// deno-lint-ignore-file require-await
// Fixture stubs intentionally satisfy async provider contracts without real I/O.
import assert from "node:assert/strict";
import { listChatGPTModels, streamChatGPT } from "./chatgpt.ts";
import {
  type ChatGPTCredential,
  ProviderError,
  type ProviderEvent,
  type ProviderFetch,
} from "./types.ts";

function credential(patch: Partial<ChatGPTCredential> = {}): ChatGPTCredential {
  return {
    provider: "chatgpt",
    accessToken: "fixture-access",
    grantedScopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    subject: "fixture-subject",
    clientId: "oaiapp_fixture",
    ...patch,
  };
}
function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\r\n\r\n`;
}
function wire(content: string | Uint8Array, bytewise = false): Response {
  const data = typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytewise) {
          for (const byte of data) controller.enqueue(new Uint8Array([byte]));
        } else controller.enqueue(data);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function values(
  fetcher: ProviderFetch,
  key = credential(),
): Promise<ProviderEvent[]> {
  const result: ProviderEvent[] = [];
  for await (
    const event of streamChatGPT(
      {
        model: "visible-fixture-model",
        messages: [{ role: "user", content: "Hello" }],
      },
      key,
      fetcher,
    )
  ) result.push(event);
  return result;
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
const completed = () => ({
  type: "response.completed",
  response: {
    id: "resp_fixture",
    model: "visible-fixture-model",
    status: "completed",
    usage: { input_tokens: 2, output_tokens: 3 },
  },
});

Deno.test("ChatGPT plan catalog uses models[] visibility and preserves account ordering", async () => {
  let calls = 0;
  const fetcher: ProviderFetch = async (url, options) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/models");
    assert.equal(options?.redirect, "error");
    assert.equal(
      new Headers(options?.headers).get("Authorization"),
      "Bearer fixture-access",
    );
    return Response.json({
      models: [{ slug: "b", display_name: "Second", visibility: "list" }, {
        slug: "hidden",
        display_name: "Hidden",
        visibility: "hide",
      }, { slug: "a", display_name: "First", visibility: "list" }],
    });
  };
  assert.deepEqual(await listChatGPTModels(credential(), fetcher), [{
    id: "b",
    name: "Second",
  }, { id: "a", name: "First" }]);
  assert.equal(calls, 1);
  await rejectsCode(
    () =>
      listChatGPTModels(
        credential(),
        async () => Response.json({ data: [{ id: "wrong-api-key-catalog" }] }),
      ),
    "provider_malformed",
  );
});

Deno.test("ChatGPT refuses expired and identity-only credentials without network calls", async () => {
  let calls = 0;
  const fetcher: ProviderFetch = async () => {
    calls++;
    return wire("");
  };
  await rejectsCode(
    () => values(fetcher, credential({ expiresAt: 1 })),
    "provider_auth_required",
  );
  await rejectsCode(
    () => values(fetcher, credential({ grantedScopes: ["openid", "email"] })),
    "provider_permission_required",
  );
  await rejectsCode(
    () => values(fetcher, credential({ clientId: "dynamic_agent_client" })),
    "provider_auth_required",
  );
  assert.equal(calls, 0);
});

Deno.test("ChatGPT payload sends full context/instructions and omits unsupported plan options", async () => {
  const fetcher: ProviderFetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      model: "fixture",
      input: [{ role: "user", content: "First" }, {
        role: "assistant",
        content: "Answer",
      }, { role: "user", content: "Next" }],
      instructions: "Be clear",
      store: false,
      stream: true,
    });
    return wire(
      sse({ type: "response.output_text.delta", delta: "Okay" }) +
        sse(completed()),
    );
  };
  const result: ProviderEvent[] = [];
  for await (
    const event of streamChatGPT(
      {
        model: "fixture",
        maxOutputTokens: 12,
        messages: [
          { role: "system", content: "Be clear" },
          { role: "user", content: "First" },
          { role: "assistant", content: "Answer" },
          { role: "user", content: "Next" },
        ],
      },
      credential(),
      fetcher,
    )
  ) result.push(event);
  assert.equal(result.at(-1)?.type, "completed");
});

Deno.test("ChatGPT byte SSE keeps split Unicode and CRLF while hiding reasoning", async () => {
  const response = sse({
    type: "response.reasoning_text.delta",
    delta: "hidden-chain-of-thought",
  }) +
    sse({ type: "response.output_text.delta", delta: "Hello 👋🏽" }) +
    sse(completed());
  assert.deepEqual(await values(async () => wire(response, true)), [
    { type: "text", text: "Hello 👋🏽" },
    { type: "usage", inputTokens: 2, outputTokens: 3 },
    {
      type: "completed",
      id: "resp_fixture",
      model: "visible-fixture-model",
      stopReason: "complete",
    },
  ]);
});

Deno.test("ChatGPT accepts completion without final blank line but not [DONE] as completion", async () => {
  const response = sse({ type: "response.output_text.delta", delta: "Hello" }) +
    `data: ${JSON.stringify(completed())}`;
  assert.equal(
    (await values(async () => wire(response))).at(-1)?.type,
    "completed",
  );
  await rejectsCode(
    () =>
      values(async () =>
        wire(
          sse({ type: "response.output_text.delta", delta: "Partial" }) +
            "data: [DONE]\n\n",
        )
      ),
    "provider_interrupted",
  );
});

Deno.test("ChatGPT failed/incomplete terminal frames preserve partials as failures", async () => {
  await rejectsCode(
    () =>
      values(async () =>
        wire(
          sse({ type: "response.output_text.delta", delta: "Partial" }) +
            sse({
              type: "response.failed",
              response: {
                error: {
                  code: "subscription_sharing_usage_limit_exceeded",
                  message: "private fixture details",
                },
              },
            }),
        )
      ),
    "provider_rate_limited",
  );
  await rejectsCode(
    () =>
      values(async () =>
        wire(
          sse({
            type: "response.incomplete",
            response: { id: "resp_fixture" },
          }),
        )
      ),
    "provider_interrupted",
  );
});

Deno.test("ChatGPT streams visible refusals and rejects empty or unsupported tool-only completion", async () => {
  const result = await values(async () =>
    wire(
      sse({
        type: "response.refusal.delta",
        delta: "I cannot help with that.",
      }) + sse(completed()),
    )
  );
  assert.deepEqual(result[0], {
    type: "text",
    text: "I cannot help with that.",
  });
  assert.deepEqual(result.at(-1), {
    type: "completed",
    id: "resp_fixture",
    model: "visible-fixture-model",
    stopReason: "refusal",
  });
  await rejectsCode(
    () => values(async () => wire(sse(completed()))),
    "provider_malformed",
  );
  await rejectsCode(
    () =>
      values(async () =>
        wire(
          sse({
            type: "response.completed",
            response: {
              id: "resp_fixture",
              output: [{ type: "function_call", name: "tool" }],
            },
          }),
        )
      ),
    "provider_unsupported",
  );
});

Deno.test("ChatGPT HTTP errors and HTML never echo raw upstream secrets", async () => {
  const sentinel = "private-fixture-token-and-prompt";
  for (
    const response of [
      new Response(`<html>${sentinel}</html>`, { status: 503 }),
      Response.json({ detail: sentinel }, { status: 401 }),
      Response.json({
        error: {
          code: "subscription_sharing_user_not_eligible",
          message: sentinel,
        },
      }, { status: 403 }),
    ]
  ) {
    try {
      await values(async () => response);
      assert.fail("Expected provider failure");
    } catch (error) {
      assert(error instanceof ProviderError);
      assert(!String(error).includes(sentinel));
    }
  }
  await rejectsCode(
    () => values(async () => new Response("<html>not SSE</html>")),
    "provider_malformed",
  );
});

Deno.test("ChatGPT bounded JSON, SSE and invalid UTF-8 fail closed", async () => {
  await rejectsCode(
    () =>
      listChatGPTModels(
        credential(),
        async () => new Response(" ".repeat(1_000_001)),
      ),
    "provider_too_large",
  );
  await rejectsCode(
    () => values(async () => wire("data: " + "x".repeat(2_000_001))),
    "provider_too_large",
  );
  await rejectsCode(
    () =>
      values(async () =>
        wire(new Uint8Array([100, 97, 116, 97, 58, 32, 0xff, 10, 10]))
      ),
    "provider_malformed",
  );
});

Deno.test("ChatGPT never retries and cancellation stops before a dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher: ProviderFetch = async () => {
    calls++;
    return wire("");
  };
  await rejectsCode(async () => {
    for await (
      const _ of streamChatGPT(
        {
          model: "fixture",
          messages: [{ role: "user", content: "Hello" }],
          signal: controller.signal,
        },
        credential(),
        fetcher,
      )
    ) { /* none */ }
  }, "provider_interrupted");
  assert.equal(calls, 0);
  await rejectsCode(() =>
    values(async () => {
      calls++;
      return new Response("not available", { status: 503 });
    }), "provider_unavailable");
  assert.equal(calls, 1);
});
