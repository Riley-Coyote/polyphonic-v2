import {
  type ChatGPTCredential,
  type ProviderChatInput,
  ProviderError,
  type ProviderErrorCode,
  type ProviderEvent,
  type ProviderFetch,
  type ProviderModel,
} from "./types.ts";

const API = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const MAX_JSON_BYTES = 1_000_000;
const MAX_EVENT_BYTES = 2_000_000;
const MAX_TEXT_BYTES = 2_000_000;

function authorized(credential: ChatGPTCredential): void {
  if (
    credential.provider !== "chatgpt" || !credential.accessToken ||
    credential.accessToken.length > 32_768 ||
    /[\s\p{Cc}]/u.test(credential.accessToken) ||
    !credential.subject || !credential.clientId ||
    credential.clientId === "dynamic_agent_client" ||
    !Number.isFinite(credential.expiresAt) ||
    credential.expiresAt <= Date.now() / 1000
  ) {
    throw new ProviderError("provider_auth_required", 401);
  }
  if (
    !credential.grantedScopes.includes(PLAN_SCOPE) ||
    !credential.grantedScopes.includes("resource.invoke")
  ) {
    throw new ProviderError("provider_permission_required", 403);
  }
}

function codeFor(status: number, code?: string): ProviderErrorCode {
  if (code === "subscription_sharing_usage_limit_exceeded") {
    return "provider_rate_limited";
  }
  if (code === "subscription_sharing_user_not_eligible") {
    return "provider_permission_required";
  }
  if (code === "subscription_sharing_usage_unavailable") {
    return "provider_unavailable";
  }
  if (
    code === "invalid_api_key" || code === "invalid_token" ||
    code === "token_expired"
  ) return "provider_auth_required";
  if (status === 401) return "provider_auth_required";
  if (status === 403) return "provider_permission_required";
  if (status === 429) return "provider_rate_limited";
  if (status === 413) return "provider_too_large";
  if (status === 400 || status === 404 || status === 422) {
    return "provider_invalid_request";
  }
  return "provider_unavailable";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function bytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new ProviderError("provider_malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) throw new ProviderError("provider_too_large", 413);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  return data;
}

async function json(
  response: Response,
  maximum = MAX_JSON_BYTES,
): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await bytes(response, maximum),
      ),
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("provider_malformed");
  }
}

async function failure(response: Response): Promise<ProviderError> {
  let code: string | undefined;
  try {
    const body = record(await json(response, 16_384));
    const nested = record(body?.error);
    code = typeof nested?.code === "string"
      ? nested.code
      : typeof body?.code === "string"
      ? body.code
      : undefined;
  } catch {
    /* Raw provider prose, HTML and detail fields never enter a user-visible error. */
  }
  return new ProviderError(codeFor(response.status, code), response.status);
}

