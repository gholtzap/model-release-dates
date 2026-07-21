const SUCCESS_CACHE_CONTROL = "public, max-age=300";
const CDN_CACHE_CONTROL = "max-age=3600, stale-while-revalidate=86400";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function headers(cache: boolean): Headers {
  const result = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
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

export function jsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: headers(status >= 200 && status < 300),
  });
}

function errorResponse(error: HttpError): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.status,
  );
}

export type GetHandler = (request: Request) => Response;

export function handleRequest(request: Request, get: GetHandler): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(false) });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = errorResponse(
      new HttpError(405, "method_not_allowed", `Method ${request.method} is not allowed`),
    );
    response.headers.set("Allow", "GET, HEAD, OPTIONS");
    return response;
  }

  try {
    const response = get(request);
    if (request.method === "HEAD") {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error);
    }
    console.error(error);
    return errorResponse(
      new HttpError(500, "internal_error", "The server could not complete the request"),
    );
  }
}
