import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import notFoundHandler from "../api/not-found.js";
import { asArray, asRecord, responseBody, type JsonRecord } from "./helpers.js";
import type { JsonValue } from "../src/types.js";

function vercelConfig(): JsonRecord {
  const rawConfig: JsonValue = JSON.parse(
    readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
  );
  return asRecord(rawConfig);
}

test("Vercel routes the documented public item URL to the item handler", () => {
  const routes = asArray(vercelConfig()["routes"]).map(asRecord);
  assert.ok(
    routes.some(
      (route) =>
        route["src"] === "/api/models/(?<provider>[^/]+)/(?<model>[^/]+)" &&
        route["dest"] === "/api/model?provider=$provider&model=$model",
    ),
  );
  assert.ok(
    routes.some(
      (route) =>
        route["src"] === "/api/identifiers/(?<namespace>[^/]+)/(?<identifier>[^/]+)" &&
        route["dest"] === "/api/identifier?namespace=$namespace&identifier=$identifier",
      ),
  );
  assert.ok(routes.some((route) => route["handle"] === "filesystem"));
  assert.deepEqual(routes.at(-1), {
    src: "/api/(.*)",
    dest: "/api/not-found",
  });
});

test("unknown API routes return the JSON API envelope with CORS and no caching", async () => {
  for (const method of ["GET", "POST"]) {
    const response = notFoundHandler.fetch(new Request("https://example.test/api/not-a-route", { method }));
    assert.equal(response.status, 404);
    assert.deepEqual(await responseBody(response), {
      error: { code: "not_found", message: "API route was not found" },
    });
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(
      response.headers.get("access-control-allow-methods"),
      "GET, HEAD, POST, OPTIONS",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const response = notFoundHandler.fetch(new Request("https://example.test/api/not-a-route", { method }));
    assert.equal(response.status, 405);
    assert.equal(asRecord((await responseBody(response))["error"])["code"], "method_not_allowed");
    assert.equal(response.headers.get("allow"), "GET, HEAD, POST, OPTIONS");
  }

  const head = notFoundHandler.fetch(new Request("https://example.test/api/not-a-route", { method: "HEAD" }));
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
  const options = notFoundHandler.fetch(new Request("https://example.test/api/not-a-route", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("cache-control"), "no-store");
});

test("all deployed functions explicitly bundle the JSON dataset", () => {
  const functions = asRecord(vercelConfig()["functions"]);
  for (const functionName of [
    "api/changes.ts",
    "api/models.ts",
    "api/model.ts",
    "api/identifier.ts",
    "api/resolve.ts",
    "api/providers.ts",
    "api/identifier-namespaces.ts",
    "api/lifecycle-statuses.ts",
  ]) {
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
  assert.match(html, /id="capability"/);
  assert.match(html, /id="updated-since"/);
  assert.match(html, /id="retiring-before"/);
  assert.match(html, /id="replacements-section"/);
  assert.match(html, /src="\/app\.js"/);
  assert.doesNotThrow(() => JSON.parse(readFileSync(resolve(process.cwd(), "public/openapi.json"), "utf8")));
});

test("the explorer ships the accessible responsive workbench contract", () => {
  const html = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "public/styles.css"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "web/app.ts"), "utf8");

  assert.match(html, /id="mobile-query-tab"[^>]+aria-controls="request-panel"/);
  assert.match(html, /id="mode-list-tab"[^>]+aria-controls="list-fields"/);
  assert.match(html, /id="mode-item-tab"[^>]*>\s*Get by model ID\s*<\/button>/);
  assert.match(html, /id="mode-identifier-tab"[^>]*>\s*Resolve external ID\s*<\/button>/);
  assert.match(html, /id="detail-overview-tab"[^>]+aria-controls="detail-overview"/);
  assert.match(html, /id="detail-json-tab"[^>]+is-active[^>]+aria-selected="true"/);
  assert.match(html, /<option value="desc" selected>Descending<\/option>/);
  assert.match(html, /list="model-id-options"/);
  assert.match(html, /<datalist id="model-id-options"><\/datalist>/);
  assert.match(html, /<th scope="col">Lifecycle<\/th>/);
  assert.match(html, /id="results-loading"/);
  assert.match(css, /grid-template-columns: var\(--request-panel-width\) 6px minmax\(320px, 1fr\) 6px var\(--detail-panel-width\)/);
  assert.match(css, /height: calc\(100dvh - 68px\)/);
  assert.doesNotMatch(css, /\bInter\b/);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
  assert.doesNotMatch(html, /API playground|Request URL|panel-kicker/);
  assert.match(html, /id="run-request" class="quiet-button"/);
  assert.doesNotMatch(html, /aria-hidden="true">→/);
  assert.doesNotMatch(html, /Quick queries|data-preset/);
  assert.match(html, /id="results-search-form"[^>]+role="search"/);
  assert.match(html, /data-panel-resizer="request"/);
  assert.match(html, /data-panel-resizer="detail"/);
  assert.match(app, /syncSearchInputs/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /event\.key !== "ArrowLeft"/);
  assert.match(css, /\.model-cell:hover \.copy-model-button/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /let detailTab: DetailTab = "json"/);
  assert.match(app, /populateModelIdOptions/);
  assert.match(app, /className = "copy-model-button"/);
  assert.match(app, /writeClipboard\(model\.model\)/);
  assert.match(app, /parameters\.get\("order"\) === "asc" \? "asc" : "desc"/);
});

test("Vercel applies the public-site security policy to every route", () => {
  const rules = asArray(vercelConfig()["routes"]).map(asRecord);
  const rule = rules.find((candidate) => candidate["src"] === "/(.*)");
  assert.notEqual(rule, undefined);
  assert.equal(rule!["continue"], true);
  assert.deepEqual(asRecord(rule!["headers"]), {
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
});

test("Vercel preserves API conditional-request and CORS behavior at the edge", () => {
  const routes = asArray(vercelConfig()["routes"]).map(asRecord);
  const postResolve = routes.find((route) => route["src"] === "/api/resolve");
  assert.deepEqual(postResolve, {
    src: "/api/resolve",
    methods: ["POST"],
    continue: true,
    transforms: [
      {
        type: "request.headers",
        op: "delete",
        target: { key: "if-none-match" },
      },
    ],
  });

  const api = routes.find((route) => route["src"] === "/api/(.*)");
  assert.deepEqual(api, {
    src: "/api/(.*)",
    continue: true,
    transforms: [
      {
        type: "response.headers",
        op: "set",
        target: { key: "access-control-allow-origin" },
        args: "*",
      },
      {
        type: "response.headers",
        op: "set",
        target: { key: "access-control-allow-headers" },
        args: "Content-Type, If-None-Match",
      },
      {
        type: "response.headers",
        op: "set",
        target: { key: "access-control-expose-headers" },
        args: "ETag",
      },
    ],
  });
});
