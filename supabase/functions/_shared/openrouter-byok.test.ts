// Offline regressions: no provider credentials, network, or platform env access.
// deno test --allow-read=supabase/functions supabase/functions/_shared/openrouter-byok.test.ts
import { AppError, errorResponse, MissingApiKeyError } from "./errors.ts";
import { resolveUserChatBackend } from "./model-backend.ts";
import { openRouterChat, withOpenRouterRetry } from "./openrouter.ts";
import {
  openRouterAccountError,
  openRouterAccountErrorFromUnknown,
  openRouterStreamError,
} from "./openrouter-errors.ts";
import { classifyCrisis } from "./agents/crisis.ts";
import { buildModelAttachmentContent } from "./attachments.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown): void {
  assert(actual === expected, `Expected ${String(expected)}, got ${String(actual)}`);
}

async function rejected(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof AppError, "Expected a typed application error");
    return error;
  }
  throw new Error("Expected rejection");
}

const fixtures = [
  { status: 401, code: "provider_auth_required", httpStatus: 403 },
  { status: 402, code: "provider_credits_required", httpStatus: 402 },
  { status: 429, code: "provider_rate_limited", httpStatus: 429 },
] as const;

Deno.test({
  name: "real chat without BYOK returns missing_api_key without any platform secret or env permission",
  permissions: { env: false, net: false },
  async fn() {
    let reads = 0;
    const client = {
      rpc(name: string, args: Record<string, string>) {
        reads++;
        equal(name, "decrypt_user_api_key");
        equal(args.p_user_id, "signed-in-user");
        return Promise.resolve({ data: null, error: null });
      },
      from() { throw new Error("No platform entitlement lookup is allowed"); },
    };
    const failure = await rejected(() => resolveUserChatBackend(client, { id: "signed-in-user" }, "chosen/model"));
    assert(failure instanceof MissingApiKeyError);
    equal(failure.code, "missing_api_key");
    equal(failure.status, 400);
    equal(reads, 1);
  },
});

Deno.test({
  name: "real chat uses the caller's existing vault key and exact model without platform access",
  permissions: { env: false, net: false },
  async fn() {
    const client = { rpc: () => Promise.resolve({ data: " fixture-user-key ", error: null }) };
    const backend = await resolveUserChatBackend(client, "signed-in-user", "chosen/model");
    equal(backend.keySource, "user");
    equal(backend.apiKey, "fixture-user-key");
    equal(backend.model, "chosen/model");
    equal(backend.substitutedModel, false);
    equal(backend.billingTier, "byok");
  },
});

Deno.test({
  name: "vault failures fail closed and are distinct from a missing connection",
  permissions: { env: false, net: false },
  async fn() {
    const client = { rpc: () => Promise.resolve({ data: "fixture-user-key", error: { message: "fixture-private-db-detail" } }) };
    const failure = await rejected(() => resolveUserChatBackend(client, "signed-in-user"));
    equal(failure.code, "upstream_unavailable");
    equal(failure.status, 503);
    assert(!failure.message.includes("fixture-private-db-detail"));
  },
});

