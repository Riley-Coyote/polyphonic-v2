// Standardized error envelope for edge functions.
// Shape: { error: string, code: string, request_id: string }

export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "quota_exceeded"
  | "missing_api_key"
  | "provider_auth_required"
  | "provider_credits_required"
  | "provider_rate_limited"
  | "upstream_unavailable"
  | "upstream_error"
  | "internal_error"
  | "conflict";

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  extra?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, status: number, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super("validation_error", message, 400, extra);
  }
}
export class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super("unauthorized", message, 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("forbidden", message, 403);
  }
}
export class QuotaExceededError extends AppError {
  constructor(scope: string, limit: number, current: number) {
    super("quota_exceeded", `Daily quota exceeded for ${scope} (${current}/${limit})`, 429, {
      scope, limit, current,
    });
  }
}
export class MissingApiKeyError extends AppError {
  constructor(message = "No API key configured. Add your OpenRouter key in Settings.") {
    super("missing_api_key", message, 400);
  }
}
export class UpstreamUnavailableError extends AppError {
  constructor(message = "Upstream service unavailable", extra?: Record<string, unknown>) {
    super("upstream_unavailable", message, 502, extra);
  }
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function errorResponse(
  err: unknown,
  corsHeaders: Record<string, string>,
  requestId: string = newRequestId(),
): Response {
  if (err instanceof AppError) {
    const body = { error: err.message, code: err.code, request_id: requestId, ...(err.extra ?? {}) };
    return new Response(JSON.stringify(body), {
      status: err.status,
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error(`[${requestId}] internal_error:`, err);
  return new Response(
    JSON.stringify({ error: "Internal error", code: "internal_error", request_id: requestId }),
    {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId },
    },
  );
}

/**
 * Wrap a handler so any thrown AppError / Error becomes a structured envelope.
 * The wrapped fn receives (req, requestId).
 */
export function wrapHandler(
  corsHeaders: Record<string, string> | ((req: Request) => Record<string, string>),
  fn: (req: Request, requestId: string) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const requestId = newRequestId();
    const headers = typeof corsHeaders === "function" ? corsHeaders(req) : corsHeaders;
    try {
      return await fn(req, requestId);
    } catch (err) {
      return errorResponse(err, headers, requestId);
    }
  };
}
