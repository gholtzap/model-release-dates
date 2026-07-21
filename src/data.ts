import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { identifierKey, parseDataset, projectModel, type JsonValue } from "./types.js";

const dataPath = resolve(process.cwd(), "model-release-dates.json");
const rawDataset: JsonValue = JSON.parse(readFileSync(dataPath, "utf8"));

export const dataset = parseDataset(rawDataset);
export const providersById = new Map(
  dataset.providers.map((provider) => [provider.id, provider] as const),
);
// parseDataset guarantees that every model references a provider in this map.
export const models = dataset.models.map((model) =>
  projectModel(model, providersById.get(model.provider_id)!),
);
export const modelsById = new Map(models.map((model) => [model.model, model] as const));

function anthropicModelAliasKey(modelId: string): string {
  return modelId.replace(/(\d)[.-](?=\d)/g, "$1.");
}

const anthropicModelsByAlias = new Map(
  models
    .filter((model) => model.provider_id === "anthropic")
    .map((model) => [anthropicModelAliasKey(model.model), model] as const),
);

export function findModelById(modelId: string) {
  return modelsById.get(modelId) ?? anthropicModelsByAlias.get(anthropicModelAliasKey(modelId));
}

export const modelsByIdentifier = new Map(
  models.flatMap((model) =>
    model.identifiers.map((identifier) => [identifierKey(identifier), model] as const),
  ),
);
