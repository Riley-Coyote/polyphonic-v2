import assert from "node:assert/strict";
import {
  beginChatGPTOAuth,
  CHATGPT_ISSUER,
  type ChatGPTSession,
  exchangeChatGPTCode,
} from "./chatgpt-oauth.ts";
import {
  connectionAction,
  type ConnectionActions,
  type OAuthCompletion,
  type OAuthPayload,
} from "./connections.ts";
import { type ProviderConfiguration } from "./config.ts";
import {
  oauthHandler,
  type OAuthHandlerDependencies,
} from "./oauth-handler.ts";
import { ProviderError } from "./types.ts";
import { type ConnectionMetadata, type StoredConnection } from "./vault.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TICKET = "T".repeat(43);
const COOKIE_NAME = "__Host-polyphonic-provider-bound";
const NOW = Math.floor(Date.now() / 1000);
const CONFIG: ProviderConfiguration = {
  chatgpt: {
    approved: true,
    planUsageApproved: true,
    clientId: "oaiapp_fixture",
    redirectUri:
      "https://edge.example.invalid/functions/v1/provider-oauth/callback",
    tokenEndpointAuthMethod: "none",
  },
  oauthStart: "https://edge.example.invalid/functions/v1/provider-oauth/start",
  settingsURL: "https://polyphonic.chat/settings/models",
  chatgptAvailable: true,
};
function session(patch: Partial<ChatGPTSession> = {}): ChatGPTSession {
  return {
    provider: "chatgpt",
    issuer: CHATGPT_ISSUER,
    clientId: CONFIG.chatgpt.clientId,
    subject: "fixture-openai-subject",
    accessToken: "fixture-private-access",
    refreshToken: "fixture-private-refresh",
    idToken: "fixture-private-id",
    grantedScopes: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: NOW + 3600,
    ...patch,
  };
}
type TransactionEntry = {
  user: string;
  ticket: string | null;
  binding: string | null;
  payload: unknown;
  expires: number;
};
class FakeStore {
  entries = new Map<string, TransactionEntry>();
  created: {
    user: string;
    state: string;
    ticket: string;
    payload: unknown;
    expires: number;
  }[] = [];
  events: string[] = [];
  record: StoredConnection = {
    connection: {
      id: ID,
      user_id: USER,
      provider: "chatgpt",
      label: "Fixture ChatGPT",
      subject: null,
      workspace_id: null,
      status: "needs_reconnect",
      granted_scopes: [],
      expires_at: null,
      created_at: new Date(NOW * 1000).toISOString(),
      updated_at: new Date(NOW * 1000).toISOString(),
    },
    encrypted_secret: "fixture-encrypted-pending",
    version: 1,
    lease_id: null,
    lease_until: null,
  };
  secret: unknown = { pending: true };
  now = NOW;
  async prepare(): Promise<OAuthPayload> {
    const start = await beginChatGPTOAuth(CONFIG.chatgpt, NOW);
    const payload: OAuthPayload = {
      kind: "authorize",
      ...start,
      connectionId: ID,
      version: 1,
      subject: null,
      label: "Fixture ChatGPT",
    };
    this.entries.set(start.transaction.state, {
      user: USER,
      ticket: TICKET,
      binding: null,
      payload,
      expires: NOW + 600,
    });
    return payload;
  }
  oauth(
    action: "bind" | "consume",
    value: string,
    binding: string,
  ): Promise<{ user: string; payload: unknown } | null> {
    this.events.push(action);
    if (action === "bind") {
      for (const entry of this.entries.values()) {
        if (entry.ticket === value && entry.expires > this.now) {
          entry.ticket = null;
          entry.binding = binding;
          return Promise.resolve({
            user: entry.user,
            payload: structuredClone(entry.payload),
          });
        }
      }
      return Promise.resolve(null);
    }
    const entry = this.entries.get(value);
    if (!entry || entry.binding !== binding || entry.expires <= this.now) {
      return Promise.resolve(null);
    }
    this.entries.delete(value);
    return Promise.resolve({
      user: entry.user,
      payload: structuredClone(entry.payload),
    });
  }
  createOAuth(
    user: string,
    state: string,
    ticket: string,
    payload: unknown,
    expires: number,
  ): Promise<void> {
    this.events.push("create-completion");
    this.created.push({
      user,
      state,
      ticket,
      payload: structuredClone(payload),
      expires,
    });
    this.entries.set(state, {
      user,
      ticket,
      binding: null,
      payload: structuredClone(payload),
      expires,
    });
    return Promise.resolve();
  }
  completeOAuth(user: string, ticket: string): Promise<unknown | null> {
    this.events.push("finish-ticket");
    for (const [state, entry] of this.entries) {
      if (
        entry.user === user && entry.ticket === ticket &&
        entry.binding === null && entry.expires > this.now
      ) {
        this.entries.delete(state);
        return Promise.resolve(structuredClone(entry.payload));
      }
    }
    return Promise.resolve(null);
  }
  read(user: string, id: string): Promise<StoredConnection | null> {
    assert.equal(user, USER);
    assert.equal(id, ID);
    return Promise.resolve(structuredClone(this.record));
  }
  save(
    user: string,
    id: string,
    metadata: ConnectionMetadata,
    secret: unknown,
    version = 0,
  ): Promise<StoredConnection> {
    this.events.push("save-credential");
    assert.equal(user, USER);
    assert.equal(id, ID);
    if (version !== this.record.version) {
      return Promise.reject(new ProviderError("provider_unavailable", 503));
    }
    this.record = {
      ...this.record,
      connection: { ...this.record.connection, ...metadata },
      encrypted_secret: "fixture-encrypted-session",
      version: version + 1,
    };
    this.secret = structuredClone(secret);
    return Promise.resolve(structuredClone(this.record));
  }
}
function deps(
  store: FakeStore,
  overrides: Partial<OAuthHandlerDependencies> = {},
): OAuthHandlerDependencies {
  return {
    store,
    config: CONFIG,
    nowSeconds: () => NOW,
    exchange: () => Promise.resolve(session()),
    ...overrides,
  };
}
function finishDeps(store: FakeStore): ConnectionActions {
  return {
    store,
    config: CONFIG,
    broker: {
      listModels: () => Promise.reject(new Error("Unexpected models")),
      disconnect: () => Promise.reject(new Error("Unexpected disconnect")),
    },
    list: () => Promise.resolve([]),
  };
}
function startRequest(ticket = TICKET): Request {
  return new Request(`${CONFIG.oauthStart}?ticket=${ticket}`);
}
function callbackRequest(
  state: string,
  cookie?: string,
  extra: Record<string, string> = {},
): Request {
  const url = new URL(CONFIG.chatgpt.redirectUri);
  url.search = new URLSearchParams({
    state,
    code: "fixture-private-code",
    ...extra,
  }).toString();
  return new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
}
function browserCookie(response: Response): string {
  const value = response.headers.get("Set-Cookie");
  assert(value);
  return value.split(";")[0];
}
function fragment(response: Response): URLSearchParams {
  const location = response.headers.get("Location");
  assert(location);
  return new URLSearchParams(new URL(location).hash.slice(1));
}
async function assertPrivateResponse(
  response: Response,
  extra: string[] = [],
): Promise<void> {
  const text = JSON.stringify([...response.headers]) +
    await response.clone().text();
  for (
    const secret of [
      "fixture-private-access",
      "fixture-private-refresh",
      "fixture-private-id",
      "fixture-private-code",
      "fixture-upstream-secret-detail",
      ...extra,
    ]
  ) assert(!text.includes(secret), secret);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

Deno.test("OAuth start atomically binds a single-use ticket to a secure host cookie and redirects only to OpenAI", async () => {
  const store = new FakeStore(), payload = await store.prepare();
  const response = await oauthHandler(startRequest(), deps(store));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), payload.authorizationUrl);
  const cookie = response.headers.get("Set-Cookie")!;
  assert.match(cookie, /^__Host-polyphonic-provider-bound=[A-Za-z0-9_-]{43};/);
  for (
    const flag of [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=600",
    ]
  ) assert(cookie.includes(flag));
  assert(!cookie.includes("Domain="));
  assert.equal(store.entries.get(payload.transaction.state)!.ticket, null);
  await assertPrivateResponse(response, [payload.transaction.verifier]);
  const replay = await oauthHandler(startRequest(), deps(store));
  assert.equal(replay.status, 401);
  assert.equal(replay.headers.get("Location"), null);
});

