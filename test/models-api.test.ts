import assert from "node:assert/strict";
import test from "node:test";

import { dataset, models, modelsByIdentifier } from "../src/data.js";
import { identifierKey } from "../src/types.js";
import { handlePostRequest, handleRequest } from "../src/http.js";
import {
  asArray,
  asRecord,
  allModelsFrom,
  identifierRequest,
  itemRequest,
  listRequest,
  modelIds,
  modelsFrom,
  responseBody,
} from "./helpers.js";

test("the default list returns the first model page in chronological order", async () => {
  const response = listRequest();
  const body = await responseBody(response);
  const models = asArray(body["data"]).map(asRecord);
  const meta = asRecord(body["meta"]);

  assert.equal(response.status, 200);
  assert.equal(models.length, 50);
  assert.equal(meta["schema_version"], dataset.schema_version);
  assert.equal(meta["researched_at"], dataset.researched_at);
  assert.equal(meta["total"], dataset.models.length);
  assert.equal(meta["count"], 50);
  assert.equal(meta["limit"], 50);
  assert.equal(meta["offset"], 0);

  for (let index = 1; index < models.length; index += 1) {
    const previous = asRecord(models[index - 1]);
    const current = asRecord(models[index]);
    const previousDate = String(previous["release_date"]);
    const currentDate = String(current["release_date"]);
    assert.ok(
      previousDate < currentDate ||
        (previousDate === currentDate &&
          String(previous["model"]).localeCompare(String(current["model"])) <= 0),
    );
  }
});

test("every published model can be retrieved by its public item URL", async (context) => {
  for (const expected of models) {
    await context.test(expected.model, async () => {
      const separator = expected.model.indexOf("/");
      const provider = expected.model.slice(0, separator);
      const model = expected.model.slice(separator + 1);
      const response = itemRequest(provider, model);
      const body = await responseBody(response);

      assert.equal(response.status, 200);
      assert.deepEqual(body["data"], expected);
      assert.deepEqual(body["meta"], {
        schema_version: dataset.schema_version,
        dataset_version: dataset.dataset_version,
        researched_at: dataset.researched_at,
        changelog_url: dataset.changelog_url,
        coverage: dataset.coverage,
      });
    });
  }
});

test("Anthropic canonical lookups treat numeric version dots and dashes as aliases", async (context) => {
  const aliasedModels = models.filter(
    (model) => model.provider_id === "anthropic" && /(\d)\.(?=\d)/.test(model.model),
  );

  for (const expected of aliasedModels) {
    await context.test(expected.model, async () => {
      const alias = expected.model.slice("anthropic/".length).replace(/(\d)\.(?=\d)/g, "$1-");
      const response = itemRequest("anthropic", alias);
      const body = await responseBody(response);

      assert.equal(response.status, 200);
      assert.deepEqual(body["data"], expected);
    });
  }
});

test("every official identifier resolves to exactly its canonical model", async (context) => {
  for (const catalogModel of dataset.models) {
    for (const identifier of catalogModel.identifiers) {
      const name = `${identifier.namespace}/${identifier.value}`;
      await context.test(name, async () => {
        const response = identifierRequest(identifier.namespace, identifier.value);
        const body = await responseBody(response);
        const resolved = asRecord(body["data"]);
        const meta = asRecord(body["meta"]);
        assert.equal(response.status, 200);
        assert.equal(resolved["model"], catalogModel.model);
        assert.deepEqual(meta["matched_identifier"], {
          namespace: identifier.namespace,
          value: identifier.value,
        });
        assert.equal(
          modelsByIdentifier.get(identifierKey(identifier))?.model,
          catalogModel.model,
        );
      });
    }
  }
});

