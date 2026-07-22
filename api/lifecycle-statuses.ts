import { catalogMeta } from "../src/catalog-api.js";
import { dataset, models } from "../src/data.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { LIFECYCLE_EVENT_STATUSES } from "../src/types.js";
import { rejectQueryParameters } from "../src/query.js";

function get(request: Request): Response {
  rejectQueryParameters(new URL(request.url));
  const statuses = ["unknown", ...LIFECYCLE_EVENT_STATUSES] as const;
  const data = statuses.map((status) => ({
    status,
    definition:
      status === "unknown"
        ? "No lifecycle state has been cataloged for this model."
        : dataset.lifecycle_status_definition[status],
    model_count: models.filter((model) => model.lifecycle_status === status).length,
  }));
  return jsonResponse({ data, meta: { ...catalogMeta(), total: data.length } }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
