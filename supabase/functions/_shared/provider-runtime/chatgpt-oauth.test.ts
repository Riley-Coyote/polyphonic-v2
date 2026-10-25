// deno-lint-ignore-file require-await no-import-prefix
// Fixture stubs intentionally satisfy async provider contracts without real I/O.
import assert from "node:assert/strict";
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "npm:jose@6.1.3";
import {
  beginChatGPTOAuth,
  CHATGPT_ISSUER,
  type ChatGPTHostedConfig,
  type ChatGPTOAuthTransaction,
  type ChatGPTSession,
  exchangeChatGPTCode,
  refreshChatGPTSession,
  revokeChatGPTSession,
} from "./chatgpt-oauth.ts";
import { ProviderError, type ProviderFetch } from "./types.ts";

const now = 1_800_000_000;
const keys = await generateKeyPair("RS256");
const jwks: JWTVerifyGetKey = async () => keys.publicKey;
const scopes =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
function config(patch: Partial<ChatGPTHostedConfig> = {}): ChatGPTHostedConfig {
  return {
    approved: true,
    planUsageApproved: true,
    clientId: "oaiapp_fixture",
    redirectUri: "https://polyphonic.example.invalid/auth/callback",
    tokenEndpointAuthMethod: "none",
    ...patch,
  };
}
async function idToken(
  tx?: ChatGPTOAuthTransaction,
  patch: Record<string, unknown> = {},
): Promise<string> {
  return await new SignJWT({
    nonce: tx?.nonce,
    email: "fixture@example.invalid",
    name: "Fixture",
    ...patch,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(
      CHATGPT_ISSUER,
    ).setAudience("oaiapp_fixture")
    .setSubject("fixture-subject").setIssuedAt(now).setExpirationTime(
      now + 3600,
    ).sign(keys.privateKey);
}
async function rawToken(
  tx?: ChatGPTOAuthTransaction,
): Promise<Record<string, unknown>> {
  return {
    access_token: "fixture-access",
    refresh_token: "fixture-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    scope: scopes,
    id_token: await idToken(tx),
  };
}
async function session(): Promise<ChatGPTSession> {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  return await exchangeChatGPTCode(
    config(),
    transaction,
    { state: transaction.state, code: "fixture-code" },
    async () => Response.json(await rawToken(transaction)),
    { nowSeconds: now, jwks },
  );
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

Deno.test("hosted ChatGPT OAuth fails closed without explicit hosted and plan approval", async () => {
  await rejectsCode(
    () => beginChatGPTOAuth(config({ approved: false }), now),
    "provider_access_pending",
  );
  await rejectsCode(
    () => beginChatGPTOAuth(config({ planUsageApproved: false }), now),
    "provider_access_pending",
  );
});

Deno.test("hosted ChatGPT config rejects OSS registration and unregistered/insecure callback shapes", async () => {
  for (
    const patch of [
      { clientId: "dynamic_agent_client" },
      { redirectUri: "http://127.0.0.1:1455/auth/callback" },
      {
        redirectUri:
          "https://user:password@polyphonic.example.invalid/callback",
      },
      { redirectUri: "https://polyphonic.example.invalid/callback#fragment" },
      { redirectUri: "https://polyphonic.example.invalid/callback?next=bad" },
      { clientSecret: "not-public-client-auth" },
      { tokenEndpointAuthMethod: "client_secret_basic" as const },
    ]
  ) {
    await rejectsCode(
      () => beginChatGPTOAuth(config(patch), now),
      "provider_configuration_required",
    );
  }
});

Deno.test("hosted ChatGPT start creates unique state/nonce/S256 PKCE and a static client authorization", async () => {
  const first = await beginChatGPTOAuth(config(), now),
    second = await beginChatGPTOAuth(config(), now);
  const url = new URL(first.authorizationUrl);
  assert.equal(url.origin, CHATGPT_ISSUER);
  assert.equal(url.pathname, "/api/accounts/authorize");
  assert.equal(url.searchParams.get("client_id"), config().clientId);
  assert.equal(url.searchParams.get("redirect_uri"), config().redirectUri);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), scopes);
  assert.equal(url.searchParams.has("ext_agent_host_id"), false);
  assert.notEqual(first.transaction.state, second.transaction.state);
  assert.notEqual(first.transaction.nonce, second.transaction.nonce);
  assert.equal(first.transaction.expiresAt - first.transaction.createdAt, 600);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(first.transaction.verifier),
    ),
  );
  const expected = btoa(String.fromCharCode(...digest)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
  assert.equal(first.transaction.challenge, expected);
  assert.equal(url.searchParams.get("code_challenge"), expected);
});