test("provider filters return only that provider's complete catalog", async () => {
  for (const provider of dataset.providers.map((item) => item.id)) {
    const expectedCount = dataset.models.filter((model) => model.provider_id === provider).length;
    const response = listRequest(`provider=${encodeURIComponent(provider)}&limit=100`);
    const body = await responseBody(response);
    const models = asArray(body["data"]).map(asRecord);
    const meta = asRecord(body["meta"]);
    assert.equal(response.status, 200);
    assert.equal(models.length, expectedCount);
    assert.equal(meta["total"], expectedCount);
    assert.ok(modelIds(models).every((model) => model.startsWith(`${provider}/`)));
  }
});

test("availability filters distinguish API access from downloadable weights", async () => {
  const apiModels = await allModelsFrom("availability=api");
  const weightModels = await allModelsFrom("availability=weights");

  assert.equal(
    apiModels.length,
    models.filter((model) => model.availability.includes("api")).length,
  );
  assert.equal(
    weightModels.length,
    models.filter((model) => model.availability.includes("weights")).length,
  );
  assert.ok(apiModels.every((model) => asArray(model["availability"]).includes("api")));
  assert.ok(weightModels.every((model) => asArray(model["availability"]).includes("weights")));
  assert.ok(modelIds(apiModels).includes("deepseek/deepseek-r1"));
  assert.ok(modelIds(weightModels).includes("deepseek/deepseek-r1"));
});

test("identifier type and confidence filters match their documented values", async () => {
  for (const identifierType of ["model", "snapshot", "weights"] as const) {
    const expectedCount = models.filter(
      (model) => model.identifier_type === identifierType,
    ).length;
    const filteredModels = await allModelsFrom(`identifier_type=${identifierType}`);
    assert.equal(filteredModels.length, expectedCount);
    assert.ok(filteredModels.every((model) => model["identifier_type"] === identifierType));
  }

  const confirmed = await allModelsFrom("confidence=confirmed");
  assert.equal(confirmed.length, dataset.models.length);
  assert.ok(confirmed.every((model) => model["confidence"] === "confirmed"));
});

test("capability filters use all-of semantics and compose with provider and lifecycle", async () => {
  const vision = await allModelsFrom("capability=vision");
  assert.ok(vision.length > 0);
  assert.ok(vision.every((model) => asArray(model["capabilities"]).includes("vision")));

  const activeOpenAiReasoningVision = await allModelsFrom(
    "provider=openai&capability=reasoning&capability=vision&lifecycle_status=active",
  );
  const expected = models.filter(
    (model) =>
      model.provider_id === "openai" &&
      model.capabilities.includes("reasoning") &&
      model.capabilities.includes("vision") &&
      model.lifecycle_status === "active",
  );
  assert.deepEqual(
    modelIds(activeOpenAiReasoningVision).sort(),
    expected.map((model) => model.model).sort(),
  );
});

test("updated and retirement filters use catalog-change and lifecycle dates", async () => {
  const updated = await allModelsFrom("updated_since=2026-07-22");
  assert.deepEqual(
    modelIds(updated).sort(),
    models.filter((model) => model.last_changed_at >= "2026-07-22").map((model) => model.model).sort(),
  );

  const retiring = await allModelsFrom("retiring_before=2026-09-01");
  const expected = models.filter((model) =>
    model.lifecycle_events.some(
      (event) => event.status === "retirement_scheduled" && event.date <= "2026-09-01",
    ),
  );
  assert.deepEqual(modelIds(retiring).sort(), expected.map((model) => model.model).sort());
  assert.ok(modelIds(retiring).includes("anthropic/claude-opus-4.1"));
  assert.ok(modelIds(retiring).includes("deepseek/deepseek-r1"));
});

test("deprecated models expose validated replacement hints", async () => {
  const gpt4o = asRecord((await responseBody(itemRequest("openai", "gpt-4o")))["data"]);
  assert.deepEqual(asArray(gpt4o["replacement_models"]), [
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-terra",
  ]);
  const event = asArray(gpt4o["lifecycle_events"])
    .map(asRecord)
    .find((candidate) => "replacement_models" in candidate);
  assert.deepEqual(asArray(event?.["replacement_models"]), asArray(gpt4o["replacement_models"]));

  const active = asRecord((await responseBody(itemRequest("openai", "gpt-5.6-sol")))["data"]);
  assert.deepEqual(active["replacement_models"], []);
});

