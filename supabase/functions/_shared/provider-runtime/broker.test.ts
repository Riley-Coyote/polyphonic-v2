// deno-lint-ignore-file require-await
// Fixture stubs intentionally satisfy async provider contracts without real I/O.
import assert from "node:assert/strict";
import {
  metadataForChatGPTSession,
  ProviderBroker,
  type ProviderBrokerOptions,
  type ProviderCredentialStore,
  streamWithCredential,
} from "./broker.ts";
import {
  CHATGPT_ISSUER,
  type ChatGPTHostedConfig,
  type ChatGPTSession,
} from "./chatgpt-oauth.ts";
import { ProviderError, type ProviderEvent } from "./types.ts";
import { type ConnectionMetadata, type StoredConnection } from "./vault.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const LEASE = "33333333-3333-4333-8333-333333333333";
const NOW = Math.floor(Date.now() / 1000);
const CONFIG: ChatGPTHostedConfig = {
  approved: true,
  planUsageApproved: true,
  clientId: "oaiapp_fixture",
  redirectUri: "https://polyphonic.example.invalid/callback",
  tokenEndpointAuthMethod: "none",
};
function session(patch: Partial<ChatGPTSession> = {}): ChatGPTSession {
  return {
    provider: "chatgpt",
    issuer: CHATGPT_ISSUER,
    clientId: CONFIG.clientId,
    subject: "fixture-subject",
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    grantedScopes: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: NOW + 3600,
    ...patch,
  };
}
function row(metadata: ConnectionMetadata, version = 1): StoredConnection {
  return {
    connection: {
      id: ID,
      user_id: USER,
      created_at: new Date(NOW * 1000).toISOString(),
      updated_at: new Date(NOW * 1000).toISOString(),
      ...metadata,
    },
    version,
    encrypted_secret: `fixture-ciphertext-${version}`,
    lease_id: null,
    lease_until: null,
  };
}
class FixtureStore implements ProviderCredentialStore {
  record: StoredConnection | null;
  secret: unknown;
  events: string[] = [];
  busy = false;
  readError = false;
  decryptError = false;
  afterSave?: () => void;
  saveFailure: "before" | "after" | undefined;
  constructor(
    secret: unknown = session(),
    metadata = metadataForChatGPTSession(
      secret as ChatGPTSession,
      "Fixture account",
    ),
  ) {
    this.secret = secret;
    this.record = row(metadata);
  }
  async read(user: string, id: string): Promise<StoredConnection | null> {
    this.events.push("read");
    assert.equal(user, USER);
    assert.equal(id, ID);
    if (this.readError) throw new ProviderError("provider_unavailable", 503);
    return structuredClone(this.record);
  }
  async credential(record: StoredConnection): Promise<unknown> {
    this.events.push("credential");
    assert.equal(record.connection.id, ID);
    if (this.decryptError) {
      throw new ProviderError("provider_configuration_required", 503);
    }
    return structuredClone(this.secret);
  }
  async lease(
    user: string,
    id: string,
    version: number,
    leaseId: string,
  ): Promise<StoredConnection | null> {
    this.events.push("lease");
    assert.equal(user, USER);
    assert.equal(id, ID);
    assert.equal(leaseId, LEASE);
    if (
      this.busy || !this.record || this.record.version !== version ||
      this.record.lease_id || this.record.connection.status !== "connected"
    ) return null;
    this.record.lease_id = leaseId;
    this.record.lease_until = new Date((NOW + 45) * 1000).toISOString();
    return structuredClone(this.record);
  }
  async save(
    user: string,
    id: string,
    metadata: ConnectionMetadata,
    secret: unknown,
    version = 0,
    leaseId?: string,
  ): Promise<StoredConnection> {
    this.events.push("save");
    assert.equal(user, USER);
    assert.equal(id, ID);
    assert.equal(leaseId, LEASE);
    if (
      this.saveFailure === "before" || !this.record ||
      this.record.connection.status === "disabled" ||
      this.record.version !== version || this.record.lease_id !== leaseId
    ) throw new ProviderError("provider_unavailable", 503);
    this.record = row(metadata, version + 1);
    this.secret = structuredClone(secret);
    this.afterSave?.();
    if (this.saveFailure === "after") {
      throw new ProviderError("provider_unavailable", 503);
    }
    return structuredClone(this.record);
  }
  async invalidate(record: StoredConnection): Promise<void> {
    this.events.push("invalidate");
    if (this.record?.version === record.version) {
      this.record.connection.status = "needs_reconnect";
      this.record.lease_id = null;
      this.record.lease_until = null;
    }
  }
  async disconnect(user: string, id: string): Promise<void> {
    this.events.push("disconnect");
    assert.equal(user, USER);
    assert.equal(id, ID);
    if (this.record) {
      this.record.connection.status = "disabled";
      this.record.connection.expires_at = null;
      this.record.connection.granted_scopes = [];
      this.record.encrypted_secret = null;
      this.record.version++;
      this.record.lease_id = null;
      this.record.lease_until = null;
    }
    this.secret = undefined;
  }
}
function broker(
  store: FixtureStore,
  options: ProviderBrokerOptions = {},
): ProviderBroker {
  return new ProviderBroker(store, {
    chatgptConfig: CONFIG,
    nowSeconds: () => NOW,
    leaseId: () => LEASE,
    fetcher: () =>
      Promise.reject(new Error("Unexpected fixture network request")),
    wait: () => Promise.resolve(),
    ...options,
  });
}
function refreshResponse(scope?: string): Response {
  return Response.json({
    access_token: "replacement-access",
    refresh_token: "replacement-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    ...(scope === undefined ? {} : { scope }),
  });
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
function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
function responseWire(): Response {
  return new Response(
    sse({ type: "response.output_text.delta", delta: "Fixture reply" }) +
      sse({
        type: "response.completed",
        response: { id: "resp_fixture", status: "completed" },
      }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

Deno.test("provider broker returns scoped Anthropic credentials without needing ChatGPT deployment configuration", async () => {
  const key = {
    provider: "anthropic",
    apiKey: "fixture-api-key",
    workspaceId: "wrkspc_fixture",
  };
  const store = new FixtureStore(key, {
    provider: "anthropic",
    label: "Console key",
    subject: null,
    workspace_id: key.workspaceId,
    status: "connected",
    granted_scopes: [],
    expires_at: null,
  });
  const usable = await new ProviderBroker(store).usableCredential(USER, ID);
  assert.deepEqual(usable.credential, key);
  assert.equal(store.events.includes("lease"), false);
  store.record!.connection.workspace_id = "wrkspc_other";
  await rejectsCode(
    () => new ProviderBroker(store).usableCredential(USER, ID),
    "provider_permission_required",
  );
});

Deno.test("provider broker checks deployment approval and exact encrypted identity/client/grant/expiry bindings", async () => {
  for (
    const change of [
      (store: FixtureStore) => {
        (store.secret as ChatGPTSession).clientId = "foreign-client";
      },
      (store: FixtureStore) => {
        (store.secret as ChatGPTSession).subject = "foreign-subject";
      },
      (store: FixtureStore) => {
        (store.secret as ChatGPTSession).grantedScopes = ["openid"];
      },
      (store: FixtureStore) => {
        store.record!.connection.expires_at = new Date((NOW + 999) * 1000)
          .toISOString();
      },
      (store: FixtureStore) => {
        store.record!.connection.user_id =
          "44444444-4444-4444-8444-444444444444";
      },
    ]
  ) {
    const store = new FixtureStore();
    change(store);
    await rejectsCode(
      () => broker(store).usableCredential(USER, ID),
      "provider_permission_required",
    );
    assert(!store.events.includes("invalidate"));
  }
  await rejectsCode(
    () =>
      broker(new FixtureStore(), {
        chatgptConfig: { ...CONFIG, planUsageApproved: false },
      }).usableCredential(USER, ID),
    "provider_access_pending",
  );
  await rejectsCode(
    () =>
      broker(new FixtureStore(), { chatgptConfig: undefined }).usableCredential(
        USER,
        ID,
      ),
    "provider_configuration_required",
  );
});

Deno.test("provider broker rejects malformed credentials and identity-only/disabled connections before provider traffic", async () => {
  const corrupt = new FixtureStore();
  (corrupt.secret as ChatGPTSession).accessToken = "invalid\r\nheader";
  await rejectsCode(
    () => broker(corrupt).usableCredential(USER, ID),
    "provider_configuration_required",
  );
  const identity = session({
    accessToken: "",
    grantedScopes: ["openid", "email"],
  });
  const store = new FixtureStore(identity);
  assert.equal(store.record!.connection.status, "identity_only");
  await rejectsCode(
    () => broker(store).usableCredential(USER, ID),
    "provider_permission_required",
  );
  store.record!.connection.status = "disabled";
  await rejectsCode(
    () => broker(store).usableCredential(USER, ID),
    "provider_auth_required",
  );
  assert(!store.events.includes("invalidate"));
});

Deno.test("provider broker refreshes at the 60-second boundary with one durable UUID lease and CAS save", async () => {
  const store = new FixtureStore(session({ expiresAt: NOW + 60 }));
  let calls = 0;
  const usable = await broker(store, {
    fetcher: (url, init) => {
      calls++;
      assert.equal(String(url), `${CHATGPT_ISSUER}/api/accounts/oauth/token`);
      assert.equal(
        new URLSearchParams(String(init?.body)).get("grant_type"),
        "refresh_token",
      );
      assert.equal(store.record!.lease_id, LEASE);
      assert.equal(Date.parse(store.record!.lease_until!) / 1000, NOW + 45);
      return Promise.resolve(refreshResponse());
    },
  }).usableCredential(USER, ID);
  assert.equal(calls, 1);
  assert.equal(usable.credential.provider, "chatgpt");
  assert.equal(
    (usable.credential as ChatGPTSession).accessToken,
    "replacement-access",
  );
  assert.equal(usable.record.version, 2);
  assert.equal(usable.record.lease_id, null);
  assert.equal(store.events.filter((event) => event === "save").length, 1);
});

Deno.test("provider broker bounded busy polling reloads the winning refresh without another token exchange", async () => {
  const store = new FixtureStore(session({ expiresAt: NOW + 10 }));
  store.busy = true;
  let waits = 0;
  const usable = await broker(store, {
    wait: () => {
      waits++;
      store.secret = session({ accessToken: "other-request-access" });
      store.record = row(
        metadataForChatGPTSession(store.secret as ChatGPTSession, "Fixture"),
        2,
      );
      return Promise.resolve();
    },
  }).usableCredential(USER, ID);
  assert.equal(waits, 1);
  assert.equal(
    (usable.credential as ChatGPTSession).accessToken,
    "other-request-access",
  );
  const busy = new FixtureStore(session({ expiresAt: NOW + 10 }));
  busy.busy = true;
  let boundedWaits = 0;
  await rejectsCode(() =>
    broker(busy, {
      wait: () => {
        boundedWaits++;
        return Promise.resolve();
      },
    }).usableCredential(USER, ID), "provider_unavailable");
  assert.equal(boundedWaits, 16);
  assert.equal(busy.events.filter((event) => event === "lease").length, 17);
  assert(!busy.events.includes("invalidate"));
});

Deno.test("parallel broker requests serialize a rotating refresh through the database lease", async () => {
  const store = new FixtureStore(session({ expiresAt: NOW + 10 }));
  let calls = 0;
  let finishSave!: () => void;
  const saved = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  store.afterSave = finishSave;
  const shared = broker(store, {
    fetcher: () => {
      calls++;
      return Promise.resolve(refreshResponse());
    },
    wait: () => saved,
  });
  const [first, second] = await Promise.all([
    shared.usableCredential(USER, ID),
    shared.usableCredential(USER, ID),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.record.version, 2);
  assert.equal(second.record.version, 2);
});

Deno.test("provider broker never repeats a refresh after an uncertain CAS result or resurrects a disconnect", async () => {
  const uncertain = new FixtureStore(session({ expiresAt: NOW + 10 }));
  uncertain.saveFailure = "after";
  let calls = 0;
  const usable = await broker(uncertain, {
    fetcher: () => {
      calls++;
      return Promise.resolve(refreshResponse());
    },
  }).usableCredential(USER, ID);
  assert.equal(usable.record.version, 2);
  assert.equal(calls, 1);
  const disconnected = new FixtureStore(session({ expiresAt: NOW + 10 }));
  await rejectsCode(() =>
    broker(disconnected, {
      fetcher: async () => {
        await disconnected.disconnect(USER, ID);
        return refreshResponse();
      },
    }).usableCredential(USER, ID), "provider_auth_required");
  assert.equal(disconnected.record!.connection.status, "disabled");
  assert.equal(disconnected.secret, undefined);
  assert(!disconnected.events.includes("invalidate"));
});

Deno.test("provider broker invalidates definitive refresh authentication failure and retains transient/permission failures", async () => {
  for (
    const [response, code, invalidates] of [
      [
        Response.json({
          error: "invalid_grant",
          error_description: "private fixture secret",
        }, { status: 400 }),
        "provider_auth_required",
        1,
      ],
      [
        Response.json({ error: "temporary_unavailable" }, { status: 503 }),
        "provider_unavailable",
        0,
      ],
      [
        Response.json({ error: "access_denied" }, { status: 403 }),
        "provider_permission_required",
        0,
      ],
      [
        Response.json({ error: "invalid_client" }, { status: 401 }),
        "provider_configuration_required",
        0,
      ],
    ] as const
  ) {
    const store = new FixtureStore(session({ expiresAt: NOW + 10 }));
    let calls = 0;
    await rejectsCode(() =>
      broker(store, {
        fetcher: () => {
          calls++;
          return Promise.resolve(response);
        },
      }).usableCredential(USER, ID), code);
    assert.equal(calls, 1);
    assert.equal(
      store.events.filter((event) => event === "invalidate").length,
      invalidates,
    );
  }
});

Deno.test("provider broker saves reduced refresh permission but cannot dispatch it", async () => {
  const store = new FixtureStore(session({ expiresAt: NOW + 10 }));
  await rejectsCode(
    () =>
      broker(store, {
        fetcher: () => Promise.resolve(refreshResponse("openid email")),
      }).usableCredential(USER, ID),
    "provider_permission_required",
  );
  assert.equal(store.record!.connection.status, "identity_only");
  assert(!store.events.includes("invalidate"));
});

Deno.test("provider broker preserves a session when refreshed ID verification cannot reach OpenAI keys", async () => {
  const store = new FixtureStore(session({ expiresAt: NOW + 10 }));
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", "");
  const jwt = `${encode({ alg: "RS256", kid: "fixture" })}.${
    encode({
      iss: CHATGPT_ISSUER,
      aud: CONFIG.clientId,
      sub: "fixture-subject",
      iat: NOW,
      exp: NOW + 3600,
    })
  }.AQ`;
  await rejectsCode(
    () =>
      broker(store, {
        fetcher: (url) =>
          Promise.resolve(
            String(url).endsWith("/oauth/token")
              ? Response.json({
                access_token: "replacement-access",
                token_type: "Bearer",
                expires_in: 3600,
                id_token: jwt,
              })
              : Response.json({}, { status: 503 }),
          ),
      }).usableCredential(USER, ID),
    "provider_unavailable",
  );
  assert(!store.events.includes("invalidate"));
  assert(!store.events.includes("save"));
});

Deno.test("provider broker dispatches model discovery and streaming once and invalidates only provider authentication errors", async () => {
  const store = new FixtureStore();
  let calls = 0;
  const runtime = broker(store, {
    fetcher: (url) => {
      calls++;
      return Promise.resolve(
        String(url).endsWith("/models")
          ? Response.json({
            models: [{
              slug: "fixture",
              display_name: "Fixture",
              visibility: "list",
            }],
          })
          : responseWire(),
      );
    },
  });
  assert.deepEqual(await runtime.listModels(USER, ID), [{
    id: "fixture",
    name: "Fixture",
  }]);
  const events: ProviderEvent[] = [];
  for await (
    const event of runtime.stream(USER, ID, {
      model: "fixture",
      messages: [{ role: "user", content: "Hello" }],
    })
  ) events.push(event);
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.type, "completed");
  for (
    const [status, code, invalidates] of [
      [401, "provider_auth_required", 1],
      [403, "provider_permission_required", 0],
      [429, "provider_rate_limited", 0],
      [503, "provider_unavailable", 0],
    ] as const
  ) {
    const failed = new FixtureStore();
    let requests = 0;
    await rejectsCode(() =>
      broker(failed, {
        fetcher: () => {
          requests++;
          return Promise.resolve(Response.json({}, { status }));
        },
      }).listModels(USER, ID), code);
    assert.equal(requests, 1);
    assert.equal(
      failed.events.filter((event) => event === "invalidate").length,
      invalidates,
    );
  }
});

Deno.test("pure provider stream dispatch does not need another credential lookup or infer billing fallback", async () => {
  let requests = 0;
  const events: ProviderEvent[] = [];
  for await (
    const event of streamWithCredential(
      { model: "fixture", messages: [{ role: "user", content: "Hello" }] },
      session(),
      () => {
        requests++;
        return Promise.resolve(responseWire());
      },
    )
  ) events.push(event);
  assert.equal(requests, 1);
  assert.equal(events[0].type, "text");
});

Deno.test("provider disconnect purges before remote revocation and confirms only upstream success", async () => {
  const store = new FixtureStore();
  let calls = 0;
  const result = await broker(store, {
    fetcher: (url, init) => {
      calls++;
      assert.equal(store.record!.connection.status, "disabled");
      assert.equal(store.secret, undefined);
      if (calls === 1) {
        return Promise.resolve(
          Response.json({
            issuer: CHATGPT_ISSUER,
            revocation_endpoint: `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`,
          }),
        );
      }
      assert.equal(String(url), `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`);
      assert.equal(
        new URLSearchParams(String(init?.body)).get("token"),
        "fixture-refresh",
      );
      return Promise.resolve(new Response(null, { status: 200 }));
    },
  }).disconnect(USER, ID);
  assert.deepEqual(result, { revocation: "confirmed" });
  assert.equal(calls, 2);
});

Deno.test("provider disconnect purges even when capture fails, remote cleanup fails or upstream ignores cancellation", async () => {
  for (const setup of ["decrypt", "read", "remote", "hung"] as const) {
    const store = new FixtureStore();
    if (setup === "decrypt") store.decryptError = true;
    if (setup === "read") store.readError = true;
    const result = await broker(store, {
      revokeTimeoutMs: 5,
      fetcher: setup === "hung"
        ? () => new Promise<Response>(() => {})
        : () => Promise.reject(new Error("private upstream fixture failure")),
    }).disconnect(USER, ID);
    assert.deepEqual(result, { revocation: "unconfirmed" });
    assert.equal(store.record!.connection.status, "disabled");
    assert.equal(store.secret, undefined);
  }
});
