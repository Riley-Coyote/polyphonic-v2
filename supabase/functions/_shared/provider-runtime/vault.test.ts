import assert from "node:assert/strict";
import { ProviderError } from "./types.ts";
import {
  type ConnectionMetadata,
  ProviderCipher,
  type ProviderDatabase,
  ProviderStore,
} from "./vault.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const metadata: ConnectionMetadata = {
  provider: "anthropic",
  label: "Fixture API key",
  subject: null,
  workspace_id: null,
  status: "connected",
  granted_scopes: [],
  expires_at: null,
};
async function configurationFailure(
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "provider_configuration_required",
  );
}

Deno.test("provider vault ciphertext uses unique IVs and authenticated user/record/purpose binding", async () => {
  const cipher = await ProviderCipher.create(KEY),
    secret = { apiKey: "fixture-api-key", provider: "anthropic" };
  const encrypted = await cipher.seal(secret, USER, ID),
    another = await cipher.seal(secret, USER, ID);
  assert.notEqual(encrypted, another);
  assert(!encrypted.includes(secret.apiKey));
  assert.deepEqual(await cipher.open(encrypted, USER, ID), secret);
  await configurationFailure(() => cipher.open(encrypted, OTHER, ID));
  await configurationFailure(() => cipher.open(encrypted, USER, OTHER));
  await configurationFailure(() => cipher.open(encrypted, USER, ID, "oauth"));
});

Deno.test("provider vault rejects tampering, invalid keys and oversized secrets without plaintext errors", async () => {
  const cipher = await ProviderCipher.create(KEY),
    encrypted = await cipher.seal(
      { refreshToken: "fixture-private-token" },
      USER,
      ID,
    );
  const parts = encrypted.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await configurationFailure(() => cipher.open(parts.join("."), USER, ID));
  await configurationFailure(() => ProviderCipher.create("invalid-base64!"));
  await configurationFailure(() => ProviderCipher.create(btoa("too short")));
  await assert.rejects(
    () => cipher.seal("x".repeat(60_001), USER, ID),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "provider_too_large",
  );
  try {
    await cipher.open("fixture-private-token", USER, ID);
    assert.fail("Expected failure");
  } catch (error) {
    assert(error instanceof ProviderError);
    assert(!String(error).includes("fixture-private-token"));
  }
});

Deno.test("provider store sends encrypted secret, expected version and refresh lease through service RPC", async () => {
  const cipher = await ProviderCipher.create(KEY),
    calls: Record<string, unknown>[] = [];
  const secret = { provider: "anthropic", apiKey: "fixture-api-key" };
  const db: ProviderDatabase = {
    rpc: (name, args) => {
      assert.equal(name, "provider_secret");
      calls.push(args);
      return Promise.resolve({
        error: null,
        data: {
          connection: {
            ...metadata,
            id: ID,
            user_id: USER,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          encrypted_secret: args.p_secret,
          version: 8,
          lease_id: null,
          lease_until: null,
        },
      });
    },
  };
  const store = new ProviderStore(db, cipher),
    saved = await store.save(USER, ID, metadata, secret, 7, OTHER);
  assert.equal(calls[0].p_version, 7);
  assert.equal(calls[0].p_lease, OTHER);
  assert(!JSON.stringify(calls).includes(secret.apiKey));
  assert.equal(saved.version, 8);
  assert.deepEqual(await store.credential(saved), secret);
});

Deno.test("provider store rejects cross-owner RPC rows and sanitizes database failures", async () => {
  const cipher = await ProviderCipher.create(KEY);
  const foreign: ProviderDatabase = {
    rpc: () =>
      Promise.resolve({
        error: null,
        data: {
          connection: { ...metadata, id: ID, user_id: OTHER },
          encrypted_secret: "fixture-ciphertext",
          version: 1,
          lease_id: null,
          lease_until: null,
        },
      }),
  };
  await assert.rejects(
    () => new ProviderStore(foreign, cipher).read(USER, ID),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "provider_permission_required",
  );
  const failed: ProviderDatabase = {
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: "fixture-private-database-detail" },
      }),
  };
  try {
    await new ProviderStore(failed, cipher).read(USER, ID);
    assert.fail("Expected failure");
  } catch (error) {
    assert(error instanceof ProviderError);
    assert.equal(error.code, "provider_unavailable");
    assert(!String(error).includes("fixture-private-database-detail"));
  }
});
