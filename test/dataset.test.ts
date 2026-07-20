import assert from "node:assert/strict";
import test from "node:test";

import { dataset, models, modelsByIdentifier } from "../src/data.js";
import {
  DatasetValidationError,
  identifierKey,
  isIsoDate,
  normalizedDate,
  parseDataset,
  projectModel,
  type CatalogModel,
  type Provider,
} from "../src/types.js";
import { asArray, asRecord, type JsonRecord } from "./helpers.js";

function validDataset(): JsonRecord {
  return asRecord(structuredClone(dataset));
}

function firstModel(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(candidate["models"])[0]);
}

function firstIdentifier(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(firstModel(candidate)["identifiers"])[0]);
}

function firstAvailabilityEvent(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(firstModel(candidate)["availability_events"])[0]);
}

function firstLifecycleEvent(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(firstModel(candidate)["lifecycle_events"])[0]);
}

function firstSource(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(firstAvailabilityEvent(candidate)["sources"])[0]);
}

interface InvalidDatasetCase {
  readonly name: string;
  readonly message: RegExp;
  readonly mutate: (candidate: JsonRecord) => void;
}

function assertInvalid(candidate: unknown, message: RegExp): void {
  assert.throws(
    () => parseDataset(candidate),
    (error: unknown) => error instanceof DatasetValidationError && message.test(error.message),
  );
}

async function runInvalidCases(
  context: test.TestContext,
  cases: readonly InvalidDatasetCase[],
): Promise<void> {
  for (const invalidCase of cases) {
    await context.test(invalidCase.name, () => {
      const candidate = validDataset();
      invalidCase.mutate(candidate);
      assertInvalid(candidate, invalidCase.message);
    });
  }
}

test("the production schema-v2 catalog satisfies every identity and event invariant", () => {
  assert.equal(dataset.schema_version, 2);
  assert.equal(dataset.providers.length, 5);
  assert.equal(dataset.models.length, 48);
  assert.equal(models.length, 48);
  assert.equal(modelsByIdentifier.size, 85);
  assert.equal(dataset.coverage.exhaustive, false);
  assert.match(dataset.coverage.statement, /non-exhaustive/);
  assert.deepEqual(parseDataset(dataset), dataset);
  assert.equal(new Set(dataset.models.map((model) => model.model)).size, dataset.models.length);
  assert.ok(dataset.models.every((model) => model.identifiers.length > 0));
  assert.ok(dataset.models.every((model) => model.availability_events.length > 0));
  assert.ok(
    dataset.models.every((model) =>
      [...model.availability_events, ...model.lifecycle_events].every(
        (event) => event.sources.length > 0,
      ),
    ),
  );
  assert.equal(
    modelsByIdentifier.get(identifierKey({ namespace: "deepseek-api", value: "deepseek-reasoner" }))
      ?.model,
    "deepseek-ai/deepseek-r1",
  );
});

test("compatibility fields are derived from event-level data", () => {
  const deepseek = models.find((model) => model.model === "deepseek-ai/deepseek-r1");
  assert.ok(deepseek !== undefined);
  assert.equal(deepseek.release_date, "2025-01-20");
  assert.equal(deepseek.release_date_precision, "day");
  assert.deepEqual(deepseek.availability, ["api", "weights"]);
  assert.equal(deepseek.confidence, "confirmed");
  assert.equal(deepseek.sources.length, 1, "duplicate event evidence is projected once");
  assert.equal(deepseek.lifecycle_status, "retirement_scheduled");
  assert.equal(deepseek.provider.name, "DeepSeek");

  const candidate = validDataset();
  const model = firstModel(candidate);
  model["lifecycle_events"] = [];
  const event = firstAvailabilityEvent(candidate);
  event["date"] = "2023-03";
  event["date_precision"] = "month";
  const parsed = parseDataset(candidate);
  const projected = projectModel(parsed.models[0] as CatalogModel, parsed.providers[0] as Provider);
  assert.equal(projected.release_date, "2023-03-01");
  assert.equal(projected.release_date_precision, "month");
  assert.equal(projected.lifecycle_status, "unknown");
});

test("date validation and normalization handle day, month, and year precision", () => {
  for (const value of ["2024-02-29", "2025-01-01", "2025-12-31"]) {
    assert.equal(isIsoDate(value), true, value);
  }
  for (const value of ["2023-02-29", "2025-02-30", "2025-00-10", "2025-13-01", "2025-1-01", "01-01-2025", ""]) {
    assert.equal(isIsoDate(value), false, value);
  }
  assert.equal(normalizedDate("2025-03-04"), "2025-03-04");
  assert.equal(normalizedDate("2025-03", "month"), "2025-03-01");
  assert.equal(normalizedDate("2025", "year"), "2025-01-01");
});

