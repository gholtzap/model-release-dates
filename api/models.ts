import { models } from "../src/data.js";
import { catalogMeta, selectModelFields } from "../src/catalog-api.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { parseModelQuery, queryModels } from "../src/query.js";

function get(request: Request): Response {
  const query = parseModelQuery(new URL(request.url));
  const result = queryModels(models, query);
  return jsonResponse({
    data: result.models.map((model) => selectModelFields(model, query.fields)),
    meta: {
      ...catalogMeta(query.fields),
      total: result.total,
      count: result.models.length,
      limit: query.limit,
      offset: query.offset,
    },
  }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
