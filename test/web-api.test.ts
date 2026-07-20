import assert from "node:assert/strict";
import test from "node:test";

import modelHandler from "../api/model.js";
import modelsHandler from "../api/models.js";
import identifierHandler from "../api/identifier.js";
import { dataset, models } from "../src/data.js";
import { asArray, asRecord, type JsonRecord } from "./helpers.js";
import {
  ApiClientError,
  buildItemPath,
  buildIdentifierPath,
  buildListPath,
  fetchIdentifier,
  fetchModel,
  fetchModels,
  type Fetcher,
  type ListFilters,
} from "../web/api.js";

function defaultFilters(overrides: Partial<ListFilters> = {}): ListFilters {
  return {
    q: "",
    provider: "",
    identifierNamespace: "",
    identifier: "",
    identifierType: "",
    availability: "",
    availabilityStage: "",
    lifecycleStatus: "",
    from: "",
    to: "",
    sort: "release_date",
    order: "asc",
    limit: 50,
    offset: 0,
    ...overrides,
  };
}

const handlerFetch: Fetcher = async (input, init) => {
  const url = new URL(input, "https://example.test");
  const identifierMatch = /^\/api\/identifiers\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (identifierMatch !== null) {
    const rewritten = new URL("https://example.test/api/identifier");
    rewritten.searchParams.set("namespace", decodeURIComponent(identifierMatch[1] ?? ""));
    rewritten.searchParams.set("identifier", decodeURIComponent(identifierMatch[2] ?? ""));
    return identifierHandler.fetch(new Request(rewritten, init));
  }
  const itemMatch = /^\/api\/models\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (itemMatch !== null) {
    const provider = itemMatch[1];
    const model = itemMatch[2];
    const rewritten = new URL("https://example.test/api/model");
    rewritten.searchParams.set("provider", decodeURIComponent(provider ?? ""));
    rewritten.searchParams.set("model", decodeURIComponent(model ?? ""));
    return modelHandler.fetch(new Request(rewritten, init));
  }
  if (url.pathname === "/api/models") {
    return modelsHandler.fetch(new Request(url, init));
  }
  return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
};

async function expectClientError(
  action: () => Promise<unknown>,
  status: number,
  code: string,
  message: RegExp,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof ApiClientError &&
      error.status === status &&
      error.code === code &&
      message.test(error.message),
  );
}

function validListBody(): JsonRecord {
  return {
    data: [structuredClone(models[0])],
    meta: {
      schema_version: dataset.schema_version,
      researched_at: dataset.researched_at,
      coverage: dataset.coverage,
      total: 1,
      count: 1,
      limit: 50,
      offset: 0,
    },
  };
}

function responseModel(body: JsonRecord): JsonRecord {
  return asRecord(asArray(body["data"])[0]);
}

test("the explorer builds documented list URLs from practical filters", () => {
  assert.equal(
    buildListPath(
      defaultFilters({
        q: "  gpt-4o  ",
        provider: "openai",
        identifierNamespace: "openai-api",
        identifier: "gpt-4o",
        identifierType: "snapshot",
        availability: "api",
        availabilityStage: "public",
        lifecycleStatus: "active",
        from: "2024-01-01",
        to: "2025-01-01",
        sort: "model",
        order: "desc",
        limit: 25,
        offset: 50,
      }),
    ),
    "/api/models?q=gpt-4o&provider=openai&identifier_namespace=openai-api&identifier=gpt-4o&identifier_type=snapshot&availability=api&availability_stage=public&lifecycle_status=active&from=2024-01-01&to=2025-01-01&sort=model&order=desc&limit=25&offset=50",
  );
  assert.equal(
    buildListPath(defaultFilters()),
    "/api/models?sort=release_date&order=asc&limit=50&offset=0",
  );
});

