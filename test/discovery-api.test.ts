import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import identifierNamespacesHandler from "../api/identifier-namespaces.js";
import changesHandler from "../api/changes.js";
import lifecycleStatusesHandler from "../api/lifecycle-statuses.js";
import providersHandler from "../api/providers.js";
import resolveHandler from "../api/resolve.js";
import modelsHandler from "../api/models.js";
import { MODEL_FIELDS } from "../src/catalog-api.js";
import { dataset, models, modelsByIdentifierValue } from "../src/data.js";
import { jsonResponse } from "../src/http.js";
import { suggestIdentifiers } from "../src/suggestions.js";
import { asArray, asRecord, identifierRequest, itemRequest, listRequest, responseBody } from "./helpers.js";

function resolveGet(query: string, method = "GET", headers?: HeadersInit): Promise<Response> {
  return resolveHandler.fetch(
    new Request(`https://example.test/api/resolve?${query}`, {
      method,
      ...(headers === undefined ? {} : { headers }),
    }),
  );
}

function resolvePost(
  value: string | object,
  options: { readonly query?: string; readonly headers?: HeadersInit } = {},
): Promise<Response> {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return resolveHandler.fetch(
    new Request(`https://example.test/api/resolve${options.query ?? ""}`, {
      method: "POST",
      headers,
      body,
    }),
  );
}

function changesGet(query: string, method = "GET"): Response {
  return changesHandler.fetch(
    new Request(`https://example.test/api/changes?${query}`, { method }),
  );
}

test("the OpenAPI document describes every public endpoint, schema, parameter, example, and error", () => {
  const document = asRecord(JSON.parse(readFileSync(resolve(process.cwd(), "public/openapi.json"), "utf8")));
  assert.equal(document["openapi"], "3.1.0");
  assert.equal(asRecord(document["info"])["version"], "1.2.3");
  const paths = asRecord(document["paths"]);
  assert.deepEqual(Object.keys(paths).sort(), [
    "/api/changes",
    "/api/identifier-namespaces",
    "/api/identifiers/{namespace}/{identifier}",
    "/api/lifecycle-statuses",
    "/api/models",
    "/api/models/{provider}/{model}",
    "/api/providers",
    "/api/resolve",
  ]);
  const schemas = asRecord(asRecord(document["components"])["schemas"]);
  for (const name of [
    "ModelRelease",
    "ModelSelection",
    "BatchResolveRequest",
    "ChangeFeedResponse",
    "SuggestionResponse",
    "IdentifierNotFoundResponse",
    "ErrorResponse",
  ]) {
    assert.ok(name in schemas);
  }
  assert.ok("parameters" in asRecord(document["components"]));
  const requestBody = asRecord(asRecord(asRecord(paths["/api/resolve"])["post"])["requestBody"]);
  const requestContent = asRecord(asRecord(requestBody["content"])["application/json"]);
  const exampleIdentifiers = asArray(asRecord(requestContent["example"])["identifiers"]);
  assert.ok(exampleIdentifiers.length > 0);
  assert.deepEqual(
    exampleIdentifiers.filter((identifier) => typeof identifier !== "string" || !modelsByIdentifierValue.has(identifier)),
    [],
  );

  const unresolved: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record["$ref"] === "string" && record["$ref"].startsWith("#/")) {
      const target = record["$ref"].slice(2).split("/").reduce<unknown>(
        (current, key) => typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)[key]
          : undefined,
        document,
      );
      if (target === undefined) unresolved.push(record["$ref"]);
    }
    Object.values(record).forEach(visit);
  }
  visit(document);
  assert.deepEqual(unresolved, []);
});

