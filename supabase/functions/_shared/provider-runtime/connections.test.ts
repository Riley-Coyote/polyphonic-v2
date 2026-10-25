import assert from "node:assert/strict";
import {
  connectionAction,
  type ConnectionActions,
  type OAuthCompletion,
  type OAuthPayload,
} from "./connections.ts";
import { CHATGPT_ISSUER, type ChatGPTSession } from "./chatgpt-oauth.ts";
import { type ProviderConfiguration, providerConfiguration } from "./config.ts";
import { failure, requestJSON } from "./http.ts";
import { ProviderError } from "./types.ts";
import { type ConnectionMetadata, type StoredConnection } from "./vault.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TICKET = "T".repeat(43);
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
    accessToken: "fixture-private-access-token",
    refreshToken: "fixture-private-refresh-token",
    idToken: "fixture-private-id-token",
    grantedScopes: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: NOW + 3600,
    ...patch,
  };
}
function completion(patch: Partial<OAuthCompletion> = {}): OAuthCompletion {
  return {
    kind: "complete",
    connectionId: ID,
    version: 0,
    subject: null,
    label: "Personal ChatGPT",
    session: session(),
    ...patch,
  };
}
function connection(
  metadata: ConnectionMetadata,
  version: number,
): StoredConnection {
  return {
    connection: {
      ...metadata,
      user_id: USER,
      id: ID,
      created_at: new Date(NOW * 1000).toISOString(),
      updated_at: new Date(NOW * 1000).toISOString(),
    },
    encrypted_secret: "fixture-ciphertext",
    version,
    lease_id: null,
    lease_until: null,
  };
}
class FakeStore {
  record: StoredConnection | null = null;
  secret: unknown;
  events: string[] = [];
  created: {
    user: string;
    state: string;
    ticket: string;
    payload: unknown;
    expires: number;
  }[] = [];
  completions = new Map<
    string,
    { user: string; payload: unknown; expires: number }
  >();
  now = NOW;
  read(user: string, id: string): Promise<StoredConnection | null> {
    assert.equal(user, USER);
    assert.equal(id, ID);
    this.events.push("read");
    return Promise.resolve(structuredClone(this.record));
  }
  save(
    user: string,
    id: string,
    metadata: ConnectionMetadata,
    secret: unknown,
    version = 0,
  ): Promise<StoredConnection> {
    assert.equal(user, USER);
    assert.equal(id, ID);
    this.events.push("save-attempt");
    if (version !== (this.record?.version ?? 0)) {
      return Promise.reject(new ProviderError("provider_unavailable", 503));
    }
    this.record = connection(metadata, version + 1);
    this.secret = structuredClone(secret);
    this.events.push("saved");
    return Promise.resolve(structuredClone(this.record));
  }
  createOAuth(
    user: string,
    state: string,
    ticket: string,
    payload: unknown,
    expires: number,
  ): Promise<void> {
    this.events.push("create-oauth");
    this.created.push({
      user,
      state,
      ticket,
      payload: structuredClone(payload),
      expires,
    });
    return Promise.resolve();
  }
  completeOAuth(user: string, ticket: string): Promise<unknown | null> {
    this.events.push("finish-ticket");
    const found = this.completions.get(ticket);
    if (!found || found.user !== user || found.expires <= this.now) {
      return Promise.resolve(null);
    }
    this.completions.delete(ticket);
    return Promise.resolve(structuredClone(found.payload));
  }
  prepare(payload: unknown = completion(), user = USER): void {
    this.completions.set(TICKET, { user, payload, expires: NOW + 300 });
  }
  disconnect(): void {
    if (this.record) {
      this.record.version++;
      this.record.connection.status = "disabled";
      this.record.connection.expires_at = null;
      this.record.connection.granted_scopes = [];
      this.record.encrypted_secret = null;
    }
    this.secret = undefined;
  }
}
function deps(
  store = new FakeStore(),
  overrides: Partial<ConnectionActions> = {},
): ConnectionActions {
  return {
    store,
    config: CONFIG,
    broker: {
      listModels: () => Promise.reject(new Error("Unexpected model broker")),
      disconnect: () =>
        Promise.reject(new Error("Unexpected disconnect broker")),
    },
    list: () => Promise.resolve([]),
    fetcher: () =>
      Promise.reject(new Error("Unexpected fixture network request")),
    ...overrides,
  };
}
async function rejectsCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof ProviderError && error.code === code,
  );
}
function assertNoSecrets(value: unknown): void {
  const shown = JSON.stringify(value);
  for (
    const secret of [
      "fixture-private-access-token",
      "fixture-private-refresh-token",
      "fixture-private-id-token",
      "sk-ant-api03-fixture-private-key",
      "fixture-ciphertext",
      "fixture-openai-subject",
    ]
  ) assert(!shown.includes(secret), secret);
}

