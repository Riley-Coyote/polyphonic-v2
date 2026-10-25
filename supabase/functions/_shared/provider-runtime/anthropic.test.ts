// deno-lint-ignore-file require-await
// Fetch fixtures retain the asynchronous network signature while returning deterministic in-memory responses.
import { listAnthropicModels, streamAnthropic } from "./anthropic.ts";
import {
  type AnthropicCredential,
  type ProviderChatInput,
  ProviderError,
  type ProviderErrorCode,
  type ProviderEvent,
  type ProviderFetch,
} from "./types.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    Object.is(actual, expected),
    `Expected ${String(expected)}, got ${String(actual)}`,
  );
}
function deepEqual(actual: unknown, expected: unknown) {
  equal(JSON.stringify(actual), JSON.stringify(expected));
}

const WORKSPACE = "wrkspc_01J7Z8K5H3M9Q2V6N4R0T1ABCD";
const credential: AnthropicCredential = {
  provider: "anthropic",
  apiKey: "sk-ant-api03-fixture",
  workspaceId: WORKSPACE,
};
const input: ProviderChatInput = {
  model: "claude-fixture",
  messages: [{ role: "system", content: "A test instruction" }, {
    role: "user",
    content: "A test question",
  }],
};
type Event = Record<string, unknown>;
const start = (): Event => ({
  type: "message_start",
  message: {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-fixture",
    content: [],
    usage: { input_tokens: 12, output_tokens: 1 },
  },
});
const textStart = (index = 0): Event => ({
  type: "content_block_start",
  index,
  content_block: { type: "text", text: "" },
});
const delta = (text: string, index = 0): Event => ({
  type: "content_block_delta",
  index,
  delta: { type: "text_delta", text },
});
const blockStop = (index = 0): Event => ({ type: "content_block_stop", index });
const messageDelta = (reason = "end_turn"): Event => ({
  type: "message_delta",
  delta: { stop_reason: reason },
  usage: { output_tokens: 8 },
});
const stop = (): Event => ({ type: "message_stop" });
const complete = (
  text = "Hello",
  reason = "end_turn",
): Event[] => [
  start(),
  textStart(),
  delta(text),
  blockStop(),
  messageDelta(reason),
  stop(),
];
function wire(
  events: Event[],
  options: { bytes?: number; ending?: string; type?: string } = {},
): Response {
  const serialized =
    events.map((event) =>
      `event: ${event.type}\r\ndata: ${JSON.stringify(event)}`
    ).join("\r\n\r\n") + (options.ending ?? "\r\n\r\n");
  const bytes = new TextEncoder().encode(serialized),
    size = options.bytes ?? bytes.byteLength;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.byteLength; at += size) {
          controller.enqueue(bytes.slice(at, at + size));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": options.type ?? "text/event-stream; charset=utf-8",
      },
    },
  );
}
async function collect(
  fetcher: ProviderFetch,
  turn = input,
  key = credential,
): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of streamAnthropic(turn, key, fetcher)) {
    events.push(event);
  }
  return events;
}
async function fails(action: () => Promise<unknown>, code: ProviderErrorCode) {
  try {
    await action();
    throw new Error("Expected a safe provider error");
  } catch (error) {
    assert(error instanceof ProviderError);
    equal(error.code, code);
    assert(!error.message.includes("private-fixture"));
    assert(!error.message.includes(credential.apiKey));
  }
}

Deno.test("Anthropic request uses fixed origin, safe API auth/workspace and text history", async () => {
  const events = await collect(async (url, init) => {
    equal(String(url), "https://api.anthropic.com/v1/messages");
    equal(init?.method, "POST");
    equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    equal(headers.get("authorization"), "Bearer " + credential.apiKey);
    equal(headers.get("anthropic-workspace-id"), WORKSPACE);
    equal(headers.get("anthropic-version"), "2023-06-01");
    equal(headers.get("x-api-key"), null);
    const body = JSON.parse(String(init?.body));
    equal(body.system, "A test instruction");
    equal(body.stream, true);
    equal(body.max_tokens, 4096);
    deepEqual(body.messages, [{ role: "user", content: "A test question" }]);
    equal(body.tools, undefined);
    return wire(complete());
  });
  deepEqual(events, [
    { type: "usage", inputTokens: 12, outputTokens: 1 },
    { type: "text", text: "Hello" },
    { type: "usage", outputTokens: 8 },
    {
      type: "completed",
      id: "msg_fixture",
      model: "claude-fixture",
      stopReason: "complete",
    },
  ]);
});

Deno.test("Anthropic SSE survives byte-split UTF8 and CRLF, EOF terminal and future events", async () => {
  const events = complete("Hello 👋🏽");
  events.splice(
    1,
    0,
    { type: "future_status", text: "private-fixture-hidden" },
    { type: "ping" },
  );
  const result = await collect(async () =>
    wire(events, { bytes: 1, ending: "" })
  );
  deepEqual(result.filter((event) => event.type === "text"), [{
    type: "text",
    text: "Hello 👋🏽",
  }]);
  equal(result.at(-1)?.type, "completed");
});

