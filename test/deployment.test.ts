import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { asArray, asRecord } from "./helpers.js";

function vercelConfig(): Record<string, unknown> {
  const rawConfig: unknown = JSON.parse(
    readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
  );
  return asRecord(rawConfig);
}

test("Vercel routes the documented public item URL to the item handler", () => {
  const rewrites = asArray(vercelConfig()["rewrites"]).map(asRecord);
  assert.ok(
    rewrites.some(
      (rewrite) =>
        rewrite["source"] === "/api/models/:provider/:model" &&
        rewrite["destination"] === "/api/model",
    ),
  );
});

test("both deployed functions explicitly bundle the JSON dataset", () => {
  const functions = asRecord(vercelConfig()["functions"]);
  for (const functionName of ["api/models.ts", "api/model.ts"]) {
    assert.equal(
      asRecord(functions[functionName])["includeFiles"],
      "model-release-dates.json",
    );
  }
});