test("fields returns compact models from list, item, and namespaced identifier endpoints", async () => {
  const fields = "model,release_date,lifecycle_status,identifiers";
  for (const response of [
    listRequest(`q=gpt-4o&limit=1&fields=${fields}`),
    itemRequest("openai", "gpt-4o", "GET", fields),
    identifierRequest("openai-api", "gpt-4o", "GET", fields),
  ]) {
    const body = await responseBody(response);
    const rawData = body["data"];
    const model = Array.isArray(rawData) ? asRecord(rawData[0]) : asRecord(rawData);
    assert.deepEqual(Object.keys(model), ["model", "release_date", "lifecycle_status", "identifiers"]);
    assert.deepEqual(asRecord(body["meta"])["fields"], fields.split(","));
  }
  assert.deepEqual([...MODEL_FIELDS].sort(), Object.keys(models[0] ?? {}).sort());
});

test("invalid fields are rejected consistently", async (context) => {
  for (const query of ["fields=unknown", "fields=model,,release_date", "fields=model,model", "fields=", "fields=model&fields=release_date"]) {
    await context.test(query, async () => {
      const response = listRequest(query);
      assert.equal(response.status, 400);
      assert.equal(asRecord((await responseBody(response))["error"])["code"], "invalid_query");
    });
  }
});

test("resolve finds raw identifiers without requiring a namespace", async () => {
  const response = await resolveGet("identifier=gpt-4o&fields=model,release_date");
  const body = await responseBody(response);
  const matches = asArray(body["data"]).map(asRecord);
  assert.equal(response.status, 200);
  assert.equal(matches.length, modelsByIdentifierValue.get("gpt-4o")?.length);
  assert.deepEqual(asRecord(matches[0]?.["matched_identifier"]), {
    namespace: "openai-api",
    value: "gpt-4o",
    kind: "alias",
  });
  assert.deepEqual(Object.keys(asRecord(matches[0]?.["model"])), ["model", "release_date"]);
  assert.equal(asRecord(body["meta"])["identifier"], "gpt-4o");

  const missing = await resolveGet("identifier=not-real");
  assert.equal(missing.status, 404);
  assert.equal(asRecord((await responseBody(missing))["error"])["code"], "identifier_not_found");
});

test("suggest mode ranks punctuation, prefixes, case, and stale identifiers with reasons", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["claude-3.5-sonnet-20241022", "punctuation_normalized"],
    ["anthropic/claude-3-5-sonnet-20241022", "provider_prefix_removed"],
    ["CLAUDE-3-5-SONNET-20241022", "case_insensitive"],
    ["claude-3-5-sonnet-20241023", "close_edit_distance"],
    ["claude-3-5-sonnet-20241022", "exact_identifier"],
    ["anthropic/CLAUDE-3-5-SONNET-20241022", "case_insensitive"],
    ["anthropic/claude-3.5-sonnet-20241022", "punctuation_normalized"],
  ];
  for (const [identifier, reason] of cases) {
    const response = await resolveGet(
      `identifier=${encodeURIComponent(identifier)}&mode=suggest&fields=model`,
    );
    const body = await responseBody(response);
    const suggestions = asArray(body["data"]).map(asRecord);
    const first = suggestions.find((suggestion) =>
      asArray(suggestion["reasons"]).includes(reason),
    );
    assert.equal(response.status, 200);
    assert.ok(first !== undefined, `${identifier} should report ${reason}`);
    assert.ok(Number(first["score"]) >= 0.55 && Number(first["score"]) <= 1);
    assert.deepEqual(Object.keys(asRecord(first["model"])), ["model"]);
    for (let index = 1; index < suggestions.length; index += 1) {
      assert.ok(Number(suggestions[index - 1]?.["score"]) >= Number(suggestions[index]?.["score"]));
    }
  }

  const unrelated = await responseBody(await resolveGet("identifier=absolutely-unrelated&mode=suggest"));
  assert.deepEqual(unrelated["data"], []);
  const punctuationOnly = await resolveGet("identifier=%3A&mode=suggest");
  assert.equal(punctuationOnly.status, 200);
});