test("top-level, coverage, definition, and provider violations are rejected", async (context) => {
  assertInvalid(null, /dataset must be an object/);
  assertInvalid([], /dataset must be an object/);
  await runInvalidCases(context, [
    { name: "unknown top-level field", message: /dataset.extra is not supported/, mutate: (value) => { value["extra"] = true; } },
    { name: "missing top-level field", message: /dataset.models is required/, mutate: (value) => { delete value["models"]; } },
    { name: "wrong schema", message: /schema_version must be 2/, mutate: (value) => { value["schema_version"] = 1; } },
    { name: "invalid research date", message: /researched_at must be a real ISO date/, mutate: (value) => { value["researched_at"] = "2026-02-30"; } },
    { name: "models is not an array", message: /models must be a non-empty array/, mutate: (value) => { value["models"] = {}; } },
    { name: "models is empty", message: /models must be a non-empty array/, mutate: (value) => { value["models"] = []; } },
    { name: "definition missing", message: /identifier_kind_definition.alias is required/, mutate: (value) => { delete asRecord(value["identifier_kind_definition"])["alias"]; } },
    { name: "definition extra", message: /availability_definition.private is not supported/, mutate: (value) => { asRecord(value["availability_definition"])["private"] = "Private"; } },
    { name: "definition empty", message: /availability_definition.api must be a non-empty string/, mutate: (value) => { asRecord(value["availability_definition"])["api"] = ""; } },
    { name: "coverage is not an object", message: /coverage must be an object/, mutate: (value) => { value["coverage"] = null; } },
    { name: "coverage extra", message: /coverage.extra is not supported/, mutate: (value) => { asRecord(value["coverage"])["extra"] = true; } },
    { name: "coverage claims exhaustive", message: /exhaustive must be false/, mutate: (value) => { asRecord(value["coverage"])["exhaustive"] = true; } },
    { name: "providers is empty", message: /providers must be a non-empty array/, mutate: (value) => { value["providers"] = []; } },
    { name: "provider is not an object", message: /providers\[0\] must be an object/, mutate: (value) => { asArray(value["providers"])[0] = null; } },
    { name: "provider field missing", message: /providers\[0\].name is required/, mutate: (value) => { delete asRecord(asArray(value["providers"])[0])["name"]; } },
    { name: "provider ID malformed", message: /providers\[0\].id is malformed/, mutate: (value) => { asRecord(asArray(value["providers"])[0])["id"] = "Open AI"; } },
    { name: "provider URL invalid", message: /website must be a valid URL/, mutate: (value) => { asRecord(asArray(value["providers"])[0])["website"] = "nope"; } },
    { name: "provider URL insecure", message: /website must use HTTPS/, mutate: (value) => { asRecord(asArray(value["providers"])[0])["website"] = "http://example.com"; } },
    { name: "duplicate provider", message: /duplicate provider IDs/, mutate: (value) => { const providers = asArray(value["providers"]); providers.push(structuredClone(providers[0])); } },
  ]);
});

