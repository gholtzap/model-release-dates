import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseDataset } from "./types.js";

const dataPath = resolve(process.cwd(), "model-release-dates.json");
const rawDataset: unknown = JSON.parse(readFileSync(dataPath, "utf8"));

export const dataset = parseDataset(rawDataset);
export const modelsById = new Map(dataset.models.map((model) => [model.model, model]));