test("suggestion ranking is deterministic across namespaces and honors limits", () => {
  const model = models[0]!;
  const candidates = [{
    ...model,
    identifiers: [
      { namespace: "z-api", value: "same-id", kind: "alias" as const },
      { namespace: "a-api", value: "same-id", kind: "alias" as const },
    ],
  }];
  const suggestions = suggestIdentifiers("same-id", candidates, { limit: 1 });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.matched_identifier.namespace, "a-api");
  assert.equal(
    suggestIdentifiers("same-id", candidates, { namespace: "z-api" })[0]?.matched_identifier.namespace,
    "z-api",
  );
});

test("not-found suggestions are machine-readable and remain opt-in", async () => {
  const plainBody = await responseBody(await resolveGet("identifier=claude-3-5-sonnet-20241023"));
  assert.equal("suggestions" in plainBody, false);

  const response = await resolveGet(
    "identifier=claude-3-5-sonnet-20241023&suggestions=true&fields=model",
  );
  const body = await responseBody(response);
  const suggestions = asArray(body["suggestions"]).map(asRecord);
  assert.equal(response.status, 404);
  assert.equal(asRecord(suggestions[0]?.["matched_identifier"])["value"], "claude-3-5-sonnet-20241022");
  assert.deepEqual(Object.keys(asRecord(suggestions[0]?.["model"])), ["model"]);
});

test("resolve validates query parameters and supports read HTTP semantics", async (context) => {
  for (const query of ["", "identifier=", "identifier=bad%20value", `identifier=${"x".repeat(201)}`, "identifier=gpt-4o&extra=1", "identifier=a&identifier=b", "identifier=gpt-4o&mode=fuzzy", "identifier=gpt-4o&suggestions=yes", "identifier=gpt-4o&mode=suggest&suggestions=true"]) {
    await context.test(query || "missing", async () => {
      assert.equal((await resolveGet(query)).status, 400);
    });
  }
  const head = await resolveGet("identifier=gpt-4o", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const options = await resolveGet("identifier=gpt-4o", "OPTIONS");
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-methods"), "GET, HEAD, POST, OPTIONS");
  const rejected = await resolveHandler.fetch(new Request("https://example.test/api/resolve", { method: "DELETE" }));
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get("allow"), "GET, HEAD, POST, OPTIONS");
});

test("batch resolve preserves input order and reports matches and misses independently", async () => {
  const identifiers = ["gpt-4o", "not-real", "deepseek-reasoner", "gpt-4o"];
  const response = await resolvePost({ identifiers }, { query: "?fields=model,release_date" });
  const body = await responseBody(response);
  const results = asArray(body["data"]).map(asRecord);
  assert.equal(response.status, 200);
  assert.deepEqual(results.map((result) => result["identifier"]), identifiers);
  assert.equal(asArray(results[0]?.["matches"]).length, 1);
  assert.equal(asArray(results[1]?.["matches"]).length, 0);
  assert.equal(asArray(results[2]?.["matches"]).length, 1);
  assert.deepEqual(Object.keys(asRecord(asRecord(asArray(results[0]?.["matches"])[0])["model"])), ["model", "release_date"]);
  assert.deepEqual(asRecord(body["meta"]), {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    researched_at: dataset.researched_at,
    changelog_url: dataset.changelog_url,
    coverage: dataset.coverage,
    fields: ["model", "release_date"],
    requested_count: 4,
    matched_count: 3,
    unmatched_count: 1,
  });
});

test("batch resolve accepts case-insensitive JSON media types", async () => {
  const response = await resolvePost(
    { identifiers: ["gpt-4o"] },
    { headers: { "Content-Type": "Application/JSON; Charset=UTF-8" } },
  );
  assert.equal(response.status, 200);
});

test("POST resolve responses consistently advertise POST", async () => {
  const success = await resolvePost({ identifiers: ["gpt-4o"] });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("access-control-allow-methods"), "GET, HEAD, POST, OPTIONS");

  const error = await resolvePost("{");
  assert.equal(error.status, 400);
  assert.equal(error.headers.get("access-control-allow-methods"), "GET, HEAD, POST, OPTIONS");
});

