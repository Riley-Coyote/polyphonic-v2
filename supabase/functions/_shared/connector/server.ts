/**
 * Polyphonic connector: the door.
 *
 *   GET  …/polyphonic-connect/.well-known/oauth-protected-resource  → RFC 9728 metadata
 *   POST …/polyphonic-connect                                       → one JSON-RPC message
 *   OPTIONS                                                          → CORS preflight
 *   anything else                                                    → 405 / 404
 *
 * The token comes first, from the header alone, so a caller without one never
 * gets a body read. Then the body, the era, and the method.
 */
import {
  bearerToken,
  metadataResponse,
  tokenProblem,
  unauthorized,
  type ResourceConfig,
  type VerifiedToken,
} from "./auth.ts";
import {
  classifyRequest,
  CORS_HEADERS,
  isObj,
  MAX_BODY_BYTES,
  methodNotAllowed,
  negotiateLegacyVersion,
  preflight,
  readCapped,
  reply,
  RPC,
  rpcError,
  rpcResult,
  SERVER_INFO,
  shapeResult,
  SUPPORTED_VERSIONS,
  validId,
  type Era,
  type RpcId,
} from "./protocol.ts";
import { callTool, INSTRUCTIONS, isToolName, TOOLS, type ToolDeps } from "./tools.ts";

export const FUNCTION_SLUG = "polyphonic-connect";

export interface ConnectorDeps extends ToolDeps {
  config: ResourceConfig;
  /** Asks the auth server; null when the token isn't valid now. */
  verifyToken: (token: string) => Promise<VerifiedToken | null>;
}

/** The path under the function, whatever prefix the platform leaves on it. */
export function subPath(pathname: string, slug = FUNCTION_SLUG): string {
  const marker = `/${slug}`;
  const at = pathname.indexOf(marker);
  let rest = at === -1 ? pathname : pathname.slice(at + marker.length);
  if (rest === "") rest = "/";
  if (rest.length > 1 && rest.endsWith("/")) rest = rest.slice(0, -1);
  return rest;
}

const TOOLS_TTL_MS = 5 * 60_000;

function listResult(era: Era, key: string, items: readonly unknown[]): Record<string, unknown> {
  return {
    [key]: items,
    ...(era.kind === "modern" ? { ttlMs: TOOLS_TTL_MS, cacheScope: "public" } : {}),
  };
}

export async function handleConnector(request: Request, deps: ConnectorDeps): Promise<Response> {
  const path = subPath(new URL(request.url).pathname);

  if (request.method === "OPTIONS") return preflight();

  if (path === "/.well-known/oauth-protected-resource" || path === "/oauth-protected-resource") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
    return metadataResponse(deps.config);
  }
  if (path !== "/") return reply({ error: "not_found" }, 404);
  // No standalone stream and no sessions: GET and DELETE are 405 in every era.
  if (request.method !== "POST") return methodNotAllowed();

  const token = bearerToken(request);
  if (!token) return unauthorized(deps.config, "missing");
  let verified: VerifiedToken | null;
  try {
    verified = await deps.verifyToken(token);
  } catch {
    return rpcError(null, RPC.unauthorized, "Polyphonic's sign-in couldn't be reached. Try again shortly.", 503);
  }
  if (!verified) return unauthorized(deps.config, "invalid");
  const problem = tokenProblem(verified, deps.config);
  if (problem) return unauthorized(deps.config, problem);
  const caller = { userId: verified.userId, clientId: verified.clientId as string };

  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === "too_large") return rpcError(null, RPC.invalidRequest, "Request too large.", 413);
  if (text === "bad") return rpcError(null, RPC.invalidRequest, "Bad Content-Length.", 400);
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return rpcError(null, RPC.parseError, "Parse error.", 400);
  }
  if (Array.isArray(msg)) return rpcError(null, RPC.invalidRequest, "Batches aren't supported.", 400);
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || "result" in msg || "error" in msg) {
    return rpcError(null, RPC.invalidRequest, "Invalid request.", 400);
  }

  // Notifications (notifications/initialized, cancellations) need no answer.
  if (!("id" in msg)) {
    return new Response(null, { status: 202, headers: { ...CORS_HEADERS, "cache-control": "no-store" } });
  }
  if (!validId(msg.id)) return rpcError(null, RPC.invalidRequest, "Invalid id.", 400);
  const id: RpcId = msg.id;
  const method = msg.method;
  const params = isObj(msg.params) ? msg.params : {};

  const check = classifyRequest(request.headers, { id, method, params });
  if ("response" in check) return check.response;
  const era = check.era;
  const ok = (result: Record<string, unknown>) => rpcResult(id, shapeResult(era, result));
  const notFound = () =>
    era.kind === "modern"
      ? rpcError(id, RPC.methodNotFound, "Method not found.", 404)
      : rpcError(id, RPC.methodNotFound, "Method not found.");

  switch (method) {
    case "initialize": {
      // Modern clients never open with a handshake.
      if (era.kind === "modern") return notFound();
      return ok({
        protocolVersion: negotiateLegacyVersion(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "server/discover":
      return ok({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: 60 * 60_000,
        cacheScope: "public",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok(listResult(era, "tools", TOOLS));
    // Not offered, but some clients ask anyway; an empty list is the honest answer.
    case "resources/list":
      return ok(listResult(era, "resources", []));
    case "resources/templates/list":
      return ok(listResult(era, "resourceTemplates", []));
    case "prompts/list":
      return ok(listResult(era, "prompts", []));
    case "tools/call": {
      const name = params.name;
      if (!isToolName(name)) return rpcError(id, RPC.invalidParams, "Unknown tool.");
      if (params.arguments !== undefined && !isObj(params.arguments)) {
        return rpcError(id, RPC.invalidParams, "Tool arguments must be an object.");
      }
      const args = isObj(params.arguments) ? params.arguments : {};
      const result = await callTool(deps, caller, name, args);
      return ok(result as unknown as Record<string, unknown>);
    }
    default:
      return notFound();
  }
}
