import { HttpError } from "./http.js";
import {
  AVAILABILITY_TYPES,
  AVAILABILITY_STAGES,
  CONFIDENCE_TYPES,
  IDENTIFIER_TYPES,
  LIFECYCLE_EVENT_STATUSES,
  isIsoDate,
  type AvailabilityType,
  type AvailabilityStage,
  type ConfidenceType,
  type IdentifierType,
  type LifecycleStatus,
  type ModelRelease,
} from "./types.js";

const LIST_PARAMETERS = new Set([
  "q",
  "provider",
  "identifier_namespace",
  "identifier",
  "identifier_type",
  "availability",
  "availability_stage",
  "confidence",
  "lifecycle_status",
  "from",
  "to",
  "sort",
  "order",
  "limit",
  "offset",
]);
const ITEM_PARAMETERS = new Set(["provider", "model"]);
const IDENTIFIER_PARAMETERS = new Set(["namespace", "identifier"]);
const SORT_FIELDS = ["model", "release_date"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
const LIFECYCLE_STATUSES = ["unknown", ...LIFECYCLE_EVENT_STATUSES] as const;

type SortField = (typeof SORT_FIELDS)[number];
type SortOrder = (typeof SORT_ORDERS)[number];

export interface ModelQuery {
  readonly q: string | undefined;
  readonly provider: string | undefined;
  readonly identifierNamespace: string | undefined;
  readonly identifier: string | undefined;
  readonly identifierType: IdentifierType | undefined;
  readonly availability: AvailabilityType | undefined;
  readonly availabilityStage: AvailabilityStage | undefined;
  readonly confidence: ConfidenceType | undefined;
  readonly lifecycleStatus: LifecycleStatus | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly sort: SortField;
  readonly order: SortOrder;
  readonly limit: number;
  readonly offset: number;
}

export interface QueryResult {
  readonly models: readonly ModelRelease[];
  readonly total: number;
}

function rejectUnknownParameters(parameters: URLSearchParams, allowed: ReadonlySet<string>): void {
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) {
      throw new HttpError(400, "invalid_query", `Unknown query parameter: ${key}`);
    }
  }
}

function readOptionalParameter(parameters: URLSearchParams, key: string): string | undefined {
  const values = parameters.getAll(key);
  if (values.length > 1) {
    throw new HttpError(400, "invalid_query", `Query parameter ${key} must appear once`);
  }
  const value = values[0];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new HttpError(400, "invalid_query", `Query parameter ${key} cannot be empty`);
  }
  return trimmed;
}

function readRequiredParameter(parameters: URLSearchParams, key: string): string {
  const value = readOptionalParameter(parameters, key);
  if (value === undefined) {
    throw new HttpError(400, "invalid_query", `Query parameter ${key} is required`);
  }
  return value;
}

function readEnum<T extends string>(
  value: string | undefined,
  values: readonly T[],
  key: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new HttpError(
      400,
      "invalid_query",
      `Query parameter ${key} must be one of: ${values.join(", ")}`,
    );
  }
  return match;
}