Deno.test("OAuth callback requires its browser cookie and atomically consumes only the matching state", async () => {
  for (
    const header of [
      undefined,
      `${COOKIE_NAME}=${"W".repeat(43)}`,
      `${COOKIE_NAME}=short`,
      `${COOKIE_NAME}=${"W".repeat(43)}; ${COOKIE_NAME}=${"W".repeat(43)}`,
    ]
  ) {
    const store = new FakeStore(), payload = await store.prepare();
    await oauthHandler(startRequest(), deps(store));
    let exchanges = 0;
    const response = await oauthHandler(
      callbackRequest(payload.transaction.state, header),
      deps(store, {
        exchange: () => {
          exchanges++;
          return Promise.resolve(session());
        },
      }),
    );
    assert.equal(
      fragment(response).get("provider_error"),
      "provider_auth_required",
    );
    assert.equal(exchanges, 0);
    assert.equal(store.created.length, 0);
    assert(store.entries.has(payload.transaction.state));
    await assertPrivateResponse(response);
  }
});

Deno.test("OAuth callback creates a short-lived completion ticket without saving a provider credential", async () => {
  const store = new FakeStore(), payload = await store.prepare();
  const started = await oauthHandler(startRequest(), deps(store));
  let exchanges = 0;
  const response = await oauthHandler(
    callbackRequest(payload.transaction.state, browserCookie(started), {
      client_id: CONFIG.chatgpt.clientId,
      iss: CHATGPT_ISSUER,
    }),
    deps(store, {
      exchange: (config, transaction, callback) => {
        exchanges++;
        assert.equal(config.clientId, CONFIG.chatgpt.clientId);
        assert.equal(transaction.verifier, payload.transaction.verifier);
        assert.equal(callback.state, payload.transaction.state);
        assert.equal(callback.code, "fixture-private-code");
        return Promise.resolve(session());
      },
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(exchanges, 1);
  assert(!store.entries.has(payload.transaction.state));
  assert.equal(store.created.length, 1);
  const created = store.created[0],
    completion = created.payload as OAuthCompletion;
  assert.equal(completion.kind, "complete");
  assert.equal(created.user, USER);
  assert.equal(created.expires, NOW + 300);
  assert.equal(fragment(response).get("provider_complete"), created.ticket);
  assert.match(created.ticket, /^[A-Za-z0-9_-]{43}$/);
  const finish = new URL(response.headers.get("Location")!);
  assert.equal(finish.origin, "https://polyphonic.chat");
  assert.equal(finish.search, "");
  assert(response.headers.get("Set-Cookie")!.includes("Max-Age=0"));
  assert(!store.events.includes("save-credential"));
  assert.deepEqual(store.secret, { pending: true });
  await assertPrivateResponse(response, [payload.transaction.verifier]);
});

Deno.test("OAuth completion requires the original authenticated Polyphonic account after public callback", async () => {
  const store = new FakeStore(), payload = await store.prepare();
  const started = await oauthHandler(startRequest(), deps(store));
  const callback = await oauthHandler(
    callbackRequest(payload.transaction.state, browserCookie(started)),
    deps(store),
  );
  const ticket = fragment(callback).get("provider_complete")!;
  await assert.rejects(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket },
        OTHER,
        finishDeps(store),
      ),
    ProviderError,
  );
  assert(!store.events.includes("save-credential"));
  const result = await connectionAction(
    { action: "chatgpt_finish", ticket },
    USER,
    finishDeps(store),
  );
  assert.equal(store.record.connection.status, "connected");
  assert.equal(
    store.events.filter((event) => event === "save-credential").length,
    1,
  );
  assert(!JSON.stringify(result).includes("fixture-private-access"));
  assert(!JSON.stringify(result).includes("fixture-openai-subject"));
  await assert.rejects(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket },
        USER,
        finishDeps(store),
      ),
    ProviderError,
  );
});

