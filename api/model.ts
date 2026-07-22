import { findModelById } from "../src/data.js";
import { catalogMeta, selectModelFields } from "../src/catalog-api.js";
import { handleRequest, HttpError, jsonResponse } from "../src/http.js";
import { parseModelItemQuery } from "../src/query.js";

function get(request: Request): Response {
  const query = parseModelItemQuery(new URL(request.url));
  const model = findModelById(query.modelId);
  if (model === undefined) {
    throw new HttpError(404, "model_not_found", `Model ${query.modelId} was not found`);
  }
  return jsonResponse({
    data: selectModelFields(model, query.fields),
    meta: catalogMeta(query.fields),
  }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
