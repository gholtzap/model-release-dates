export type IdentifierType = "model" | "snapshot" | "weights";
export type IdentifierKind = "model" | "alias" | "snapshot" | "weights";
export type AvailabilityType = "api" | "weights";
export type AvailabilityStage = "public_preview" | "public";
export type ConfidenceType = "confirmed";
export type DatePrecision = "day" | "month" | "year";
export type LifecycleStatus =
  | "unknown"
  | "active"
  | "deprecated"
  | "retired"
  | "retirement_scheduled";
export type LifecycleDateRole = "announced" | "effective" | "scheduled" | "observed";
export type RelationshipType = "snapshot_of" | "alias_of";
export type SortField = "model" | "release_date";
export type SortOrder = "asc" | "desc";

export interface ApiSource {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly evidence: string;
}

export interface ApiProvider {
  readonly id: string;
  readonly name: string;
  readonly website: string;
}

export interface ApiIdentifier {
  readonly namespace: string;
  readonly value: string;
  readonly kind: IdentifierKind;
}

export interface ApiRelationship {
  readonly type: RelationshipType;
  readonly target_model: string;
}

export interface ApiAvailabilityEvent {
  readonly channel: AvailabilityType;
  readonly stage: AvailabilityStage;
  readonly date: string;
  readonly date_precision?: DatePrecision;
  readonly confidence: ConfidenceType;
  readonly sources: readonly ApiSource[];
}

export interface ApiLifecycleEvent {
  readonly status: Exclude<LifecycleStatus, "unknown">;
  readonly date: string;
  readonly date_role: LifecycleDateRole;
  readonly date_precision?: DatePrecision;
  readonly channel?: AvailabilityType;
  readonly identifier?: Readonly<Pick<ApiIdentifier, "namespace" | "value">>;
  readonly confidence: ConfidenceType;
  readonly sources: readonly ApiSource[];
}

export interface CatalogCoverage {
  readonly exhaustive: false;
  readonly statement: string;
  readonly provider_inclusion_criteria: string;
  readonly model_inclusion_criteria: string;
}

export interface ApiModel {
  readonly model: string;
  readonly display_name: string;
  readonly provider_id: string;
  readonly provider: ApiProvider;
  readonly identifier_type: IdentifierType;
  readonly identifiers: readonly ApiIdentifier[];
  readonly relationships: readonly ApiRelationship[];
  readonly availability_events: readonly ApiAvailabilityEvent[];
  readonly lifecycle_events: readonly ApiLifecycleEvent[];
  readonly verified_at: string;
  readonly availability: readonly AvailabilityType[];
  readonly release_date: string;
  readonly release_date_precision: DatePrecision;
  readonly confidence: ConfidenceType;
  readonly sources: readonly ApiSource[];
  readonly lifecycle_status: LifecycleStatus;
}

export interface ListFilters {
  readonly q: string;
  readonly provider: string;
  readonly identifierNamespace: string;
  readonly identifier: string;
  readonly identifierType: string;
  readonly availability: string;
  readonly availabilityStage: string;
  readonly lifecycleStatus: string;
  readonly from: string;
  readonly to: string;
  readonly sort: SortField;
  readonly order: SortOrder;
  readonly limit: number;
  readonly offset: number;
}

export interface ListMeta {
  readonly schema_version: number;
  readonly researched_at: string;
  readonly coverage: CatalogCoverage;
  readonly total: number;
  readonly count: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ListResponse {
  readonly data: readonly ApiModel[];
  readonly meta: ListMeta;
}

export interface ItemResponse {
  readonly data: ApiModel;
  readonly meta: Pick<ListMeta, "schema_version" | "researched_at" | "coverage">;
}

export interface IdentifierResponse extends ItemResponse {
  readonly meta: ItemResponse["meta"] & {
    readonly matched_identifier: Readonly<Pick<ApiIdentifier, "namespace" | "value">>;
  };
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiClientError(502, "invalid_response", `${path} is not an object`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ApiClientError(502, "invalid_response", `${path}.${key} is not a string`);
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  return key in record ? readString(record, key, path) : undefined;
}

function readNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiClientError(502, "invalid_response", `${path}.${key} is not a number`);
  }
  return value;
}

function readArray(record: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ApiClientError(502, "invalid_response", `${path}.${key} is not an array`);
  }
  return value;
}

function parseEnum<T extends string>(value: string, values: readonly T[], path: string): T {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ApiClientError(502, "invalid_response", `${path} is unsupported`);
  }
  return match;
}

function parseSource(value: unknown, path: string): ApiSource {
  const record = readRecord(value, path);
  return {
    publisher: readString(record, "publisher", path),
    title: readString(record, "title", path),
    url: readString(record, "url", path),
    evidence: readString(record, "evidence", path),
  };
}

function parseSources(record: Record<string, unknown>, path: string): readonly ApiSource[] {
  return readArray(record, "sources", path).map((source, index) =>
    parseSource(source, `${path}.sources[${index}]`),
  );
}