test("the change feed returns stable incremental pages and compact fields", async () => {
  const response = changesGet("since=2026-07-22&limit=2&offset=1&fields=model,last_changed_at");
  const body = await responseBody(response);
  const changed = asArray(body["data"]).map(asRecord);
  const expected = models
    .filter((model) => model.last_changed_at >= "2026-07-22")
    .sort((left, right) =>
      left.last_changed_at.localeCompare(right.last_changed_at) || left.model.localeCompare(right.model),
    );
  assert.equal(response.status, 200);
  assert.deepEqual(changed.map((model) => model["model"]), expected.slice(1, 3).map((model) => model.model));
  assert.ok(changed.every((model) => Object.keys(model).join(",") === "model,last_changed_at"));
  assert.deepEqual(asRecord(body["meta"]), {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    researched_at: dataset.researched_at,
    changelog_url: dataset.changelog_url,
    coverage: dataset.coverage,
    fields: ["model", "last_changed_at"],
    since: "2026-07-22",
    total: expected.length,
    count: 2,
    limit: 2,
    offset: 1,
  });
  assert.notEqual(response.headers.get("etag"), null);
  assert.equal(changesGet("since=2026-07-22", "HEAD").status, 200);
  assert.equal(changesGet("since=2026-07-22", "OPTIONS").status, 204);
});

test("the change feed rejects incomplete and malformed queries", async () => {
  for (const query of ["", "since=", "since=2026-02-30", "since=2026-07-22&since=2026-07-21", "since=2026-07-22&limit=0", "since=2026-07-22&offset=-1", "since=2026-07-22&unknown=1"]) {
    assert.equal(changesGet(query).status, 400, query);
  }
  assert.equal(changesGet("since=2026-07-22", "POST").status, 405);
});

test("batch resolve rejects malformed media, bodies, identifiers, and oversized requests", async (context) => {
  const cases: ReadonlyArray<readonly [string, () => Promise<Response>, number, string]> = [
    ["media type", () => resolveHandler.fetch(new Request("https://example.test/api/resolve", { method: "POST", body: "{}" })), 415, "unsupported_media_type"],
    ["invalid JSON", () => resolvePost("{"), 400, "invalid_json"],
    ["array body", () => resolvePost([]), 400, "invalid_request"],
    ["null body", () => resolvePost("null"), 400, "invalid_request"],
    ["missing key", () => resolvePost({}), 400, "invalid_request"],
    ["extra key", () => resolvePost({ identifiers: ["gpt-4o"], extra: true }), 400, "invalid_request"],
    ["not array", () => resolvePost({ identifiers: "gpt-4o" }), 400, "invalid_request"],
    ["empty", () => resolvePost({ identifiers: [] }), 400, "invalid_request"],
    ["too many", () => resolvePost({ identifiers: Array.from({ length: 101 }, () => "gpt-4o") }), 400, "invalid_request"],
    ["not string", () => resolvePost({ identifiers: [1] }), 400, "invalid_request"],
    ["blank", () => resolvePost({ identifiers: [""] }), 400, "invalid_request"],
    ["whitespace", () => resolvePost({ identifiers: ["bad value"] }), 400, "invalid_request"],
    ["too long", () => resolvePost({ identifiers: ["x".repeat(201)] }), 400, "invalid_request"],
    ["unknown query", () => resolvePost({ identifiers: ["gpt-4o"] }, { query: "?extra=1" }), 400, "invalid_query"],
    ["suggest mode", () => resolvePost({ identifiers: ["gpt-4o"] }, { query: "?mode=suggest" }), 400, "invalid_query"],
    ["wildcard precondition", () => resolvePost({ identifiers: ["gpt-4o"] }, { headers: { "If-None-Match": "*" } }), 412, "precondition_failed"],
    ["declared too large", () => resolvePost({ identifiers: ["gpt-4o"] }, { headers: { "Content-Length": "65537" } }), 413, "request_too_large"],
    ["actually too large", () => resolvePost(`{"identifiers":["${"x".repeat(65_536)}"]}`), 413, "request_too_large"],
  ];
  for (const [name, request, status, code] of cases) {
    await context.test(name, async () => {
      const response = await request();
      assert.equal(response.status, status);
      assert.equal(asRecord((await responseBody(response))["error"])["code"], code);
    });
  }
});

