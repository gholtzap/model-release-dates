import { models, modelsByIdentifier } from "../src/data.js";
import { catalogMeta, selectModelFields } from "../src/catalog-api.js";
import { handleRequest, HttpError, jsonResponse } from "../src/http.js";
import { parseIdentifierQuery } from "../src/query.js";
import { identifierKey } from "../src/types.js";
import { suggestIdentifiers } from "../src/suggestions.js";

function get(request: Request): Response {
  const identifier = parseIdentifierQuery(new URL(request.url));
  const model = modelsByIdentifier.get(identifierKey({
    namespace: identifier.namespace,
    value: identifier.identifier,
  }));
  if (model === undefined) {
    const suggestions = identifier.suggestions
      ? suggestIdentifiers(identifier.identifier, models, { namespace: identifier.namespace }).map(
          (suggestion) => ({
            matched_identifier: suggestion.matched_identifier,
            model: selectModelFields(suggestion.model, identifier.fields),
            score: suggestion.score,
            reasons: suggestion.reasons,
          }),
        )
      : undefined;
    throw new HttpError(
      404,
      "identifier_not_found",
      `Identifier ${identifier.namespace}/${identifier.identifier} was not found`,
      suggestions === undefined ? undefined : { suggestions },
    );
  }
  return jsonResponse({
    data: selectModelFields(model, identifier.fields),
    meta: {
      ...catalogMeta(identifier.fields),
      matched_identifier: {
        namespace: identifier.namespace,
        value: identifier.identifier,
      },
    },
  }, 200, request);
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, get);
  },
};
