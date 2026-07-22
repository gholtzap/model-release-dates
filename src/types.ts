export const IDENTIFIER_TYPES = ["model", "snapshot", "weights"] as const;
export const IDENTIFIER_KINDS = ["model", "alias", "snapshot", "weights"] as const;
export const AVAILABILITY_TYPES = ["api", "weights"] as const;
export const AVAILABILITY_STAGES = ["public_preview", "public"] as const;
export const CONFIDENCE_TYPES = ["confirmed"] as const;
export const DATE_PRECISIONS = ["day", "month", "year"] as const;
export const LIFECYCLE_EVENT_STATUSES = [
  "active",
  "deprecated",
  "retired",
  "retirement_scheduled",
] as const;
export const LIFECYCLE_DATE_ROLES = ["announced", "effective", "scheduled", "observed"] as const;
export const RELATIONSHIP_TYPES = ["snapshot_of", "alias_of"] as const;
export const CAPABILITY_TAGS = [
  "text",
  "vision",
  "reasoning",
  "audio",
  "weights",
  "embedding",
  "deprecated",
] as const;

export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];
export type AvailabilityType = (typeof AVAILABILITY_TYPES)[number];
export type AvailabilityStage = (typeof AVAILABILITY_STAGES)[number];
export type ConfidenceType = (typeof CONFIDENCE_TYPES)[number];
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export type LifecycleEventStatus = (typeof LIFECYCLE_EVENT_STATUSES)[number];
export type LifecycleDateRole = (typeof LIFECYCLE_DATE_ROLES)[number];
export type LifecycleStatus = "unknown" | LifecycleEventStatus;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
type JsonInput = JsonValue | undefined;

export interface Source {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly evidence: string;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly website: string;
}

export interface ModelIdentifier {
  readonly namespace: string;
  readonly value: string;
  readonly kind: IdentifierKind;
}

export interface IdentifierReference {
  readonly namespace: string;
  readonly value: string;
}

export interface AvailabilityEvent {
  readonly channel: AvailabilityType;
  readonly stage: AvailabilityStage;
  readonly date: string;
  readonly date_precision?: DatePrecision;
  readonly confidence: ConfidenceType;
  readonly sources: readonly Source[];
}

export interface LifecycleEvent {
  readonly status: LifecycleEventStatus;
  readonly date: string;
  readonly date_role: LifecycleDateRole;
  readonly date_precision?: DatePrecision;
  readonly channel?: AvailabilityType;
  readonly identifier?: IdentifierReference;
  readonly confidence: ConfidenceType;
  readonly sources: readonly Source[];
}

export interface ModelRelationship {
  readonly type: RelationshipType;
  readonly target_model: string;
}

export interface CatalogModel {
  readonly model: string;
  readonly display_name: string;
  readonly provider_id: string;
  readonly identifier_type: IdentifierType;
  readonly identifiers: readonly ModelIdentifier[];
  readonly relationships: readonly ModelRelationship[];
  readonly availability_events: readonly AvailabilityEvent[];
  readonly lifecycle_events: readonly LifecycleEvent[];
  readonly capabilities: readonly CapabilityTag[];
  readonly verified_at: string;
  readonly last_changed_at: string;
}

export interface CatalogCoverage {
  readonly exhaustive: false;
  readonly statement: string;
  readonly provider_inclusion_criteria: string;
  readonly model_inclusion_criteria: string;
}

export interface Dataset {
  readonly schema_version: 2;
  readonly dataset_version: string;
  readonly changelog_url: string;
  readonly release_date_definition: string;
  readonly identifier_type_definition: Readonly<Record<IdentifierType, string>>;
  readonly identifier_kind_definition: Readonly<Record<IdentifierKind, string>>;
  readonly availability_definition: Readonly<Record<AvailabilityType, string>>;
  readonly availability_stage_definition: Readonly<Record<AvailabilityStage, string>>;
  readonly date_precision_definition: Readonly<Record<DatePrecision, string>>;
  readonly lifecycle_status_definition: Readonly<Record<LifecycleEventStatus, string>>;
  readonly lifecycle_date_role_definition: Readonly<Record<LifecycleDateRole, string>>;
  readonly relationship_type_definition: Readonly<Record<RelationshipType, string>>;
  readonly capability_definition: Readonly<Record<CapabilityTag, string>>;
  readonly coverage: CatalogCoverage;
  readonly providers: readonly Provider[];
  readonly researched_at: string;
  readonly models: readonly CatalogModel[];
}

