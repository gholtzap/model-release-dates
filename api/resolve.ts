import { catalogMeta, selectModelFields } from "../src/catalog-api.js";
import { models, modelsByIdentifierValue } from "../src/data.js";
import {
  handlePostRequest,
  hasWildcardIfNoneMatch,
  HttpError,
  jsonResponse,
} from "../src/http.js";
import {
  parseBatchIdentifiers,
  parseFieldsQuery,
  parseResolveQuery,
} from "../src/query.js";
import type { ModelField } from "../src/catalog-api.js";
import { suggestIdentifiers } from "../src/suggestions.js";

function selectedMatches(identifier: string, fields: readonly ModelField[] | undefined) {
  return (modelsByIdentifierValue.get(identifier) ?? []).map((match) => ({
    matched_identifier: match.matched_identifier,
    model: selectModelFields(match.model, fields),
  }));
}

function selectedSuggestions(identifier: string, fields: readonly ModelField[] | undefined) {
  return suggestIdentifiers(identifier, models).map((suggestion) => ({
    matched_identifier: suggestion.matched_identifier,
    model: selectModelFields(suggestion.model, fields),
    score: suggestion.score,
    reasons: suggestion.reasons,
  }));
}

function get(request: Request): Response {
  const query = parseResolveQuery(new URL(request.url));
  if (query.mode === "suggest") {
    const suggestions = selectedSuggestions(query.identifier, query.fields);
    return jsonResponse({
      data: suggestions,
      meta: {
        ...catalogMeta(query.fields),
        identifier: query.identifier,
        mode: query.mode,
        total: suggestions.length,
      },
    }, 200, request);
  }
  const matches = selectedMatches(query.identifier, query.fields);
  if (matches.length === 0) {
    throw new HttpError(
      404,
      "identifier_not_found",
      `Identifier ${query.identifier} was not found in any namespace`,
      query.suggestions
        ? { suggestions: selectedSuggestions(query.identifier, query.fields) }
        : undefined,
    );
  }
  return jsonResponse({
    data: matches,
    meta: {
      ...catalogMeta(query.fields),
      identifier: query.identifier,
      total: matches.length,
    },
  }, 200, request);
}

async function post(request: Request): Promise<Response> {
  if (hasWildcardIfNoneMatch(request)) {
    throw new HttpError(
      412,
      "precondition_failed",
      "If-None-Match * cannot be used with batch resolution",
    );
  }
  const fields = parseFieldsQuery(new URL(request.url));
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
    throw new HttpError(413, "request_too_large", "Request body cannot exceed 65536 bytes");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 65_536) {
    throw new HttpError(413, "request_too_large", "Request body cannot exceed 65536 bytes");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
  const identifiers = parseBatchIdentifiers(value);
  const data = identifiers.map((identifier) => ({
    identifier,
    matches: selectedMatches(identifier, fields),
  }));
  const matchedCount = data.filter((result) => result.matches.length > 0).length;
  return jsonResponse({
    data,
    meta: {
      ...catalogMeta(fields),
      requested_count: identifiers.length,
      matched_count: matchedCount,
      unmatched_count: identifiers.length - matchedCount,
    },
  }, 200, request);
}

export default {
  fetch(request: Request): Promise<Response> {
    return handlePostRequest(request, get, post);
  },
};
