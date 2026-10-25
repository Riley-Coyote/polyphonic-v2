import { buildLucaSystemPrompt } from "../agents/luca-soul.ts";
import { buildCustomAgentSystemPrompt } from "../agents/custom-agent-prompt.ts";
import { loadAgentIdentity } from "../agents/luca-identity.ts";
import {
  buildLucaPromptPartsFromContinuity,
  loadContinuityPacket,
} from "../continuity/kernel.ts";
import {
  formatProjectContextPrompt,
  loadProjectContextForThread,
} from "../projects/context.ts";
import type {
  CompletedAnswer,
  ConnectedTurn,
  ProviderChatRepository,
  SavedAnswer,
  TurnState,
} from "./chat-handler.ts";
import { data, type ProviderDataClient } from "./database.ts";
import { ProviderError, type ProviderMessage } from "./types.ts";
import { isObject, uuid } from "./vault.ts";

const capabilities = `## Current connection capabilities
This is text chat over the user's explicitly connected provider account. You can use the supplied conversation and continuity context. You do not have tools, web access, desktop access, image inputs, file access, scheduling, or background actions in this connection. Do not claim to perform those actions. Answer directly and honestly about what the supplied context supports.`;
const hasAttachments = (v: Record<string, unknown>) =>
  [v.attachments, v.attachment_ids].some((x) =>
    x != null && (!Array.isArray(x) || x.length > 0)
  );