test("the explorer builds and validates public item URLs", () => {
  assert.equal(buildItemPath(" openai/gpt-4o "), "/api/models/openai/gpt-4o");
  assert.equal(
    buildItemPath("provider/model name"),
    "/api/models/provider/model%20name",
  );
  for (const modelId of ["", "openai", "openai/", "/gpt-4o", "a/b/c"]) {
    assert.throws(
      () => buildItemPath(modelId),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 0 &&
        error.code === "invalid_model",
    );
  }
});

test("the explorer builds and validates exact identifier URLs", () => {
  assert.equal(
    buildIdentifierPath(" deepseek-api ", " deepseek-reasoner "),
    "/api/identifiers/deepseek-api/deepseek-reasoner",
  );
  assert.equal(
    buildIdentifierPath("huggingface", "deepseek-ai/DeepSeek-R1"),
    "/api/identifiers/huggingface/deepseek-ai%2FDeepSeek-R1",
  );
  for (const [namespace, identifier] of [["Bad Namespace", "value"], ["openai-api", ""], ["openai-api", "bad value"], ["openai-api", "x".repeat(201)]]) {
    assert.throws(
      () => buildIdentifierPath(namespace ?? "", identifier ?? ""),
      (error: unknown) => error instanceof ApiClientError && error.code === "invalid_identifier",
    );
  }
});

test("the browser list client consumes the real filtered API response", async () => {
  const response = await fetchModels(
    handlerFetch,
    defaultFilters({
      provider: "openai",
      availability: "api",
      from: "2025-04-16",
      to: "2025-04-16",
      limit: 10,
    }),
  );

  assert.deepEqual(
    response.data.map((model) => model.model),
    ["openai/o3", "openai/o4-mini"],
  );
  assert.equal(response.meta.total, 2);
  assert.equal(response.meta.count, 2);
  assert.equal(response.meta.offset, 0);
  assert.ok(response.data.every((model) => model.availability.includes("api")));
});

test("the browser item client consumes the real public item endpoint", async () => {
  const response = await fetchModel(handlerFetch, "openai/gpt-4o");
  assert.equal(response.data.model, "openai/gpt-4o");
  assert.equal(response.data.release_date, "2024-05-13");
  assert.equal(response.data.identifier_type, "model");
  assert.equal(response.data.confidence, "confirmed");
  assert.equal(response.data.sources[0]?.publisher, "OpenAI");
  assert.equal(response.meta.schema_version, 2);
  assert.equal(response.meta.coverage.exhaustive, false);
});

test("the browser client parses model relationships", async () => {
  const response = await fetchModel(handlerFetch, "openai/gpt-4o-2024-05-13");
  assert.deepEqual(response.data.relationships, [
    { type: "snapshot_of", target_model: "openai/gpt-4o" },
  ]);
});

test("the browser client preserves optional precision and lifecycle context", async () => {
  const body = validListBody();
  const model = responseModel(body);
  asRecord(asArray(model["availability_events"])[0])["date_precision"] = "month";
  const lifecycle = asRecord(asArray(model["lifecycle_events"])[0]);
  lifecycle["date_precision"] = "year";
  delete lifecycle["channel"];
  lifecycle["identifier"] = { namespace: "openai-api", value: "gpt-3.5-turbo" };
  model["relationships"] = [{ type: "alias_of", target_model: "openai/gpt-3.5-turbo-0301" }];
  const fetcher: Fetcher = async () => Response.json(body);
  const response = await fetchModels(fetcher, defaultFilters());
  assert.equal(response.data[0]?.availability_events[0]?.date_precision, "month");
  assert.equal(response.data[0]?.lifecycle_events[0]?.date_precision, "year");
  assert.equal(response.data[0]?.lifecycle_events[0]?.channel, undefined);
  assert.equal(response.data[0]?.lifecycle_events[0]?.identifier?.value, "gpt-3.5-turbo");
  assert.equal(response.data[0]?.relationships[0]?.type, "alias_of");
});

