import { catalogMeta } from "../src/catalog-api.js";
import { dataset, models } from "../src/data.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { rejectQueryParameters } from "../src/query.js";

function get(request: Request): Response {
  rejectQueryParameters(new URL(request.url));
  const data = dataset.providers.map((provider) => ({
    ...provider,
    model_count: models.filter((model) => model.provider_id === provider.id).length,
  }));
  return jsonResponse({ data, meta: { ...catalogMeta(), total: data.length } }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