function parseProvider(value: unknown, path: string): ApiProvider {
  const record = readRecord(value, path);
  return {
    id: readString(record, "id", path),
    name: readString(record, "name", path),
    website: readString(record, "website", path),
  };
}

function parseIdentifierReference(
  value: unknown,
  path: string,
): Readonly<Pick<ApiIdentifier, "namespace" | "value">> {
  const record = readRecord(value, path);
  return {
    namespace: readString(record, "namespace", path),
    value: readString(record, "value", path),
  };
}

function parseIdentifier(value: unknown, path: string): ApiIdentifier {
  const record = readRecord(value, path);
  return {
    ...parseIdentifierReference(record, path),
    kind: parseEnum(
      readString(record, "kind", path),
      ["model", "alias", "snapshot", "weights"],
      `${path}.kind`,
    ),
  };
}

function parseAvailabilityEvent(value: unknown, path: string): ApiAvailabilityEvent {
  const record = readRecord(value, path);
  const datePrecision = readOptionalString(record, "date_precision", path);
  return {
    channel: parseEnum(readString(record, "channel", path), ["api", "weights"], `${path}.channel`),
    stage: parseEnum(
      readString(record, "stage", path),
      ["public_preview", "public"],
      `${path}.stage`,
    ),
    date: readString(record, "date", path),
    ...(datePrecision === undefined
      ? {}
      : { date_precision: parseEnum(datePrecision, ["day", "month", "year"], `${path}.date_precision`) }),
    confidence: parseEnum(readString(record, "confidence", path), ["confirmed"], `${path}.confidence`),
    sources: parseSources(record, path),
  };
}

function parseLifecycleEvent(value: unknown, path: string): ApiLifecycleEvent {
  const record = readRecord(value, path);
  const datePrecision = readOptionalString(record, "date_precision", path);
  const channel = readOptionalString(record, "channel", path);
  const identifier = "identifier" in record
    ? parseIdentifierReference(record["identifier"], `${path}.identifier`)
    : undefined;
  return {
    status: parseEnum(
      readString(record, "status", path),
      ["active", "deprecated", "retired", "retirement_scheduled"],
      `${path}.status`,
    ),
    date: readString(record, "date", path),
    date_role: parseEnum(
      readString(record, "date_role", path),
      ["announced", "effective", "scheduled", "observed"],
      `${path}.date_role`,
    ),
    ...(datePrecision === undefined
      ? {}
      : { date_precision: parseEnum(datePrecision, ["day", "month", "year"], `${path}.date_precision`) }),
    ...(channel === undefined
      ? {}
      : { channel: parseEnum(channel, ["api", "weights"], `${path}.channel`) }),
    ...(identifier === undefined ? {} : { identifier }),
    confidence: parseEnum(readString(record, "confidence", path), ["confirmed"], `${path}.confidence`),
    sources: parseSources(record, path),
  };
}

function parseRelationship(value: unknown, path: string): ApiRelationship {
  const record = readRecord(value, path);
  return {
    type: parseEnum(
      readString(record, "type", path),
      ["snapshot_of", "alias_of"],
      `${path}.type`,
    ),
    target_model: readString(record, "target_model", path),
  };
}

function parseCoverage(value: unknown): CatalogCoverage {
  const record = readRecord(value, "meta.coverage");
  if (record["exhaustive"] !== false) {
    throw new ApiClientError(502, "invalid_response", "meta.coverage.exhaustive is not false");
  }
  return {
    exhaustive: false,
    statement: readString(record, "statement", "meta.coverage"),
    provider_inclusion_criteria: readString(record, "provider_inclusion_criteria", "meta.coverage"),
    model_inclusion_criteria: readString(record, "model_inclusion_criteria", "meta.coverage"),
  };
}

function parseModel(value: unknown, path: string): ApiModel {
  const record = readRecord(value, path);
  return {
    model: readString(record, "model", path),
    display_name: readString(record, "display_name", path),
    provider_id: readString(record, "provider_id", path),
    provider: parseProvider(record["provider"], `${path}.provider`),
    identifier_type: parseEnum(
      readString(record, "identifier_type", path),
      ["model", "snapshot", "weights"],
      `${path}.identifier_type`,
    ),
    identifiers: readArray(record, "identifiers", path).map((identifier, index) =>
      parseIdentifier(identifier, `${path}.identifiers[${index}]`),
    ),
    relationships: readArray(record, "relationships", path).map((relationship, index) =>
      parseRelationship(relationship, `${path}.relationships[${index}]`),
    ),
    availability_events: readArray(record, "availability_events", path).map((event, index) =>
      parseAvailabilityEvent(event, `${path}.availability_events[${index}]`),
    ),
    lifecycle_events: readArray(record, "lifecycle_events", path).map((event, index) =>
      parseLifecycleEvent(event, `${path}.lifecycle_events[${index}]`),
    ),
    verified_at: readString(record, "verified_at", path),
    availability: readArray(record, "availability", path).map((channel, index) =>
      parseEnum(String(channel), ["api", "weights"], `${path}.availability[${index}]`),
    ),
    release_date: readString(record, "release_date", path),
    release_date_precision: parseEnum(
      readString(record, "release_date_precision", path),
      ["day", "month", "year"],
      `${path}.release_date_precision`,
    ),
    confidence: parseEnum(readString(record, "confidence", path), ["confirmed"], `${path}.confidence`),
    sources: parseSources(record, path),
    lifecycle_status: parseEnum(
      readString(record, "lifecycle_status", path),
      ["unknown", "active", "deprecated", "retired", "retirement_scheduled"],
      `${path}.lifecycle_status`,
    ),
  };
}