test("the browser resolves exact upstream identifiers", async () => {
  const response = await fetchIdentifier(handlerFetch, "deepseek-api", "deepseek-reasoner");
  assert.equal(response.data.model, "deepseek-ai/deepseek-r1");
  assert.deepEqual(response.meta.matched_identifier, {
    namespace: "deepseek-api",
    value: "deepseek-reasoner",
  });
});

test("API errors retain their HTTP status, stable code, and useful message", async () => {
  await expectClientError(
    () => fetchModel(handlerFetch, "openai/not-real"),
    404,
    "model_not_found",
    /openai\/not-real/,
  );
});

test("non-JSON and unstructured failures become safe client errors", async () => {
  const invalidJson: Fetcher = async () => new Response("not json", { status: 502 });
  await expectClientError(
    () => fetchModels(invalidJson, defaultFilters()),
    502,
    "invalid_response",
    /invalid JSON/,
  );

  const unstructured: Fetcher = async () => Response.json({ message: "Nope" }, { status: 503 });
  await expectClientError(
    () => fetchModels(unstructured, defaultFilters()),
    503,
    "request_failed",
    /status 503/,
  );

  const malformedError: Fetcher = async () =>
    Response.json({ error: { code: 12, message: "Nope" } }, { status: 400 });
  await expectClientError(
    () => fetchModels(malformedError, defaultFilters()),
    502,
    "invalid_response",
    /error.code is not a string/,
  );
});

