import { dataset } from "../src/data.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { parseModelQuery, queryModels } from "../src/query.js";

function get(request: Request): Response {
  const query = parseModelQuery(new URL(request.url));
  const result = queryModels(dataset.models, query);
  return jsonResponse({
    data: result.models,
    meta: {
      schema_version: dataset.schema_version,
      researched_at: dataset.researched_at,
      total: result.total,
      count: result.models.length,
      limit: query.limit,
      offset: query.offset,
    },
  });
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
