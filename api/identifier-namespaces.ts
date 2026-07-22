import { catalogMeta } from "../src/catalog-api.js";
import { models } from "../src/data.js";
import { handleRequest, jsonResponse } from "../src/http.js";
import { rejectQueryParameters } from "../src/query.js";

function get(request: Request): Response {
  rejectQueryParameters(new URL(request.url));
  const namespaces = new Map<string, { identifiers: number; models: Set<string> }>();
  for (const model of models) {
    for (const identifier of model.identifiers) {
      const index = namespaces.get(identifier.namespace) ?? { identifiers: 0, models: new Set() };
      index.identifiers += 1;
      index.models.add(model.model);
      namespaces.set(identifier.namespace, index);
    }
  }
  const data = [...namespaces]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, index]) => ({
      namespace,
      identifier_count: index.identifiers,
      model_count: index.models.size,
    }));
  return jsonResponse({ data, meta: { ...catalogMeta(), total: data.length } }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
