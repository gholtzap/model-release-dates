import { handleRequest, HttpError } from "../src/http.js";

const API_METHODS = "GET, HEAD, POST, OPTIONS";

function notFound(): never {
  throw new HttpError(404, "not_found", "API route was not found");
}

export default {
  fetch(request: Request): Response {
    return handleRequest(request, notFound, API_METHODS);
  },
};