Deno.test("parallel/replayed OAuth callbacks exchange the authorization code at most once", async () => {
  const store = new FakeStore(), payload = await store.prepare();
  const started = await oauthHandler(startRequest(), deps(store));
  let exchanges = 0;
  const dependencies = deps(store, {
    exchange: () => {
      exchanges++;
      return Promise.resolve(session());
    },
  });
  const responses = await Promise.all([
    oauthHandler(
      callbackRequest(payload.transaction.state, browserCookie(started)),
      dependencies,
    ),
    oauthHandler(
      callbackRequest(payload.transaction.state, browserCookie(started)),
      dependencies,
    ),
  ]);
  assert.equal(exchanges, 1);
  assert.equal(store.created.length, 1);
  assert.equal(
    responses.filter((response) => fragment(response).has("provider_complete"))
      .length,
    1,
  );
  assert.equal(
    responses.filter((response) =>
      fragment(response).get("provider_error") === "provider_auth_required"
    ).length,
    1,
  );
});

Deno.test("OAuth callback fails closed for changed hosted registration/configuration before token requests", async () => {
  for (
    const chatgpt of [
      { ...CONFIG.chatgpt, approved: false },
      { ...CONFIG.chatgpt, planUsageApproved: false },
      { ...CONFIG.chatgpt, clientId: "foreign-client" },
      {
        ...CONFIG.chatgpt,
        redirectUri: "https://edge.example.invalid/other-callback",
      },
      {
        ...CONFIG.chatgpt,
        tokenEndpointAuthMethod: "client_secret_basic" as const,
      },
    ]
  ) {
    const store = new FakeStore(), payload = await store.prepare();
    const started = await oauthHandler(startRequest(), deps(store));
    let requests = 0;
    const response = await oauthHandler(
      callbackRequest(payload.transaction.state, browserCookie(started)),
      deps(store, {
        config: { ...CONFIG, chatgpt },
        exchange: (config, transaction, callback) =>
          exchangeChatGPTCode(config, transaction, callback, () => {
            requests++;
            return Promise.reject(
              new Error("Unexpected fixture token request"),
            );
          }, { nowSeconds: NOW }),
      }),
    );
    assert(fragment(response).has("provider_error"));
    assert.equal(requests, 0);
    assert.equal(store.created.length, 0);
    assert(!store.events.includes("save-credential"));
    await assertPrivateResponse(response);
  }
});

