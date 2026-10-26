import { AppError, UpstreamUnavailableError } from "./errors.ts";

/** Static copy only: upstream bodies can contain credentials or user content. */
export function openRouterAccountError(status: number): AppError | null {
  switch (status) {
    case 401:
      // This is the provider's credential failure, not Polyphonic's login.
      return new AppError("provider_auth_required", "OpenRouter rejected your connection. Reconnect OpenRouter in Settings → Models, then try again.", 403);
    case 402:
      return new AppError("provider_credits_required", "Your OpenRouter account needs credits. Add credits in OpenRouter, then try again.", 402);
    case 429:
      return new AppError("provider_rate_limited", "OpenRouter is limiting requests. Wait a moment, then try again.", 429);
    default:
      return null;
  }
}

export function openRouterError(status: number): AppError {
  return openRouterAccountError(status) ?? new UpstreamUnavailableError(
    "OpenRouter could not complete this response. Please try again shortly.",
    { upstream_status: status },
  );
}

export function isOpenRouterAccountError(error: unknown): error is AppError {
  return error instanceof AppError && [
    "provider_auth_required", "provider_credits_required", "provider_rate_limited",
  ].includes(error.code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function httpStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

/** Normalize SDK/stream errors by status without reflecting upstream text. */
export function openRouterAccountErrorFromUnknown(error: unknown): AppError | null {
  if (isOpenRouterAccountError(error)) return error;
  const record = asRecord(error);
  if (!record) return null;
  const nested = asRecord(record.error);
  for (const candidate of [record, nested]) {
    if (!candidate) continue;
    for (const field of ["status", "statusCode", "code"]) {
      const status = httpStatus(candidate[field]);
      if (status !== null) {
        const classified = openRouterAccountError(status);
        if (classified) return classified;
      }
    }
  }
  return null;
}

/** A 200 SSE response can still carry an upstream error event. */
export function openRouterStreamError(payload: unknown): AppError | null {
  const record = asRecord(payload);
  if (!record?.error) return null;
  return openRouterAccountErrorFromUnknown(record) ?? new UpstreamUnavailableError(
    "OpenRouter interrupted this response. Please try again shortly.",
  );
}
