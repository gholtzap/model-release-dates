import assert from "node:assert/strict";
import test from "node:test";

import modelHandler from "../api/model.js";
import modelsHandler from "../api/models.js";

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected an array");
  }
  return value;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  return asRecord(value);
}

test("GET /api/models returns the validated dataset", async () => {
  const response = modelsHandler.fetch(new Request("https://example.test/api/models"));
  const body = await responseBody(response);
  const data = asArray(body["data"]);
  const meta = asRecord(body["meta"]);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(data.length, 48);
  assert.equal(meta["schema_version"], 1);
  assert.equal(meta["total"], 48);
  assert.equal(meta["count"], 48);
});

test("GET /api/models filters, sorts, and paginates", async () => {
  const url = new URL("https://example.test/api/models");
  url.searchParams.set("provider", "openai");
  url.searchParams.set("availability", "api");
  url.searchParams.set("from", "2025-04-01");
  url.searchParams.set("to", "2025-08-31");
  url.searchParams.set("sort", "model");
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", "3");
  url.searchParams.set("offset", "1");

  const response = modelsHandler.fetch(new Request(url));
  const body = await responseBody(response);
  const data = asArray(body["data"]).map(asRecord);
  const meta = asRecord(body["meta"]);

  assert.equal(response.status, 200);
  assert.equal(data.length, 3);
  assert.equal(meta["total"], 10);
  assert.equal(meta["limit"], 3);
  assert.equal(meta["offset"], 1);
  for (const model of data) {
    assert.match(String(model["model"]), /^openai\//);
    assert.ok(asArray(model["availability"]).includes("api"));
    assert.ok(String(model["release_date"]) >= "2025-04-01");
    assert.ok(String(model["release_date"]) <= "2025-08-31");
  }
});

test("GET /api/models supports case-insensitive model search", async () => {
  const response = modelsHandler.fetch(
    new Request("https://example.test/api/models?q=GPT-4O-2024-05-13"),
  );
  const body = await responseBody(response);
  const data = asArray(body["data"]).map(asRecord);

  assert.equal(response.status, 200);
  assert.equal(data.length, 1);
  assert.equal(data[0]?.["model"], "openai/gpt-4o-2024-05-13");
});

test("GET /api/models/:provider/:model returns one model", async () => {
  const response = modelHandler.fetch(
    new Request("https://example.test/api/model?provider=openai&model=gpt-4o"),
  );
  const body = await responseBody(response);
  const model = asRecord(body["data"]);

  assert.equal(response.status, 200);
  assert.equal(model["model"], "openai/gpt-4o");
  assert.equal(model["release_date"], "2024-05-13");
});

test("individual lookup returns a typed 404 error", async () => {
  const response = modelHandler.fetch(
    new Request("https://example.test/api/model?provider=openai&model=missing"),
  );
  const body = await responseBody(response);
  const error = asRecord(body["error"]);

  assert.equal(response.status, 404);
  assert.equal(error["code"], "model_not_found");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid list queries return 400 instead of being ignored", async () => {
  const requests = [
    "https://example.test/api/models?unknown=value",
    "https://example.test/api/models?limit=0",
    "https://example.test/api/models?from=2025-02-30",
    "https://example.test/api/models?from=2025-02-01&to=2025-01-01",
    "https://example.test/api/models?provider=openai&provider=google",
  ];

  for (const request of requests) {
    const response = modelsHandler.fetch(new Request(request));
    const body = await responseBody(response);
    const error = asRecord(body["error"]);
    assert.equal(response.status, 400);
    assert.equal(error["code"], "invalid_query");
  }
});

test("HTTP method and preflight behavior is explicit", async () => {
  const post = modelsHandler.fetch(
    new Request("https://example.test/api/models", { method: "POST" }),
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD, OPTIONS");

  const options = modelsHandler.fetch(
    new Request("https://example.test/api/models", { method: "OPTIONS" }),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");

  const head = modelsHandler.fetch(
    new Request("https://example.test/api/models", { method: "HEAD" }),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