test("date bounds are inclusive", async () => {
  const models = await modelsFrom(listRequest("from=2025-04-16&to=2025-04-16"));
  assert.deepEqual(modelIds(models), [
    "openai/o3",
    "openai/o4-mini",
  ]);
  assert.ok(models.every((model) => model["release_date"] === "2025-04-16"));
});

test("model search is case-insensitive and can return related identifiers", async () => {
  const models = await modelsFrom(listRequest("q=GPT-4O"));
  assert.deepEqual(modelIds(models), [
    "openai/gpt-4o",
    "openai/gpt-4o-2024-05-13",
    "openai/gpt-4o-mini",
    "openai/gpt-4o-2024-08-06",
    "openai/gpt-4o-mini-search-preview",
  ]);
});

test("users can query exact upstream identifiers, namespaces, stages, and lifecycle states", async () => {
  assert.deepEqual(
    modelIds(await modelsFrom(listRequest("identifier_namespace=deepseek-api&identifier=deepseek-reasoner"))),
    ["deepseek/deepseek-r1"],
  );
  assert.ok(
    (await modelsFrom(listRequest("identifier_namespace=huggingface"))).every((model) =>
      asArray(model["identifiers"]).map(asRecord).some((identifier) => identifier["namespace"] === "huggingface"),
    ),
  );
  const previews = await modelsFrom(listRequest("availability_stage=public_preview"));
  assert.ok(previews.length > 0);
  assert.ok(previews.every((model) => asArray(model["availability_events"]).map(asRecord).some((event) => event["stage"] === "public_preview")));
  const retired = await modelsFrom(listRequest("lifecycle_status=retired"));
  assert.ok(retired.length > 0);
  assert.ok(retired.every((model) => model["lifecycle_status"] === "retired"));
  assert.deepEqual(
    modelIds(await modelsFrom(listRequest("q=DEEPSEEK-REASONER"))),
    ["deepseek/deepseek-r1"],
  );
});

test("users can combine provider, channel, date, sorting, and pagination filters", async () => {
  const query =
    "provider=openai&availability=api&from=2025-04-01&to=2025-08-31&sort=model&order=asc&limit=3&offset=1";
  const response = listRequest(query);
  const body = await responseBody(response);
  const pageModels = asArray(body["data"]).map(asRecord);
  const meta = asRecord(body["meta"]);

  assert.equal(response.status, 200);
  const expectedTotal = models.filter(
    (model) =>
      model.provider_id === "openai" &&
      model.availability.includes("api") &&
      model.release_date >= "2025-04-01" &&
      model.release_date <= "2025-08-31",
  ).length;
  assert.equal(meta["total"], expectedTotal);
  assert.equal(meta["count"], 3);
  assert.equal(meta["limit"], 3);
  assert.equal(meta["offset"], 1);
  assert.ok(modelIds(pageModels).every((model) => model.startsWith("openai/")));
  assert.ok(pageModels.every((model) => asArray(model["availability"]).includes("api")));
  assert.ok(pageModels.every((model) => String(model["release_date"]) >= "2025-04-01"));
  assert.ok(pageModels.every((model) => String(model["release_date"]) <= "2025-08-31"));
  assert.deepEqual(modelIds(pageModels), [...modelIds(pageModels)].sort((left, right) => left.localeCompare(right)));
});

test("descending sorts reverse both primary and tie-break ordering", async () => {
  const byModel = await modelsFrom(listRequest("sort=model&order=desc"));
  const expectedByModel = [...modelIds(byModel)].sort((left, right) => right.localeCompare(left));
  assert.deepEqual(modelIds(byModel), expectedByModel);

  const byDate = await modelsFrom(listRequest("sort=release_date&order=desc"));
  for (let index = 1; index < byDate.length; index += 1) {
    const previous = asRecord(byDate[index - 1]);
    const current = asRecord(byDate[index]);
    assert.ok(String(previous["release_date"]) >= String(current["release_date"]));
  }
});

