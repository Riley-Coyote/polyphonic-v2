import { exchangeChatGPTCode } from "./chatgpt-oauth.ts";
import type { ProviderConfiguration } from "./config.ts";
import type { OAuthCompletion, OAuthPayload } from "./connections.ts";
import { failure, opaque } from "./http.ts";
import { ProviderError } from "./types.ts";
import { isObject, ProviderStore, randomOpaque, uuid } from "./vault.ts";

const COOKIE = "__Host-polyphonic-provider-bound";
const securityHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const cookie = (value: string, age = 600) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
function browserBinding(request: Request): string {
  const values = (request.headers.get("Cookie") ?? "").split(";").map((x) =>
    x.trim()
  ).filter((x) => x.startsWith(`${COOKIE}=`));
  if (values.length !== 1) {
    throw new ProviderError("provider_auth_required", 401);
  }
  return opaque(values[0].slice(COOKIE.length + 1));
}
function authorizationPayload(value: unknown): OAuthPayload {
  if (
    !isObject(value) || value.kind !== "authorize" ||
    !isObject(value.transaction) ||
    typeof value.authorizationUrl !== "string" ||
    !Number.isSafeInteger(value.version) || Number(value.version) < 0 ||
    typeof value.label !== "string" ||
    !(value.subject === null || typeof value.subject === "string")
  ) throw new ProviderError("provider_auth_required", 401);
  uuid(value.connectionId);
  const result = value as unknown as OAuthPayload;
  const url = new URL(result.authorizationUrl);
  if (
    url.origin !== "https://auth.openai.com" ||
    url.pathname !== "/api/accounts/authorize" ||
    url.searchParams.get("state") !== result.transaction.state
  ) throw new ProviderError("provider_auth_required", 401);
  return result;
}
export type OAuthHandlerDependencies = {
  store: Pick<ProviderStore, "oauth" | "createOAuth">;
  config: ProviderConfiguration;
  exchange?: typeof exchangeChatGPTCode;
  nowSeconds?: () => number;
};
/** Public GET entry point. Final credential saving separately requires the original authenticated Polyphonic user. */
export async function oauthHandler(
  request: Request,
  deps: OAuthHandlerDependencies,
): Promise<Response> {
  if (request.method !== "GET") {
    return failure(
      new ProviderError("provider_invalid_request", 405),
      securityHeaders,
    );
  }
  const url = new URL(request.url);
  const callback = url.pathname.endsWith("/provider-oauth/callback");
  try {
    if (url.pathname.endsWith("/provider-oauth/start")) {
      const binding = randomOpaque();
      const record = await deps.store.oauth(
        "bind",
        opaque(url.searchParams.get("ticket")),
        binding,
      );
      if (!record) throw new ProviderError("provider_auth_required", 401);
      const payload = authorizationPayload(record.payload);
      if (
        payload.transaction.expiresAt <=
          (deps.nowSeconds?.() ?? Date.now() / 1000)
      ) throw new ProviderError("provider_auth_required", 401);
      return new Response(null, {
        status: 303,
        headers: {
          ...securityHeaders,
          Location: payload.authorizationUrl,
          "Set-Cookie": cookie(binding),
        },
      });
    }
    if (!callback) throw new ProviderError("provider_invalid_request", 404);
    const state = opaque(url.searchParams.get("state"));
    const record = await deps.store.oauth(
      "consume",
      state,
      browserBinding(request),
    );
    if (!record) throw new ProviderError("provider_auth_required", 401);
    const payload = authorizationPayload(record.payload);
    const session = await (deps.exchange ?? exchangeChatGPTCode)(
      deps.config.chatgpt,
      payload.transaction,
      {
        state,
        code: url.searchParams.get("code") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        clientId: url.searchParams.get("client_id") ?? undefined,
        issuer: url.searchParams.get("iss") ?? undefined,
      },
    );
    if (payload.subject && session.subject !== payload.subject) {
      throw new ProviderError("provider_auth_required", 401);
    }
    const ticket = randomOpaque();
    const completion: OAuthCompletion = {
      kind: "complete",
      connectionId: payload.connectionId,
      label: payload.label,
      version: payload.version,
      subject: payload.subject,
      session,
    };
    await deps.store.createOAuth(
      record.user,
      randomOpaque(),
      ticket,
      completion,
      Math.floor(deps.nowSeconds?.() ?? Date.now() / 1000) + 300,
    );
    const finish = new URL(deps.config.settingsURL);
    finish.hash = new URLSearchParams({ provider_complete: ticket }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        ...securityHeaders,
        Location: finish.href,
        "Set-Cookie": cookie("", 0),
      },
    });
  } catch (error) {
    if (!callback) return failure(error, securityHeaders);
    const finish = new URL(deps.config.settingsURL);
    finish.hash = new URLSearchParams({
      provider_error: error instanceof ProviderError
        ? error.code
        : "provider_unavailable",
    }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        ...securityHeaders,
        Location: finish.href,
        "Set-Cookie": cookie("", 0),
      },
    });
  }
}
