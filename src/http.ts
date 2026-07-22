import { createHash } from "node:crypto";

const SUCCESS_CACHE_CONTROL = "public, max-age=300";
const CDN_CACHE_CONTROL = "max-age=3600, stale-while-revalidate=86400";
const READ_METHODS = "GET, HEAD, OPTIONS";
const READ_WRITE_METHODS = "GET, HEAD, POST, OPTIONS";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, object>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, object>>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function headers(cache: boolean, allowedMethods = READ_METHODS): Headers {
  const result = new Headers({
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (cache) {
    result.set("Cache-Control", SUCCESS_CACHE_CONTROL);
    result.set("Vercel-CDN-Cache-Control", CDN_CACHE_CONTROL);
  } else {
    result.set("Cache-Control", "no-store");
  }
  return result;
}

function matchesEtag(request: Request, etag: string): boolean {
  return (request.headers.get("If-None-Match") ?? "")
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag || candidate.trim() === "*");
}

export function jsonResponse(value: object, status = 200, request?: Request): Response {
  const body = JSON.stringify(value);
  const responseHeaders = headers(status >= 200 && status < 300);
  if (status >= 200 && status < 300) {
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
    responseHeaders.set("ETag", etag);
    if (
      request !== undefined &&
      (request.method === "GET" || request.method === "HEAD") &&
      matchesEtag(request, etag)
    ) {
      return new Response(null, { status: 304, headers: responseHeaders });
    }
  }
  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}

function errorResponse(error: HttpError): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
      },
      ...error.details,
    },
    error.status,
  );
}

function earlyResponse(request: Request, allowedMethods: string): Response | undefined {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(false, allowedMethods) });
  }
  if (!allowedMethods.split(", ").includes(request.method)) {
    const response = errorResponse(
      new HttpError(405, "method_not_allowed", `Method ${request.method} is not allowed`),
    );
    response.headers.set("Allow", allowedMethods);
    return response;
  }
  return undefined;
}

function finishResponse(request: Request, response: Response): Response {
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

function caughtResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error);
  }
  console.error(error);
  return errorResponse(
    new HttpError(500, "internal_error", "The server could not complete the request"),
  );
}

export type GetHandler = (request: Request) => Response;

export function handleRequest(request: Request, get: GetHandler): Response {
  const early = earlyResponse(request, READ_METHODS);
  if (early !== undefined) return early;

  try {
    return finishResponse(request, get(request));
  } catch (error) {
    return caughtResponse(error);
  }
}

export type PostHandler = (request: Request) => Promise<Response>;

export async function handlePostRequest(
  request: Request,
  get: GetHandler,
  post: PostHandler,
): Promise<Response> {
  const early = earlyResponse(request, READ_WRITE_METHODS);
  if (early !== undefined) return early;

  try {
    const response = request.method === "POST" ? await post(request) : get(request);
    return finishResponse(request, response);
  } catch (error) {
    return caughtResponse(error);
  }
}