test("model, identifier, and relationship violations are rejected", async (context) => {
  await runInvalidCases(context, [
    { name: "model is not an object", message: /models\[0\] must be an object/, mutate: (value) => { asArray(value["models"])[0] = null; } },
    { name: "unknown model field", message: /models\[0\].extra is not supported/, mutate: (value) => { firstModel(value)["extra"] = true; } },
    { name: "missing model field", message: /display_name is required/, mutate: (value) => { delete firstModel(value)["display_name"]; } },
    { name: "model ID empty", message: /model must be a non-empty string/, mutate: (value) => { firstModel(value)["model"] = ""; } },
    { name: "model ID has no provider", message: /one provider\/name separator/, mutate: (value) => { firstModel(value)["model"] = "model"; } },
    { name: "model ID has extra separator", message: /one provider\/name separator/, mutate: (value) => { firstModel(value)["model"] = "openai/team/model"; } },
    { name: "provider prefix differs", message: /provider_id must match/, mutate: (value) => { firstModel(value)["provider_id"] = "anthropic"; } },
    { name: "unknown provider", message: /references unknown provider/, mutate: (value) => { const model = firstModel(value); model["model"] = "missing/model"; model["provider_id"] = "missing"; } },
    { name: "invalid verification date", message: /verified_at must be a real ISO date/, mutate: (value) => { firstModel(value)["verified_at"] = "2026-02-30"; } },
    { name: "verification after research", message: /verified_at cannot exceed researched_at/, mutate: (value) => { firstModel(value)["verified_at"] = "2026-07-21"; } },
    { name: "unsupported identifier type", message: /identifier_type is not supported/, mutate: (value) => { firstModel(value)["identifier_type"] = "alias"; } },
    { name: "identifiers empty", message: /identifiers must be a non-empty array/, mutate: (value) => { firstModel(value)["identifiers"] = []; } },
    { name: "identifier not object", message: /identifiers\[0\] must be an object/, mutate: (value) => { asArray(firstModel(value)["identifiers"])[0] = null; } },
    { name: "identifier extra", message: /identifiers\[0\].extra is not supported/, mutate: (value) => { firstIdentifier(value)["extra"] = true; } },
    { name: "identifier namespace malformed", message: /namespace is malformed/, mutate: (value) => { firstIdentifier(value)["namespace"] = "OpenAI API"; } },
    { name: "identifier value malformed", message: /value is malformed/, mutate: (value) => { firstIdentifier(value)["value"] = "bad value"; } },
    { name: "identifier value too long", message: /value is malformed/, mutate: (value) => { firstIdentifier(value)["value"] = "x".repeat(201); } },
    { name: "identifier kind unsupported", message: /kind is not supported/, mutate: (value) => { firstIdentifier(value)["kind"] = "route"; } },
    { name: "identifier duplicate within model", message: /identifiers contains duplicates/, mutate: (value) => { const list = asArray(firstModel(value)["identifiers"]); list.push(structuredClone(list[0])); } },
    { name: "identifier duplicate across models", message: /duplicate identifier/, mutate: (value) => { const modelsValue = asArray(value["models"]); asRecord(asArray(asRecord(modelsValue[1])["identifiers"])[0])["namespace"] = firstIdentifier(value)["namespace"]; asRecord(asArray(asRecord(modelsValue[1])["identifiers"])[0])["value"] = firstIdentifier(value)["value"]; } },
    { name: "duplicate model", message: /duplicate model/, mutate: (value) => { const list = asArray(value["models"]); list.push(structuredClone(list[0])); } },
    { name: "relationships not array", message: /relationships must be an array/, mutate: (value) => { firstModel(value)["relationships"] = null; } },
    { name: "relationship unknown field", message: /relationships\[0\].extra is not supported/, mutate: (value) => { const model = asRecord(asArray(value["models"])[4]); asRecord(asArray(model["relationships"])[0])["extra"] = true; } },
    { name: "relationship unsupported", message: /type is not supported/, mutate: (value) => { const model = asRecord(asArray(value["models"])[4]); asRecord(asArray(model["relationships"])[0])["type"] = "variant_of"; } },
    { name: "relationship target unknown", message: /references unknown model/, mutate: (value) => { const model = asRecord(asArray(value["models"])[4]); asRecord(asArray(model["relationships"])[0])["target_model"] = "openai/missing"; } },
    { name: "relationship self reference", message: /cannot relate to itself/, mutate: (value) => { const model = asRecord(asArray(value["models"])[4]); asRecord(asArray(model["relationships"])[0])["target_model"] = model["model"]; } },
    { name: "duplicate relationship", message: /duplicate relationships/, mutate: (value) => { const model = asRecord(asArray(value["models"])[4]); const list = asArray(model["relationships"]); list.push(structuredClone(list[0])); } },
  ]);
});

