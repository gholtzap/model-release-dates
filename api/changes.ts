import { catalogMeta, selectModelFields } from "../src/catalog-api.js";
import { models } from "../src/data.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { parseChangeQuery, queryChanges } from "../src/query.js";

function get(request: Request): Response {
  const query = parseChangeQuery(new URL(request.url));
  const result = queryChanges(models, query);
  return jsonResponse({
    data: result.models.map((model) => selectModelFields(model, query.fields)),
    meta: {
      ...catalogMeta(query.fields),
      since: query.since,
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