Deno.test("OAuth rejects expired or tampered authorization payloads and never redirects to a foreign authorization site", async () => {
  for (
    const scenario of [
      "expired-payload",
      "expired-store",
      "foreign-authorization",
      "state-mismatch",
    ] as const
  ) {
    const store = new FakeStore(), payload = await store.prepare();
    if (scenario === "expired-payload") payload.transaction.expiresAt = NOW - 1;
    if (scenario === "expired-store") store.now = NOW + 601;
    if (scenario === "foreign-authorization") {
      payload.authorizationUrl =
        `https://attacker.example.invalid/authorize?state=${payload.transaction.state}`;
    }
    if (scenario === "state-mismatch") {
      const url = new URL(payload.authorizationUrl);
      url.searchParams.set("state", "W".repeat(43));
      payload.authorizationUrl = url.href;
    }
    const response = await oauthHandler(startRequest(), deps(store));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(store.created.length, 0);
    await assertPrivateResponse(response);
  }
});

Deno.test("OAuth callback rejects a changed reconnect subject and sanitizes provider decline/upstream prose", async () => {
  for (const scenario of ["subject", "declined", "upstream"] as const) {
    const store = new FakeStore(), payload = await store.prepare();
    if (scenario === "subject") payload.subject = "original-subject";
    const started = await oauthHandler(startRequest(), deps(store));
    const response = await oauthHandler(
      callbackRequest(
        payload.transaction.state,
        browserCookie(started),
        scenario === "declined"
          ? {
            error: "access_denied",
            error_description: "fixture-upstream-secret-detail",
          }
          : {},
      ),
      deps(store, {
        exchange: (_config, _transaction, callback) => {
          if (scenario === "declined") {
            assert.equal(callback.error, "access_denied");
            return Promise.reject(
              new ProviderError("provider_permission_required", 403),
            );
          }
          if (scenario === "upstream") {
            return Promise.reject(new Error("fixture-upstream-secret-detail"));
          }
          return Promise.resolve(session());
        },
      }),
    );
    assert(fragment(response).has("provider_error"));
    assert.equal(store.created.length, 0);
    assert(!store.events.includes("save-credential"));
    await assertPrivateResponse(response);
  }
});

Deno.test("OAuth handler rejects unsupported methods/paths and malformed tickets before state operations", async () => {
  const store = new FakeStore();
  const method = await oauthHandler(
    new Request(CONFIG.oauthStart, { method: "POST" }),
    deps(store),
  );
  assert.equal(method.status, 405);
  const path = await oauthHandler(
    new Request(
      "https://edge.example.invalid/functions/v1/provider-oauth/unknown",
    ),
    deps(store),
  );
  assert.equal(path.status, 404);
  const ticket = await oauthHandler(startRequest("short"), deps(store));
  assert.equal(ticket.status, 401);
  assert.deepEqual(store.events, []);
  for (const response of [method, path, ticket]) {
    await assertPrivateResponse(response);
  }
});
