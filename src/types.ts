export const IDENTIFIER_TYPES = ["model", "snapshot", "weights"] as const;
export const AVAILABILITY_TYPES = ["api", "weights"] as const;
export const CONFIDENCE_TYPES = ["confirmed"] as const;

export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type AvailabilityType = (typeof AVAILABILITY_TYPES)[number];
export type ConfidenceType = (typeof CONFIDENCE_TYPES)[number];

export interface Source {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly evidence: string;
}

export interface ModelRelease {
  readonly model: string;
  readonly identifier_type: IdentifierType;
  readonly availability: readonly AvailabilityType[];
  readonly release_date: string;
  readonly confidence: ConfidenceType;
  readonly sources: readonly Source[];
}

export interface Dataset {
  readonly schema_version: 1;
  readonly release_date_definition: string;
  readonly identifier_type_definition: Readonly<Record<IdentifierType, string>>;
  readonly availability_definition: Readonly<Record<AvailabilityType, string>>;
  readonly researched_at: string;
  readonly models: readonly ModelRelease[];
}

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DatasetValidationError(`${path} must be an object`);
  }
  return value;
}

function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new DatasetValidationError(`${path}.${key} is not supported`);
    }
  }
  for (const key of keys) {
    if (!(key in record)) {
      throw new DatasetValidationError(`${path}.${key} is required`);
    }
  }
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DatasetValidationError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function readArray(record: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new DatasetValidationError(`${path}.${key} must be a non-empty array`);
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

function isIdentifierType(value: string): value is IdentifierType {
  return IDENTIFIER_TYPES.some((candidate) => candidate === value);
}

function isAvailabilityType(value: string): value is AvailabilityType {
  return AVAILABILITY_TYPES.some((candidate) => candidate === value);
}

function isConfidenceType(value: string): value is ConfidenceType {
  return CONFIDENCE_TYPES.some((candidate) => candidate === value);
}

function readDefinitions<T extends string>(
  value: unknown,
  keys: readonly T[],
  path: string,
): Readonly<Record<T, string>> {
  const record = readRecord(value, path);
  requireExactKeys(record, keys, path);
  const entries = keys.map((key) => [key, readString(record, key, path)] as const);
  return Object.fromEntries(entries) as Readonly<Record<T, string>>;
}

function parseSource(value: unknown, path: string): Source {
  const record = readRecord(value, path);
  requireExactKeys(record, ["publisher", "title", "url", "evidence"], path);
  const url = readString(record, "url", path);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new DatasetValidationError(`${path}.url must be a valid URL`);
  }
  if (parsedUrl.protocol !== "https:") {
    throw new DatasetValidationError(`${path}.url must use HTTPS`);
  }
  return {
    publisher: readString(record, "publisher", path),
    title: readString(record, "title", path),
    url,
    evidence: readString(record, "evidence", path),
  };
}

function parseModel(value: unknown, index: number): ModelRelease {
  const path = `models[${index}]`;
  const record = readRecord(value, path);
  requireExactKeys(
    record,
    ["model", "identifier_type", "availability", "release_date", "confidence", "sources"],
    path,
  );

  const model = readString(record, "model", path);
  if (!/^[^/]+\/[^/]+$/.test(model)) {
    throw new DatasetValidationError(`${path}.model must contain one provider/name separator`);
  }

  const identifierType = readString(record, "identifier_type", path);
  if (!isIdentifierType(identifierType)) {
    throw new DatasetValidationError(`${path}.identifier_type is not supported`);
  }

  const availability = readArray(record, "availability", path).map((item, itemIndex) => {
    if (typeof item !== "string" || !isAvailabilityType(item)) {
      throw new DatasetValidationError(`${path}.availability[${itemIndex}] is not supported`);
    }
    return item;
  });
  if (new Set(availability).size !== availability.length) {
    throw new DatasetValidationError(`${path}.availability contains duplicates`);
  }

  const releaseDate = readString(record, "release_date", path);
  if (!isIsoDate(releaseDate)) {
    throw new DatasetValidationError(`${path}.release_date must be a real ISO date`);
  }

  const confidence = readString(record, "confidence", path);
  if (!isConfidenceType(confidence)) {
    throw new DatasetValidationError(`${path}.confidence is not supported`);
  }

  return {
    model,
    identifier_type: identifierType,
    availability,
    release_date: releaseDate,
    confidence,
    sources: readArray(record, "sources", path).map((source, sourceIndex) =>
      parseSource(source, `${path}.sources[${sourceIndex}]`),
    ),
  };
}

export function parseDataset(value: unknown): Dataset {
  const record = readRecord(value, "dataset");
  requireExactKeys(
    record,
    [
      "schema_version",
      "release_date_definition",
      "identifier_type_definition",
      "availability_definition",
      "researched_at",
      "models",
    ],
    "dataset",
  );
  if (record["schema_version"] !== 1) {
    throw new DatasetValidationError("dataset.schema_version must be 1");
  }

  const researchedAt = readString(record, "researched_at", "dataset");
  if (!isIsoDate(researchedAt)) {
    throw new DatasetValidationError("dataset.researched_at must be a real ISO date");
  }

  const models = readArray(record, "models", "dataset").map(parseModel);
  const modelIds = new Set<string>();
  for (const model of models) {
    if (modelIds.has(model.model)) {
      throw new DatasetValidationError(`dataset contains duplicate model ${model.model}`);
    }
    modelIds.add(model.model);
  }

  return {
    schema_version: 1,
    release_date_definition: readString(record, "release_date_definition", "dataset"),
    identifier_type_definition: readDefinitions(
      record["identifier_type_definition"],
      IDENTIFIER_TYPES,
      "dataset.identifier_type_definition",
    ),
    availability_definition: readDefinitions(
      record["availability_definition"],
      AVAILABILITY_TYPES,
      "dataset.availability_definition",
    ),
    researched_at: researchedAt,
    models,
  };
}
