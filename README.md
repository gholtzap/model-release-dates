# IN PROGRESS - NOT DONE YET

# AI Model Release Date API

I was surprised there was no reliable, developer-friendly source for AI model release dates, so I built one. This read-only API answers practical questions about when a model became usable, which upstream identifiers refer to it, how aliases and snapshots relate, and whether an API model is active, deprecated, retired, or scheduled for retirement.

Every availability and lifecycle event is backed by first-party evidence. The catalog is curated and intentionally non-exhaustive; every response states its research date and inclusion criteria so missing records are not mistaken for confirmed absence.

## Try it

Open the deployment root to use the web explorer. It can list and filter models, retrieve a canonical model, or resolve an exact provider API or Hugging Face identifier. It also shows the generated URL, cURL command, structured timelines, and raw JSON.

Replace `https://<your-domain>` below with the Vercel deployment URL.

### Resolve an upstream identifier

Use this when the ID in your application does not match the catalog's canonical `provider/model` ID:

```sh
curl 'https://<your-domain>/api/identifiers/deepseek-api/deepseek-reasoner'
```

The response resolves `deepseek-reasoner` to `deepseek-ai/deepseek-r1` and includes the exact match in `meta.matched_identifier`. URL-encode identifiers containing `/`, such as Hugging Face repository IDs.

Supported namespaces currently include `openai-api`, `anthropic-api`, `gemini-api`, `deepseek-api`, and `huggingface`. Identifier matching is exact and case-sensitive. Unknown identifiers return `404` with `error.code` set to `identifier_not_found`.

### Get one canonical model

```sh
curl 'https://<your-domain>/api/models/openai/gpt-4o'
```

Model IDs use `provider/model` format. Unknown models return `404` with `error.code` set to `model_not_found`.

### Search and filter models

```sh
curl 'https://<your-domain>/api/models?provider=anthropic&lifecycle_status=retired&sort=release_date&order=desc'
```

`GET /api/models` accepts:

| Parameter | Accepted value |
| --- | --- |
| `q` | Case-insensitive substring of a canonical ID, display name, or upstream identifier |
| `provider` | Provider ID such as `openai`, `anthropic`, `google`, `deepseek-ai`, or `meta` |
| `identifier_namespace` | Exact namespace, such as `openai-api` or `huggingface` |
| `identifier` | Exact upstream identifier; combine with `identifier_namespace` when possible |
| `identifier_type` | `model`, `snapshot`, or `weights` |
| `availability` | `api` or `weights` |
| `availability_stage` | `public_preview` or `public` |
| `lifecycle_status` | `unknown`, `active`, `deprecated`, `retired`, or `retirement_scheduled` |
| `confidence` | `confirmed` |
| `from` / `to` | Inclusive `YYYY-MM-DD` bounds on the derived release date |
| `sort` | `release_date` (default) or `model` |
| `order` | `asc` (default) or `desc` |
| `limit` | 1–100; default 50 |
| `offset` | Zero-based offset; default 0 |

Filters can be combined. `meta.total` is the number of matches before pagination; `meta.count` is the number returned. Invalid, unknown, or repeated query parameters return `400` with `error.code` set to `invalid_query`.

## Response model

Schema version 2 keeps evidence on the event it supports:

```json
{
  "data": {
    "model": "deepseek-ai/deepseek-r1",
    "display_name": "DeepSeek R1",
    "provider_id": "deepseek-ai",
    "provider": {
      "id": "deepseek-ai",
      "name": "DeepSeek",
      "website": "https://www.deepseek.com/"
    },
    "identifiers": [
      { "namespace": "deepseek-api", "value": "deepseek-reasoner", "kind": "alias" },
      { "namespace": "huggingface", "value": "deepseek-ai/DeepSeek-R1", "kind": "weights" }
    ],
    "relationships": [],
    "availability_events": [
      {
        "channel": "api",
        "stage": "public",
        "date": "2025-01-20",
        "confidence": "confirmed",
        "sources": [{ "publisher": "DeepSeek", "title": "...", "url": "https://...", "evidence": "..." }]
      }
    ],
    "lifecycle_events": [
      {
        "status": "retirement_scheduled",
        "date": "2026-07-24",
        "date_role": "scheduled",
        "channel": "api",
        "identifier": { "namespace": "deepseek-api", "value": "deepseek-reasoner" },
        "confidence": "confirmed",
        "sources": [{ "publisher": "DeepSeek", "title": "...", "url": "https://...", "evidence": "..." }]
      }
    ],
    "verified_at": "2026-07-20",
    "release_date": "2025-01-20",
    "release_date_precision": "day",
    "availability": ["api", "weights"],
    "confidence": "confirmed",
    "sources": [
      { "publisher": "DeepSeek", "title": "...", "url": "https://...", "evidence": "..." }
    ],
    "lifecycle_status": "retirement_scheduled"
  },
  "meta": {
    "schema_version": 2,
    "researched_at": "2026-07-20",
    "coverage": {
      "exhaustive": false,
      "statement": "...",
      "provider_inclusion_criteria": "...",
      "model_inclusion_criteria": "..."
    }
  }
}
```

`release_date`, `release_date_precision`, `availability`, `confidence`, and `sources` are compatibility fields derived from the earliest qualifying availability event. New integrations should use `availability_events` when channel-specific timing matters. Dates can have `day`, `month`, or `year` precision; partial dates are normalized to the first day of their period only in the compatibility `release_date`.

`lifecycle_status` is the latest cataloged lifecycle state. Consult `lifecycle_events` for whether a date was observed, announced, effective, or scheduled and whether it applies to a particular channel or identifier.

## Coverage policy

The catalog includes notable foundation models from providers with authoritative, publicly accessible release evidence. A model is included when public developer availability through an official API or downloadable official weights can be dated. Public previews qualify; private previews and announcements without access do not.

The catalog does not claim to list every provider, model, regional rollout, hosting platform, or post-research-date change. `verified_at` is model-specific; `meta.researched_at` is the dataset research cutoff.

## Run and verify locally

Node.js 24 is the deployment runtime.

```sh
npm install
npm run check
npm test
npm run test:coverage
npx vercel dev
```

The suite validates schema invariants and corrupt-data rejection, retrieves every canonical model, resolves every official identifier, exercises real combined filters and pagination, checks the browser client against the handlers, and verifies routing and HTTP behavior. Production source, branch, and function coverage are enforced at 100%.

## Deploy on Vercel

Import the repository without a framework preset, database, secrets, or environment variables. `vercel.json` builds the static explorer, bundles `model-release-dates.json` into each function, and configures the public item and identifier routes.

To update the catalog, edit `model-release-dates.json`, keep evidence on the relevant event, update `verified_at` and `researched_at`, run `npm run test:coverage`, and deploy the tested commit.