test("pagination can reconstruct the complete result set without gaps or duplicates", async () => {
  const expected = models.map((model) => model.model).sort((left, right) => left.localeCompare(right));
  const collected: string[] = [];
  const pageSize = 7;

  for (let offset = 0; offset < expected.length; offset += pageSize) {
    const response = listRequest(`sort=model&limit=${pageSize}&offset=${offset}`);
    const body = await responseBody(response);
    const page = asArray(body["data"]).map(asRecord);
    const meta = asRecord(body["meta"]);
    assert.equal(meta["total"], expected.length);
    assert.equal(meta["count"], Math.min(pageSize, expected.length - offset));
    collected.push(...modelIds(page));
  }

  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected).size, expected.length);

  const pastEnd = await responseBody(listRequest("limit=10&offset=1000"));
  assert.deepEqual(pastEnd["data"], []);
  assert.equal(asRecord(pastEnd["meta"])["total"], dataset.models.length);
});

test("valid filters with no matches return an empty successful response", async () => {
  const response = listRequest("provider=unknown&q=does-not-exist");
  const body = await responseBody(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body["data"], []);
  assert.equal(asRecord(body["meta"])["total"], 0);
});

test("bad list queries fail loudly instead of returning misleading results", async (context) => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["unknown=value", "Unknown query parameter"],
    ["q=", "cannot be empty"],
    [`q=${"x".repeat(201)}`, "cannot exceed 200"],
    ["provider=OpenAI", "provider is malformed"],
    ["provider=openai&provider=google", "must appear once"],
    ["identifier_namespace=OpenAI", "identifier_namespace is malformed"],
    ["identifier=bad%20value", "identifier is malformed"],
    [`identifier=${"x".repeat(201)}`, "identifier is malformed"],
    ["identifier_type=alias", "must be one of"],
    ["availability=private", "must be one of"],
    ["availability_stage=private", "must be one of"],
    ["lifecycle_status=sunset", "must be one of"],
    ["capability=video", "must be one of"],
    ["capability=vision&capability=vision", "contains duplicates"],
    ["capability=", "cannot be empty"],
    ["confidence=likely", "must be one of"],
    ["updated_since=2026-02-30", "real ISO date"],
    ["retiring_before=2026-02-30", "real ISO date"],
    ["from=2025-02-30", "real ISO date"],
    ["to=2025-1-01", "real ISO date"],
    ["from=2025-02-01&to=2025-01-01", "cannot be after"],
    ["sort=provider", "must be one of"],
    ["order=newest", "must be one of"],
    ["limit=0", "between 1 and 100"],
    ["limit=101", "between 1 and 100"],
    ["limit=1.5", "must be an integer"],
    ["offset=-1", "must be an integer"],
    ["offset=9007199254740992", "between 0 and 9007199254740991"],
  ];

  for (const [query, message] of cases) {
    await context.test(query.slice(0, 80), async () => {
      const response = listRequest(query);
      const body = await responseBody(response);
      const error = asRecord(body["error"]);
      assert.equal(response.status, 400);
      assert.equal(error["code"], "invalid_query");
      assert.match(String(error["message"]), new RegExp(message));
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  }
});