Deno.test("provider connection list publishes display metadata/capabilities without credentials or internal identity", async () => {
  const store = new FakeStore();
  store.prepare();
  await connectionAction(
    { action: "chatgpt_finish", ticket: TICKET },
    USER,
    deps(store),
  );
  const result = await connectionAction(
    { action: "list" },
    USER,
    deps(store, {
      list: (user) => {
        assert.equal(user, USER);
        return Promise.resolve([store.record!.connection]);
      },
    }),
  );
  assertNoSecrets(result);
  const data = result as {
    connections: Record<string, unknown>[];
    capabilities: unknown;
  };
  assert.deepEqual(Object.keys(data.connections[0]).sort(), [
    "created_at",
    "expires_at",
    "id",
    "label",
    "provider",
    "status",
  ]);
});

Deno.test("Anthropic connection validates API key/workspace and discovers actual models before saving", async () => {
  const store = new FakeStore();
  let requests = 0;
  const result = await connectionAction(
    {
      action: "save_anthropic",
      connection_id: ID,
      api_key: "sk-ant-api03-fixture-private-key",
      workspace_id: "wrkspc_fixture",
      label: "Personal Claude",
    },
    USER,
    deps(store, {
      fetcher: (url, options) => {
        requests++;
        store.events.push("discover-models");
        assert.equal(new URL(String(url)).origin, "https://api.anthropic.com");
        assert.equal(new URL(String(url)).pathname, "/v1/models");
        assert.equal(
          new Headers(options?.headers).get("anthropic-workspace-id"),
          "wrkspc_fixture",
        );
        return Promise.resolve(
          Response.json({
            data: [{
              type: "model",
              id: "claude-fixture",
              display_name: "Fixture Claude",
            }],
            has_more: false,
          }),
        );
      },
    }),
  );
  assert.equal(requests, 1);
  assert(
    store.events.indexOf("discover-models") < store.events.lastIndexOf("saved"),
  );
  assert.deepEqual(store.secret, {
    provider: "anthropic",
    apiKey: "sk-ant-api03-fixture-private-key",
    workspaceId: "wrkspc_fixture",
  });
  assertNoSecrets(result);
  assert.deepEqual(store.record!.connection.granted_scopes, []);
  assert.equal(store.record!.connection.workspace_id, "wrkspc_fixture");
});

Deno.test("Anthropic subscription tokens, malformed keys/workspaces and provider switches never reach model discovery/save", async () => {
  for (
    const body of [
      { api_key: "sk-ant-oat01-fixture-subscription-token" },
      { api_key: "sk-ant-api03-invalid\r\nheader" },
      { api_key: "short" },
      {
        api_key: "sk-ant-api03-fixture-private-key",
        workspace_id: "wrong workspace",
      },
    ]
  ) {
    const store = new FakeStore();
    await assert.rejects(
      () =>
        connectionAction(
          { action: "save_anthropic", connection_id: ID, ...body },
          USER,
          deps(store),
        ),
      ProviderError,
    );
    assert(!store.events.includes("save-attempt"));
  }
  const store = new FakeStore();
  store.prepare();
  await connectionAction(
    { action: "chatgpt_finish", ticket: TICKET },
    USER,
    deps(store),
  );
  const previous = structuredClone(store.record);
  await rejectsCode(
    () =>
      connectionAction(
        {
          action: "save_anthropic",
          connection_id: ID,
          api_key: "sk-ant-api03-fixture-private-key",
        },
        USER,
        deps(store),
      ),
    "provider_invalid_request",
  );
  assert.deepEqual(store.record, previous);
});

Deno.test("Anthropic upstream auth/catalog failures cannot persist a credential", async () => {
  for (
    const response of [
      Response.json({
        error: {
          type: "authentication_error",
          message: "fixture-private-access-token",
        },
      }, { status: 401 }),
      Response.json({ models: [] }),
    ]
  ) {
    const store = new FakeStore();
    await assert.rejects(
      () =>
        connectionAction(
          {
            action: "save_anthropic",
            connection_id: ID,
            api_key: "sk-ant-api03-fixture-private-key",
          },
          USER,
          deps(store, { fetcher: () => Promise.resolve(response) }),
        ),
      ProviderError,
    );
    assert.deepEqual(store.secret, { pending: true });
    assert.equal(store.record!.connection.status, "needs_reconnect");
    assert(
      !JSON.stringify(store.secret).includes(
        "sk-ant-api03-fixture-private-key",
      ),
    );
  }
});

