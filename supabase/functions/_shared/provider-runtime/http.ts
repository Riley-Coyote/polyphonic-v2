import { ProviderError } from "./types.ts";
import { isObject } from "./vault.ts";

export function failure(error: unknown, headers: HeadersInit = {}): Response {
  const safe = error instanceof ProviderError
    ? error
    : new ProviderError("provider_unavailable", 503);
  return Response.json({ error: safe.message, code: safe.code }, {
    status: safe.status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}
/** Request size is checked while reading, including chunked bodies without Content-Length. */
export async function requestJSON(
  request: Request,
  maximum = 70_000,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" || !request.body
  ) throw new ProviderError("provider_invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new ProviderError("provider_too_large", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!isObject(data)) throw new Error();
    return data;
  } catch {
    throw new ProviderError("provider_invalid_request", 400);
  }
}
export function opaque(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ProviderError("provider_auth_required", 401);
  }
  return value;
}
