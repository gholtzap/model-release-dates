import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { identifierKey, parseDataset, projectModel } from "./types.js";

const dataPath = resolve(process.cwd(), "model-release-dates.json");
const rawDataset: unknown = JSON.parse(readFileSync(dataPath, "utf8"));

export const dataset = parseDataset(rawDataset);
export const providersById = new Map(
  dataset.providers.map((provider) => [provider.id, provider] as const),
);
// parseDataset guarantees that every model references a provider in this map.
export const models = dataset.models.map((model) =>
  projectModel(model, providersById.get(model.provider_id)!),
);
export const modelsById = new Map(models.map((model) => [model.model, model] as const));
export const modelsByIdentifier = new Map(
  models.flatMap((model) =>
    model.identifiers.map((identifier) => [identifierKey(identifier), model] as const),
  ),
);