Deno.test("thinking and signatures never become visible prose", async () => {
  const events: Event[] = [
    start(),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "private-fixture-hidden" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "private-fixture-hidden" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "signature_delta",
        signature: "private-fixture-signature",
      },
    },
    blockStop(),
    textStart(1),
    delta("Visible", 1),
    blockStop(1),
    messageDelta(),
    stop(),
  ];
  const result = await collect(async () => wire(events));
  deepEqual(result.filter((event) => event.type === "text"), [{
    type: "text",
    text: "Visible",
  }]);
  assert(!JSON.stringify(result).includes("private-fixture"));
});

Deno.test("terminal reasons distinguish length, tool handoff and refusal", async () => {
  for (
    const [upstream, expected] of [
      ["max_tokens", "max_tokens"],
      ["model_context_window_exceeded", "max_tokens"],
      ["refusal", "refusal"],
      ["stop_sequence", "complete"],
    ]
  ) {
    const events = await collect(async () =>
      wire(complete("Partial or refusal", upstream))
    );
    deepEqual(events.at(-1), {
      type: "completed",
      id: "msg_fixture",
      model: "claude-fixture",
      stopReason: expected,
    });
  }
  const tools: Event[] = [
    start(),
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool_fixture",
        name: "unexecuted",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"private-fixture":' },
    },
    blockStop(),
    messageDelta("tool_use"),
    stop(),
  ];
  const events = await collect(async () => wire(tools));
  deepEqual(events.filter((event) => event.type === "text"), []);
  deepEqual(events.at(-1), {
    type: "completed",
    id: "msg_fixture",
    model: "claude-fixture",
    stopReason: "tool_use",
  });
});

Deno.test("stream truncation, missing metadata, unclosed blocks and duplicate indices never complete", async () => {
  await fails(
    () => collect(async () => wire(complete().slice(0, -1))),
    "provider_interrupted",
  );
  await fails(() => collect(async () => wire([stop()])), "provider_malformed");
  await fails(
    () =>
      collect(async () =>
        wire([start(), textStart(), delta("Partial"), messageDelta(), stop()])
      ),
    "provider_malformed",
  );
  await fails(
    () =>
      collect(async () =>
        wire([start(), textStart(), blockStop(), textStart()])
      ),
    "provider_malformed",
  );
});

Deno.test("midstream errors and HTTP errors are typed without echoing private response bodies", async () => {
  for (
    const [status, error, expected] of [
      [401, "authentication_error", "provider_auth_required"],
      [403, "permission_error", "provider_permission_required"],
      [402, "billing_error", "provider_credits_required"],
      [429, "rate_limit_error", "provider_rate_limited"],
      [529, "overloaded_error", "provider_unavailable"],
      [400, "invalid_request_error", "provider_invalid_request"],
    ] as const
  ) {
    await fails(
      () =>
        collect(async () =>
          new Response(
            JSON.stringify({
              error: {
                type: error,
                message: "private-fixture-secret " + credential.apiKey,
              },
            }),
            { status },
          )
        ),
      expected,
    );
  }
  await fails(
    () =>
      collect(async () =>
        wire([start(), {
          type: "error",
          error: { type: "billing_error", message: "private-fixture-secret" },
        }])
      ),
    "provider_credits_required",
  );
  await fails(
    () =>
      collect(async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "Your credit balance is too low: private-fixture-secret",
            },
          }),
          { status: 400 },
        )
      ),
    "provider_credits_required",
  );
  for (
    const workspaceMessage of [
      "This API key is not scoped to a workspace, add the anthropic-workspace-id header. private-fixture-secret",
      "anthropic-workspace-id is required when authenticating with an identity-linked API key. private-fixture-secret",
    ]
  ) {
    await fails(
      () =>
        collect(async () =>
          new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                message: workspaceMessage,
              },
            }),
            { status: 400 },
          )
        ),
      "provider_workspace_required",
    );
  }
});

Deno.test("a body transport failure after partial text is an interruption, not a decoder error", async () => {
  const serialized = complete("Partial").slice(0, 3).map((event) =>
    `data: ${JSON.stringify(event)}\n\n`
  ).join("");
  const received: ProviderEvent[] = [];
  let chunk = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunk++ === 0) {
          controller.enqueue(new TextEncoder().encode(serialized));
        } else {controller.error(
            new TypeError("private-fixture-network-termination"),
          );}
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  await fails(async () => {
    for await (
      const event of streamAnthropic(input, credential, async () => response)
    ) received.push(event);
  }, "provider_interrupted");
  deepEqual(received.filter((event) => event.type === "text"), [{
    type: "text",
    text: "Partial",
  }]);
  assert(!received.some((event) => event.type === "completed"));
});