test("bad or unknown identifier lookups return stable errors", async (context) => {
  const malformedRequests = [
    "https://example.test/api/identifier?identifier=gpt-4o",
    "https://example.test/api/identifier?namespace=openai-api",
    "https://example.test/api/identifier?namespace=OpenAI&identifier=gpt-4o",
    "https://example.test/api/identifier?namespace=openai-api&identifier=bad%20value",
    "https://example.test/api/identifier?namespace=openai-api&identifier=gpt-4o&extra=true",
  ];
  const handler = (await import("../api/identifier.js")).default;
  for (const url of malformedRequests) {
    await context.test(url, async () => {
      const response = handler.fetch(new Request(url));
      const error = asRecord((await responseBody(response))["error"]);
      assert.equal(response.status, 400);
      assert.equal(error["code"], "invalid_query");
    });
  }

  const missing = identifierRequest("openai-api", "not-real");
  const missingBody = await responseBody(missing);
  const error = asRecord(missingBody["error"]);
  assert.equal(missing.status, 404);
  assert.equal(error["code"], "identifier_not_found");
  assert.equal("suggestions" in missingBody, false);

  const suggested = handler.fetch(new Request(
    "https://example.test/api/identifier?namespace=anthropic-api&identifier=claude-3-5-sonnet-20241023&suggestions=true&fields=model",
  ));
  const suggestedBody = await responseBody(suggested);
  const suggestions = asArray(suggestedBody["suggestions"]).map(asRecord);
  assert.equal(suggested.status, 404);
  assert.equal(asRecord(suggestions[0]?.["matched_identifier"])["value"], "claude-3-5-sonnet-20241022");
  assert.deepEqual(Object.keys(asRecord(suggestions[0]?.["model"])), ["model"]);
});

test("bad or unknown item lookups return stable errors", async (context) => {
  const malformedRequests = [
    "https://example.test/api/model?model=gpt-4o",
    "https://example.test/api/model?provider=openai",
    "https://example.test/api/model?provider=OpenAI&model=gpt-4o",
    "https://example.test/api/model?provider=openai&model=gpt%2F4o",
    "https://example.test/api/model?provider=openai&model=gpt-4o&extra=true",
    "https://example.test/api/model?provider=openai&provider=google&model=gpt-4o",
  ];

  for (const url of malformedRequests) {
    await context.test(url, async () => {
      const response = (await import("../api/model.js")).default.fetch(new Request(url));
      const error = asRecord((await responseBody(response))["error"]);
      assert.equal(response.status, 400);
      assert.equal(error["code"], "invalid_query");
    });
  }

  const missing = itemRequest("openai", "does-not-exist");
  const error = asRecord((await responseBody(missing))["error"]);
  assert.equal(missing.status, 404);
  assert.equal(error["code"], "model_not_found");
  assert.match(String(error["message"]), /openai\/does-not-exist/);
});

test("success, preflight, HEAD, and method errors expose usable HTTP headers", async () => {
  const get = listRequest();
  assert.equal(get.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(get.headers.get("access-control-allow-origin"), "*");
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.equal(get.headers.get("cache-control"), "public, max-age=300");
  assert.equal(get.headers.get("vercel-cdn-cache-control"), "max-age=3600, stale-while-revalidate=86400");

  const head = listRequest("provider=openai", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("cache-control"), "public, max-age=300");

  const options = listRequest("", "OPTIONS");
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
  assert.equal(options.headers.get("access-control-allow-headers"), "Content-Type, If-None-Match");
  assert.equal(get.headers.get("access-control-expose-headers"), "ETag");

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = listRequest("", method);
    const error = asRecord((await responseBody(response))["error"]);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
    assert.equal(error["code"], "method_not_allowed");
  }
});

test("unexpected handler failures return a generic 500 without leaking details", async () => {
  const originalError = console.error;
  console.error = (..._values: Parameters<typeof console.error>): void => {};
  try {
    const response = handleRequest(new Request("https://example.test/api/test"), () => {
      throw new Error("private implementation detail");
    });
    const error = asRecord((await responseBody(response))["error"]);
    assert.equal(response.status, 500);
    assert.equal(error["code"], "internal_error");
    assert.doesNotMatch(String(error["message"]), /private implementation detail/);

    const postResponse = await handlePostRequest(
      new Request("https://example.test/api/test", { method: "POST" }),
      () => response,
      async () => {
        throw new Error("private POST implementation detail");
      },
    );
    const postError = asRecord((await responseBody(postResponse))["error"]);
    assert.equal(postResponse.status, 500);
    assert.equal(postError["code"], "internal_error");
    assert.doesNotMatch(String(postError["message"]), /private POST implementation detail/);
  } finally {
    console.error = originalError;
  }
});
