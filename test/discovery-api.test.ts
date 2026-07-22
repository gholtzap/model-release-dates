import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import identifierNamespacesHandler from "../api/identifier-namespaces.js";
import lifecycleStatusesHandler from "../api/lifecycle-statuses.js";
import providersHandler from "../api/providers.js";
import resolveHandler from "../api/resolve.js";
import modelsHandler from "../api/models.js";
import { MODEL_FIELDS } from "../src/catalog-api.js";
import { dataset, models, modelsByIdentifierValue } from "../src/data.js";
import { jsonResponse } from "../src/http.js";
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

test("the OpenAPI document describes every public endpoint, schema, parameter, example, and error", () => {
  const document = asRecord(JSON.parse(readFileSync(resolve(process.cwd(), "public/openapi.json"), "utf8")));
  assert.equal(document["openapi"], "3.1.0");
  const paths = asRecord(document["paths"]);
  assert.deepEqual(Object.keys(paths).sort(), [
    "/api/identifier-namespaces",
    "/api/identifiers/{namespace}/{identifier}",
    "/api/lifecycle-statuses",
    "/api/models",
    "/api/models/{provider}/{model}",
    "/api/providers",
    "/api/resolve",
  ]);
  const schemas = asRecord(asRecord(document["components"])["schemas"]);
  for (const name of ["ModelRelease", "ModelSelection", "BatchResolveRequest", "ErrorResponse"]) {
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

test("resolve validates query parameters and supports read HTTP semantics", async (context) => {
  for (const query of ["", "identifier=", "identifier=bad%20value", `identifier=${"x".repeat(201)}`, "identifier=gpt-4o&extra=1", "identifier=a&identifier=b"]) {
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
  }
  const miss = modelsHandler.fetch(new Request("https://example.test/api/models?q=gpt-4o&limit=1", { headers: { "If-None-Match": "\"miss\"" } }));
  assert.equal(miss.status, 200);
  assert.equal(listRequest("unknown=1").headers.get("etag"), null);

  const post = await resolvePost({ identifiers: ["gpt-4o"] }, { headers: { "If-None-Match": "*" } });
  assert.equal(post.status, 200);
  assert.notEqual(post.headers.get("etag"), null);

  const direct = jsonResponse({ ok: true });
  assert.equal(direct.status, 200);
  assert.notEqual(direct.headers.get("etag"), null);
});
