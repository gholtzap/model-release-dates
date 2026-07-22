# AI Model Release Date API

I was surprised there was no reliable, developer-friendly source for AI model release dates, so I built one. This read-only API answers practical questions about when a model became usable, which upstream identifiers refer to it, how aliases and snapshots relate, and whether an API model is active, deprecated, retired, or scheduled for retirement.

Every availability and lifecycle event is source-backed, with first-party evidence used wherever a surviving dated source is available. The catalog is curated and intentionally non-exhaustive; every response states its research date and inclusion criteria so missing records are not mistaken for confirmed absence.

## Try it

Open the deployment root to use the web explorer. It can list and filter models, retrieve a canonical model, or resolve an exact provider API or Hugging Face identifier. It also shows the generated URL, cURL command, lifecycle replacements, structured timelines, and raw JSON.

The API is deployed at `https://model-release-dates.vercel.app`.

The machine-readable API contract is available at [`/openapi.json`](https://model-release-dates.vercel.app/openapi.json).

### Resolve an upstream identifier

Use this when the ID in your application does not match the catalog's canonical `provider/model` ID:

```sh
curl 'https://model-release-dates.vercel.app/api/identifiers/deepseek-api/deepseek-reasoner'
```

The response resolves `deepseek-reasoner` to `deepseek/deepseek-r1` and includes the exact match in `meta.matched_identifier`. URL-encode identifiers containing `/`, such as Hugging Face repository IDs.

Supported namespaces currently include `openai-api`, `anthropic-api`, `gemini-api`, `deepseek-api`, `huggingface`, and `vercel-ai-gateway`. Identifier matching is exact and case-sensitive. Unknown identifiers return `404` with `error.code` set to `identifier_not_found`.

### Resolve without knowing the namespace

Resolve one raw identifier across every namespace:

```sh
curl 'https://model-release-dates.vercel.app/api/resolve?identifier=gpt-4o'
```

Resolve up to 100 identifiers in one ordered batch:

```sh
curl -X POST 'https://model-release-dates.vercel.app/api/resolve?fields=model,release_date,lifecycle_status,identifiers' \
  -H 'Content-Type: application/json' \
  -d '{"identifiers":["gpt-4o","claude-3-5-sonnet-20241022","deepseek-reasoner"]}'
```

Unknown batch members have an empty `matches` array, so one miss does not discard the other results.

Exact, case-sensitive resolution remains the default. To explicitly request ranked candidates for punctuation changes, provider-prefixed values, case differences, and stale aliases, use suggestion mode:

```sh
curl 'https://model-release-dates.vercel.app/api/resolve?identifier=anthropic%2Fclaude-3.5-sonnet-20241022&mode=suggest&fields=model,lifecycle_status,replacement_models'
```

Each candidate includes a score from 0 to 1 and machine-readable reasons such as `punctuation_normalized`, `provider_prefix_removed`, `case_insensitive`, `close_edit_distance`, and `shared_tokens`. Suggestion mode returns `200` with zero or more candidates. Alternatively, add `suggestions=true` to an exact resolve or namespaced identifier request to preserve the normal `404 identifier_not_found` response while adding a top-level `suggestions` array.

### Get one canonical model

```sh
curl 'https://model-release-dates.vercel.app/api/models/openai/gpt-4o'
```

Canonical model IDs use `provider/model` format and remain stable even when a provider's exact identifier uses different spelling or changes aliases. Anthropic canonical lookups treat dots and dashes between numeric version components as equivalent, so `claude-3.5-sonnet` and `claude-3-5-sonnet` resolve to the same record. Exact upstream identifiers live in `identifiers` and can be resolved through `/api/identifiers/:namespace/:identifier`; those matches remain exact and case-sensitive. Unknown models return `404` with `error.code` set to `model_not_found`.

### Search and filter models

```sh
curl 'https://model-release-dates.vercel.app/api/models?provider=anthropic&lifecycle_status=retired&sort=release_date&order=desc'
```

`GET /api/models` accepts:

| Parameter | Accepted value |
| --- | --- |
| `q` | Case-insensitive substring of a canonical ID, display name, or upstream identifier |
| `provider` | Provider ID such as `openai`, `anthropic`, `google`, `deepseek`, or `meta` |
| `identifier_namespace` | Exact namespace, such as `openai-api` or `huggingface` |
| `identifier` | Exact upstream identifier; combine with `identifier_namespace` when possible |
| `identifier_type` | `model`, `snapshot`, or `weights` |
| `availability` | `api` or `weights` |
| `availability_stage` | `public_preview` or `public` |
| `lifecycle_status` | `unknown`, `active`, `deprecated`, `retired`, or `retirement_scheduled` |
| `capability` | `text`, `vision`, `reasoning`, `audio`, `weights`, `embedding`, or `deprecated`; repeat it to require every supplied capability |
| `updated_since` | Inclusive `YYYY-MM-DD` lower bound on `last_changed_at` |
| `retiring_before` | Models with a `retirement_scheduled` event on or before this `YYYY-MM-DD` date |
| `confidence` | `confirmed` |
| `from` / `to` | Inclusive `YYYY-MM-DD` bounds on the derived release date |
| `sort` | `release_date` (default) or `model` |
| `order` | `asc` (default) or `desc` |
| `limit` | 1–100; default 50 |
| `offset` | Zero-based offset; default 0 |
| `fields` | Comma-separated response fields, such as `model,release_date,lifecycle_status,identifiers` |

Filters can be combined. Repeated `capability` parameters use all-of semantics; other repeated parameters are invalid. `meta.total` is the number of matches before pagination; `meta.count` is the number returned. Invalid or unknown query parameters return `400` with `error.code` set to `invalid_query`.

`fields` is also supported by canonical model, namespaced identifier, and resolve requests. Without it, the complete record is returned.

### Discover filter values

Clients can build filters dynamically from `GET /api/providers`, `GET /api/identifier-namespaces`, and `GET /api/lifecycle-statuses`.

### Consume catalog changes

Use the date-based change feed for incremental synchronization:

```sh
curl 'https://model-release-dates.vercel.app/api/changes?since=2026-07-01&fields=model,last_changed_at,lifecycle_status,replacement_models'
```

`since` is required and inclusive because catalog timestamps have day precision. Results are ordered by `last_changed_at` and then canonical model ID, with the same `limit`, `offset`, `fields`, metadata, and ETag behavior as model queries.

Requests to `/api/*` are limited to 100 requests per 60-second fixed window per source IP and Vercel region. Requests over the limit receive HTTP `429`.

Unknown `/api/*` routes return JSON with HTTP `404` and `error.code` set to `not_found`.

## Response model

Schema version 2 keeps evidence on the event it supports:

```json
{
  "data": {
    "model": "deepseek/deepseek-r1",
    "display_name": "DeepSeek R1",
    "provider_id": "deepseek",
    "provider": {
      "id": "deepseek",
      "name": "DeepSeek",
      "website": "https://www.deepseek.com/"
    },
    "identifiers": [
      { "namespace": "deepseek-api", "value": "deepseek-reasoner", "kind": "alias" },
      { "namespace": "huggingface", "value": "deepseek-ai/DeepSeek-R1", "kind": "weights" }
    ],
    "capabilities": ["text", "reasoning", "weights", "deprecated"],
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
    "verified_at": "2026-07-22",
    "last_changed_at": "2026-07-22",
    "release_date": "2025-01-20",
    "release_date_precision": "day",
    "availability": ["api", "weights"],
    "confidence": "confirmed",
    "sources": [
      { "publisher": "DeepSeek", "title": "...", "url": "https://...", "evidence": "..." }
    ],
    "lifecycle_status": "retirement_scheduled",
    "replacement_models": []
  },
  "meta": {
    "schema_version": 2,
    "dataset_version": "2026-07-22.2",
    "researched_at": "2026-07-22",
    "changelog_url": "https://github.com/gholtzap/model-release-dates/commits/main/model-release-dates.json",
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

`lifecycle_status` is the latest cataloged lifecycle state. Consult `lifecycle_events` for whether a date was observed, announced, effective, or scheduled and whether it applies to a particular channel or identifier. For deprecated, retired, or retirement-scheduled records, `replacement_models` contains source-backed canonical successors when the provider publishes a recommendation; an empty array means the catalog does not have a supported replacement hint.

`capabilities` uses the tags `text`, `vision`, `reasoning`, `audio`, `weights`, `embedding`, and `deprecated`. `last_changed_at` records when the catalog record itself changed; `verified_at` records when its evidence was checked.

Successful `GET` and `HEAD` representations include a strong `ETag`. Send it back in `If-None-Match`; unchanged representations return `304`. Successful `POST` responses are not cacheable and do not include an ETag. Response metadata includes the dataset version and changelog URL.

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
