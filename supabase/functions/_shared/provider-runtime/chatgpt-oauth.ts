// deno-lint-ignore-file no-import-prefix
// Pin this standalone Edge module's maintained OIDC dependency without changing the frontend package.
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTVerifyGetKey,
} from "npm:jose@6.1.3";
import {
  type ChatGPTCredential,
  ProviderError,
  type ProviderFetch,
} from "./types.ts";

export const CHATGPT_ISSUER = "https://auth.openai.com";
const AUTHORIZE = `${CHATGPT_ISSUER}/api/accounts/authorize`;
const TOKEN = `${CHATGPT_ISSUER}/api/accounts/oauth/token`;
const JWKS = `${CHATGPT_ISSUER}/.well-known/jwks.json`;
const DISCOVERY = `${CHATGPT_ISSUER}/.well-known/openid-configuration`;
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  PLAN_SCOPE,
];

/** Deployment-owned values from an approved hosted registration. This module never does OSS dynamic registration. */
export type ChatGPTHostedConfig = {
  approved: boolean;
  planUsageApproved: boolean;
  clientId: string;
  redirectUri: string;
  tokenEndpointAuthMethod: "none" | "client_secret_basic";
  clientSecret?: string;
};
/** Root owns encrypted persistence, browser binding and atomic one-time consumption of this transaction. */
export type ChatGPTOAuthTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
  clientId: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
};
export type ChatGPTOAuthCallback = {
  state?: string;
  code?: string;
  error?: string;
  clientId?: string;
  issuer?: string;
};
/** Entire profile remains encrypted server-side; only verified identity/grant metadata belongs in browser responses. */
export type ChatGPTSession = ChatGPTCredential & {
  issuer: typeof CHATGPT_ISSUER;
  email?: string;
  name?: string;
  refreshToken?: string;
  idToken?: string;
};
export type ChatGPTOAuthOptions = {
  nowSeconds?: number;
  jwks?: JWTVerifyGetKey;
};

