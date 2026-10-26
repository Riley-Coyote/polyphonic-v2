// Bounded retry for outbound model-completion fetches.
//
// Designed to wrap an EXISTING fetch thunk unchanged, so adoption is a one-line
// change that cannot drop request params, headers, body, or signal:
//
//   const response = await withModelRetry(() =>
//     fetch("https://openrouter.ai/api/v1/chat/completions", { ...opts, signal: AbortSignal.timeout(60000) })
//   );
//
// Because the thunk reconstructs the request each attempt, every retry gets a
// fresh AbortSignal.timeout — the per-attempt timeout is preserved automatically.
//
// Retries on:
//   - transient HTTP status: 429, 500, 502, 503, 504 (honors Retry-After on 429)
//   - network-level throws (connection reset, DNS, etc.)
// Does NOT retry on:
//   - AbortError / TimeoutError — the caller's AbortSignal.timeout already bounds
//     each attempt; retrying a timed-out request would stack timeouts and risk
//     blowing the edge-function wall-clock.
//   - any non-transient status (4xx other than 429) — returned as-is for the
//     caller's existing `if (!resp.ok)` handling.
//
// IMPORTANT: never wrap a STREAMING response whose body is consumed incrementally
// (SSE chat). A retry would restart the request mid-stream. Use this only for
// buffered/non-streaming model calls.

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3; // initial + 2 retries
const DEFAULT_BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 8000;

export interface ModelRetryOpts {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; grows exponentially with jitter. Default 400. */
  baseDelayMs?: number;
  /** Override transient statuses when a provider limit needs user action. */
  retryStatuses?: readonly number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

export async function withModelRetry(
  doFetch: () => Promise<Response>,
  opts: ModelRetryOpts = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelay = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const transientStatuses = opts.retryStatuses ? new Set(opts.retryStatuses) : TRANSIENT_STATUS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await doFetch();
    } catch (err) {
      lastError = err;
      // Don't retry a deliberate abort/timeout — the per-attempt timeout already
      // gave it a full budget, and retrying would stack timeouts.
      if (isAbort(err) || attempt >= maxAttempts) throw err;
      await sleep(Math.min(baseDelay * 2 ** (attempt - 1), MAX_DELAY_MS) + Math.random() * 200);
      continue;
    }

    if (!transientStatuses.has(resp.status) || attempt >= maxAttempts) {
      // Success, non-transient error, or out of attempts — hand back to caller.
      return resp;
    }

    // Transient status with attempts remaining: drain the discarded body to
    // avoid leaking the connection, then back off and retry.
    await resp.body?.cancel().catch(() => {});
    const retryAfter = resp.status === 429 ? parseRetryAfter(resp.headers.get("Retry-After")) : null;
    const backoff = Math.min(baseDelay * 2 ** (attempt - 1), MAX_DELAY_MS) + Math.random() * 200;
    await sleep(retryAfter ?? backoff);
  }

  // Loop always returns or throws above; this satisfies the type checker.
  throw lastError ?? new Error("withModelRetry: exhausted attempts");
}