Deno.test("HTML, invalid JSON, malformed UTF8 and oversized output fail safely", async () => {
  await fails(
    () => collect(async () => new Response("<html>private-fixture</html>")),
    "provider_malformed",
  );
  await fails(
    () =>
      collect(async () =>
        new Response("data: {not-json}\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      ),
    "provider_malformed",
  );
  await fails(
    () =>
      collect(async () =>
        new Response(new Uint8Array([0xff]), {
          headers: { "content-type": "text/event-stream" },
        })
      ),
    "provider_malformed",
  );
  await fails(
    () => collect(async () => wire(complete("x".repeat(1_000_001)))),
    "provider_too_large",
  );
});

Deno.test("caller abort cancels the upstream request and never emits completion", async () => {
  const controller = new AbortController();
  await fails(
    () =>
      collect((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          assert(init?.signal);
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("private-fixture", "AbortError")),
            {
              once: true,
            },
          );
          controller.abort();
        }), { ...input, signal: controller.signal }),
    "provider_interrupted",
  );
  let called = false;
  const already = new AbortController();
  already.abort();
  await fails(() =>
    collect(async () => {
      called = true;
      return wire(complete());
    }, { ...input, signal: already.signal }), "provider_interrupted");
  equal(called, false);
});

Deno.test("invalid requests, subscription tokens and header injection are rejected before networking", async () => {
  let calls = 0;
  const fetcher: ProviderFetch = async () => {
    calls++;
    return wire(complete());
  };
  const invalid: { turn: unknown; code: ProviderErrorCode }[] = [
    {
      turn: { ...input, model: "anthropic/claude-fixture" },
      code: "provider_invalid_request",
    },
    {
      turn: { ...input, maxOutputTokens: 0 },
      code: "provider_invalid_request",
    },
    {
      turn: { ...input, maxOutputTokens: 32_001 },
      code: "provider_invalid_request",
    },
    {
      turn: {
        ...input,
        messages: [{ role: "assistant", content: "Unrequested prefill" }],
      },
      code: "provider_invalid_request",
    },
    {
      turn: {
        ...input,
        messages: [{ role: "user", content: "Question" }, {
          role: "system",
          content: "Late instruction",
        }],
      },
      code: "provider_unsupported",
    },
    {
      turn: {
        ...input,
        messages: [{ role: "user", content: [{ type: "image" }] }],
      },
      code: "provider_unsupported",
    },
  ];
  for (const { turn, code } of invalid) {
    await fails(() => collect(fetcher, turn as ProviderChatInput), code);
  }
  for (
    const { key, code } of [
      {
        key: { ...credential, apiKey: "sk-ant-oat01-subscription-token" },
        code: "provider_api_key_invalid" as const,
      },
      {
        key: { ...credential, apiKey: "fixture\r\ninjected" },
        code: "provider_api_key_invalid" as const,
      },
      {
        key: { ...credential, workspaceId: "workspace\r\ninjected" },
        code: "provider_workspace_invalid" as const,
      },
      {
        key: { ...credential, workspaceId: credential.apiKey },
        code: "provider_workspace_invalid" as const,
      },
      {
        key: { ...credential, workspaceId: "workspace_fixture" },
        code: "provider_workspace_invalid" as const,
      },
    ]
  ) {
    await fails(
      () => collect(fetcher, input, key),
      code,
    );
  }
  equal(calls, 0);
});

Deno.test("model discovery paginates native IDs and does not call inference", async () => {
  const calls: string[] = [];
  const models = await listAnthropicModels(credential, async (url, init) => {
    calls.push(String(url));
    const request = new URL(String(url));
    equal(request.origin, "https://api.anthropic.com");
    equal(request.pathname, "/v1/models");
    equal(
      new Headers(init?.headers).get("anthropic-workspace-id"),
      WORKSPACE,
    );
    return Response.json(
      calls.length === 1
        ? {
          data: [{ type: "model", id: "claude-a", display_name: "Claude A" }],
          has_more: true,
          last_id: "claude-a",
        }
        : {
          data: [{ type: "model", id: "claude-b", display_name: "Claude B" }, {
            type: "model",
            id: "retired-model",
            lifecycle: "retired",
          }],
          has_more: false,
          last_id: "claude-b",
        },
    );
  });
  deepEqual(models, [{ id: "claude-a", name: "Claude A" }, {
    id: "claude-b",
    name: "Claude B",
  }]);
  equal(new URL(calls[1]).searchParams.get("after_id"), "claude-a");
  assert(!calls.join().includes(credential.apiKey));
});

Deno.test("workspace-scoped keys omit an unset header and model cursor cycles are rejected", async () => {
  await listAnthropicModels({
    provider: "anthropic",
    apiKey: credential.apiKey,
  }, async (_url, init) => {
    equal(new Headers(init?.headers).get("anthropic-workspace-id"), null);
    return Response.json({ data: [], has_more: false });
  });
  await fails(
    () =>
      listAnthropicModels(credential, async () =>
        Response.json({
          data: [{ type: "model", id: "claude-a" }],
          has_more: true,
          last_id: "claude-a",
        })),
    "provider_malformed",
  );
  await fails(() =>
    listAnthropicModels(credential, async () => {
      throw new Error("private-fixture-network-error");
    }), "provider_unavailable");
});