test("provider, namespace, and lifecycle indexes expose live catalog values", async () => {
  const providerBody = await responseBody(providersHandler.fetch(new Request("https://example.test/api/providers")));
  const providers = asArray(providerBody["data"]).map(asRecord);
  assert.equal(providers.length, dataset.providers.length);
  assert.equal(providers.reduce((sum, provider) => sum + Number(provider["model_count"]), 0), models.length);

  const namespaceBody = await responseBody(identifierNamespacesHandler.fetch(new Request("https://example.test/api/identifier-namespaces")));
  const namespaces = asArray(namespaceBody["data"]).map(asRecord);
  assert.deepEqual(namespaces.map((item) => item["namespace"]), [...namespaces.map((item) => String(item["namespace"]))].sort());
  assert.equal(namespaces.reduce((sum, item) => sum + Number(item["identifier_count"]), 0), dataset.models.reduce((sum, model) => sum + model.identifiers.length, 0));

  const lifecycleBody = await responseBody(lifecycleStatusesHandler.fetch(new Request("https://example.test/api/lifecycle-statuses")));
  const statuses = asArray(lifecycleBody["data"]).map(asRecord);
  assert.deepEqual(statuses.map((item) => item["status"]), ["unknown", "active", "deprecated", "retired", "retirement_scheduled"]);
  assert.equal(statuses.reduce((sum, item) => sum + Number(item["model_count"]), 0), models.length);
  assert.match(String(statuses[0]?.["definition"]), /No lifecycle state/);

  for (const handler of [providersHandler, identifierNamespacesHandler, lifecycleStatusesHandler]) {
    assert.equal(handler.fetch(new Request("https://example.test/api/index?extra=1")).status, 400);
  }
});

test("ETags are strong, representation-specific, and honor conditional reads", async () => {
  const full = listRequest("q=gpt-4o&limit=1");
  const compact = listRequest("q=gpt-4o&limit=1&fields=model");
  const etag = full.headers.get("etag");
  assert.match(etag ?? "", /^"[A-Za-z0-9_-]{43}"$/);
  assert.notEqual(compact.headers.get("etag"), etag);

  for (const ifNoneMatch of [etag!, `W/${etag}`, `"miss", ${etag}`, "*"]) {
    const response = modelsHandler.fetch(new Request("https://example.test/api/models?q=gpt-4o&limit=1", { headers: { "If-None-Match": ifNoneMatch } }));
    assert.equal(response.status, 304);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type, If-None-Match");
    assert.equal(response.headers.get("access-control-expose-headers"), "ETag");
  }
  const miss = modelsHandler.fetch(new Request("https://example.test/api/models?q=gpt-4o&limit=1", { headers: { "If-None-Match": "\"miss\"" } }));
  assert.equal(miss.status, 200);
  assert.equal(listRequest("unknown=1").headers.get("etag"), null);

  const post = await resolvePost({ identifiers: ["gpt-4o"] }, { headers: { "If-None-Match": "*" } });
  assert.equal(post.status, 412);
  assert.equal(asRecord((await responseBody(post))["error"])["code"], "precondition_failed");
  assert.equal(post.headers.get("etag"), null);
  assert.equal(post.headers.get("cache-control"), "no-store");
  assert.equal(post.headers.get("vercel-cdn-cache-control"), null);

  const direct = jsonResponse({ ok: true });
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get("etag"), null);
  assert.equal(direct.headers.get("cache-control"), "no-store");
});