Deno.test("hosted ChatGPT code exchange validates ID signature, identity, scope and exact callback/verifier", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  const profile = await exchangeChatGPTCode(config(), transaction, {
    state: transaction.state,
    code: "fixture-code",
    clientId: "oaiapp_fixture",
    issuer: CHATGPT_ISSUER,
  }, async (url, init) => {
    assert.equal(
      String(url),
      "https://auth.openai.com/api/accounts/oauth/token",
    );
    assert.equal(init?.redirect, "error");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("code"), "fixture-code");
    assert.equal(body.get("code_verifier"), transaction.verifier);
    assert.equal(body.get("redirect_uri"), transaction.redirectUri);
    assert.equal(body.get("client_id"), config().clientId);
    assert.equal(body.has("client_secret"), false);
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json(await rawToken(transaction));
  }, { nowSeconds: now, jwks });
  assert.equal(profile.subject, "fixture-subject");
  assert.equal(profile.clientId, "oaiapp_fixture");
  assert.equal(profile.email, "fixture@example.invalid");
  assert.equal(profile.expiresAt, now + 3600);
  assert(profile.grantedScopes.includes("chatgpt.tokens.use.direct"));
  assert.equal(profile.refreshToken, "fixture-refresh");
});

Deno.test("hosted confidential ChatGPT uses its provisioned Basic auth without body secret", async () => {
  const settings = config({
    tokenEndpointAuthMethod: "client_secret_basic",
    clientSecret: "fixture:secret+?",
  });
  const { transaction } = await beginChatGPTOAuth(settings, now);
  await exchangeChatGPTCode(settings, transaction, {
    state: transaction.state,
    code: "fixture-code",
  }, async (_url, init) => {
    const encode = (v: string) =>
      new URLSearchParams({ value: v }).toString().slice(6);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Basic ${
        btoa(`${encode(settings.clientId)}:${encode(settings.clientSecret!)}`)
      }`,
    );
    assert.equal(
      new URLSearchParams(String(init?.body)).has("client_secret"),
      false,
    );
    return Response.json(await rawToken(transaction));
  }, { nowSeconds: now, jwks });
});

Deno.test("hosted ChatGPT callback rejects stale, swapped and declined transactions before token traffic", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  let calls = 0;
  const fetcher: ProviderFetch = async () => {
    calls++;
    return Response.json({});
  };
  for (
    const callback of [{ state: "wrong-state", code: "code" }, {
      state: transaction.state,
      code: "code",
      clientId: "another-client",
    }, {
      state: transaction.state,
      code: "code",
      issuer: "https://other.example.invalid",
    }, { state: transaction.state }]
  ) {
    await rejectsCode(
      () =>
        exchangeChatGPTCode(config(), transaction, callback, fetcher, {
          nowSeconds: now,
          jwks,
        }),
      "provider_auth_required",
    );
  }
  await rejectsCode(
    () =>
      exchangeChatGPTCode(
        config(),
        { ...transaction, expiresAt: now },
        { state: transaction.state, code: "code" },
        fetcher,
        { nowSeconds: now, jwks },
      ),
    "provider_auth_required",
  );
  await rejectsCode(
    () =>
      exchangeChatGPTCode(
        config(),
        { ...transaction, verifier: "wrong".repeat(12) },
        { state: transaction.state, code: "code" },
        fetcher,
        { nowSeconds: now, jwks },
      ),
    "provider_auth_required",
  );
  await rejectsCode(
    () =>
      exchangeChatGPTCode(
        config(),
        transaction,
        { state: transaction.state, error: "access_denied" },
        fetcher,
        { nowSeconds: now, jwks },
      ),
    "provider_permission_required",
  );
  assert.equal(calls, 0);
});

Deno.test("hosted ChatGPT rejects forged, wrong-audience, wrong-nonce and expired ID tokens", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  const valid = await idToken(transaction);
  const parts = valid.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  const badTokens = [
    parts.join("."),
    await idToken(transaction, { nonce: "another-nonce" }),
    await new SignJWT({ nonce: transaction.nonce }).setProtectedHeader({
      alg: "RS256",
    }).setIssuer(CHATGPT_ISSUER).setAudience("another-client").setSubject(
      "fixture-subject",
    ).setIssuedAt(now).setExpirationTime(now + 3600).sign(keys.privateKey),
    await new SignJWT({ nonce: transaction.nonce }).setProtectedHeader({
      alg: "RS256",
    }).setIssuer(CHATGPT_ISSUER).setAudience(config().clientId).setSubject(
      "fixture-subject",
    ).setIssuedAt(now - 3600).setExpirationTime(now - 100).sign(
      keys.privateKey,
    ),
  ];
  for (const token of badTokens) {
    await rejectsCode(
      () =>
        exchangeChatGPTCode(
          config(),
          transaction,
          { state: transaction.state, code: "code" },
          async () =>
            Response.json({
              ...(await rawToken(transaction)),
              id_token: token,
            }),
          { nowSeconds: now, jwks },
        ),
      "provider_auth_required",
    );
  }
});

Deno.test("identity-only ChatGPT consent retains verified identity but grants no plan permission", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  const profile = await exchangeChatGPTCode(
    config(),
    transaction,
    { state: transaction.state, code: "code" },
    async () =>
      Response.json({
        id_token: await idToken(transaction),
        scope: "openid profile email",
      }),
    { nowSeconds: now, jwks },
  );
  assert.equal(profile.subject, "fixture-subject");
  assert.equal(profile.accessToken, "");
  assert.equal(
    profile.grantedScopes.includes("chatgpt.tokens.use.direct"),
    false,
  );
});

Deno.test("ChatGPT key-service outages do not become definitive identity failures", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  await rejectsCode(
    () =>
      exchangeChatGPTCode(config(), transaction, {
        state: transaction.state,
        code: "fixture-code",
      }, async () =>
        Response.json(await rawToken(transaction)), {
        nowSeconds: now,
        jwks: () =>
          Promise.reject(new Error("private fixture key-service detail")),
      }),
    "provider_unavailable",
  );
});

Deno.test("hosted ChatGPT binds multi-audience ID tokens to the authorized party", async () => {
  const { transaction } = await beginChatGPTOAuth(config(), now);
  for (const azp of [undefined, "another-client"]) {
    const token = await new SignJWT({ nonce: transaction.nonce, azp })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(CHATGPT_ISSUER).setAudience([
        config().clientId,
        "another-client",
      ]).setSubject("fixture-subject")
      .setIssuedAt(now).setExpirationTime(now + 3600).sign(keys.privateKey);
    await rejectsCode(
      () =>
        exchangeChatGPTCode(
          config(),
          transaction,
          { state: transaction.state, code: "fixture-code" },
          async () =>
            Response.json({
              ...(await rawToken(transaction)),
              id_token: token,
            }),
          { nowSeconds: now, jwks },
        ),
      "provider_auth_required",
    );
  }
});

Deno.test("ChatGPT refresh rotates atomically returned credentials and preserves absent ID/scopes", async () => {
  const previous = await session(), snapshot = structuredClone(previous);
  const refreshed = await refreshChatGPTSession(
    config(),
    previous,
    async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("client_id"), previous.clientId);
      assert.equal(body.get("refresh_token"), previous.refreshToken!);
      assert.equal(body.has("scope"), false);
      return Response.json({
        access_token: "replacement-access",
        refresh_token: "replacement-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    },
    { nowSeconds: now + 1800, jwks },
  );
  assert.equal(refreshed.accessToken, "replacement-access");
  assert.equal(refreshed.refreshToken, "replacement-refresh");
  assert.equal(refreshed.subject, previous.subject);
  assert.deepEqual(refreshed.grantedScopes, previous.grantedScopes);
  assert.equal(refreshed.idToken, previous.idToken);
  assert.deepEqual(previous, snapshot);
});

Deno.test("ChatGPT refresh never adopts another subject/client and accepts a reduced grant", async () => {
  const previous = await session();
  const foreignToken = await new SignJWT({}).setProtectedHeader({
    alg: "RS256",
  }).setIssuer(CHATGPT_ISSUER).setAudience(config().clientId).setSubject(
    "foreign-subject",
  ).setIssuedAt(now).setExpirationTime(now + 3600).sign(keys.privateKey);
  await rejectsCode(
    () =>
      refreshChatGPTSession(
        config(),
        previous,
        async () =>
          Response.json({ ...(await rawToken()), id_token: foreignToken }),
        {
          nowSeconds: now,
          jwks,
        },
      ),
    "provider_auth_required",
  );
  let calls = 0;
  await rejectsCode(
    () =>
      refreshChatGPTSession(
        config(),
        { ...previous, clientId: "wrong-client" },
        async () => {
          calls++;
          return Response.json({});
        },
        { nowSeconds: now, jwks },
      ),
    "provider_auth_required",
  );
  assert.equal(calls, 0);
  const reduced = await refreshChatGPTSession(
    config(),
    previous,
    async () =>
      Response.json({
        access_token: "replacement",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email",
      }),
    { nowSeconds: now, jwks },
  );
  assert.equal(
    reduced.grantedScopes.includes("chatgpt.tokens.use.direct"),
    false,
  );
});

Deno.test("ChatGPT invalid-grant and malformed token responses are sanitized", async () => {
  const previous = await session(), sentinel = "private-refresh-and-prompt";
  try {
    await refreshChatGPTSession(
      config(),
      previous,
      async () =>
        Response.json({ error: "invalid_grant", error_description: sentinel }, {
          status: 400,
        }),
      { nowSeconds: now, jwks },
    );
    assert.fail("Expected rejection");
  } catch (error) {
    assert(error instanceof ProviderError);
    assert.equal(error.code, "provider_auth_required");
    assert(!String(error).includes(sentinel));
  }
  await rejectsCode(
    () =>
      refreshChatGPTSession(config(), previous, async () =>
        Response.json({
          access_token: "bad\r\nheader",
          token_type: "Bearer",
          expires_in: 3600,
        }), { nowSeconds: now, jwks }),
    "provider_malformed",
  );
  await rejectsCode(
    () =>
      refreshChatGPTSession(
        config(),
        previous,
        async () => new Response(" ".repeat(262_145)),
        { nowSeconds: now, jwks },
      ),
    "provider_too_large",
  );
});

Deno.test("ChatGPT revoke uses discovered same-issuer endpoint and can clean up after access is disabled", async () => {
  const profile = await session();
  let calls = 0;
  await revokeChatGPTSession(
    config({ approved: false, planUsageApproved: false }),
    profile,
    async (url, init) => {
      calls++;
      if (calls === 1) {
        return Response.json({
          issuer: CHATGPT_ISSUER,
          revocation_endpoint: `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`,
        });
      }
      assert.equal(String(url), `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`);
      assert.equal(init?.redirect, "error");
      assert.equal(
        new URLSearchParams(String(init?.body)).get("token"),
        profile.refreshToken,
      );
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(calls, 2);
});

Deno.test("ChatGPT revoke never forwards refresh credentials to a foreign discovery endpoint", async () => {
  const profile = await session();
  let calls = 0;
  await rejectsCode(() =>
    revokeChatGPTSession(config(), profile, async () => {
      calls++;
      return Response.json({
        issuer: CHATGPT_ISSUER,
        revocation_endpoint: "https://other.example.invalid/steal",
      });
    }), "provider_malformed");
  assert.equal(calls, 1);
});