function requireRow(value: unknown, user: string): Record<string, unknown> {
  if (!isObject(value) || value.user_id !== user) {
    throw new ProviderError("provider_permission_required", 403);
  }
  return value;
}
export class SupabaseProviderChatRepository implements ProviderChatRepository {
  constructor(private readonly db: ProviderDataClient) {}
  async load(
    user: string,
    thread: string,
    message: string,
  ): Promise<ConnectedTurn> {
    const [threadValue, messageValue] = await Promise.all([
      data(
        this.db.from("threads").select(
          "id,user_id,provider_connection_id,selected_model,agent_id,primary_agent_id",
        ).eq("user_id", user).eq("id", thread).maybeSingle(),
      ),
      data(
        this.db.from("messages").select(
          "id,user_id,thread_id,role,content,attachments,attachment_ids",
        ).eq("user_id", user).eq("thread_id", thread).eq("id", message)
          .maybeSingle(),
      ),
    ]);
    const t = requireRow(threadValue, user), m = requireRow(messageValue, user);
    if (
      t.id !== thread || m.id !== message || m.thread_id !== thread ||
      m.role !== "user" || typeof m.content !== "string" || !m.content.trim() ||
      m.content.length > 32000 || typeof t.selected_model !== "string" ||
      !t.selected_model || t.selected_model.length > 512
    ) throw new ProviderError("provider_invalid_request", 400);
    if (hasAttachments(m)) throw new ProviderError("provider_unsupported", 400);
    return {
      user,
      thread,
      message,
      connection: uuid(t.provider_connection_id),
      model: t.selected_model,
      text: m.content,
      agent: typeof t.agent_id === "string" && t.agent_id
        ? t.agent_id
        : typeof t.primary_agent_id === "string" && t.primary_agent_id
        ? t.primary_agent_id
        : "luca",
    };
  }
  async context(turn: ConnectedTurn): Promise<ProviderMessage[]> {
    const rows = await data(
      this.db.from("messages").select(
        "id,user_id,thread_id,role,content,agent,kind,attachments,attachment_ids",
      ).eq("user_id", turn.user).eq("thread_id", turn.thread).order(
        "created_at",
        { ascending: true },
      ).order("id", { ascending: true }).limit(201),
    );
    if (!Array.isArray(rows) || rows.length > 200) {
      throw new ProviderError("provider_too_large", 413);
    }
    const history: Array<ProviderMessage & { id: string }> = [];
    for (const value of rows) {
      const row = requireRow(value, turn.user);
      if (row.thread_id !== turn.thread) {
        throw new ProviderError("provider_permission_required", 403);
      }
      if (row.role !== "user" && row.role !== "assistant") continue;
      if (row.kind === "agent_error") continue;
      if (
        row.role === "assistant" && typeof row.agent === "string" &&
        row.agent !== turn.agent
      ) continue;
      if (hasAttachments(row)) {
        throw new ProviderError("provider_unsupported", 400);
      }
      if (typeof row.content !== "string") {
        throw new ProviderError("provider_malformed");
      }
      history.push({ id: uuid(row.id), role: row.role, content: row.content });
    }
    if (history.at(-1)?.id !== turn.message) {
      throw new ProviderError("provider_interrupted", 409);
    }
    if (history.reduce((sum, row) => sum + row.content.length, 0) > 250000) {
      throw new ProviderError("provider_too_large", 413);
    }
    const agent = turn.agent === "luca"
      ? { name: "Luca", prompt: "" }
      : await data(
        this.db.from("agent_configs").select("name,prompt,user_id").eq(
          "user_id",
          turn.user,
        ).eq("id", turn.agent).maybeSingle(),
      );
    if (
      !isObject(agent) || typeof agent.name !== "string" ||
      typeof agent.prompt !== "string"
    ) throw new ProviderError("provider_permission_required", 403);
    // These layers read existing continuity. No OpenRouter key, embedding call, classifier, auto-title or background model is invoked.
    const [packet, project] = await Promise.all([
      loadContinuityPacket({
        from: (table) => this.db.from(table),
        rpc: (name, args) => this.db.rpc(name, args ?? {}),
      }, {
        userId: turn.user,
        agentId: turn.agent,
        threadId: turn.thread,
        userMessage: turn.text,
        apiKey: null,
        includePendingRevisions: false,
        includeMnemos: false,
        includeSkills: false,
      }, {
        history: () => Promise.resolve(history.slice(0, -1)),
        identity: loadAgentIdentity,
      }),
      loadProjectContextForThread(this.db, turn.user, turn.thread),
    ]);
    const projectContextBlock = formatProjectContextPrompt(project);
    const system = turn.agent === "luca"
      ? buildLucaSystemPrompt({
        ...buildLucaPromptPartsFromContinuity(packet),
        projectContextBlock,
      })
      : buildCustomAgentSystemPrompt({
        agentName: agent.name,
        agentPrompt: agent.prompt,
        identityDocs: packet.identityDocs,
        projectContextBlock,
        hypomnemaBlock: packet.hypomnema.block,
        functionalMemoryBlock: packet.functionalMemoryBlock,
        memoryContext: packet.mnemosBlock,
        continuityNote: packet.continuityNote,
      });
    return [
      { role: "system", content: `${system}\n\n${capabilities}` },
      ...history.map(({ role, content }) => ({ role, content })),
    ];
  }
  async state(
    turn: ConnectedTurn,
    action: "status" | "claim" | "finish" | "unknown",
    assistant?: string,
  ): Promise<TurnState> {
    const value = await data(
      this.db.rpc("provider_turn", {
        p_action: action,
        p_user: turn.user,
        p_message: turn.message,
        p_thread: turn.thread,
        p_connection: turn.connection,
        p_assistant: assistant ?? null,
      }),
    );
    if (!isObject(value)) throw new ProviderError("provider_malformed");
    return value as TurnState;
  }
  async answer(turn: ConnectedTurn, id: string): Promise<SavedAnswer | null> {
    const value = await data(
      this.db.from("messages").select(
        "id,user_id,thread_id,role,content,model,tokens_used,metadata",
      ).eq("user_id", turn.user).eq("thread_id", turn.thread).eq("id", id)
        .maybeSingle(),
    );
    if (value === null) return null;
    const row = requireRow(value, turn.user);
    if (
      row.role !== "assistant" || row.id !== id ||
      typeof row.content !== "string" || typeof row.model !== "string" ||
      !isObject(row.metadata) ||
      row.metadata.provider_turn_id !== turn.message ||
      row.metadata.provider_connection_id !== turn.connection
    ) throw new ProviderError("provider_permission_required", 403);
    return {
      id,
      content: row.content,
      model: row.model,
      tokens_used: typeof row.tokens_used === "number" ? row.tokens_used : null,
    };
  }
  async save(turn: ConnectedTurn, answer: CompletedAnswer): Promise<void> {
    await data(
      this.db.from("messages").insert({
        id: answer.id,
        user_id: turn.user,
        thread_id: turn.thread,
        role: "assistant",
        agent: turn.agent,
        content: answer.text,
        model: answer.model,
        tokens_used: answer.inputTokens + answer.outputTokens,
        metadata: {
          provider_turn_id: turn.message,
          provider_connection_id: turn.connection,
          provider_response_id: answer.providerId,
          provider_status: "complete",
          input_tokens: answer.inputTokens,
          output_tokens: answer.outputTokens,
        },
      }),
    );
    await data(
      this.db.from("threads").update({ updated_at: new Date().toISOString() })
        .eq("user_id", turn.user).eq("id", turn.thread),
    ).catch(() => undefined);
  }
}