function printable(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && !/[\s\p{Cc}]/u.test(value);
}
export function validateChatGPTHostedConfig(
  config: ChatGPTHostedConfig,
  approvalRequired = true,
): void {
  if (
    approvalRequired &&
    (config.approved !== true || config.planUsageApproved !== true)
  ) {
    throw new ProviderError("provider_access_pending", 503);
  }
  if (
    !printable(config.clientId, 256) ||
    config.clientId === "dynamic_agent_client" ||
    !["none", "client_secret_basic"].includes(config.tokenEndpointAuthMethod)
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  let redirect: URL;
  try {
    redirect = new URL(config.redirectUri);
  } catch {
    throw new ProviderError("provider_configuration_required", 503);
  }
  if (
    redirect.protocol !== "https:" || redirect.username || redirect.password ||
    redirect.hash || redirect.search
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  if (
    config.tokenEndpointAuthMethod === "client_secret_basic" &&
    !printable(config.clientSecret, 16_384)
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  if (config.tokenEndpointAuthMethod === "none" && config.clientSecret) {
    // Do not quietly change a public client's registered authentication method.
    throw new ProviderError("provider_configuration_required", 503);
  }
}
function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
function random(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function seconds(options?: ChatGPTOAuthOptions): number {
  const value = options?.nowSeconds ?? Date.now() / 1000;
  if (!Number.isFinite(value) || value < 0) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  return Math.floor(value);
}
function equal(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function beginChatGPTOAuth(
  config: ChatGPTHostedConfig,
  nowSeconds = Date.now() / 1000,
): Promise<{ authorizationUrl: string; transaction: ChatGPTOAuthTransaction }> {
  validateChatGPTHostedConfig(config);
  const now = seconds({ nowSeconds }), verifier = random();
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const transaction: ChatGPTOAuthTransaction = {
    state: random(),
    nonce: random(),
    verifier,
    challenge,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    createdAt: now,
    expiresAt: now + 600,
  };
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    resource: RESOURCE,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: transaction.challenge,
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: url.href, transaction };
}

function tokenHeaders(config: ChatGPTHostedConfig): Headers {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });
  if (config.tokenEndpointAuthMethod === "client_secret_basic") {
    const encode = (value: string) =>
      new URLSearchParams({ value }).toString().slice("value=".length);
    headers.set(
      "Authorization",
      `Basic ${
        btoa(`${encode(config.clientId)}:${encode(config.clientSecret!)}`)
      }`,
    );
  }
  return headers;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
async function readJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new ProviderError("provider_malformed");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262_144) throw new ProviderError("provider_too_large", 413);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    const result = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)),
    );
    if (!result) throw new ProviderError("provider_malformed");
    return result;
  } catch {
    throw new ProviderError("provider_malformed");
  }
}
async function postToken(
  config: ChatGPTHostedConfig,
  body: URLSearchParams,
  fetcher: ProviderFetch,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher(TOKEN, {
      method: "POST",
      redirect: "error",
      headers: tokenHeaders(config),
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const data = await readJSON(response);
    if (!response.ok) {
      const code = data.error;
      if (code === "unauthorized_client") {
        throw new ProviderError("provider_access_pending", 403);
      }
      if (code === "invalid_client") {
        throw new ProviderError("provider_configuration_required", 503);
      }
      if (code === "invalid_grant" || response.status === 401) {
        throw new ProviderError("provider_auth_required", 401);
      }
      if (code === "invalid_scope" || code === "access_denied") {
        throw new ProviderError("provider_permission_required", 403);
      }
      throw new ProviderError(
        "provider_unavailable",
        response.status >= 500 ? response.status : 502,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("provider_unavailable", 503);
  }
}
const jwksByFetch = new WeakMap<ProviderFetch, JWTVerifyGetKey>();
function resolver(fetcher: ProviderFetch): JWTVerifyGetKey {
  let keys = jwksByFetch.get(fetcher);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(JWKS), {
      [customFetch]: fetcher,
      timeoutDuration: 10_000,
    });
    jwksByFetch.set(fetcher, keys);
  }
  return keys;
}
type Identity = {
  subject: string;
  email?: string;
  name?: string;
  expiresAt: number;
};
async function verifyIdentity(
  idToken: string,
  clientId: string,
  fetcher: ProviderFetch,
  options?: ChatGPTOAuthOptions,
  nonce?: string,
  expectedSubject?: string,
): Promise<Identity> {
  if (!printable(idToken, 32_768)) {
    throw new ProviderError("provider_auth_required", 401);
  }
  try {
    const now = seconds(options);
    const { payload } = await jwtVerify(
      idToken,
      options?.jwks ?? resolver(fetcher),
      {
        algorithms: ["RS256"],
        issuer: CHATGPT_ISSUER,
        audience: clientId,
        requiredClaims: [
          "iss",
          "aud",
          "sub",
          "exp",
          "iat",
          ...(nonce ? ["nonce"] : []),
        ],
        currentDate: new Date(now * 1000),
        clockTolerance: 30,
      },
    );
    if (
      !printable(payload.sub, 512) || typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.iat > now + 30 || payload.exp <= payload.iat ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 &&
        payload.azp !== clientId) ||
      (nonce &&
        (typeof payload.nonce !== "string" || !equal(nonce, payload.nonce))) ||
      (expectedSubject && payload.sub !== expectedSubject)
    ) throw new ProviderError("provider_auth_required", 401);
    return {
      subject: payload.sub,
      expiresAt: payload.exp,
      ...(typeof payload.email === "string" && payload.email.length <= 320
        ? { email: payload.email }
        : {}),
      ...(typeof payload.name === "string" && payload.name.length <= 512
        ? { name: payload.name }
        : {}),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const code = object(error)?.code;
    if (
      typeof code === "string" && [
        "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
        "ERR_JWT_CLAIM_VALIDATION_FAILED",
        "ERR_JWT_EXPIRED",
        "ERR_JWT_INVALID",
        "ERR_JWS_INVALID",
        "ERR_JOSE_ALG_NOT_ALLOWED",
        "ERR_JOSE_NOT_SUPPORTED",
      ].includes(code)
    ) throw new ProviderError("provider_auth_required", 401);
    // An unavailable/malformed key set or key-rotation cache miss does not establish that the user's grant is invalid.
    throw new ProviderError("provider_unavailable", 503);
  }
}
function scopes(value: unknown, previous?: readonly string[]): string[] {
  if (value === undefined) return [...(previous ?? [])];
  if (
    typeof value !== "string" || value.length > 16_384 ||
    /\p{Cc}/u.test(value)
  ) throw new ProviderError("provider_malformed");
  return [...new Set(value.split(" ").filter(Boolean))];
}
function tokenSession(
  data: Record<string, unknown>,
  config: ChatGPTHostedConfig,
  identity: Identity,
  now: number,
  previous?: ChatGPTSession,
): ChatGPTSession {
  const grantedScopes = scopes(data.scope, previous?.grantedScopes);
  const plan = grantedScopes.includes(PLAN_SCOPE) &&
    grantedScopes.includes("resource.invoke");
  const accessToken = data.access_token === undefined && !plan
    ? ""
    : data.access_token;
  if (accessToken !== "" && !printable(accessToken, 32_768)) {
    throw new ProviderError("provider_malformed");
  }
  if (plan && !accessToken) throw new ProviderError("provider_malformed");
  if (
    accessToken &&
    (typeof data.token_type !== "string" ||
      data.token_type.toLowerCase() !== "bearer")
  ) throw new ProviderError("provider_malformed");
  const expiry = data.expires_in;
  if (
    accessToken &&
    (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry <= 0 ||
      expiry > 31 * 86_400)
  ) throw new ProviderError("provider_malformed");
  if (
    data.refresh_token !== undefined && !printable(data.refresh_token, 32_768)
  ) throw new ProviderError("provider_malformed");
  if (data.id_token !== undefined && !printable(data.id_token, 32_768)) {
    throw new ProviderError("provider_malformed");
  }
  return {
    provider: "chatgpt",
    issuer: CHATGPT_ISSUER,
    clientId: config.clientId,
    subject: identity.subject,
    email: identity.email,
    name: identity.name,
    accessToken: accessToken as string,
    grantedScopes,
    expiresAt: accessToken ? now + (expiry as number) : identity.expiresAt,
    refreshToken: data.refresh_token as string | undefined ??
      previous?.refreshToken,
    idToken: data.id_token as string | undefined ?? previous?.idToken,
  };
}

export async function exchangeChatGPTCode(
  config: ChatGPTHostedConfig,
  transaction: ChatGPTOAuthTransaction,
  callback: ChatGPTOAuthCallback,
  fetcher: ProviderFetch = fetch,
  options?: ChatGPTOAuthOptions,
): Promise<ChatGPTSession> {
  validateChatGPTHostedConfig(config);
  const now = seconds(options);
  if (
    !printable(callback.state, 512) ||
    !equal(callback.state, transaction.state) ||
    transaction.clientId !== config.clientId ||
    transaction.redirectUri !== config.redirectUri ||
    !Number.isFinite(transaction.createdAt) ||
    !Number.isFinite(transaction.expiresAt) ||
    transaction.createdAt > now + 30 || transaction.expiresAt <= now ||
    transaction.expiresAt <= transaction.createdAt ||
    transaction.expiresAt - transaction.createdAt > 600 ||
    !printable(transaction.verifier, 128) || transaction.verifier.length < 43 ||
    !printable(transaction.nonce, 512) ||
    (callback.clientId !== undefined &&
      callback.clientId !== config.clientId) ||
    (callback.issuer !== undefined && callback.issuer !== CHATGPT_ISSUER)
  ) throw new ProviderError("provider_auth_required", 401);
  if (callback.error) {
    throw new ProviderError("provider_permission_required", 403);
  }
  if (!printable(callback.code, 4096)) {
    throw new ProviderError("provider_auth_required", 401);
  }
  const expectedChallenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(transaction.verifier),
      ),
    ),
  );
  if (!equal(expectedChallenge, transaction.challenge)) {
    throw new ProviderError("provider_auth_required", 401);
  }
  const data = await postToken(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code: callback.code,
      code_verifier: transaction.verifier,
      redirect_uri: transaction.redirectUri,
      resource: RESOURCE,
    }),
    fetcher,
  );
  if (typeof data.id_token !== "string") {
    throw new ProviderError("provider_auth_required", 401);
  }
  const identity = await verifyIdentity(
    data.id_token,
    config.clientId,
    fetcher,
    options,
    transaction.nonce,
  );
  return tokenSession(data, config, identity, now);
}

