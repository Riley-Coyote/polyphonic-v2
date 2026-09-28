/**
 * Polyphonic connector: who is calling.
 *
 * People sign in through Supabase Auth's OAuth 2.1 server. The connector is
 * the protected resource: it publishes RFC 9728 metadata naming the project's
 * auth server, answers 401 with a WWW-Authenticate challenge that points
 * there, and accepts only tokens that auth server issued to an OAuth client.
 *
 * Identity comes from the verified token only (G4): never from arguments.
 */
import { CORS_HEADERS, reply, RPC } from "./protocol.ts";

/** What a verified token says. Filled in by the entry point's verifier. */
export interface VerifiedToken {
  userId: string;
  /** The OAuth client the token was issued to; null for the site's own sessions. */
  clientId: string | null;
  audience: string[];
  issuer: string | null;
}

export interface ResourceConfig {
  /** The canonical MCP endpoint, e.g. https://<ref>.supabase.co/functions/v1/polyphonic-connect */
  resourceUrl: string;
  /** The issuer, e.g. https://<ref>.supabase.co/auth/v1 */
  authServerUrl: string;
  /** Where people read about the connector. */
  documentationUrl: string;
}

/**
 * The scope asked for at sign-in. Access here isn't scoped (the grant table
 * decides which companions an app may reach); this only keeps clients from
 * asking for `openid`, which fails while the project signs with HS256.
 */
export const CONNECTOR_SCOPE = "email";

/** The caller's token, read from the Authorization header and nowhere else. */
export function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const match = /^Bearer[ ]+([A-Za-z0-9._~+/-]+=*)$/.exec(auth.trim());
  return match ? match[1] : null;
}

/** A JWT's claims, unverified. Only read after the auth server accepted the token. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

export function audienceOf(claims: Record<string, unknown>): string[] {
  const aud = claims.aud;
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((v): v is string => typeof v === "string");
  return [];
}

export function metadataUrl(config: ResourceConfig): string {
  return `${config.resourceUrl}/.well-known/oauth-protected-resource`;
}

/** RFC 9728 protected resource metadata. */
export function protectedResourceMetadata(config: ResourceConfig): Record<string, unknown> {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.authServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [CONNECTOR_SCOPE],
    resource_name: "Polyphonic",
    resource_documentation: config.documentationUrl,
  };
}

export type TokenProblem = "missing" | "invalid" | "wrong_audience" | "not_connector_token";

const PROBLEM_TEXT: Record<Exclude<TokenProblem, "missing">, string> = {
  invalid: "The sign-in has expired or was revoked. Connect Polyphonic again.",
  wrong_audience: "This sign-in wasn't made for the Polyphonic connector. Connect Polyphonic again.",
  not_connector_token: "This address only accepts sign-ins made for it. Connect Polyphonic from your app.",
};

/**
 * Should this verified token be served? The auth server already checked the
 * signature, expiry and that the session still exists; here: our issuer, an
 * OAuth client, and an audience this resource accepts.
 *
 * Audience (RFC 8707): Supabase issues project tokens with aud
 * "authenticated", so until an access-token hook names this resource in
 * `aud`, a token passes on aud "authenticated" plus a client_id. A token
 * that names audiences, none of them ours or "authenticated", is refused.
 */
export function tokenProblem(token: VerifiedToken, config: ResourceConfig): TokenProblem | null {
  if (token.issuer !== null && token.issuer !== config.authServerUrl) return "invalid";
  if (!token.clientId) return "not_connector_token";
  const accepted = token.audience.some((aud) => aud === config.resourceUrl || aud === "authenticated");
  if (!accepted) return "wrong_audience";
  return null;
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}

/** 401 with the challenge MCP clients use to find the auth server. */
export function unauthorized(config: ResourceConfig, problem: TokenProblem): Response {
  const params = [
    ...(problem === "missing" ? [] : [`error="invalid_token"`, `error_description=${quoted(PROBLEM_TEXT[problem])}`]),
    `resource_metadata=${quoted(metadataUrl(config))}`,
    `scope=${quoted(CONNECTOR_SCOPE)}`,
  ];
  const message = problem === "missing"
    ? "Sign in to Polyphonic to use this connector."
    : PROBLEM_TEXT[problem];
  return reply(
    { jsonrpc: "2.0", id: null, error: { code: RPC.unauthorized, message } },
    401,
    { "www-authenticate": `Bearer ${params.join(", ")}` },
  );
}

export function metadataResponse(config: ResourceConfig): Response {
  return new Response(JSON.stringify(protectedResourceMetadata(config)), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      ...CORS_HEADERS,
    },
  });
}