export interface ModelRelease extends CatalogModel {
  readonly provider: Provider;
  readonly availability: readonly AvailabilityType[];
  readonly release_date: string;
  readonly release_date_precision: DatePrecision;
  readonly confidence: ConfidenceType;
  readonly sources: readonly Source[];
  readonly lifecycle_status: LifecycleStatus;
}

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

function isRecord(value: JsonInput | Dataset): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: JsonInput | Dataset, path: string): JsonObject {
  if (!isRecord(value)) {
    throw new DatasetValidationError(`${path} must be an object`);
  }
  return value;
}

function requireKeys(
  record: JsonObject,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new DatasetValidationError(`${path}.${key} is not supported`);
    }
  }
  for (const key of required) {
    if (!(key in record)) {
      throw new DatasetValidationError(`${path}.${key} is required`);
    }
  }
}

function requireExactKeys(
  record: JsonObject,
  keys: readonly string[],
  path: string,
): void {
  requireKeys(record, keys, [], path);
}

function readString(record: JsonObject, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DatasetValidationError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(
  record: JsonObject,
  key: string,
  path: string,
): string | undefined {
  if (!(key in record)) {
    return undefined;
  }
  return readString(record, key, path);
}

function readArray(
  record: JsonObject,
  key: string,
  path: string,
  allowEmpty = false,
): readonly JsonValue[] {
  const value = record[key];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    const qualifier = allowEmpty ? "an array" : "a non-empty array";
    throw new DatasetValidationError(`${path}.${key} must be ${qualifier}`);
  }
  return value;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isIsoMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value) && isIsoDate(`${value}-01`);
}

function isIsoYear(value: string): boolean {
  return /^\d{4}$/.test(value);
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((candidate) => candidate === value);
}

function readEnum<T extends string>(
  record: JsonObject,
  key: string,
  values: readonly T[],
  path: string,
): T {
  const value = readString(record, key, path);
  if (!includes(values, value)) {
    throw new DatasetValidationError(`${path}.${key} is not supported`);
  }
  return value;
}

function readDefinitions<T extends string>(
  value: JsonInput,
  keys: readonly T[],
  path: string,
): Readonly<Record<T, string>> {
  const record = readRecord(value, path);
  requireExactKeys(record, keys, path);
  const entries = keys.map((key) => [key, readString(record, key, path)] as const);
  return Object.fromEntries(entries) as Readonly<Record<T, string>>;
}