function readInteger(
  value: string | undefined,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, "invalid_query", `Query parameter ${key} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(
      400,
      "invalid_query",
      `Query parameter ${key} must be between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function readDate(value: string | undefined, key: string): string | undefined {
  if (value !== undefined && !isIsoDate(value)) {
    throw new HttpError(400, "invalid_query", `Query parameter ${key} must be a real ISO date`);
  }
  return value;
}

export function parseModelQuery(url: URL): ModelQuery {
  const parameters = url.searchParams;
  rejectUnknownParameters(parameters, LIST_PARAMETERS);

  const q = readOptionalParameter(parameters, "q");
  if (q !== undefined && q.length > 200) {
    throw new HttpError(400, "invalid_query", "Query parameter q cannot exceed 200 characters");
  }

  const provider = readOptionalParameter(parameters, "provider");
  if (provider !== undefined && !/^[a-z0-9][a-z0-9.-]*$/.test(provider)) {
    throw new HttpError(400, "invalid_query", "Query parameter provider is malformed");
  }

  const identifierNamespace = readOptionalParameter(parameters, "identifier_namespace");
  if (
    identifierNamespace !== undefined &&
    !/^[a-z0-9][a-z0-9.-]*$/.test(identifierNamespace)
  ) {
    throw new HttpError(400, "invalid_query", "Query parameter identifier_namespace is malformed");
  }
  const identifier = readOptionalParameter(parameters, "identifier");
  if (identifier !== undefined && (identifier.length > 200 || /\s/.test(identifier))) {
    throw new HttpError(400, "invalid_query", "Query parameter identifier is malformed");
  }

  const from = readDate(readOptionalParameter(parameters, "from"), "from");
  const to = readDate(readOptionalParameter(parameters, "to"), "to");
  if (from !== undefined && to !== undefined && from > to) {
    throw new HttpError(400, "invalid_query", "Query parameter from cannot be after to");
  }

  return {
    q,
    provider,
    identifierNamespace,
    identifier,
    identifierType: readEnum(
      readOptionalParameter(parameters, "identifier_type"),
      IDENTIFIER_TYPES,
      "identifier_type",
    ),
    availability: readEnum(
      readOptionalParameter(parameters, "availability"),
      AVAILABILITY_TYPES,
      "availability",
    ),
    availabilityStage: readEnum(
      readOptionalParameter(parameters, "availability_stage"),
      AVAILABILITY_STAGES,
      "availability_stage",
    ),
    confidence: readEnum(
      readOptionalParameter(parameters, "confidence"),
      CONFIDENCE_TYPES,
      "confidence",
    ),
    lifecycleStatus: readEnum(
      readOptionalParameter(parameters, "lifecycle_status"),
      LIFECYCLE_STATUSES,
      "lifecycle_status",
    ),
    from,
    to,
    sort:
      readEnum(readOptionalParameter(parameters, "sort"), SORT_FIELDS, "sort") ??
      "release_date",
    order: readEnum(readOptionalParameter(parameters, "order"), SORT_ORDERS, "order") ?? "asc",
    limit: readInteger(readOptionalParameter(parameters, "limit"), "limit", 50, 1, 100),
    offset: readInteger(
      readOptionalParameter(parameters, "offset"),
      "offset",
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function compareModels(left: ModelRelease, right: ModelRelease, field: SortField): number {
  const primary = left[field].localeCompare(right[field]);
  return primary !== 0 ? primary : left.model.localeCompare(right.model);
}

export function queryModels(models: readonly ModelRelease[], query: ModelQuery): QueryResult {
  const search = query.q?.toLowerCase();
  const filtered = models.filter(
    (model) =>
      (search === undefined ||
        model.model.toLowerCase().includes(search) ||
        model.display_name.toLowerCase().includes(search) ||
        model.identifiers.some((identifier) => identifier.value.toLowerCase().includes(search))) &&
      (query.provider === undefined || model.provider_id === query.provider) &&
      (query.identifierNamespace === undefined ||
        model.identifiers.some(
          (identifier) => identifier.namespace === query.identifierNamespace,
        )) &&
      (query.identifier === undefined ||
        model.identifiers.some(
          (identifier) =>
            identifier.value === query.identifier &&
            (query.identifierNamespace === undefined ||
              identifier.namespace === query.identifierNamespace),
        )) &&
      (query.identifierType === undefined || model.identifier_type === query.identifierType) &&
      (query.availability === undefined || model.availability.includes(query.availability)) &&
      (query.availabilityStage === undefined ||
        model.availability_events.some((event) => event.stage === query.availabilityStage)) &&
      (query.confidence === undefined || model.confidence === query.confidence) &&
      (query.lifecycleStatus === undefined || model.lifecycle_status === query.lifecycleStatus) &&
      (query.from === undefined || model.release_date >= query.from) &&
      (query.to === undefined || model.release_date <= query.to),
  );
  filtered.sort((left, right) => {
    const comparison = compareModels(left, right, query.sort);
    return query.order === "asc" ? comparison : -comparison;
  });
  return {
    models: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
  };
}

export function parseModelId(url: URL): string {
  const parameters = url.searchParams;
  rejectUnknownParameters(parameters, ITEM_PARAMETERS);
  const provider = readRequiredParameter(parameters, "provider");
  const model = readRequiredParameter(parameters, "model");
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(provider) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
    throw new HttpError(400, "invalid_query", "The model identifier is malformed");
  }
  return `${provider}/${model}`;
}

export interface IdentifierQuery {
  readonly namespace: string;
  readonly identifier: string;
}

export function parseIdentifierQuery(url: URL): IdentifierQuery {
  const parameters = url.searchParams;
  rejectUnknownParameters(parameters, IDENTIFIER_PARAMETERS);
  const namespace = readRequiredParameter(parameters, "namespace");
  const identifier = readRequiredParameter(parameters, "identifier");
  if (
    !/^[a-z0-9][a-z0-9.-]*$/.test(namespace) ||
    identifier.length > 200 ||
    /\s/.test(identifier)
  ) {
    throw new HttpError(400, "invalid_query", "The upstream identifier is malformed");
  }
  return { namespace, identifier };
}
