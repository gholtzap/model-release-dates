import { dataset, modelsByIdentifier } from "../src/data.js";
import { handleRequest, HttpError, jsonResponse } from "../src/http.js";
import { parseIdentifierQuery } from "../src/query.js";
import { identifierKey } from "../src/types.js";

function get(request: Request): Response {
  const identifier = parseIdentifierQuery(new URL(request.url));
  const model = modelsByIdentifier.get(identifierKey({
    namespace: identifier.namespace,
    value: identifier.identifier,
  }));
  if (model === undefined) {
    throw new HttpError(
      404,
      "identifier_not_found",
      `Identifier ${identifier.namespace}/${identifier.identifier} was not found`,
    );
  }
  return jsonResponse({
    data: model,
    meta: {
      schema_version: dataset.schema_version,
      researched_at: dataset.researched_at,
      coverage: dataset.coverage,
      matched_identifier: {
        namespace: identifier.namespace,
        value: identifier.identifier,
      },
    },
  });
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
