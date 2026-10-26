// OpenRouter call wrapper with one retry on transient upstream errors.
// Streaming callers should NOT use this — they need to keep the SSE pipe open.

import { UpstreamUnavailableError } from "./errors.ts";
import { openRouterError } from "./openrouter-errors.ts";
import { withModelRetry, type ModelRetryOpts } from "./modelRetry.ts";

const TRANSIENT = new Set([502, 503, 504]);

/** Account/credit/rate errors require user action, never another dispatch. */
export function withOpenRouterRetry(
  doFetch: () => Promise<Response>,
  opts: Omit<ModelRetryOpts, "retryStatuses"> = {},
): Promise<Response> {
  return withModelRetry(doFetch, { ...opts, retryStatuses: [500, 502, 503, 504] });
}

export interface OpenRouterCallOpts {
  apiKey: string;
  body: Record<string, unknown>;
  retry?: boolean; // default true
  signal?: AbortSignal;
}

export async function openRouterChat(opts: OpenRouterCallOpts): Promise<Response> {
  const { apiKey, body, signal } = opts;
  const retry = opts.retry ?? true;

  const doFetch = () =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://polyphonic.chat",
        "X-Title": "Luca",
      },
      body: JSON.stringify(body),
      signal,
    });

  let resp: Response;
  try {
    resp = await doFetch();
  } catch {
    if (!retry) throw new UpstreamUnavailableError("OpenRouter unreachable");
    await sleep(300 + Math.random() * 400);
    try {
      resp = await doFetch();
    } catch {
      throw new UpstreamUnavailableError("OpenRouter unreachable after retry");
    }
  }

  if (TRANSIENT.has(resp.status) && retry) {
    await sleep(300 + Math.random() * 400);
    resp = await doFetch();
  }

  if (!resp.ok) {
    await resp.body?.cancel().catch(() => {});
    throw openRouterError(resp.status);
  }
  return resp;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