test("availability and lifecycle event violations are rejected", async (context) => {
  await runInvalidCases(context, [
    { name: "availability events empty", message: /availability_events must be a non-empty array/, mutate: (value) => { firstModel(value)["availability_events"] = []; } },
    { name: "availability event not object", message: /availability_events\[0\] must be an object/, mutate: (value) => { asArray(firstModel(value)["availability_events"])[0] = null; } },
    { name: "availability extra field", message: /availability_events\[0\].extra is not supported/, mutate: (value) => { firstAvailabilityEvent(value)["extra"] = true; } },
    { name: "channel unsupported", message: /channel is not supported/, mutate: (value) => { firstAvailabilityEvent(value)["channel"] = "private"; } },
    { name: "stage unsupported", message: /stage is not supported/, mutate: (value) => { firstAvailabilityEvent(value)["stage"] = "beta"; } },
    { name: "confidence unsupported", message: /confidence is not supported/, mutate: (value) => { firstAvailabilityEvent(value)["confidence"] = "likely"; } },
    { name: "day invalid", message: /date must match its date_precision/, mutate: (value) => { firstAvailabilityEvent(value)["date"] = "2025-02-30"; } },
    { name: "month invalid", message: /date must match its date_precision/, mutate: (value) => { const event = firstAvailabilityEvent(value); event["date"] = "2025-13"; event["date_precision"] = "month"; } },
    { name: "year invalid", message: /date must match its date_precision/, mutate: (value) => { const event = firstAvailabilityEvent(value); event["date"] = "25"; event["date_precision"] = "year"; } },
    { name: "precision unsupported", message: /date_precision is not supported/, mutate: (value) => { firstAvailabilityEvent(value)["date_precision"] = "quarter"; } },
    { name: "lifecycle events not array", message: /lifecycle_events must be an array/, mutate: (value) => { firstModel(value)["lifecycle_events"] = null; } },
    { name: "lifecycle event not object", message: /lifecycle_events\[0\] must be an object/, mutate: (value) => { asArray(firstModel(value)["lifecycle_events"])[0] = null; } },
    { name: "lifecycle status unsupported", message: /status is not supported/, mutate: (value) => { firstLifecycleEvent(value)["status"] = "paused"; } },
    { name: "lifecycle date role unsupported", message: /date_role is not supported/, mutate: (value) => { firstLifecycleEvent(value)["date_role"] = "guessed"; } },
    { name: "lifecycle channel unsupported", message: /channel is not supported/, mutate: (value) => { firstLifecycleEvent(value)["channel"] = "chat"; } },
    { name: "lifecycle identifier malformed", message: /identifier.*namespace is malformed/, mutate: (value) => { const event = firstLifecycleEvent(value); event["identifier"] = { namespace: "Bad Namespace", value: "x" }; } },
    { name: "lifecycle identifier value malformed", message: /identifier.*value is malformed/, mutate: (value) => { const event = firstLifecycleEvent(value); event["identifier"] = { namespace: "openai-api", value: "bad value" }; } },
    { name: "lifecycle identifier value too long", message: /identifier.*value is malformed/, mutate: (value) => { const event = firstLifecycleEvent(value); event["identifier"] = { namespace: "openai-api", value: "x".repeat(201) }; } },
    { name: "lifecycle identifier belongs elsewhere", message: /identifier must belong to the model/, mutate: (value) => { const event = firstLifecycleEvent(value); event["identifier"] = { namespace: "openai-api", value: "not-this-model" }; } },
  ]);

  const candidate = validDataset();
  const event = firstAvailabilityEvent(candidate);
  event["date_precision"] = "day";
  firstLifecycleEvent(candidate)["date_precision"] = "day";
  const parsed = parseDataset(candidate).models[0];
  assert.equal(parsed?.availability_events[0]?.date_precision, "day");
  assert.equal(parsed?.lifecycle_events[0]?.date_precision, "day");
});

test("source validation rejects incomplete, unsafe, and malformed evidence", async (context) => {
  await runInvalidCases(context, [
    { name: "sources empty", message: /sources must be a non-empty array/, mutate: (value) => { firstAvailabilityEvent(value)["sources"] = []; } },
    { name: "source not object", message: /sources\[0\] must be an object/, mutate: (value) => { asArray(firstAvailabilityEvent(value)["sources"])[0] = null; } },
    { name: "source extra", message: /sources\[0\].extra is not supported/, mutate: (value) => { firstSource(value)["extra"] = true; } },
    { name: "source missing", message: /evidence is required/, mutate: (value) => { delete firstSource(value)["evidence"]; } },
    { name: "source publisher empty", message: /publisher must be a non-empty string/, mutate: (value) => { firstSource(value)["publisher"] = ""; } },
    { name: "source URL invalid", message: /url must be a valid URL/, mutate: (value) => { firstSource(value)["url"] = "not-a-url"; } },
    { name: "source URL insecure", message: /url must use HTTPS/, mutate: (value) => { firstSource(value)["url"] = "http://example.com"; } },
  ]);
});

test("projection rejects a programmatically constructed model without availability", () => {
  const model: CatalogModel = {
    ...dataset.models[0] as CatalogModel,
    availability_events: [],
  };
  assert.throws(
    () => projectModel(model, dataset.providers[0] as Provider),
    /has no availability event/,
  );
});