Deno.test("both released chat entrypoints gate every attachment preparation behind BYOK", async () => {
  for (const path of ["../chat/index.ts", "../chat-multi/index.ts"]) {
    const file = await Deno.readTextFile(new URL(path, import.meta.url));
    const source = file.slice(file.indexOf("serve(async (req) => {"));
    const keyGate = source.indexOf("await resolveUserChatBackend(");
    assert(keyGate >= 0, `${path} must resolve a user-only backend`);
    assert(!source.includes("await resolveChatBackend("), `${path} must not select a platform backend`);
    const preparations = [...source.matchAll(/await buildModelAttachmentContent\(/g)];
    assert(preparations.length > 0, `${path} should exercise the real attachment call site`);
    for (const preparation of preparations) {
      assert(keyGate < preparation.index!, `${path} must reject missing BYOK before attachment derivatives`);
    }
    assert(source.indexOf("return fail(new MissingApiKeyError") < preparations[0].index!);
    for (const preparation of source.matchAll(/await hydrateHistoricalAttachmentContent\(/g)) {
      assert(keyGate < preparation.index!, `${path} must gate historical derivatives too`);
    }
  }
});

for (const fixture of fixtures) {
  Deno.test(`OpenRouter ${fixture.status} uses actionable safe copy and preserves Polyphonic login`, async () => {
    const failure = openRouterAccountError(fixture.status);
    assert(failure);
    equal(failure.code, fixture.code);
    const response = errorResponse(failure, {}, "fixture-request");
    equal(response.status, fixture.httpStatus);
    const envelope = await response.json();
    equal(envelope.code, fixture.code);
    assert(envelope.error.includes("OpenRouter"));
    assert(envelope.code !== "unauthorized");
  });

  Deno.test(`OpenRouter ${fixture.status} is never retried by completion helpers`, async () => {
    let calls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(new Response("fixture-private-upstream-body", { status: fixture.status }));
    };
    try {
      const failure = await rejected(() => openRouterChat({ apiKey: "fixture-only", body: {} }));
      equal(failure.code, fixture.code);
      equal(calls, 1);
      assert(!JSON.stringify(failure).includes("fixture-private-upstream-body"));

      const response = await withOpenRouterRetry(() => fetch("https://fixture.invalid"), { baseDelayMs: 0 });
      equal(response.status, fixture.status);
      equal(calls, 2);
      await response.body?.cancel();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  Deno.test(`SDK ${fixture.status} statusCode and 200-stream errors are sanitized without message guessing`, () => {
    // @openrouter/agent 0.5.0 delegates to @openrouter/sdk ^0.12.12.
    // OpenRouterError in both 0.12.12 and resolved 0.12.79 stores statusCode,
    // body, headers, rawResponse;
    // typed Unauthorized/PaymentRequired/TooManyRequests errors add error/data$.
    const privateText = "fixture-private-key-and-user-content";
    const sdkError = Object.assign(new Error(privateText), {
      name: "OpenRouterError",
      statusCode: fixture.status,
      body: privateText,
      headers: new Headers(),
      rawResponse: new Response(privateText, { status: fixture.status }),
      error: { code: fixture.status, message: privateText },
    });
    const classified = openRouterAccountErrorFromUnknown(sdkError);
    assert(classified);
    equal(classified.code, fixture.code);
    assert(!JSON.stringify(classified).includes(privateText));
    equal(openRouterStreamError({ error: { code: fixture.status, message: privateText } })?.code, fixture.code);
    equal(openRouterAccountErrorFromUnknown(new Error(`Provider said ${fixture.status}: ${privateText}`)), null);
  });

  Deno.test(`crisis preparation stops the turn on OpenRouter ${fixture.status} before another dispatch`, async () => {
    let calls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(new Response("fixture-private-upstream-body", { status: fixture.status }));
    };
    try {
      const failure = await rejected(() => classifyCrisis("fixture-only", [], "a user message"));
      equal(failure.code, fixture.code);
      equal(calls, 1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  Deno.test(`attachment derivatives stop on OpenRouter ${fixture.status} with safe connection guidance`, async () => {
    let paidCalls = 0;
    const previousFetch = globalThis.fetch;
    const row = {
      id: "fixture-attachment", user_id: "signed-in-user", kind: "image", status: "ready",
      original_name: "image.png", bucket: "fixture-bucket", storage_path: "fixture-image",
      derivatives: [],
    };
    const client = {
      from() {
        return { select: () => ({ in: () => Promise.resolve({ data: [row], error: null }) }) };
      },
      storage: {
        from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://fixture.invalid/image.png" }, error: null }) }),
      },
    };
    globalThis.fetch = (input) => {
      if (String(input).endsWith("/models")) return Promise.resolve(Response.json({ data: [] }));
      paidCalls++;
      return Promise.resolve(new Response("fixture-private-upstream-body", { status: fixture.status }));
    };
    try {
      const failure = await rejected(() => buildModelAttachmentContent(client, "signed-in-user", [row.id], "fixture/text-only", "fixture-only"));
      equal(failure.code, fixture.code);
      equal(paidCalls, 1);
      assert(!JSON.stringify(failure).includes("fixture-private-upstream-body"));
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}

Deno.test("unrecognized upstream stream errors use safe generic copy", () => {
  const failure = openRouterStreamError({ error: { code: 500, message: "fixture-private-content", metadata: { raw: "fixture-private-key" } } });
  equal(failure?.code, "upstream_unavailable");
  assert(!JSON.stringify(failure).includes("fixture-private"));
  equal(openRouterStreamError({ choices: [] }), null);
});
