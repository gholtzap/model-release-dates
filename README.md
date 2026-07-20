# Model Release Date API

A read-only API for querying verified AI model release dates. It runs as native TypeScript Vercel Functions and uses `model-release-dates.json` as its versioned data source.

## Endpoints

### List and filter models

```http
GET /api/models
```

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `q` | Case-insensitive substring search against the canonical model ID |
| `provider` | Exact provider prefix, such as `openai` |
| `identifier_type` | `model`, `snapshot`, or `weights` |
| `availability` | `api` or `weights` |
| `confidence` | `confirmed` |
| `from` | Inclusive earliest release date in `YYYY-MM-DD` format |
| `to` | Inclusive latest release date in `YYYY-MM-DD` format |
| `sort` | `release_date` (default) or `model` |
| `order` | `asc` (default) or `desc` |
| `limit` | Page size from 1 through 100; defaults to 50 |
| `offset` | Zero-based result offset; defaults to 0 |

Example:

```sh
curl 'https://your-project.vercel.app/api/models?provider=openai&from=2025-01-01&sort=release_date'
```

List responses contain a `data` array and pagination metadata:

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

### Retrieve one model

```http
GET /api/models/:provider/:model
```

Example:

```sh
curl 'https://your-project.vercel.app/api/models/openai/gpt-4o'
```

The response contains the complete model record, including `release_date` and its supporting sources. Unknown models return `404` with a stable JSON error code.

## Development

Uses Node.js 24, matching Vercel's supported major-version configuration.

```sh
npm install
npm run check
npm test
```

The tests execute the actual Vercel handlers through standard Web `Request` and `Response` objects. Dataset validation runs when a function starts, so malformed records fail before the API serves them.

## Deploying to Vercel

Import this repository as a Vercel project. No framework preset, build command, database, or environment variables are required. `vercel.json` includes the dataset in each function bundle and rewrites individual model URLs to the item handler.
