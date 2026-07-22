import { dataset } from "./data.js";
import type { ModelRelease } from "./types.js";

export const MODEL_FIELDS = [
  "model",
  "display_name",
  "provider_id",
  "provider",
  "identifier_type",
  "identifiers",
  "relationships",
  "availability_events",
  "lifecycle_events",
  "capabilities",
  "verified_at",
  "last_changed_at",
  "availability",
  "release_date",
  "release_date_precision",
  "confidence",
  "sources",
  "lifecycle_status",
  "replacement_models",
] as const satisfies readonly (keyof ModelRelease)[];

export type ModelField = (typeof MODEL_FIELDS)[number];
export type ModelSelection = Partial<Pick<ModelRelease, ModelField>>;

export function selectModelFields(
  model: ModelRelease,
  fields: readonly ModelField[] | undefined,
): ModelRelease | ModelSelection {
  if (fields === undefined) {
    return model;
  }
  return Object.fromEntries(fields.map((field) => [field, model[field]])) as ModelSelection;
}

export function catalogMeta(fields?: readonly ModelField[]): object {
  return {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    researched_at: dataset.researched_at,
    changelog_url: dataset.changelog_url,
    coverage: dataset.coverage,
    ...(fields === undefined ? {} : { fields }),
  };
}
