import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { asArray, asRecord, type JsonRecord } from "./helpers.js";
import type { JsonValue } from "../src/types.js";

function vercelConfig(): JsonRecord {
  const rawConfig: JsonValue = JSON.parse(
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

test("the explorer ships the accessible responsive workbench contract", () => {
  const html = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "public/styles.css"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "web/app.ts"), "utf8");

  assert.match(html, /id="mobile-query-tab"[^>]+aria-controls="request-panel"/);
  assert.match(html, /id="mode-list-tab"[^>]+aria-controls="list-fields"/);
  assert.match(html, /id="detail-overview-tab"[^>]+aria-controls="detail-overview"/);
  assert.match(html, /<option value="desc" selected>Descending<\/option>/);
  assert.match(html, /list="model-id-options"/);
  assert.match(html, /<datalist id="model-id-options"><\/datalist>/);
  assert.match(html, /<th scope="col">Lifecycle<\/th>/);
  assert.match(html, /id="results-loading"/);
  assert.match(css, /grid-template-columns: 360px minmax\(470px, 1fr\) minmax\(360px, 430px\)/);
  assert.match(css, /height: calc\(100dvh - 68px\)/);
  assert.doesNotMatch(css, /\bInter\b/);
  assert.match(css, /\.model-cell:hover \.copy-model-button/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /populateModelIdOptions/);
  assert.match(app, /className = "copy-model-button"/);
  assert.match(app, /writeClipboard\(model\.model\)/);
  assert.match(app, /parameters\.get\("order"\) === "asc" \? "asc" : "desc"/);
});

test("Vercel applies the public-site security policy to every route", () => {
  const rules = asArray(vercelConfig()["headers"]).map(asRecord);
  const rule = rules.find((candidate) => candidate["source"] === "/(.*)");
  assert.notEqual(rule, undefined);

  const headers = Object.fromEntries(
    asArray(rule!["headers"]).map((value) => {
      const header = asRecord(value);
      return [header["key"], header["value"]];
    }),
  );
  assert.deepEqual(headers, {
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
});