Deno.test("ChatGPT start returns only an Edge start ticket while keeping verifier/nonce and previous version server-side", async () => {
  const store = new FakeStore();
  const result = await connectionAction(
    { action: "chatgpt_start", connection_id: ID, label: "Personal ChatGPT" },
    USER,
    deps(store),
  ) as { authorization_url: string };
  assert.equal(store.created.length, 1);
  const created = store.created[0], payload = created.payload as OAuthPayload;
  assert.equal(created.user, USER);
  assert.equal(payload.kind, "authorize");
  assert.equal(payload.connectionId, ID);
  assert.equal(created.state, payload.transaction.state);
  assert.equal(created.expires, payload.transaction.expiresAt);
  const url = new URL(result.authorization_url);
  assert.equal(url.origin, "https://edge.example.invalid");
  assert.equal(url.pathname, "/functions/v1/provider-oauth/start");
  assert.equal(url.searchParams.get("ticket"), created.ticket);
  assert.match(created.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert(!JSON.stringify(result).includes(payload.transaction.verifier));
  assert(!JSON.stringify(result).includes(payload.transaction.nonce));
  assertNoSecrets(result);
});

Deno.test("ChatGPT start refuses disabled hosted approval without creating an OAuth transaction", async () => {
  const store = new FakeStore();
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_start", connection_id: ID },
        USER,
        deps(store, {
          config: {
            ...CONFIG,
            chatgpt: { ...CONFIG.chatgpt, approved: false },
            chatgptAvailable: false,
          },
        }),
      ),
    "provider_access_pending",
  );
  assert.equal(store.created.length, 0);
  assert(!store.events.includes("saved"));
});

Deno.test("ChatGPT finish requires the original authenticated Supabase user and consumes a completion ticket exactly once", async () => {
  const store = new FakeStore();
  store.prepare();
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket: TICKET },
        OTHER,
        deps(store),
      ),
    "provider_auth_required",
  );
  assert(store.completions.has(TICKET));
  assert.equal(store.secret, undefined);
  const result = await connectionAction(
    { action: "chatgpt_finish", ticket: TICKET },
    USER,
    deps(store),
  );
  assert.equal(store.record!.connection.subject, "fixture-openai-subject");
  assert.equal(store.record!.connection.status, "connected");
  assertNoSecrets(result);
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket: TICKET },
        USER,
        deps(store),
      ),
    "provider_auth_required",
  );
  assert.equal(store.events.filter((event) => event === "saved").length, 1);
});

Deno.test("ChatGPT finish rejects expired, initial-stage, switched-client and switched-subject payloads", async () => {
  for (
    const payload of [
      { kind: "authorize" },
      completion({ session: session({ clientId: "foreign-client" }) }),
      completion({ subject: "original-subject" }),
    ]
  ) {
    const store = new FakeStore();
    store.prepare(payload);
    await rejectsCode(
      () =>
        connectionAction(
          { action: "chatgpt_finish", ticket: TICKET },
          USER,
          deps(store),
        ),
      "provider_auth_required",
    );
    assert.equal(store.secret, undefined);
  }
  const expired = new FakeStore();
  expired.prepare();
  expired.now = NOW + 301;
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket: TICKET },
        USER,
        deps(expired),
      ),
    "provider_auth_required",
  );
});

Deno.test("ChatGPT finish cannot bypass a deployment approval/configuration change after provider callback", async () => {
  for (
    const chatgpt of [{ ...CONFIG.chatgpt, approved: false }, {
      ...CONFIG.chatgpt,
      planUsageApproved: false,
    }, {
      ...CONFIG.chatgpt,
      tokenEndpointAuthMethod: "client_secret_basic" as const,
    }]
  ) {
    const store = new FakeStore();
    store.prepare();
    await assert.rejects(
      () =>
        connectionAction(
          { action: "chatgpt_finish", ticket: TICKET },
          USER,
          deps(store, {
            config: { ...CONFIG, chatgpt, chatgptAvailable: false },
          }),
        ),
      ProviderError,
    );
    assert.equal(store.secret, undefined);
    assert(!store.events.includes("saved"));
  }
});

