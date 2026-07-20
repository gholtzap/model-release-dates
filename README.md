# Model Release Date API

This project provides one read-only, source-backed API for answering questions such as:

- When was a specific model first available to developers?
- Which models did a provider release during a date range?
- Was a model released through an API, downloadable weights, or both?

A release date means the first public developer availability through an official API or downloadable weights. Public previews count; private previews and announcements without access do not.

## Get one model

```sh
curl 'https://<your-domain>/api/models/openai/gpt-4o'
```

```json
{
  "data": {
    "model": "openai/gpt-4o",
    "identifier_type": "model",
    "availability": ["api"],
    "release_date": "2024-05-13",
    "confidence": "confirmed",
    "sources": [
      {
        "publisher": "OpenAI",
        "title": "Hello GPT-4o",
        "url": "https://openai.com/index/hello-gpt-4o/",
        "evidence": "OpenAI publicly released GPT-4o text and image capabilities on May 13, 2024."
      }
    ]
  },
  "meta": {
    "schema_version": 1,
    "researched_at": "2026-07-20"
  }
}
```

Model IDs use `provider/model` format. An unknown model returns `404` with `error.code` set to `model_not_found`.

## Search models

```sh
curl 'https://<your-domain>/api/models?provider=openai&from=2025-01-01&to=2025-12-31&sort=release_date&order=desc'
```

`GET /api/models` accepts these query parameters:

| Parameter | Accepted value |
| --- | --- |
| `q` | Case-insensitive substring of a model ID |
| `provider` | Provider prefix, such as `openai`, `anthropic`, or `meta` |
| `identifier_type` | `model`, `snapshot`, or `weights` |
| `availability` | `api` or `weights` |
| `confidence` | `confirmed` |
| `from` / `to` | Inclusive `YYYY-MM-DD` date bounds |
| `sort` | `release_date` (default) or `model` |
| `order` | `asc` (default) or `desc` |
| `limit` | 1–100; defaults to 50 |
| `offset` | Zero-based offset; defaults to 0 |

Filters can be combined. The response contains `data` plus pagination metadata:

```json
{
  "data": [],
  "meta": {
    "schema_version": 1,
    "researched_at": "2026-07-20",
    "total": 0,
    "count": 0,
    "limit": 50,
    "offset": 0
  }
}
```

`total` is the number of matching records before pagination; `count` is the number returned. Invalid or repeated parameters return `400` with `error.code` set to `invalid_query`.

## Run locally

Node.js 24 is the deployment runtime.

```sh
npm install
npm run check
npm test
npm run test:coverage
npx vercel dev
```

The tests exercise every published model lookup, combined filters, inclusive dates, sorting, complete pagination, request failures, HTTP headers, Vercel routing, and dataset corruption cases. Coverage is enforced at 100% for production lines, branches, and functions.

The project uses strict TypeScript, native Vercel Functions, and `model-release-dates.json` as its data source. The dataset is validated at startup; malformed dates, duplicate model IDs, unsupported enum values, or invalid sources prevent the API from serving bad data.

## Deploy

Import the repository into Vercel without a framework preset, database, environment variables, or custom build command. `vercel.json` bundles the dataset and routes `/api/models/:provider/:model` to the individual-model handler.

To update the API, edit `model-release-dates.json`, run `npm test`, and deploy the new commit.
