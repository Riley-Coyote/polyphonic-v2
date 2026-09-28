// The Polyphonic connector: a remote MCP server that brings a person's
// companion (Luca, or an agent they made) into Claude, ChatGPT, Claude Code,
// Codex and other MCP clients, with its soul, memory and journal.
//
// People sign in through Supabase Auth's OAuth 2.1 server and choose, on
// polyphonic.chat/oauth/consent, which companions the app may reach. The
// logic lives in _shared/connector/ (protocol, auth, tools, server); this file
// only wires the real clients.
//
// verify_jwt is off in config.toml: discovery and the first unauthenticated
// request must reach the function, which checks every token itself.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { audienceOf, decodeJwtPayload, type VerifiedToken } from "../_shared/connector/auth.ts";
import { CORS_HEADERS as corsHeaders, preflight } from "../_shared/connector/protocol.ts";
import { FUNCTION_SLUG, handleConnector, type ConnectorDeps } from "../_shared/connector/server.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// O4: the raw function address for private testing; a clean address later.
const RESOURCE_URL = (Deno.env.get("CONNECTOR_PUBLIC_URL") ?? `${SUPABASE_URL}/functions/v1/${FUNCTION_SLUG}`)
  .replace(/\/+$/, "");
const SITE_URL = (Deno.env.get("POLYPHONIC_SITE_URL") ?? "https://polyphonic.chat").replace(/\/+$/, "");

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
const authClient = createClient(SUPABASE_URL, ANON_KEY, clientOptions);

/**
 * The auth server checks the signature, expiry and that the session still
 * exists (revoking an app deletes its sessions). Only then are the claims
 * read, for the client id, audience and issuer.
 */
async function verifyToken(token: string): Promise<VerifiedToken | null> {
  const { data, error } = await authClient.auth.getUser(token);
  if (error) {
    const status = typeof error.status === "number" ? error.status : 0;
    if (status === 0 || status >= 500 || error.name === "AuthRetryableFetchError") throw new Error("auth unavailable");
    return null;
  }
  const user = data?.user;
  if (!user?.id || user.is_anonymous) return null;
  const claims = decodeJwtPayload(token);
  if (!claims || claims.sub !== user.id) return null;
  return {
    userId: user.id,
    clientId: typeof claims.client_id === "string" && claims.client_id ? claims.client_id : null,
    audience: audienceOf(claims),
    issuer: typeof claims.iss === "string" ? claims.iss : null,
  };
}

const deps: ConnectorDeps = {
  admin,
  siteUrl: SITE_URL,
  verifyToken,
  config: {
    resourceUrl: RESOURCE_URL,
    authServerUrl: `${SUPABASE_URL}/auth/v1`,
    documentationUrl: `${SITE_URL}/connect`,
  },
};

// CORS is open on purpose: tokens travel only in the Authorization header and
// this origin sets no cookies, so a page can't borrow anyone's session here.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    return await handleConnector(req, deps);
  } catch {
    console.error("[polyphonic-connect] unhandled failure");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error." } }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" },
    });
  }
});
