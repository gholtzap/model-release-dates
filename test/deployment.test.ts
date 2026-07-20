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
  assert.ok(
    rewrites.some(
      (rewrite) =>
        rewrite["source"] === "/api/identifiers/:namespace/:identifier" &&
        rewrite["destination"] === "/api/identifier",
    ),
  );
});

test("all deployed functions explicitly bundle the JSON dataset", () => {
  const functions = asRecord(vercelConfig()["functions"]);
  for (const functionName of ["api/models.ts", "api/model.ts", "api/identifier.ts"]) {
    assert.equal(
      asRecord(functions[functionName])["includeFiles"],
      "model-release-dates.json",
    );
  }
});

test("Vercel builds and serves the static explorer", () => {
  const config = vercelConfig();
  assert.equal(config["buildCommand"], "npm run build");
  assert.equal(config["outputDirectory"], "public");

  const html = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="request-form"/);
  assert.match(html, /id="results-body"/);
  assert.match(html, /id="detail-overview"/);
  assert.match(html, /id="identifier-namespace"/);
  assert.match(html, /id="availability-events-list"/);
  assert.match(html, /src="\/app\.js"/);
});