/** The plan endpoint returns models[], not the API-key catalog's data[]. Preserve account-specific ordering. */
export async function listChatGPTModels(
  credential: ChatGPTCredential,
  fetcher: ProviderFetch = fetch,
): Promise<ProviderModel[]> {
  authorized(credential);
  try {
    const response = await fetcher(`${API}/models`, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await failure(response);
    const body = record(await json(response));
    if (!Array.isArray(body?.models)) {
      throw new ProviderError("provider_malformed");
    }
    const result: ProviderModel[] = [], seen = new Set<string>();
    for (const value of body.models) {
      const model = record(value);
      if (model?.visibility !== "list") continue;
      if (
        typeof model.slug !== "string" || !model.slug ||
        model.slug.length > 256 ||
        typeof model.display_name !== "string" || !model.display_name ||
        model.display_name.length > 512
      ) {
        throw new ProviderError("provider_malformed");
      }
      if (!seen.has(model.slug)) {
        result.push({ id: model.slug, name: model.display_name });
        seen.add(model.slug);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("provider_unavailable", 503);
  }
}

function payload(input: ProviderChatInput): Record<string, unknown> {
  if (
    !input.model.trim() || input.model.length > 256 ||
    /\p{Cc}/u.test(input.model) ||
    !Array.isArray(input.messages) || input.messages.length < 1 ||
    input.messages.length > 200
  ) {
    throw new ProviderError("provider_invalid_request", 400);
  }
  let length = 0;
  const instructions: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of input.messages) {
    if (
      !message || typeof message.content !== "string" ||
      !["system", "user", "assistant"].includes(message.role)
    ) {
      throw new ProviderError("provider_invalid_request", 400);
    }
    length += new TextEncoder().encode(message.content).byteLength;
    if (length > 2_000_000) throw new ProviderError("provider_too_large", 413);
    if (message.role === "system") instructions.push(message.content);
    else messages.push({ role: message.role, content: message.content });
  }
  if (
    !messages.some((message) =>
      message.role === "user" && message.content.trim()
    )
  ) {
    throw new ProviderError("provider_invalid_request", 400);
  }
  // ChatGPT-plan HTTP requests require full context, store:false and streaming. Generic maxOutputTokens is not a
  // supported plan parameter, so it is deliberately omitted along with API-key-only tuning and conversation fields.
  return {
    model: input.model,
    input: messages,
    ...(instructions.length ? { instructions: instructions.join("\n\n") } : {}),
    store: false,
    stream: true,
  };
}

/** Byte-oriented SSE framing preserves split UTF-8, CR/LF boundaries, multiline data and a final event without LF. */
async function* frames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line: number[] = [],
    afterCR = false,
    event: string[] = [],
    eventLength = 0;
  function addLine(value: string): string | undefined {
    if (value === "") {
      const data = event.length ? event.join("\n") : undefined;
      event = [];
      eventLength = 0;
      return data;
    }
    if (!value.startsWith("data:")) return undefined;
    let data = value.slice(5);
    if (data.startsWith(" ")) data = data.slice(1);
    eventLength += new TextEncoder().encode(data).byteLength;
    if (eventLength > MAX_EVENT_BYTES) {
      throw new ProviderError("provider_too_large", 413);
    }
    event.push(data);
    return undefined;
  }
  function decoded(): string {
    try {
      return decoder.decode(new Uint8Array(line));
    } catch {
      throw new ProviderError("provider_malformed");
    }
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const byte of chunk.value) {
        if (byte === 10 && afterCR) {
          afterCR = false;
          continue;
        }
        afterCR = byte === 13;
        if (byte === 10 || byte === 13) {
          const data = addLine(decoded());
          line = [];
          if (data !== undefined) yield data;
        } else {
          line.push(byte);
          if (line.length > MAX_EVENT_BYTES) {
            throw new ProviderError("provider_too_large", 413);
          }
        }
      }
    }
    if (line.length) {
      const data = addLine(decoded());
      if (data !== undefined) yield data;
    }
    const data = addLine("");
    if (data !== undefined) yield data;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** A successful HTTP status or partial text is not completion. Nothing is retried or moved to another billing path. */
export async function* streamChatGPT(
  input: ProviderChatInput,
  credential: ChatGPTCredential,
  fetcher: ProviderFetch = fetch,
): AsyncGenerator<ProviderEvent> {
  authorized(credential);
  const body = payload(input);
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000);
  let shown = 0, refused = false;
  try {
    if (signal.aborted) throw new ProviderError("provider_interrupted");
    const response = await fetcher(`${API}/responses`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    if (
      !response.body ||
      !response.headers.get("content-type")?.toLowerCase().includes(
        "text/event-stream",
      )
    ) {
      throw new ProviderError("provider_malformed");
    }
    for await (const data of frames(response.body)) {
      if (signal.aborted) throw new ProviderError("provider_interrupted");
      if (data === "[DONE]") continue;
      let event: Record<string, unknown> | undefined;
      try {
        event = record(JSON.parse(data));
      } catch {
        throw new ProviderError("provider_malformed");
      }
      if (!event || typeof event.type !== "string") {
        throw new ProviderError("provider_malformed");
      }
      if (
        event.type === "response.output_text.delta" ||
        event.type === "response.refusal.delta"
      ) {
        if (typeof event.delta !== "string") {
          throw new ProviderError("provider_malformed");
        }
        if (event.type === "response.refusal.delta") refused = true;
        shown += new TextEncoder().encode(event.delta).byteLength;
        if (shown > MAX_TEXT_BYTES) {
          throw new ProviderError("provider_too_large", 413);
        }
        yield { type: "text", text: event.delta };
      } else if (event.type === "response.failed" || event.type === "error") {
        const failure = record(record(event.response)?.error) ??
          record(event.error) ?? event;
        const code = typeof failure.code === "string"
          ? failure.code
          : undefined;
        const mapped = codeFor(502, code);
        const status = mapped === "provider_rate_limited"
          ? 429
          : mapped === "provider_permission_required"
          ? 403
          : mapped === "provider_auth_required"
          ? 401
          : mapped === "provider_unavailable"
          ? 503
          : 502;
        throw new ProviderError(mapped, status);
      } else if (event.type === "response.incomplete") {
        throw new ProviderError("provider_interrupted");
      } else if (event.type === "response.completed") {
        const completed = record(event.response);
        if (
          !completed || typeof completed.id !== "string" || !completed.id ||
          completed.id.length > 512 ||
          (completed.status !== undefined && completed.status !== "completed")
        ) throw new ProviderError("provider_malformed");
        if (shown === 0) {
          const toolOnly = Array.isArray(completed.output) &&
            completed.output.some((item) => {
              const type = record(item)?.type;
              return typeof type === "string" && type !== "message" &&
                type !== "reasoning";
            });
          throw new ProviderError(
            toolOnly ? "provider_unsupported" : "provider_malformed",
          );
        }
        const usage = record(completed.usage);
        const inputTokens = tokenCount(usage?.input_tokens),
          outputTokens = tokenCount(usage?.output_tokens);
        if (inputTokens !== undefined || outputTokens !== undefined) {
          yield { type: "usage", inputTokens, outputTokens };
        }
        yield {
          type: "completed",
          id: completed.id,
          model: typeof completed.model === "string"
            ? completed.model
            : input.model,
          stopReason: refused ? "refusal" : "complete",
        };
        return;
      }
      // Hidden reasoning, tool/status events and unrecognized frames never become assistant prose.
    }
    throw new ProviderError("provider_interrupted");
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      signal.aborted || shown > 0
        ? "provider_interrupted"
        : "provider_unavailable",
      signal.aborted ? 499 : 503,
    );
  }
}
