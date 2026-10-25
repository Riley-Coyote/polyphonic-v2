import {
  type AnthropicCredential,
  type ProviderChatInput,
  ProviderError,
  type ProviderEvent,
  type ProviderFetch,
  type ProviderModel,
  type ProviderStopReason,
} from "./types.ts";

// Explicit stable API version; the public API origin is not user-configurable. A Console key can be workspace-scoped
// or require a workspace header. Neither a Claude subscription token nor a browser cookie is an API credential here.
const ORIGIN = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const MAX_JSON = 2_000_000;
const MAX_STREAM = 32_000_000;
const MAX_LINE = 1_000_000;
const MAX_TEXT = 2_000_000;

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderError("provider_malformed");
  }
  return value as RecordValue;
}
function identifier(value: unknown): string {
  if (
    typeof value !== "string" || !value || value.length > 512 ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new ProviderError("provider_malformed");
  }
  return value;
}
export function isAnthropicApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 &&
    /^sk-ant-(?:api|usr)[\x21-\x7e]+/.exec(value)?.[0] === value;
}
export function isAnthropicWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 &&
    /^wrkspc_[A-Za-z0-9]+$/.test(value);
}
function headers(credential: AnthropicCredential): Headers {
  if (
    !credential || credential.provider !== "anthropic" ||
    !isAnthropicApiKey(credential.apiKey)
  ) {
    throw new ProviderError("provider_api_key_invalid", 400);
  }
  const value = new Headers({
    Authorization: "Bearer " + credential.apiKey,
    "anthropic-version": VERSION,
    "Content-Type": "application/json",
  });
  if (credential.workspaceId !== undefined) {
    if (!isAnthropicWorkspaceId(credential.workspaceId)) {
      throw new ProviderError("provider_workspace_invalid", 400);
    }
    value.set("anthropic-workspace-id", credential.workspaceId);
  }
  return value;
}
function deadline(parent?: AbortSignal, milliseconds = 180_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
function safe(error: unknown, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  return signal.aborted
    ? new ProviderError("provider_interrupted", 499)
    : new ProviderError("provider_unavailable");
}
function upstreamError(status: number, value?: unknown): ProviderError {
  // Read error type for classification; never return/log the upstream message, which can echo a prompt or secret.
  const envelope = value && typeof value === "object"
    ? value as RecordValue
    : undefined;
  const error = envelope?.error && typeof envelope.error === "object"
    ? envelope.error as RecordValue
    : undefined;
  const type = error?.type;
  if (status === 401 || type === "authentication_error") {
    return new ProviderError("provider_auth_required", 401);
  }
  if (status === 403 || type === "permission_error") {
    return new ProviderError("provider_permission_required", 403);
  }
  if (
    status === 402 || type === "billing_error" ||
    (type === "invalid_request_error" && typeof error?.message === "string" &&
      /credit balance|insufficient credits/i.test(error.message))
  ) {
    return new ProviderError("provider_credits_required", 402);
  }
  if (status === 429 || type === "rate_limit_error") {
    return new ProviderError("provider_rate_limited", 429);
  }
  if (status === 413 || type === "request_too_large") {
    return new ProviderError("provider_too_large", 413);
  }
  if (
    type === "invalid_request_error" && typeof error?.message === "string" &&
    /API key is not scoped to a workspace|anthropic-workspace-id/i.test(
      error.message,
    )
  ) {
    return new ProviderError("provider_workspace_required", 400);
  }
  if (
    status === 400 || status === 404 || type === "invalid_request_error" ||
    type === "not_found_error"
  ) {
    return new ProviderError("provider_invalid_request", 400);
  }
  return new ProviderError("provider_unavailable");
}
async function json(
  response: Response,
  signal: AbortSignal,
  maximum = MAX_JSON,
): Promise<unknown> {
  if (!response.body) throw new ProviderError("provider_malformed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError("provider_interrupted", 499);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new ProviderError("provider_too_large", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ProviderError("provider_malformed");
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProviderError("provider_malformed");
    }
    throw error;
  } finally {
    try {
      await reader.cancel();
    } catch { /* response already closed */ }
    reader.releaseLock();
  }
}
async function accepted(response: Response, signal: AbortSignal) {
  if (response.ok) return;
  let detail: unknown;
  try {
    detail = await json(response, signal, 16_384);
  } catch (error) {
    if (signal.aborted) {
      throw error; /* classify status without exposing an invalid error body */
    }
  }
  throw upstreamError(response.status, detail);
}

