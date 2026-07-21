import assert from "node:assert/strict";

import modelHandler from "../api/model.js";
import modelsHandler from "../api/models.js";
import identifierHandler from "../api/identifier.js";
import type { JsonObject, JsonValue } from "../src/types.js";

export type JsonRecord = JsonObject;

export function asRecord(value: JsonValue | object | undefined): JsonRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

export function asArray(value: JsonValue | object | undefined): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected an array");
  }
  return value;
}

export async function responseBody(response: Response): Promise<JsonRecord> {
  const value: JsonValue = await response.json();
  return asRecord(value);
}

export function listRequest(query = "", method = "GET"): Response {
  const suffix = query === "" ? "" : `?${query}`;
  return modelsHandler.fetch(new Request(`https://example.test/api/models${suffix}`, { method }));
}

export function itemRequest(provider: string, model: string, method = "GET"): Response {
  const url = new URL("https://example.test/api/model");
  url.searchParams.set("provider", provider);
  url.searchParams.set("model", model);
  return modelHandler.fetch(new Request(url, { method }));
}

export function identifierRequest(namespace: string, identifier: string, method = "GET"): Response {
  const url = new URL("https://example.test/api/identifier");
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("identifier", identifier);
  return identifierHandler.fetch(new Request(url, { method }));
}

export async function modelsFrom(response: Response): Promise<JsonRecord[]> {
  const body = await responseBody(response);
  return asArray(body["data"]).map(asRecord);
}

export function modelIds(models: readonly JsonRecord[]): string[] {
  return models.map((model) => {
    const value = model["model"];
    if (typeof value !== "string") {
      throw new TypeError("Expected a model ID string");
    }
    return value;
  });
}