function readHttpsUrl(record: JsonObject, key: string, path: string): string {
  const value = readString(record, key, path);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatasetValidationError(`${path}.${key} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new DatasetValidationError(`${path}.${key} must use HTTPS`);
  }
  return value;
}

function readDatePrecision(record: JsonObject, path: string): DatePrecision {
  const value = readOptionalString(record, "date_precision", path);
  if (value === undefined) {
    return "day";
  }
  if (!includes(DATE_PRECISIONS, value)) {
    throw new DatasetValidationError(`${path}.date_precision is not supported`);
  }
  return value;
}

function validateEventDate(date: string, precision: DatePrecision, path: string): void {
  const valid =
    (precision === "day" && isIsoDate(date)) ||
    (precision === "month" && isIsoMonth(date)) ||
    (precision === "year" && isIsoYear(date));
  if (!valid) {
    throw new DatasetValidationError(`${path}.date must match its date_precision`);
  }
}

export function normalizedDate(date: string, precision: DatePrecision = "day"): string {
  if (precision === "year") {
    return `${date}-01-01`;
  }
  if (precision === "month") {
    return `${date}-01`;
  }
  return date;
}

function parseSource(value: JsonInput, path: string): Source {
  const record = readRecord(value, path);
  requireExactKeys(record, ["publisher", "title", "url", "evidence"], path);
  return {
    publisher: readString(record, "publisher", path),
    title: readString(record, "title", path),
    url: readHttpsUrl(record, "url", path),
    evidence: readString(record, "evidence", path),
  };
}

function parseSources(record: JsonObject, path: string): readonly Source[] {
  return readArray(record, "sources", path).map((source, index) =>
    parseSource(source, `${path}.sources[${index}]`),
  );
}

function parseProvider(value: JsonInput, index: number): Provider {
  const path = `providers[${index}]`;
  const record = readRecord(value, path);
  requireExactKeys(record, ["id", "name", "website"], path);
  const id = readString(record, "id", path);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) {
    throw new DatasetValidationError(`${path}.id is malformed`);
  }
  return {
    id,
    name: readString(record, "name", path),
    website: readHttpsUrl(record, "website", path),
  };
}

function parseIdentifierReference(value: JsonInput, path: string): IdentifierReference {
  const record = readRecord(value, path);
  requireExactKeys(record, ["namespace", "value"], path);
  const namespace = readString(record, "namespace", path);
  const identifierValue = readString(record, "value", path);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(namespace)) {
    throw new DatasetValidationError(`${path}.namespace is malformed`);
  }
  if (identifierValue.length > 200 || /\s/.test(identifierValue)) {
    throw new DatasetValidationError(`${path}.value is malformed`);
  }
  return { namespace, value: identifierValue };
}

function parseIdentifier(value: JsonInput, path: string): ModelIdentifier {
  const record = readRecord(value, path);
  requireExactKeys(record, ["namespace", "value", "kind"], path);
  const namespace = readString(record, "namespace", path);
  const identifierValue = readString(record, "value", path);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(namespace)) {
    throw new DatasetValidationError(`${path}.namespace is malformed`);
  }
  if (identifierValue.length > 200 || /\s/.test(identifierValue)) {
    throw new DatasetValidationError(`${path}.value is malformed`);
  }
  return {
    namespace,
    value: identifierValue,
    kind: readEnum(record, "kind", IDENTIFIER_KINDS, path),
  };
}

function parseAvailabilityEvent(value: JsonInput, path: string): AvailabilityEvent {
  const record = readRecord(value, path);
  requireKeys(
    record,
    ["channel", "stage", "date", "confidence", "sources"],
    ["date_precision"],
    path,
  );
  const precision = readDatePrecision(record, path);
  const date = readString(record, "date", path);
  validateEventDate(date, precision, path);
  return {
    channel: readEnum(record, "channel", AVAILABILITY_TYPES, path),
    stage: readEnum(record, "stage", AVAILABILITY_STAGES, path),
    date,
    ...(precision === "day" && !("date_precision" in record)
      ? {}
      : { date_precision: precision }),
    confidence: readEnum(record, "confidence", CONFIDENCE_TYPES, path),
    sources: parseSources(record, path),
  };
}

function parseLifecycleEvent(value: JsonInput, path: string): LifecycleEvent {
  const record = readRecord(value, path);
  requireKeys(
    record,
    ["status", "date", "date_role", "confidence", "sources"],
    ["date_precision", "channel", "identifier"],
    path,
  );
  const precision = readDatePrecision(record, path);
  const date = readString(record, "date", path);
  validateEventDate(date, precision, path);
  const channel =
    "channel" in record
      ? readEnum(record, "channel", AVAILABILITY_TYPES, path)
      : undefined;
  const identifier =
    "identifier" in record
      ? parseIdentifierReference(record["identifier"], `${path}.identifier`)
      : undefined;
  return {
    status: readEnum(record, "status", LIFECYCLE_EVENT_STATUSES, path),
    date,
    date_role: readEnum(record, "date_role", LIFECYCLE_DATE_ROLES, path),
    ...(precision === "day" && !("date_precision" in record)
      ? {}
      : { date_precision: precision }),
    ...(channel === undefined ? {} : { channel }),
    ...(identifier === undefined ? {} : { identifier }),
    confidence: readEnum(record, "confidence", CONFIDENCE_TYPES, path),
    sources: parseSources(record, path),
  };
}

function parseRelationship(value: JsonInput, path: string): ModelRelationship {
  const record = readRecord(value, path);
  requireExactKeys(record, ["type", "target_model"], path);
  return {
    type: readEnum(record, "type", RELATIONSHIP_TYPES, path),
    target_model: readString(record, "target_model", path),
  };
}

function parseModel(value: JsonInput, index: number): CatalogModel {
  const path = `models[${index}]`;
  const record = readRecord(value, path);
  requireExactKeys(
    record,
    [
      "model",
      "display_name",
      "provider_id",
      "identifier_type",
      "identifiers",
      "relationships",
      "availability_events",
      "lifecycle_events",
      "capabilities",
      "verified_at",
      "last_changed_at",
    ],
    path,
  );

  const model = readString(record, "model", path);
  if (!/^[^/]+\/[^/]+$/.test(model)) {
    throw new DatasetValidationError(`${path}.model must contain one provider/name separator`);
  }
  const providerId = readString(record, "provider_id", path);
  if (!model.startsWith(`${providerId}/`)) {
    throw new DatasetValidationError(`${path}.provider_id must match the model prefix`);
  }
  const verifiedAt = readString(record, "verified_at", path);
  if (!isIsoDate(verifiedAt)) {
    throw new DatasetValidationError(`${path}.verified_at must be a real ISO date`);
  }
  const lastChangedAt = readString(record, "last_changed_at", path);
  if (!isIsoDate(lastChangedAt)) {
    throw new DatasetValidationError(`${path}.last_changed_at must be a real ISO date`);
  }
  if (lastChangedAt > verifiedAt) {
    throw new DatasetValidationError(`${path}.last_changed_at cannot exceed verified_at`);
  }

  const identifiers = readArray(record, "identifiers", path).map((identifier, itemIndex) =>
    parseIdentifier(identifier, `${path}.identifiers[${itemIndex}]`),
  );
  const identifierKeys = identifiers.map(identifierKey);
  if (new Set(identifierKeys).size !== identifierKeys.length) {
    throw new DatasetValidationError(`${path}.identifiers contains duplicates`);
  }

  const availabilityEvents = readArray(record, "availability_events", path).map(
    (event, eventIndex) =>
      parseAvailabilityEvent(event, `${path}.availability_events[${eventIndex}]`),
  );
  const lifecycleEvents = readArray(record, "lifecycle_events", path, true).map(
    (event, eventIndex) => parseLifecycleEvent(event, `${path}.lifecycle_events[${eventIndex}]`),
  );
  const capabilities = readArray(record, "capabilities", path).map((value, itemIndex) => {
    if (typeof value !== "string" || !includes(CAPABILITY_TAGS, value)) {
      throw new DatasetValidationError(`${path}.capabilities[${itemIndex}] is not supported`);
    }
    return value;
  });
  if (new Set(capabilities).size !== capabilities.length) {
    throw new DatasetValidationError(`${path}.capabilities contains duplicates`);
  }
  if (!capabilities.includes("text")) {
    throw new DatasetValidationError(`${path}.capabilities must include text`);
  }
  const hasWeights = availabilityEvents.some((event) => event.channel === "weights");
  if (capabilities.includes("weights") !== hasWeights) {
    throw new DatasetValidationError(`${path}.capabilities weights must match availability_events`);
  }
  const latestLifecycleStatus = [...lifecycleEvents]
    .sort((left, right) =>
      normalizedDate(left.date, left.date_precision).localeCompare(
        normalizedDate(right.date, right.date_precision),
      ),
    )
    .at(-1)?.status;
  const isDeprecated =
    latestLifecycleStatus === "deprecated" ||
    latestLifecycleStatus === "retired" ||
    latestLifecycleStatus === "retirement_scheduled";
  if (capabilities.includes("deprecated") !== isDeprecated) {
    throw new DatasetValidationError(`${path}.capabilities deprecated must match lifecycle_events`);
  }
  for (const [eventIndex, event] of lifecycleEvents.entries()) {
    if (
      event.identifier !== undefined &&
      !identifierKeys.includes(identifierKey(event.identifier))
    ) {
      throw new DatasetValidationError(
        `${path}.lifecycle_events[${eventIndex}].identifier must belong to the model`,
      );
    }
  }

  return {
    model,
    display_name: readString(record, "display_name", path),
    provider_id: providerId,
    identifier_type: readEnum(record, "identifier_type", IDENTIFIER_TYPES, path),
    identifiers,
    relationships: readArray(record, "relationships", path, true).map(
      (relationship, relationshipIndex) =>
        parseRelationship(relationship, `${path}.relationships[${relationshipIndex}]`),
    ),
    availability_events: availabilityEvents,
    lifecycle_events: lifecycleEvents,
    capabilities,
    verified_at: verifiedAt,
    last_changed_at: lastChangedAt,
  };
}

function parseCoverage(value: JsonInput): CatalogCoverage {
  const path = "dataset.coverage";
  const record = readRecord(value, path);
  requireExactKeys(
    record,
    ["exhaustive", "statement", "provider_inclusion_criteria", "model_inclusion_criteria"],
    path,
  );
  if (record["exhaustive"] !== false) {
    throw new DatasetValidationError(`${path}.exhaustive must be false`);
  }
  return {
    exhaustive: false,
    statement: readString(record, "statement", path),
    provider_inclusion_criteria: readString(record, "provider_inclusion_criteria", path),
    model_inclusion_criteria: readString(record, "model_inclusion_criteria", path),
  };
}

export function identifierKey(identifier: IdentifierReference): string {
  return `${identifier.namespace}\u0000${identifier.value}`;
}

export function projectModel(model: CatalogModel, provider: Provider): ModelRelease {
  const orderedEvents = [...model.availability_events].sort((left, right) =>
    normalizedDate(left.date, left.date_precision).localeCompare(
      normalizedDate(right.date, right.date_precision),
    ),
  );
  const firstEvent = orderedEvents[0];
  if (firstEvent === undefined) {
    throw new DatasetValidationError(`${model.model} has no availability event`);
  }
  const sourceKeys = new Set<string>();
  const sources = orderedEvents.flatMap((event) =>
    event.sources.filter((source) => {
      const key = `${source.url}\u0000${source.evidence}`;
      if (sourceKeys.has(key)) {
        return false;
      }
      sourceKeys.add(key);
      return true;
    }),
  );
  const lifecycleEvents = [...model.lifecycle_events].sort((left, right) =>
    normalizedDate(left.date, left.date_precision).localeCompare(
      normalizedDate(right.date, right.date_precision),
    ),
  );
  return {
    ...model,
    provider,
    availability: [...new Set(orderedEvents.map((event) => event.channel))],
    release_date: normalizedDate(firstEvent.date, firstEvent.date_precision),
    release_date_precision: firstEvent.date_precision ?? "day",
    confidence: firstEvent.confidence,
    sources,
    lifecycle_status: lifecycleEvents.at(-1)?.status ?? "unknown",
  };
}

export function parseDataset(value: JsonInput | Dataset): Dataset {
  const record = readRecord(value, "dataset");
  requireExactKeys(
    record,
    [
      "schema_version",
      "dataset_version",
      "changelog_url",
      "release_date_definition",
      "identifier_type_definition",
      "identifier_kind_definition",
      "availability_definition",
      "availability_stage_definition",
      "date_precision_definition",
      "lifecycle_status_definition",
      "lifecycle_date_role_definition",
      "relationship_type_definition",
      "capability_definition",
      "coverage",
      "providers",
      "researched_at",
      "models",
    ],
    "dataset",
  );
  if (record["schema_version"] !== 2) {
    throw new DatasetValidationError("dataset.schema_version must be 2");
  }
  const datasetVersion = readString(record, "dataset_version", "dataset");
  if (!/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(datasetVersion)) {
    throw new DatasetValidationError("dataset.dataset_version must be a date-based version");
  }
  const changelogUrl = readHttpsUrl(record, "changelog_url", "dataset");
  const researchedAt = readString(record, "researched_at", "dataset");
  if (!isIsoDate(researchedAt)) {
    throw new DatasetValidationError("dataset.researched_at must be a real ISO date");
  }
  if (datasetVersion.slice(0, 10) > researchedAt) {
    throw new DatasetValidationError("dataset.dataset_version cannot exceed researched_at");
  }

  const providers = readArray(record, "providers", "dataset").map(parseProvider);
  const providerIds = providers.map((provider) => provider.id);
  if (new Set(providerIds).size !== providerIds.length) {
    throw new DatasetValidationError("dataset contains duplicate provider IDs");
  }

  const models = readArray(record, "models", "dataset").map(parseModel);
  const modelIds = new Set<string>();
  const identifierKeys = new Set<string>();
  for (const model of models) {
    if (modelIds.has(model.model)) {
      throw new DatasetValidationError(`dataset contains duplicate model ${model.model}`);
    }
    if (!providerIds.includes(model.provider_id)) {
      throw new DatasetValidationError(`${model.model} references unknown provider ${model.provider_id}`);
    }
    if (model.verified_at > researchedAt) {
      throw new DatasetValidationError(`${model.model}.verified_at cannot exceed researched_at`);
    }
    for (const identifier of model.identifiers) {
      const key = identifierKey(identifier);
      if (identifierKeys.has(key)) {
        throw new DatasetValidationError(
          `dataset contains duplicate identifier ${identifier.namespace}/${identifier.value}`,
        );
      }
      identifierKeys.add(key);
    }
    modelIds.add(model.model);
  }
  for (const model of models) {
    const relationships = new Set<string>();
    for (const relationship of model.relationships) {
      if (relationship.target_model === model.model) {
        throw new DatasetValidationError(`${model.model} cannot relate to itself`);
      }
      if (!modelIds.has(relationship.target_model)) {
        throw new DatasetValidationError(
          `${model.model} references unknown model ${relationship.target_model}`,
        );
      }
      const key = `${relationship.type}\u0000${relationship.target_model}`;
      if (relationships.has(key)) {
        throw new DatasetValidationError(`${model.model} contains duplicate relationships`);
      }
      relationships.add(key);
    }
  }

  return {
    schema_version: 2,
    dataset_version: datasetVersion,
    changelog_url: changelogUrl,
    release_date_definition: readString(record, "release_date_definition", "dataset"),
    identifier_type_definition: readDefinitions(
      record["identifier_type_definition"],
      IDENTIFIER_TYPES,
      "dataset.identifier_type_definition",
    ),
    identifier_kind_definition: readDefinitions(
      record["identifier_kind_definition"],
      IDENTIFIER_KINDS,
      "dataset.identifier_kind_definition",
    ),
    availability_definition: readDefinitions(
      record["availability_definition"],
      AVAILABILITY_TYPES,
      "dataset.availability_definition",
    ),
    availability_stage_definition: readDefinitions(
      record["availability_stage_definition"],
      AVAILABILITY_STAGES,
      "dataset.availability_stage_definition",
    ),
    date_precision_definition: readDefinitions(
      record["date_precision_definition"],
      DATE_PRECISIONS,
      "dataset.date_precision_definition",
    ),
    lifecycle_status_definition: readDefinitions(
      record["lifecycle_status_definition"],
      LIFECYCLE_EVENT_STATUSES,
      "dataset.lifecycle_status_definition",
    ),
    lifecycle_date_role_definition: readDefinitions(
      record["lifecycle_date_role_definition"],
      LIFECYCLE_DATE_ROLES,
      "dataset.lifecycle_date_role_definition",
    ),
    relationship_type_definition: readDefinitions(
      record["relationship_type_definition"],
      RELATIONSHIP_TYPES,
      "dataset.relationship_type_definition",
    ),
    capability_definition: readDefinitions(
      record["capability_definition"],
      CAPABILITY_TAGS,
      "dataset.capability_definition",
    ),
    coverage: parseCoverage(record["coverage"]),
    providers,
    researched_at: researchedAt,
    models,
  };
}