/** Discover actual API model IDs without generating a billed answer. Keys never enter the returned model list. */
export async function listAnthropicModels(
  credential: AnthropicCredential,
  fetcher: ProviderFetch = fetch,
): Promise<ProviderModel[]> {
  const requestHeaders = headers(credential),
    scope = deadline(undefined, 30_000);
  const models = new Map<string, ProviderModel>(), cursors = new Set<string>();
  let after: string | undefined;
  try {
    for (let page = 0; page < 20; page++) {
      const url = new URL("/v1/models", ORIGIN);
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after_id", after);
      const response = await fetcher(url, {
        headers: requestHeaders,
        signal: scope.signal,
        redirect: "error",
      });
      await accepted(response, scope.signal);
      const body = record(await json(response, scope.signal));
      if (!Array.isArray(body.data) || typeof body.has_more !== "boolean") {
        throw new ProviderError("provider_malformed");
      }
      for (const item of body.data) {
        const row = record(item), id = identifier(row.id);
        if (row.type !== "model") throw new ProviderError("provider_malformed");
        if (row.lifecycle === "retired") continue;
        const name =
          typeof row.display_name === "string" && row.display_name.length <= 512
            ? row.display_name
            : id;
        models.set(id, { id, name });
        if (models.size > 1000) {
          throw new ProviderError("provider_too_large", 413);
        }
      }
      if (!body.has_more) return [...models.values()];
      after = identifier(body.last_id);
      if (cursors.has(after) || body.data.length === 0) {
        throw new ProviderError("provider_malformed");
      }
      cursors.add(after);
    }
    throw new ProviderError("provider_too_large", 413);
  } catch (error) {
    throw safe(error, scope.signal);
  } finally {
    scope.close();
  }
}

function body(input: ProviderChatInput): string {
  if (
    typeof input.model !== "string" || !input.model ||
    input.model.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.model)
  ) {
    throw new ProviderError("provider_invalid_request", 400);
  }
  const maxTokens = input.maxOutputTokens ?? 4096;
  if (
    !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 32_000 ||
    !Array.isArray(input.messages) || input.messages.length < 1 ||
    input.messages.length > 200
  ) {
    throw new ProviderError("provider_invalid_request", 400);
  }
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of input.messages) {
    if (!message || typeof message.content !== "string") {
      throw new ProviderError("provider_unsupported", 400);
    }
    if (message.role === "system") {
      if (messages.length) throw new ProviderError("provider_unsupported", 400);
      system.push(message.content);
    } else if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content });
    } else throw new ProviderError("provider_unsupported", 400);
  }
  if (
    !messages.length || messages.at(-1)?.role !== "user" ||
    !messages.at(-1)?.content.trim()
  ) {
    throw new ProviderError("provider_invalid_request", 400);
  }
  const value = JSON.stringify({
    model: input.model,
    max_tokens: maxTokens,
    messages,
    ...(system.length ? { system: system.join("\n\n") } : {}),
    stream: true,
  });
  if (new TextEncoder().encode(value).byteLength > MAX_JSON) {
    throw new ProviderError("provider_too_large", 413);
  }
  return value;
}

