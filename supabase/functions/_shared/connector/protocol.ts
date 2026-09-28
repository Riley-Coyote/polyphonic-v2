/**
 * Polyphonic connector: the wire.
 *
 * Stateless Streamable HTTP. One POST carries one JSON-RPC message and gets
 * one JSON reply: no SSE, no session id, nothing to bind or guess.
 *
 * The server is dual-era (MCP 2026-07-28 "Versioning"):
 *   - modern: every request carries its version in
 *     params._meta["io.modelcontextprotocol/protocolVersion"], mirrored in the
 *     MCP-Protocol-Version header, with Mcp-Method / Mcp-Name headers that
 *     must match the body;
 *   - legacy (2025-11-25 and earlier): an `initialize` handshake, then plain
 *     requests. Served statelessly: no Mcp-Session-Id is ever minted.
 *
 * Never logged: tokens, bodies, arguments.
 */

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

/** MCP messages here are small; the largest argument is a 4,000-character memory. */
export const MAX_BODY_BYTES = 256 * 1024;

export const SERVER_INFO = { name: "polyphonic", title: "Polyphonic", version: "1.0.0" };

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** Implementation-defined range (-32000..-32019). */
  unauthorized: -32001,
  /** MCP-reserved range (-32020..-32099). */
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

export type RpcId = string | number | null;

/**
 * Bearer-only auth and no cookies on this origin, so any browser origin may
 * call: a page can't borrow a person's session here. That is why the Origin
 * check the spec asks of local servers (DNS rebinding) isn't needed.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
  "access-control-max-age": "600",
};

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  ...CORS_HEADERS,
};

export function reply(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

export function rpcResult(id: RpcId, result: unknown, status = 200): Response {
  return reply({ jsonrpc: "2.0", id, result }, status);
}

export function rpcError(
  id: RpcId,
  code: number,
  message: string,
  status = 200,
  data?: Record<string, unknown>,
  extra: Record<string, string> = {},
): Response {
  return reply(
    { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } },
    status,
    extra,
  );
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "cache-control": "no-store" } });
}

export function methodNotAllowed(): Response {
  return reply({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });
}

/** At most `cap` bytes, whether or not a length is declared. */
export async function readCapped(request: Request, cap: number): Promise<string | "too_large" | "bad"> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isSafeInteger(n) || n < 0) return "bad";
    if (n > cap) return "too_large";
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    parts.push(next.value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validId(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value) && String(value).length <= 128;
  return typeof value === "string" && value.length <= 128;
}

/** `=?base64?…?=` header values (Mcp-Name, Mcp-Param-*), decoded; plain values as they are. */
export function decodeHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const match = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!match) return value;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type Era =
  | { kind: "modern"; version: string }
  | { kind: "legacy"; version: string };

export type EraCheck = { ok: true; era: Era } | { ok: false; response: Response };

/**
 * Which era a request speaks, and whether its headers agree with its body.
 * Every failure here is a recognized modern error, so a dual-era client
 * retries rather than falling back.
 */
export function classifyRequest(
  headers: Headers,
  msg: { id: RpcId; method: string; params: Record<string, unknown> },
): EraCheck {
  const meta = isObj(msg.params._meta) ? msg.params._meta : null;
  const metaVersion = meta && typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : null;
  const headerVersion = headers.get("mcp-protocol-version");
  const headerMethod = headers.get("mcp-method");
  const headerName = decodeHeaderValue(headers.get("mcp-name"));

  const mismatch = (what: string) => ({
    ok: false as const,
    response: rpcError(msg.id, RPC.headerMismatch, `Header mismatch: ${what}.`, 400),
  });
  const unsupported = (requested: string) => ({
    ok: false as const,
    response: rpcError(msg.id, RPC.unsupportedVersion, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS,
      // The spec asks for the requested version back; a short slice is enough.
      requested: requested.slice(0, 32),
    }),
  });

  // Mirrored headers must agree with the body whenever they're present.
  if (headerMethod !== null && headerMethod !== msg.method) return mismatch("Mcp-Method does not match the body");
  if (msg.method === "tools/call" && headers.has("mcp-name")) {
    if (headerName === null || headerName !== msg.params.name) return mismatch("Mcp-Name does not match the body");
  }

  if (metaVersion !== null) {
    if (!SUPPORTED_VERSIONS.includes(metaVersion)) return unsupported(metaVersion);
    if (headerVersion !== metaVersion) return mismatch("MCP-Protocol-Version does not match _meta");
    if (metaVersion === MODERN_VERSION) {
      if (headerMethod === null) return mismatch("Mcp-Method is required");
      if (msg.method === "tools/call" && !headers.has("mcp-name")) return mismatch("Mcp-Name is required");
      return { ok: true, era: { kind: "modern", version: metaVersion } };
    }
    return { ok: true, era: { kind: "legacy", version: metaVersion } };
  }

  // No per-request version: a legacy client, or a modern one that forgot _meta.
  if (headerVersion === MODERN_VERSION) return mismatch("the request has no _meta protocol version");
  if (headerVersion !== null && !LEGACY_VERSIONS.includes(headerVersion)) return unsupported(headerVersion);
  // Clients before 2025-06-18 send no header at all.
  return { ok: true, era: { kind: "legacy", version: headerVersion ?? "2025-03-26" } };
}

/** A legacy `initialize` answers with the client's version when we speak it. */
export function negotiateLegacyVersion(params: Record<string, unknown>): string {
  const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
  return LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0];
}

/** Modern results carry resultType and the server's identity; legacy ones stay as they were. */
export function shapeResult(era: Era, result: Record<string, unknown>): Record<string, unknown> {
  if (era.kind !== "modern") return result;
  return {
    resultType: "complete",
    ...result,
    _meta: { [META_SERVER_INFO]: SERVER_INFO },
  };
}