function parseMeta(value: unknown, includePagination: boolean): ListMeta {
  const record = readRecord(value, "meta");
  return {
    schema_version: readNumber(record, "schema_version", "meta"),
    researched_at: readString(record, "researched_at", "meta"),
    coverage: parseCoverage(record["coverage"]),
    total: includePagination ? readNumber(record, "total", "meta") : 1,
    count: includePagination ? readNumber(record, "count", "meta") : 1,
    limit: includePagination ? readNumber(record, "limit", "meta") : 1,
    offset: includePagination ? readNumber(record, "offset", "meta") : 0,
  };
}

export function buildListPath(filters: ListFilters): string {
  const parameters = new URLSearchParams();
  const optionalValues: ReadonlyArray<readonly [string, string]> = [
    ["q", filters.q.trim()],
    ["provider", filters.provider],
    ["identifier_namespace", filters.identifierNamespace],
    ["identifier", filters.identifier],
    ["identifier_type", filters.identifierType],
    ["availability", filters.availability],
    ["availability_stage", filters.availabilityStage],
    ["lifecycle_status", filters.lifecycleStatus],
    ["from", filters.from],
    ["to", filters.to],
  ];
  for (const [key, value] of optionalValues) {
    if (value !== "") {
      parameters.set(key, value);
    }
  }
  parameters.set("sort", filters.sort);
  parameters.set("order", filters.order);
  parameters.set("limit", String(filters.limit));
  parameters.set("offset", String(filters.offset));
  return `/api/models?${parameters.toString()}`;
}

export function buildItemPath(modelId: string): string {
  const parts = modelId.trim().split("/");
  const provider = parts[0];
  const model = parts[1];
  if (parts.length !== 2 || provider === undefined || provider === "" || model === undefined || model === "") {
    throw new ApiClientError(0, "invalid_model", "Use the provider/model format");
  }
  return `/api/models/${encodeURIComponent(provider)}/${encodeURIComponent(model)}`;
}

export function buildIdentifierPath(namespace: string, identifier: string): string {
  const normalizedNamespace = namespace.trim();
  const normalizedIdentifier = identifier.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]*$/.test(normalizedNamespace) ||
    normalizedIdentifier === "" ||
    normalizedIdentifier.length > 200 ||
    /\s/.test(normalizedIdentifier)
  ) {
    throw new ApiClientError(0, "invalid_identifier", "Use a namespace and exact upstream identifier");
  }
  return `/api/identifiers/${encodeURIComponent(normalizedNamespace)}/${encodeURIComponent(normalizedIdentifier)}`;
}

async function requestJson(fetcher: Fetcher, path: string): Promise<unknown> {
  const response = await fetcher(path, { headers: { Accept: "application/json" } });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(response.status, "invalid_response", "The API returned invalid JSON");
  }
  if (!response.ok) {
    const record = isRecord(body) && isRecord(body["error"]) ? body["error"] : undefined;
    const code = record === undefined ? "request_failed" : readString(record, "code", "error");
    const message = record === undefined
      ? `Request failed with status ${response.status}`
      : readString(record, "message", "error");
    throw new ApiClientError(response.status, code, message);
  }
  return body;
}

export async function fetchModels(fetcher: Fetcher, filters: ListFilters): Promise<ListResponse> {
  const body = readRecord(await requestJson(fetcher, buildListPath(filters)), "response");
  return {
    data: readArray(body, "data", "response").map((model, index) => parseModel(model, `data[${index}]`)),
    meta: parseMeta(body["meta"], true),
  };
}

function parseItemResponse(bodyValue: unknown): ItemResponse {
  const body = readRecord(bodyValue, "response");
  const meta = parseMeta(body["meta"], false);
  return {
    data: parseModel(body["data"], "data"),
    meta: {
      schema_version: meta.schema_version,
      researched_at: meta.researched_at,
      coverage: meta.coverage,
    },
  };
}

export async function fetchModel(fetcher: Fetcher, modelId: string): Promise<ItemResponse> {
  return parseItemResponse(await requestJson(fetcher, buildItemPath(modelId)));
}

export async function fetchIdentifier(
  fetcher: Fetcher,
  namespace: string,
  identifier: string,
): Promise<IdentifierResponse> {
  const body = readRecord(
    await requestJson(fetcher, buildIdentifierPath(namespace, identifier)),
    "response",
  );
  const item = parseItemResponse(body);
  const meta = readRecord(body["meta"], "meta");
  return {
    ...item,
    meta: {
      ...item.meta,
      matched_identifier: parseIdentifierReference(
        meta["matched_identifier"],
        "meta.matched_identifier",
      ),
    },
  };
}
