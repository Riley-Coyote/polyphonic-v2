// deno-lint-ignore-file require-await
// Async fixtures preserve the production repository/provider signatures without network access.
import {
  type CompletedAnswer,
  type ConnectedTurn,
  providerChat,
  type ProviderChatDependencies,
  type ProviderChatRepository,
  type SavedAnswer,
  type TurnState,
} from "./chat-handler.ts";
import type { UsableProviderCredential } from "./broker.ts";
import {
  type ProviderChatInput,
  ProviderError,
  type ProviderEvent,
  type ProviderStopReason,
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
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const THREAD = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const CONNECTION = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "88888888-8888-4888-8888-888888888888";
const MODEL = "claude-fixture";
const RAW_SECRET = "fixture-private-provider-token-and-upstream-error";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const completion = (
  stopReason: ProviderStopReason = "complete",
): ProviderEvent => ({
  type: "completed",
  id: "msg_opaque_upstream_identifier",
  model: MODEL,
  stopReason,
});
const successfulEvents = (): ProviderEvent[] => [
  { type: "usage", inputTokens: 12, outputTokens: 1 },
  { type: "text", text: "Cloud " },
  { type: "text", text: "reply ✓" },
  { type: "usage", outputTokens: 9 },
  completion(),
];
async function* events(
  values = successfulEvents(),
): AsyncGenerator<ProviderEvent> {
  yield* values;
}
type WireEvent = Record<string, unknown>;
function parseFrames(wire: string): WireEvent[] {
  return wire.split(/\r?\n\r?\n/).flatMap((frame) => {
    const data = frame.split(/\r?\n/).filter((line) =>
      line.startsWith("data: ")
    )
      .map((line) => line.slice(6)).join("\n");
    return data ? [JSON.parse(data) as WireEvent] : [];
  });
}
async function collect(response: Response): Promise<WireEvent[]> {
  equal(response.headers.get("Content-Type"), "text/event-stream");
  const wire = await response.text();
  assert(
    !wire.includes(RAW_SECRET),
    "raw provider/credential errors must stay off the wire",
  );
  return parseFrames(wire);
}
async function errorCode(response: Response): Promise<string> {
  assert(response.status >= 400);
  const raw = await response.text();
  assert(!raw.includes(RAW_SECRET));
  return (JSON.parse(raw) as { code: string }).code;
}

/** Atomic in-memory equivalent of the SQL claim journal; provider work is injected separately. */
class FixtureRepository implements ProviderChatRepository {
  readonly turn: ConnectedTurn = {
    user: USER,
    thread: THREAD,
    message: MESSAGE,
    connection: CONNECTION,
    model: MODEL,
    text: "Reply with cloud test OK",
    agent: "luca",
  };
  readonly trace: string[] = [];
  readonly answers = new Map<string, SavedAnswer>();
  readonly saved: CompletedAnswer[] = [];
  current: TurnState = { claimed: false, state: null, assistant_id: null };
  connected = true;
  loads = 0;
  claims = 0;
  contexts = 0;
  loadError?: Error;
  contextError?: Error;
  answerError?: Error;
  saveFailure?: "before" | "after";
  claimFailure?: "before" | "after";
  finishFailure?: "before" | "after";
  unknownFailure = false;
  saveGate?: ReturnType<typeof deferred>;
  readonly saveStarted = deferred();
  readonly markedFinished = deferred();
  readonly markedUnknown = deferred();

  async load(
    user: string,
    thread: string,
    message: string,
  ): Promise<ConnectedTurn> {
    this.loads++;
    this.trace.push("load");
    if (this.loadError) throw this.loadError;
    if (user !== USER || thread !== THREAD || message !== MESSAGE) {
      throw new ProviderError("provider_permission_required", 403);
    }
    return { ...this.turn };
  }
  async context(turn: ConnectedTurn): Promise<ProviderChatInput["messages"]> {
    this.check(turn);
    this.contexts++;
    this.trace.push("context");
    if (this.contextError) throw this.contextError;
    return [{ role: "system", content: "Text-only fixture context" }, {
      role: "user",
      content: this.turn.text,
    }];
  }
  async state(
    turn: ConnectedTurn,
    action: "status" | "claim" | "finish" | "unknown",
    assistant?: string,
  ): Promise<TurnState> {
    this.check(turn);
    this.trace.push(action);
    if (action === "status") return { ...this.current };
    if (action === "claim") {
      this.claims++;
      if (this.claimFailure === "before") {
        this.claimFailure = undefined;
        throw new Error(RAW_SECRET);
      }
      if (!this.connected) {
        throw new ProviderError("provider_auth_required", 401);
      }
      assert(
        assistant && UUID.test(assistant),
        "claim reserves a canonical UUID before inference",
      );
      if (this.current.state) return { ...this.current, claimed: false };
      this.current = {
        claimed: false,
        state: "dispatched",
        assistant_id: assistant,
      };
      if (this.claimFailure === "after") {
        this.claimFailure = undefined;
        throw new Error(RAW_SECRET);
      }
      return { claimed: true };
    }
    if (action === "finish") {
      if (this.finishFailure === "before") {
        this.finishFailure = undefined;
        throw new Error(RAW_SECRET);
      }
      assert(typeof assistant === "string");
      assert(
        assistant === this.current.assistant_id && this.answers.has(assistant),
      );
      if (
        this.current.state === "dispatched" || this.current.state === "unknown"
      ) this.current.state = "finished";
      this.markedFinished.resolve();
      if (this.finishFailure === "after") {
        this.finishFailure = undefined;
        throw new Error(RAW_SECRET);
      }
    } else {
      if (this.current.state === "dispatched") this.current.state = "unknown";
      this.markedUnknown.resolve();
      if (this.unknownFailure) throw new Error(RAW_SECRET);
    }
    return { ...this.current };
  }
  async answer(turn: ConnectedTurn, id: string): Promise<SavedAnswer | null> {
    this.check(turn);
    this.trace.push("answer");
    if (this.answerError) throw this.answerError;
    return this.answers.get(id) ?? null;
  }
  async save(turn: ConnectedTurn, answer: CompletedAnswer): Promise<void> {
    this.check(turn);
    this.trace.push("save:start");
    this.saveStarted.resolve();
    if (this.saveGate) await this.saveGate.promise;
    if (this.saveFailure === "before") throw new Error(RAW_SECRET);
    assert(answer.id === this.current.assistant_id && UUID.test(answer.id));
    assert(
      !this.answers.has(answer.id),
      "canonical output may be inserted only once",
    );
    this.saved.push({ ...answer });
    this.answers.set(answer.id, {
      id: answer.id,
      content: answer.text,
      model: answer.model,
      tokens_used: answer.inputTokens + answer.outputTokens,
    });
    this.trace.push("save:commit");
    if (this.saveFailure === "after") throw new Error(RAW_SECRET);
  }
  private check(turn: ConnectedTurn) {
    deepEqual(turn, this.turn);
  }
}

class Fixture {
  readonly repository = new FixtureRepository();
  credentials = 0;
  discoveries = 0;
  streams = 0;
  credentialError?: Error;
  modelsError?: Error;
  availableModels = [{ id: MODEL }];
  modelGate?: () => Promise<void>;
  afterModels?: () => void;
  capturedInput?: ProviderChatInput;
  factory: (input: ProviderChatInput) => AsyncIterable<ProviderEvent> = () =>
    events();
  readonly usable: UsableProviderCredential = {
    record: {
      connection: {
        id: CONNECTION,
        user_id: USER,
        provider: "anthropic",
        label: "Fixture",
        subject: null,
        workspace_id: null,
        status: "connected",
        granted_scopes: [],
        expires_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      version: 1,
      encrypted_secret: "encrypted-fixture",
      lease_id: null,
      lease_until: null,
    },
    credential: { provider: "anthropic", apiKey: RAW_SECRET },
  };
  readonly deps: ProviderChatDependencies = {
    repository: this.repository,
    credential: async (user, connection) => {
      equal(user.toLowerCase(), USER);
      equal(connection, CONNECTION);
      this.repository.trace.push("credential");
      this.credentials++;
      if (this.credentialError) throw this.credentialError;
      return this.usable;
    },
    models: async (credential) => {
      equal(credential, this.usable);
      this.repository.trace.push("models");
      this.discoveries++;
      if (this.modelGate) await this.modelGate();
      if (this.modelsError) throw this.modelsError;
      this.afterModels?.();
      return this.availableModels;
    },
    stream: (input, credential) => {
      equal(credential, this.usable);
      equal(input.model, MODEL);
      this.capturedInput = input;
      this.repository.trace.push("stream");
      this.streams++;
      return this.factory(input);
    },
  };
  request(
    body: Record<string, unknown> = {},
    options: { signal?: AbortSignal; user?: string } = {},
  ) {
    return providerChat(
      new Request("https://polyphonic.example.invalid/provider-chat", {
        method: "POST",
        signal: options.signal,
      }),
      { thread_id: THREAD, user_message_id: MESSAGE, ...body },
      options.user ?? USER,
      this.deps,
      { "Access-Control-Allow-Origin": "https://polyphonic.example.invalid" },
    );
  }
}

Deno.test("provider chat persists one canonical answer before done, preserving content/usage/model and safe headers", async () => {
  const fixture = new Fixture();
  fixture.repository.saveGate = deferred();
  const response = await fixture.request({
    model: MODEL,
    connection_id: CONNECTION,
    message: fixture.repository.turn.text,
  });
  equal(response.status, 200);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://polyphonic.example.invalid",
  );
  equal(response.headers.get("X-Accel-Buffering"), "no");
  const reader = response.body!.getReader();
  const received: WireEvent[] = [];
  for (let i = 0; i < 2; i++) {
    received.push(
      ...parseFrames(new TextDecoder().decode((await reader.read()).value)),
    );
  }
  await fixture.repository.saveStarted.promise;
  let terminalReadSettled = false;
  const next = reader.read().then((value) => {
    terminalReadSettled = true;
    return value;
  });
  await tick();
  equal(terminalReadSettled, false);
  equal(fixture.repository.saved.length, 0);
  fixture.repository.saveGate.resolve();
  received.push(...parseFrames(new TextDecoder().decode((await next).value)));
  equal((await reader.read()).done, true);
  reader.releaseLock();
  deepEqual(received.map((event) => event.type), [
    "content",
    "content",
    "done",
  ]);
  equal(
    received.filter((event) => event.type === "content").map((event) =>
      event.text
    ).join(""),
    "Cloud reply ✓",
  );
  const done = received.at(-1)!;
  assert(typeof done.message_id === "string" && UUID.test(done.message_id));
  assert(done.message_id !== "msg_opaque_upstream_identifier");
  equal(done.key_source, "connected_provider");
  equal(done.tokens_used, 21);
  equal(done.model, MODEL);
  deepEqual(fixture.repository.saved, [{
    id: done.message_id,
    text: "Cloud reply ✓",
    model: MODEL,
    providerId: "msg_opaque_upstream_identifier",
    inputTokens: 12,
    outputTokens: 9,
  }]);
  assert(
    fixture.repository.trace.indexOf("save:commit") <
      fixture.repository.trace.indexOf("finish"),
  );
  assert(
    fixture.repository.trace.indexOf("claim") <
      fixture.repository.trace.indexOf("stream"),
  );
  equal(fixture.repository.current.state, "finished");
});

Deno.test("provider chat retries replay saved content without credentials, model discovery, or another paid request", async () => {
  const fixture = new Fixture();
  const first = await collect(await fixture.request());
  fixture.repository.connected = false;
  fixture.credentialError = new ProviderError("provider_auth_required", 401);
  const second = await collect(await fixture.request());
  deepEqual(second, [{ type: "content", text: "Cloud reply ✓" }, first.at(-1)]);
  equal(fixture.streams, 1);
  equal(fixture.credentials, 1);
  equal(fixture.discoveries, 1);
  equal(fixture.repository.claims, 1);
  equal(fixture.repository.saved.length, 1);
});

Deno.test("concurrent retries use one atomic claim and never perform duplicate inference", async () => {
  const fixture = new Fixture();
  const bothReady = deferred(), release = deferred();
  let ready = 0;
  fixture.modelGate = () => {
    if (++ready === 2) bothReady.resolve();
    return bothReady.promise;
  };
  fixture.factory = async function* () {
    yield { type: "text", text: "One paid reply" };
    await release.promise;
    yield completion();
  };
  const replies = await Promise.all([fixture.request(), fixture.request()]);
  equal(fixture.streams, 1);
  equal(fixture.repository.claims, 2);
  equal(replies.filter((response) => response.status === 200).length, 1);
  equal(
    await errorCode(replies.find((response) => response.status !== 200)!),
    "provider_interrupted",
  );
  release.resolve();
  const first = await collect(
    replies.find((response) => response.status === 200)!,
  );
  equal(first.at(-1)!.type, "done");
  const retry = await collect(await fixture.request());
  equal(retry.at(-1)!.message_id, first.at(-1)!.message_id);
  equal(fixture.streams, 1);
  equal(fixture.repository.saved.length, 1);
});

Deno.test("persisted output recovers a lost save or finish acknowledgement without redispatch", async () => {
  for (const failure of ["save-after", "finish-before", "finish-after"]) {
    const fixture = new Fixture();
    if (failure === "save-after") fixture.repository.saveFailure = "after";
    else {fixture.repository.finishFailure = failure === "finish-before"
        ? "before"
        : "after";}
    const interrupted = await collect(await fixture.request());
    equal(interrupted.at(-1)!.type, "error");
    assert(!interrupted.some((event) => event.type === "done"));
    equal(fixture.repository.saved.length, 1);
    const replayed = await collect(await fixture.request());
    equal(replayed.at(-1)!.type, "done");
    equal(replayed.at(-1)!.message_id, fixture.repository.saved[0].id);
    equal(fixture.streams, 1);
    equal(fixture.repository.claims, 1);
    equal(fixture.repository.saved.length, 1);
  }
});

Deno.test("a lost claim acknowledgement never triggers speculative provider redispatch", async () => {
  const ambiguous = new Fixture();
  ambiguous.repository.claimFailure = "after";
  equal(await errorCode(await ambiguous.request()), "provider_unavailable");
  equal(ambiguous.repository.current.state, "dispatched");
  equal(await errorCode(await ambiguous.request()), "provider_interrupted");
  equal(ambiguous.streams, 0);
  equal(ambiguous.repository.claims, 1);
  const rejected = new Fixture();
  rejected.repository.claimFailure = "before";
  equal(await errorCode(await rejected.request()), "provider_unavailable");
  equal(rejected.repository.current.state, null);
  equal((await collect(await rejected.request())).at(-1)!.type, "done");
  equal(rejected.streams, 1);
});

Deno.test("failed persistence never sends done and leaves the paid identity unavailable for redispatch", async () => {
  const fixture = new Fixture();
  fixture.repository.saveFailure = "before";
  const result = await collect(await fixture.request());
  equal(result.at(-1)!.type, "error");
  equal(result.at(-1)!.code, "provider_unavailable");
  assert(!result.some((event) => event.type === "done"));
  equal(fixture.repository.saved.length, 0);
  equal(fixture.repository.current.state, "unknown");
  equal(await errorCode(await fixture.request()), "provider_interrupted");
  equal(fixture.streams, 1);
});

Deno.test("length, tool, refusal, missing terminal, and empty replies never become canonical completed answers", async () => {
  const cases: Array<{ values: ProviderEvent[]; code: string }> = [
    {
      values: [{ type: "text", text: "Partial" }, completion("max_tokens")],
      code: "provider_interrupted",
    },
    {
      values: [{ type: "text", text: "Tool preface" }, completion("tool_use")],
      code: "provider_unsupported",
    },
    {
      values: [{ type: "text", text: "Refusal" }, completion("refusal")],
      code: "provider_unsupported",
    },
    {
      values: [{ type: "text", text: "No terminal marker" }],
      code: "provider_interrupted",
    },
    {
      values: [{ type: "text", text: " \n" }, completion()],
      code: "provider_interrupted",
    },
    { values: [], code: "provider_interrupted" },
  ];
  for (const { values, code } of cases) {
    const fixture = new Fixture();
    fixture.factory = () => events(values);
    const received = await collect(await fixture.request());
    equal(received.at(-1)!.code, code);
    assert(!received.some((event) => event.type === "done"));
    equal(fixture.repository.saved.length, 0);
    equal(fixture.repository.current.state, "unknown");
    equal(await errorCode(await fixture.request()), "provider_interrupted");
    equal(fixture.streams, 1);
  }
});

Deno.test("oversized, malformed, and post-terminal provider events fail closed", async () => {
  const cases: Array<{ values: ProviderEvent[]; code: string }> = [
    {
      values: [{ type: "text", text: "x".repeat(2_000_001) }],
      code: "provider_too_large",
    },
    {
      values: [{ type: "unknown-wire-event" } as unknown as ProviderEvent],
      code: "provider_malformed",
    },
    { values: [null as unknown as ProviderEvent], code: "provider_malformed" },
    {
      values: [...successfulEvents(), { type: "text", text: "after terminal" }],
      code: "provider_malformed",
    },
  ];
  for (const { values, code } of cases) {
    const fixture = new Fixture();
    fixture.factory = () => events(values);
    const received = await collect(await fixture.request());
    equal(received.at(-1)!.code, code);
    assert(!received.some((event) => event.type === "done"));
    equal(fixture.repository.saved.length, 0);
  }
});

Deno.test("stream failures and failed journal cleanup expose only safe errors", async () => {
  for (const partial of [false, true]) {
    const fixture = new Fixture();
    fixture.repository.unknownFailure = true;
    fixture.factory = async function* () {
      if (partial) yield { type: "text", text: "Safe partial reply" };
      throw new Error(RAW_SECRET);
    };
    const received = await collect(await fixture.request());
    equal(received.at(-1)!.code, "provider_unavailable");
    equal(
      received.at(-1)!.text,
      new ProviderError("provider_unavailable").message,
    );
    equal(received.some((event) => event.type === "content"), partial);
    assert(!received.some((event) => event.type === "done"));
    equal(fixture.repository.saved.length, 0);
    equal(await errorCode(await fixture.request()), "provider_interrupted");
    equal(fixture.streams, 1);
  }
});

Deno.test("preflight failures are sanitized and do not reserve or dispatch a paid turn", async () => {
  for (
    const source of ["load", "context", "credential", "models", "missing-model"]
  ) {
    const fixture = new Fixture();
    if (source === "load") fixture.repository.loadError = new Error(RAW_SECRET);
    else if (source === "context") {
      fixture.repository.contextError = new Error(RAW_SECRET);
    } else if (source === "credential") {
      fixture.credentialError = new ProviderError(
        "provider_auth_required",
        401,
      );
    } else if (source === "models") fixture.modelsError = new Error(RAW_SECRET);
    else fixture.availableModels = [{ id: "another-model" }];
    const code = await errorCode(await fixture.request());
    equal(
      code,
      source === "credential"
        ? "provider_auth_required"
        : source === "missing-model"
        ? "provider_permission_required"
        : "provider_unavailable",
    );
    equal(fixture.repository.claims, 0);
    equal(fixture.streams, 0);
  }
});

Deno.test("caller/model/connection/message mismatches and attachments cannot redirect canonical inference", async () => {
  const cases: Array<
    { body: Record<string, unknown>; user?: string; code: string }
  > = [
    { body: { thread_id: undefined }, code: "provider_invalid_request" },
    { body: { user_message_id: undefined }, code: "provider_invalid_request" },
    { body: { thread_id: OTHER_ID }, code: "provider_permission_required" },
    {
      body: { user_message_id: OTHER_ID },
      code: "provider_permission_required",
    },
    { body: {}, user: OTHER_USER, code: "provider_permission_required" },
    {
      body: {},
      user: "not-an-authenticated-uuid",
      code: "provider_invalid_request",
    },
    { body: { model: "other-model" }, code: "provider_invalid_request" },
    { body: { model: null }, code: "provider_invalid_request" },
    { body: { connection_id: OTHER_ID }, code: "provider_invalid_request" },
    {
      body: { connection_id: "invalid-uuid" },
      code: "provider_invalid_request",
    },
    {
      body: { message: "changed user text" },
      code: "provider_invalid_request",
    },
    { body: { attachment_ids: [OTHER_ID] }, code: "provider_unsupported" },
    {
      body: { attachments: [{ url: "https://example.invalid/image.png" }] },
      code: "provider_unsupported",
    },
    { body: { attachments: {} }, code: "provider_unsupported" },
    { body: { attachment_ids: null }, code: "provider_unsupported" },
  ];
  for (const { body, user, code } of cases) {
    const fixture = new Fixture();
    equal(await errorCode(await fixture.request(body, { user })), code);
    equal(fixture.credentials, 0);
    equal(fixture.repository.claims, 0);
    equal(fixture.streams, 0);
  }
  const bound = new Fixture();
  equal(
    (await collect(
      await bound.request({
        user_id: OTHER_USER,
        attachments: [],
        attachment_ids: [],
      }),
    )).at(-1)!.type,
    "done",
  );
  equal(bound.credentials, 1);
});

Deno.test("disconnect while model discovery is in progress prevents inference at the atomic claim", async () => {
  const fixture = new Fixture();
  fixture.afterModels = () => fixture.repository.connected = false;
  equal(await errorCode(await fixture.request()), "provider_auth_required");
  equal(fixture.streams, 0);
  equal(fixture.repository.current.state, null);
  equal(fixture.repository.saved.length, 0);
});

Deno.test("already-aborted requests do not claim a canonical turn or reach provider preflight", async () => {
  const fixture = new Fixture(), controller = new AbortController();
  controller.abort();
  const response = await fixture.request({}, { signal: controller.signal });
  if (response.headers.get("Content-Type") === "text/event-stream") {
    await collect(response);
  } else await errorCode(response);
  equal(fixture.streams, 0);
  equal(fixture.repository.claims, 0);
  equal(fixture.credentials, 0);
  equal(fixture.discoveries, 0);
  equal(fixture.repository.loads, 0);
});

Deno.test("cancellation during preflight leaves the user message available for a later real dispatch", async () => {
  const fixture = new Fixture(), controller = new AbortController();
  fixture.afterModels = () => controller.abort();
  const response = await fixture.request({}, { signal: controller.signal });
  if (response.headers.get("Content-Type") === "text/event-stream") {
    await collect(response);
  } else await errorCode(response);
  equal(fixture.streams, 0);
  equal(fixture.repository.claims, 0);
  equal(fixture.repository.current.state, null);
  fixture.afterModels = undefined;
  equal((await collect(await fixture.request())).at(-1)!.type, "done");
  equal(fixture.streams, 1);
});

Deno.test("request cancellation aborts in-flight provider work without saving partial output or redispatching", async () => {
  const fixture = new Fixture(), controller = new AbortController();
  const waiting = deferred();
  fixture.factory = async function* (input) {
    yield { type: "text", text: "Partial before cancellation" };
    await new Promise<void>((resolve) => {
      input.signal!.addEventListener("abort", () => resolve(), { once: true });
      waiting.resolve();
    });
    throw new ProviderError("provider_interrupted", 499);
  };
  const receiving = collect(
    await fixture.request({}, { signal: controller.signal }),
  );
  await waiting.promise;
  controller.abort();
  const received = await receiving;
  equal(fixture.capturedInput!.signal!.aborted, true);
  equal(received.at(-1)!.code, "provider_interrupted");
  assert(!received.some((event) => event.type === "done"));
  equal(fixture.repository.saved.length, 0);
  equal(fixture.repository.current.state, "unknown");
  equal(await errorCode(await fixture.request()), "provider_interrupted");
  equal(fixture.streams, 1);
});

Deno.test("canceling the response reader aborts the upstream and closes the journal safely", async () => {
  const fixture = new Fixture(), waiting = deferred();
  fixture.factory = async function* (input) {
    yield { type: "text", text: "Partial before receiver leaves" };
    await new Promise<void>((resolve) => {
      input.signal!.addEventListener("abort", () => resolve(), { once: true });
      waiting.resolve();
    });
    throw new ProviderError("provider_interrupted", 499);
  };
  const response = await fixture.request();
  const reader = response.body!.getReader();
  equal(
    parseFrames(new TextDecoder().decode((await reader.read()).value))[0].type,
    "content",
  );
  await waiting.promise;
  await reader.cancel();
  reader.releaseLock();
  await fixture.repository.markedUnknown.promise;
  await tick();
  equal(fixture.capturedInput!.signal!.aborted, true);
  equal(fixture.repository.saved.length, 0);
  equal(fixture.repository.current.state, "unknown");
  equal(await errorCode(await fixture.request()), "provider_interrupted");
  equal(fixture.streams, 1);
});

Deno.test("a receiver leaving after provider completion still preserves the canonical reply for recovery", async () => {
  const fixture = new Fixture();
  fixture.repository.saveGate = deferred();
  const response = await fixture.request();
  await fixture.repository.saveStarted.promise;
  const reader = response.body!.getReader();
  await reader.cancel();
  reader.releaseLock();
  fixture.repository.saveGate.resolve();
  await fixture.repository.markedFinished.promise;
  await tick();
  equal(fixture.repository.saved.length, 1);
  equal(fixture.repository.current.state, "finished");
  const replayed = await collect(await fixture.request());
  equal(replayed.at(-1)!.type, "done");
  equal(replayed.at(-1)!.message_id, fixture.repository.saved[0].id);
  equal(fixture.streams, 1);
  equal(fixture.credentials, 1);
});

Deno.test("long Unicode canonical replies recover in bounded frames without another provider call", async () => {
  const fixture = new Fixture();
  const content = "A😀\n".repeat(20000);
  fixture.repository.current = {
    claimed: false,
    state: "unknown",
    assistant_id: OTHER_ID,
  };
  fixture.repository.answers.set(OTHER_ID, {
    id: OTHER_ID,
    content,
    model: MODEL,
    tokens_used: 123,
  });
  const response = await fixture.request();
  const wire = await response.text();
  const frames = parseFrames(wire);
  equal(
    frames.filter((event) => event.type === "content").map((event) =>
      event.text
    ).join(""),
    content,
  );
  equal(frames.at(-1)?.message_id, OTHER_ID);
  assert(
    wire.split("\n\n").every((frame) =>
      new TextEncoder().encode(frame).byteLength < 64000
    ),
  );
  equal(fixture.repository.current.state, "finished");
  equal(fixture.credentials, 0);
  equal(fixture.streams, 0);
});
