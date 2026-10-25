import type { UsableProviderCredential } from "./broker.ts";
import { failure } from "./http.ts";
import {
  type ProviderChatInput,
  ProviderError,
  type ProviderEvent,
} from "./types.ts";
import { isObject, uuid } from "./vault.ts";

export type ConnectedTurn = {
  user: string;
  thread: string;
  message: string;
  connection: string;
  model: string;
  text: string;
  agent: string;
};
export type TurnState = {
  claimed: boolean;
  state?: "dispatched" | "finished" | "unknown" | null;
  assistant_id?: string | null;
};
export type SavedAnswer = {
  id: string;
  content: string;
  model: string;
  tokens_used: number | null;
};
export type CompletedAnswer = {
  id: string;
  text: string;
  model: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
};
export type ProviderChatRepository = {
  load(user: string, thread: string, message: string): Promise<ConnectedTurn>;
  context(turn: ConnectedTurn): Promise<ProviderChatInput["messages"]>;
  state(
    turn: ConnectedTurn,
    action: "status" | "claim" | "finish" | "unknown",
    assistant?: string,
  ): Promise<TurnState>;
  answer(turn: ConnectedTurn, id: string): Promise<SavedAnswer | null>;
  save(turn: ConnectedTurn, answer: CompletedAnswer): Promise<void>;
};
export type ProviderChatDependencies = {
  repository: ProviderChatRepository;
  credential(
    user: string,
    connection: string,
  ): Promise<UsableProviderCredential>;
  models(
    credential: UsableProviderCredential,
  ): Promise<readonly { id: string }[]>;
  stream(
    input: ProviderChatInput,
    credential: UsableProviderCredential,
  ): AsyncIterable<ProviderEvent>;
};
const bytes = new TextEncoder();
const frame = (value: unknown) =>
  bytes.encode(`data: ${JSON.stringify(value)}\n\n`);
const done = (answer: SavedAnswer) => ({
  type: "done",
  message_id: answer.id,
  model: answer.model,
  tokens_used: answer.tokens_used,
  key_source: "connected_provider",
});
async function replay(
  turn: ConnectedTurn,
  state: TurnState,
  repository: ProviderChatRepository,
  headers: HeadersInit,
): Promise<Response> {
  if (state.assistant_id) {
    const answer = await repository.answer(turn, uuid(state.assistant_id));
    if (answer) {
      if (state.state !== "finished") {
        await repository.state(turn, "finish", answer.id);
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            // Recovery uses the same small SSE frames as live deltas, including for very long saved answers.
            for (let offset = 0; offset < answer.content.length;) {
              let end = Math.min(offset + 4096, answer.content.length);
              const last = answer.content.charCodeAt(end - 1);
              if (
                end < answer.content.length && last >= 0xD800 && last <= 0xDBFF
              ) end--;
              controller.enqueue(
                frame({
                  type: "content",
                  text: answer.content.slice(offset, end),
                }),
              );
              offset = end;
            }
            controller.enqueue(frame(done(answer)));
            controller.close();
          },
        }),
        {
          headers: {
            ...headers,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }
  throw new ProviderError("provider_interrupted", 409);
}
/** A canonical user row is the paid-dispatch identity. Replaying its request can only return persisted output. */
export async function providerChat(
  request: Request,
  body: Record<string, unknown>,
  user: string,
  deps: ProviderChatDependencies,
  headers: HeadersInit = {},
): Promise<Response> {
  let turn: ConnectedTurn;
  try {
    const checkCancelled = () => {
      if (request.signal.aborted) {
        throw new ProviderError("provider_interrupted", 499);
      }
    };
    checkCancelled();
    if (
      body.attachment_ids !== undefined &&
        (!Array.isArray(body.attachment_ids) || body.attachment_ids.length) ||
      body.attachments !== undefined &&
        (!Array.isArray(body.attachments) || body.attachments.length)
    ) throw new ProviderError("provider_unsupported", 400);
    turn = await deps.repository.load(
      uuid(user),
      uuid(body.thread_id),
      uuid(body.user_message_id),
    );
    if (
      (body.message !== undefined && body.message !== turn.text) ||
      (body.model !== undefined && body.model !== turn.model) ||
      (body.connection_id !== undefined &&
        uuid(body.connection_id) !== turn.connection)
    ) throw new ProviderError("provider_invalid_request", 400);
    const prior = await deps.repository.state(turn, "status");
    if (prior.state) return await replay(turn, prior, deps.repository, headers);
    const messages = await deps.repository.context(turn);
    checkCancelled();
    const credential = await deps.credential(user, turn.connection);
    if (
      !(await deps.models(credential)).some((model) => model.id === turn.model)
    ) throw new ProviderError("provider_permission_required", 403);
    checkCancelled();
    const assistant = crypto.randomUUID();
    const claim = await deps.repository.state(turn, "claim", assistant);
    if (!claim.claimed) {
      return await replay(turn, claim, deps.repository, headers);
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener("abort", cancel, { once: true });
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (!closed) {
            try {
              controller.enqueue(frame(event));
            } catch {
              closed = true;
              cancel();
            }
          }
        };
        const heartbeat = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(bytes.encode(": keepalive\n\n"));
            } catch {
              closed = true;
              cancel();
            }
          }
        }, 15_000);
        let text = "", textBytes = 0, inputTokens = 0, outputTokens = 0;
        let completion:
          | Extract<ProviderEvent, { type: "completed" }>
          | undefined;
        try {
          if (abort.signal.aborted) {
            throw new ProviderError("provider_interrupted", 499);
          }
          for await (
            const event of deps.stream({
              model: turn.model,
              messages,
              signal: abort.signal,
            }, credential)
          ) {
            if (completion || !isObject(event)) {
              throw new ProviderError("provider_malformed");
            }
            if (event.type === "text") {
              if (
                typeof event.text !== "string" ||
                (textBytes + bytes.encode(event.text).byteLength) > 2_000_000
              ) throw new ProviderError("provider_too_large", 413);
              textBytes += bytes.encode(event.text).byteLength;
              text += event.text;
              send({ type: "content", text: event.text });
            } else if (event.type === "usage") {
              inputTokens = Math.max(inputTokens, event.inputTokens ?? 0);
              outputTokens = Math.max(outputTokens, event.outputTokens ?? 0);
            } else if (event.type === "completed") completion = event;
            else throw new ProviderError("provider_malformed");
          }
          if (!completion || !text.trim()) {
            throw new ProviderError("provider_interrupted");
          }
          if (completion.stopReason !== "complete") {
            throw new ProviderError(
              completion.stopReason === "max_tokens"
                ? "provider_interrupted"
                : "provider_unsupported",
            );
          }
          // Persist even if the receiver leaves just after completion; history is the recovery source.
          await deps.repository.save(turn, {
            id: assistant,
            text,
            model: completion.model,
            providerId: completion.id,
            inputTokens,
            outputTokens,
          });
          await deps.repository.state(turn, "finish", assistant);
          send(
            done({
              id: assistant,
              content: text,
              model: completion.model,
              tokens_used: inputTokens + outputTokens,
            }),
          );
        } catch (error) {
          await deps.repository.state(turn, "unknown").catch(() => undefined);
          const safe = error instanceof ProviderError
            ? error
            : new ProviderError("provider_unavailable", 503);
          send({ type: "error", text: safe.message, code: safe.code });
        } finally {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", cancel);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        cancel();
      },
    });
    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return failure(error, headers);
  }
}