type Frame = { event?: string; data: string };
/** Byte-fragment-safe SSE: CR, LF and split CRLF work; comments/unknown fields do not enter assistant prose. */
async function* frames(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<Frame> {
  if (!response.body) throw new ProviderError("provider_malformed");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0,
    line = "",
    afterCR = false,
    event: string | undefined,
    data: string[] = [],
    size = 0;
  const finish = (): Frame | undefined => {
    const frame = data.length ? { event, data: data.join("\n") } : undefined;
    event = undefined;
    data = [];
    size = 0;
    return frame;
  };
  const take = (): Frame | undefined => {
    const value = line;
    line = "";
    if (value === "") return finish();
    if (value.startsWith(":")) return;
    if (value.startsWith("event:")) event = value.slice(6).replace(/^ /, "");
    if (value.startsWith("data:")) {
      const payload = value.slice(5).replace(/^ /, "");
      size += payload.length;
      if (size > MAX_LINE) throw new ProviderError("provider_too_large", 413);
      data.push(payload);
    }
  };
  function* lines(text: string): Generator<Frame> {
    for (const char of text) {
      if (afterCR && char === "\n") {
        afterCR = false;
        continue;
      }
      afterCR = char === "\r";
      if (char === "\r" || char === "\n") {
        const frame = take();
        if (frame) yield frame;
      } else {
        line += char;
        if (line.length > MAX_LINE) {
          throw new ProviderError("provider_too_large", 413);
        }
      }
    }
  }
  const decode = (bytes?: Uint8Array, stream = false) => {
    try {
      return decoder.decode(bytes, { stream });
    } catch {
      throw new ProviderError("provider_malformed");
    }
  };
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError("provider_interrupted", 499);
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_STREAM) {
        throw new ProviderError("provider_too_large", 413);
      }
      yield* lines(decode(value, true));
    }
    yield* lines(decode());
    if (line) {
      const frame = take();
      if (frame) yield frame;
    }
    const last = finish();
    if (last) yield last;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("provider_interrupted", signal.aborted ? 499 : 502);
  } finally {
    try {
      await reader.cancel();
    } catch { /* response already closed */ }
    reader.releaseLock();
  }
}
function count(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError("provider_malformed");
  }
  return value;
}
function usage(value: unknown): ProviderEvent {
  const row = record(value),
    inputTokens = count(row.input_tokens),
    outputTokens = count(row.output_tokens);
  // message_delta often contains only output_tokens. Omit absent keys so a caller retaining the latest cumulative
  // counts cannot overwrite its earlier input count with undefined.
  return {
    type: "usage",
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
function stopReason(value: unknown): ProviderStopReason {
  switch (value) {
    case "end_turn":
    case "stop_sequence":
      return "complete";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "refusal";
    default:
      throw new ProviderError("provider_unsupported");
  }
}

/** Initial route accepts text only. Tool handoffs are typed terminal outcomes; this adapter never executes a tool. */
export async function* streamAnthropic(
  input: ProviderChatInput,
  credential: AnthropicCredential,
  fetcher: ProviderFetch = fetch,
): AsyncIterable<ProviderEvent> {
  const requestHeaders = headers(credential),
    requestBody = body(input),
    scope = deadline(input.signal);
  try {
    if (scope.signal.aborted) {
      throw new ProviderError("provider_interrupted", 499);
    }
    const response = await fetcher(new URL("/v1/messages", ORIGIN), {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
      signal: scope.signal,
      redirect: "error",
    });
    await accepted(response, scope.signal);
    if (
      !response.headers.get("content-type")?.toLowerCase().includes(
        "text/event-stream",
      )
    ) throw new ProviderError("provider_malformed");
    let id: string | undefined,
      model = input.model,
      reason: ProviderStopReason | undefined,
      shown = 0,
      tools = false;
    const blocks = new Map<number, string>(), seen = new Set<number>();
    for await (const frame of frames(response, scope.signal)) {
      let value: RecordValue;
      try {
        value = record(JSON.parse(frame.data));
      } catch (error) {
        throw error instanceof ProviderError
          ? error
          : new ProviderError("provider_malformed");
      }
      const type = value.type;
      if (
        typeof type !== "string" ||
        (frame.event !== undefined && frame.event !== type)
      ) throw new ProviderError("provider_malformed");
      if (type === "ping") continue;
      if (type === "error") throw upstreamError(502, value);
      if (type === "message_start") {
        if (id) throw new ProviderError("provider_malformed");
        const message = record(value.message);
        if (
          message.role !== "assistant" || message.type !== "message" ||
          !Array.isArray(message.content) || message.content.length
        ) throw new ProviderError("provider_malformed");
        id = identifier(message.id);
        model = identifier(message.model);
        yield usage(message.usage);
      } else if (type === "content_block_start") {
        if (
          !id || !Number.isSafeInteger(value.index) ||
          (value.index as number) < 0 || seen.has(value.index as number)
        ) throw new ProviderError("provider_malformed");
        const block = record(value.content_block),
          blockType = identifier(block.type);
        blocks.set(value.index as number, blockType);
        seen.add(value.index as number);
        if (blockType === "tool_use" || blockType === "server_tool_use") {
          tools = true;
        }
        if (
          blockType === "text" && block.text !== undefined && block.text !== ""
        ) {
          if (typeof block.text !== "string") {
            throw new ProviderError("provider_malformed");
          }
          shown += new TextEncoder().encode(block.text).byteLength;
          if (shown > MAX_TEXT) {
            throw new ProviderError("provider_too_large", 413);
          }
          yield { type: "text", text: block.text };
        }
      } else if (type === "content_block_delta") {
        if (
          !id || !Number.isSafeInteger(value.index) ||
          !blocks.has(value.index as number)
        ) throw new ProviderError("provider_malformed");
        const delta = record(value.delta);
        if (delta.type === "text_delta") {
          if (
            blocks.get(value.index as number) !== "text" ||
            typeof delta.text !== "string"
          ) throw new ProviderError("provider_malformed");
          shown += new TextEncoder().encode(delta.text).byteLength;
          if (shown > MAX_TEXT) {
            throw new ProviderError("provider_too_large", 413);
          }
          yield { type: "text", text: delta.text };
        }
      } else if (type === "content_block_stop") {
        if (
          !Number.isSafeInteger(value.index) ||
          !blocks.delete(value.index as number)
        ) throw new ProviderError("provider_malformed");
      } else if (type === "message_delta") {
        if (!id) throw new ProviderError("provider_malformed");
        const delta = record(value.delta);
        if (delta.stop_reason !== undefined && delta.stop_reason !== null) {
          reason = stopReason(delta.stop_reason);
        }
        if (typeof delta.model === "string") model = identifier(delta.model);
        if (value.usage !== undefined) {
          yield usage(value.usage);
        }
      } else if (type === "message_stop") {
        if (!id || !reason || blocks.size) {
          throw new ProviderError("provider_malformed");
        }
        yield {
          type: "completed",
          id,
          model,
          stopReason: tools && reason === "complete" ? "tool_use" : reason,
        };
        return;
      }
      // Unknown future event types are ignored, but never reinterpreted as visible text or a completion.
    }
    throw new ProviderError("provider_interrupted");
  } catch (error) {
    throw safe(error, scope.signal);
  } finally {
    scope.close();
  }
}