export async function refreshChatGPTSession(
  config: ChatGPTHostedConfig,
  previous: ChatGPTSession,
  fetcher: ProviderFetch = fetch,
  options?: ChatGPTOAuthOptions,
): Promise<ChatGPTSession> {
  validateChatGPTHostedConfig(config);
  if (
    previous.provider !== "chatgpt" || previous.clientId !== config.clientId ||
    previous.issuer !== CHATGPT_ISSUER ||
    !printable(previous.subject, 512) ||
    !printable(previous.refreshToken, 32_768)
  ) throw new ProviderError("provider_auth_required", 401);
  const now = seconds(options);
  const data = await postToken(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: previous.clientId,
      refresh_token: previous.refreshToken,
      resource: RESOURCE,
    }),
    fetcher,
  );
  const identity = data.id_token === undefined
    ? {
      subject: previous.subject,
      email: previous.email,
      name: previous.name,
      expiresAt: previous.expiresAt,
    }
    : await verifyIdentity(
      String(data.id_token),
      previous.clientId,
      fetcher,
      options,
      undefined,
      previous.subject,
    );
  return tokenSession(data, config, identity, now, previous);
}

/** Root disables the local connection before calling this. A failure means remote revocation is unconfirmed. */
export async function revokeChatGPTSession(
  config: ChatGPTHostedConfig,
  session: ChatGPTSession,
  fetcher: ProviderFetch = fetch,
): Promise<void> {
  validateChatGPTHostedConfig(config, false);
  if (
    session.provider !== "chatgpt" || session.clientId !== config.clientId ||
    session.issuer !== CHATGPT_ISSUER ||
    !printable(session.refreshToken, 32_768)
  ) throw new ProviderError("provider_auth_required", 401);
  try {
    const metadataResponse = await fetcher(DISCOVERY, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!metadataResponse.ok) {
      throw new ProviderError("provider_unavailable", 503);
    }
    const metadata = await readJSON(metadataResponse);
    if (
      metadata.issuer !== CHATGPT_ISSUER ||
      typeof metadata.revocation_endpoint !== "string"
    ) throw new ProviderError("provider_malformed");
    const endpoint = new URL(metadata.revocation_endpoint);
    if (
      endpoint.origin !== CHATGPT_ISSUER || endpoint.username ||
      endpoint.password || endpoint.search || endpoint.hash
    ) throw new ProviderError("provider_malformed");
    const response = await fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: tokenHeaders(config),
      body: new URLSearchParams({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
        client_id: session.clientId,
      }),
    });
    // The documented response is an empty 200, including an already-invalid refresh token.
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 200) {
      throw new ProviderError(
        "provider_unavailable",
        response.status >= 500 ? response.status : 502,
      );
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("provider_unavailable", 503);
  }
}