test("malformed successful list responses are rejected at the browser boundary", async (context) => {
  const structuralCases: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ["response object", null, /response is not an object/],
    ["data array", { data: {}, meta: {} }, /response.data is not an array/],
    ["model object", { data: [null], meta: {} }, /data\[0\] is not an object/],
  ];

  for (const [name, body, message] of structuralCases) {
    await context.test(name, async () => {
      const fetcher: Fetcher = async () => Response.json(body);
      await expectClientError(
        () => fetchModels(fetcher, defaultFilters()),
        502,
        "invalid_response",
        message,
      );
    });
  }

  interface InvalidResponseCase {
    readonly name: string;
    readonly message: RegExp;
    readonly mutate: (model: JsonRecord) => void;
  }
  const cases: readonly InvalidResponseCase[] = [
    { name: "model string", message: /data\[0\].model is not a string/, mutate: (model) => { model["model"] = 1; } },
    { name: "provider object", message: /provider is not an object/, mutate: (model) => { model["provider"] = null; } },
    { name: "provider ID", message: /provider.id is not a string/, mutate: (model) => { asRecord(model["provider"])["id"] = 1; } },
    { name: "identifier enum", message: /identifier_type is unsupported/, mutate: (model) => { model["identifier_type"] = "alias"; } },
    { name: "identifiers array", message: /identifiers is not an array/, mutate: (model) => { model["identifiers"] = {}; } },
    { name: "identifier kind", message: /identifiers\[0\].kind is unsupported/, mutate: (model) => { asRecord(asArray(model["identifiers"])[0])["kind"] = "route"; } },
    { name: "identifier namespace", message: /identifiers\[0\].namespace is not a string/, mutate: (model) => { asRecord(asArray(model["identifiers"])[0])["namespace"] = 1; } },
    { name: "relationships array", message: /relationships is not an array/, mutate: (model) => { model["relationships"] = {}; } },
    { name: "relationship object", message: /relationships\[0\] is not an object/, mutate: (model) => { model["relationships"] = [null]; } },
    { name: "relationship type", message: /relationships\[0\].type is unsupported/, mutate: (model) => { model["relationships"] = [{ type: "variant_of", target_model: "a/b" }]; } },
    { name: "availability events array", message: /availability_events is not an array/, mutate: (model) => { model["availability_events"] = {}; } },
    { name: "availability event object", message: /availability_events\[0\] is not an object/, mutate: (model) => { model["availability_events"] = [null]; } },
    { name: "availability channel", message: /channel is unsupported/, mutate: (model) => { asRecord(asArray(model["availability_events"])[0])["channel"] = "private"; } },
    { name: "availability stage", message: /stage is unsupported/, mutate: (model) => { asRecord(asArray(model["availability_events"])[0])["stage"] = "private"; } },
    { name: "availability optional precision type", message: /date_precision is not a string/, mutate: (model) => { asRecord(asArray(model["availability_events"])[0])["date_precision"] = 1; } },
    { name: "availability precision", message: /date_precision is unsupported/, mutate: (model) => { asRecord(asArray(model["availability_events"])[0])["date_precision"] = "quarter"; } },
    { name: "lifecycle events array", message: /lifecycle_events is not an array/, mutate: (model) => { model["lifecycle_events"] = {}; } },
    { name: "lifecycle event object", message: /lifecycle_events\[0\] is not an object/, mutate: (model) => { model["lifecycle_events"] = [null]; } },
    { name: "lifecycle event status", message: /lifecycle_events\[0\].status is unsupported/, mutate: (model) => { asRecord(asArray(model["lifecycle_events"])[0])["status"] = "paused"; } },
    { name: "lifecycle date role", message: /date_role is unsupported/, mutate: (model) => { asRecord(asArray(model["lifecycle_events"])[0])["date_role"] = "guessed"; } },
    { name: "lifecycle channel", message: /channel is unsupported/, mutate: (model) => { asRecord(asArray(model["lifecycle_events"])[0])["channel"] = "chat"; } },
    { name: "lifecycle identifier", message: /identifier is not an object/, mutate: (model) => { asRecord(asArray(model["lifecycle_events"])[0])["identifier"] = null; } },
    { name: "availability array", message: /availability is not an array/, mutate: (model) => { model["availability"] = "api"; } },
    { name: "availability enum", message: /availability\[0\] is unsupported/, mutate: (model) => { model["availability"] = ["private"]; } },
    { name: "date precision", message: /release_date_precision is unsupported/, mutate: (model) => { model["release_date_precision"] = "quarter"; } },
    { name: "confidence enum", message: /confidence is unsupported/, mutate: (model) => { model["confidence"] = "likely"; } },
    { name: "sources array", message: /sources is not an array/, mutate: (model) => { model["sources"] = {}; } },
    { name: "source object", message: /sources\[0\] is not an object/, mutate: (model) => { model["sources"] = [null]; } },
    { name: "source string", message: /publisher is not a string/, mutate: (model) => { model["sources"] = [{ publisher: 1, title: "T", url: "https://example.com", evidence: "E" }]; } },
    { name: "lifecycle status", message: /lifecycle_status is unsupported/, mutate: (model) => { model["lifecycle_status"] = "paused"; } },
  ];
  for (const invalidCase of cases) {
    await context.test(invalidCase.name, async () => {
      const body = validListBody();
      invalidCase.mutate(responseModel(body));
      const fetcher: Fetcher = async () => Response.json(body);
      await expectClientError(
        () => fetchModels(fetcher, defaultFilters()),
        502,
        "invalid_response",
        invalidCase.message,
      );
    });
  }
});

test("malformed list metadata is rejected", async () => {
  const fetcher: Fetcher = async () =>
    Response.json({
      data: [],
      meta: {
        schema_version: "1",
        researched_at: "2026-07-20",
        coverage: dataset.coverage,
        total: 0,
        count: 0,
        limit: 50,
        offset: 0,
      },
    });
  await expectClientError(
    () => fetchModels(fetcher, defaultFilters()),
    502,
    "invalid_response",
    /schema_version is not a number/,
  );
});

test("catalog coverage must explicitly disclose that it is non-exhaustive", async () => {
  const body = validListBody();
  asRecord(asRecord(body["meta"])["coverage"])["exhaustive"] = true;
  const fetcher: Fetcher = async () => Response.json(body);
  await expectClientError(
    () => fetchModels(fetcher, defaultFilters()),
    502,
    "invalid_response",
    /coverage.exhaustive is not false/,
  );
});
