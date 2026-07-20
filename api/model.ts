import { dataset, modelsById } from "../src/data.js";
import { handleRequest, HttpError, jsonResponse } from "../src/http.js";
import { parseModelId } from "../src/query.js";

function get(request: Request): Response {
  const modelId = parseModelId(new URL(request.url));
  const model = modelsById.get(modelId);
  if (model === undefined) {
    throw new HttpError(404, "model_not_found", `Model ${modelId} was not found`);
  }
  return jsonResponse({
    data: model,
    meta: {
      schema_version: dataset.schema_version,
      researched_at: dataset.researched_at,
      coverage: dataset.coverage,
    },
  });
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