Deno.test("ChatGPT finish honors disconnect and concurrent reconnect CAS versions", async () => {
  const store = new FakeStore();
  store.prepare();
  await connectionAction(
    { action: "chatgpt_finish", ticket: TICKET },
    USER,
    deps(store),
  );
  store.prepare(
    completion({
      version: store.record!.version,
      subject: store.record!.connection.subject,
    }),
  );
  store.disconnect();
  const previous = structuredClone(store.record);
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket: TICKET },
        USER,
        deps(store),
      ),
    "provider_unavailable",
  );
  assert.equal(store.secret, undefined);
  assert.deepEqual(store.record, previous);
});

Deno.test("ChatGPT identity-only finish saves display identity without claiming model permission", async () => {
  const store = new FakeStore();
  store.prepare(
    completion({
      session: session({ accessToken: "", grantedScopes: ["openid", "email"] }),
    }),
  );
  const result = await connectionAction(
    { action: "chatgpt_finish", ticket: TICKET },
    USER,
    deps(store),
  );
  assert.equal(store.record!.connection.status, "identity_only");
  assertNoSecrets(result);
});

Deno.test("new pending ChatGPT and Anthropic connections cannot resurrect after disconnect", async () => {
  const store = new FakeStore();
  await connectionAction(
    { action: "chatgpt_start", connection_id: ID },
    USER,
    deps(store),
  );
  const payload = store.created[0].payload as OAuthPayload;
  assert.equal(store.record!.connection.status, "needs_reconnect");
  assert.equal(payload.version, store.record!.version);
  store.disconnect();
  store.prepare(completion({ version: payload.version }));
  await rejectsCode(
    () =>
      connectionAction(
        { action: "chatgpt_finish", ticket: TICKET },
        USER,
        deps(store),
      ),
    "provider_unavailable",
  );
  assert.equal(store.record!.connection.status, "disabled");
  assert.equal(store.secret, undefined);
  const anthropic = new FakeStore();
  await rejectsCode(
    () =>
      connectionAction(
        {
          action: "save_anthropic",
          connection_id: ID,
          api_key: "sk-ant-api03-fixture-private-key",
        },
        USER,
        deps(anthropic, {
          fetcher: () => {
            anthropic.disconnect();
            return Promise.resolve(
              Response.json({
                data: [{ type: "model", id: "claude-fixture" }],
                has_more: false,
              }),
            );
          },
        }),
      ),
    "provider_unavailable",
  );
  assert.equal(anthropic.record!.connection.status, "disabled");
  assert.equal(anthropic.secret, undefined);
});

Deno.test("provider HTTP request parsing enforces streamed byte limits, UTF-8 and JSON-object shape", async () => {
  const request = (
    body: string | Uint8Array<ArrayBuffer>,
    contentType = "application/json",
  ) =>
    new Request("https://edge.example.invalid/route", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  assert.deepEqual(await requestJSON(request('{"action":"list"}')), {
    action: "list",
  });
  for (const body of ["[]", "null", "{", new Uint8Array([0xff])]) {
    await rejectsCode(
      () => requestJSON(request(body)),
      "provider_invalid_request",
    );
  }
  await rejectsCode(
    () => requestJSON(request(" ".repeat(70_001))),
    "provider_too_large",
  );
  await rejectsCode(
    () => requestJSON(request("{}", "text/plain")),
    "provider_invalid_request",
  );
  const response = failure(new Error("fixture-private-access-token"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assertNoSecrets(await response.json());
});

Deno.test("provider configuration binds the exact Edge callback and constrains settings redirects", () => {
  const env = (values: Record<string, string | undefined>) => (name: string) =>
    values[name];
  const base = {
    SUPABASE_URL: "https://edge.example.invalid",
    ENVIRONMENT: "production",
  };
  assert.equal(providerConfiguration(env(base)).chatgptAvailable, false);
  for (
    const values of [
      {
        PROVIDER_OAUTH_REDIRECT_URI:
          "https://attacker.example.invalid/callback",
      },
      { PROVIDER_SETTINGS_URL: "https://attacker.example.invalid/settings" },
      {
        PROVIDER_SETTINGS_URL: "https://polyphonic.chat/settings?next=attacker",
      },
      { PROVIDER_SETTINGS_URL: "http://localhost:3000/settings" },
    ]
  ) {
    assert.throws(
      () => providerConfiguration(env({ ...base, ...values })),
      ProviderError,
    );
  }
});
