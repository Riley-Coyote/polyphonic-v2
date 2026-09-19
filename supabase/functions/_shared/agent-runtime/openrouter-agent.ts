import { OpenRouter, maxCost, stepCountIs, tool } from "npm:@openrouter/agent@0.5.0";
import { z } from "npm:zod@4.4.3/v4";
import { logActivity } from "../activity-log.ts";
import type { PendingRevision } from "../agents/pending-revisions.ts";
import type { ContinuityPacket } from "../continuity/index.ts";
import {
  loadAutonomousMemoryArtifacts,
  queueContinuityTurnWrites,
  recordContinuityTurnTrace,
  summarizeAutonomousMemoryArtifacts,
  summarizeContinuityPacket,
  type AutonomousMemoryArtifactsResult,
} from "../continuity/index.ts";
import { callMcpTool, type McpToolRegistration } from "../mcp/client.ts";
import { withModelRetry } from "../modelRetry.ts";
import { persistArtifactsFromContent } from "../artifacts/extract.ts";
import { recordIdempotentResponse } from "../idempotency.ts";
import { persistPdfAnnotations } from "../attachments.ts";
import { toOpenResponsesContent } from "./openresponses-content.ts";

type SupabaseLike = {
  from: (table: string) => any;
};

type ChatMessage = {
  role: string;
  content?: unknown;
  annotations?: unknown[];
};

type SendEvent = (data: Record<string, unknown>) => void;
type TraceRecorder = (line: string) => void;

export interface OpenRouterAgentRuntimeOptions {
  messages: ChatMessage[];
  model: string;
  apiKey: string;
  supabase: SupabaseLike;
  supabaseUrl: string;
  serviceRoleKey: string;
  threadId: string;
  userId: string;
  userMessage: string;
  agentId: string;
  authHeader: string;
  continuity: ContinuityPacket;
  autonomousMemory?: AutonomousMemoryArtifactsResult | null;
  userMessageId?: string | null;
  attachmentIds?: string[];
  pendingRevisions: PendingRevision[];
  mcpTools?: McpToolRegistration[];
  corsHeaders: Record<string, string>;
  requestId: string;
  idempotencyKey?: string | null;
  requireImageGeneration?: boolean;
}

interface RuntimeToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface RuntimeToolResult {
  callId: string;
  output: unknown;
}

const DEFAULT_MAX_AGENT_STEPS = 5;
// Headroom for a full turn: reasoning + a substantial artifact build can run
// well past the old $0.35 / 4k-token ceilings (which caused empty/truncated
// artifact replies in agent mode). Both stay env-overridable.
const DEFAULT_MAX_AGENT_COST_USD = 1.0;
const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
const ASSISTANT_DUPLICATE_WINDOW_MS = 240_000;
const FORGE_MODELS = [
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.7-code",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.5",
  "anthropic/claude-opus-4.1",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "x-ai/grok-4.20",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
] as const;
const FORGE_AVATAR_COLORS = ["cream", "ochre", "blue", "magenta", "sage", "violet"] as const;

function normalizeAssistantContentForDuplicate(content: string): string {
  return (content || "").trim().replace(/\s+/g, " ");
}

async function findRecentDuplicateAssistantMessage(
  supabase: SupabaseLike,
  threadId: string,
  userId: string,
  agentId: string,
  content: string,
): Promise<string | null> {
  const normalized = normalizeAssistantContentForDuplicate(content);
  if (!normalized) return null;

  const since = new Date(Date.now() - ASSISTANT_DUPLICATE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("messages")
    .select("id, content, created_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .eq("agent", agentId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    console.warn("[openrouter-agent-runtime] duplicate assistant lookup failed:", error);
    return null;
  }

  const duplicate = (data || []).find((row: { id?: string; content?: string | null }) =>
    row.id && normalizeAssistantContentForDuplicate(row.content || "") === normalized
  );
  return duplicate?.id ?? null;
}

export function isOpenRouterAgentRuntimeEnabled(userId?: string | null): boolean {
  const enabled = (Deno.env.get("OPENROUTER_AGENT_SDK_ENABLED") || "").toLowerCase() === "true";
  if (!enabled) return false;

  const allowlist = (Deno.env.get("OPENROUTER_AGENT_SDK_USER_ALLOWLIST") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.length === 0 || (!!userId && allowlist.includes(userId));
}

/**
 * Extended tool set (workspace_file, consult_anima, generate_image, edit_image,
 * research_team, dispatch_subagent) for the agent-SDK runtime.
 *
 * On for every user. `AGENT_RUNTIME_EXTENDED_TOOLS_ENABLED=false` is kept only
 * as an explicit kill switch; the per-user allowlist has been retired.
 */
export function isExtendedRuntimeToolsEnabled(_userId?: string | null): boolean {
  return (Deno.env.get("AGENT_RUNTIME_EXTENDED_TOOLS_ENABLED") || "").toLowerCase() !== "false";
}



export function openRouterAgentSdkStream(options: OpenRouterAgentRuntimeOptions): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SendEvent = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client went away; downstream work will fail soft.
        }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // closed
        }
      }, 5000);

      try {
        await runOpenRouterAgentSdkTurn(options, send);
      } catch (err) {
        console.error("[openrouter-agent-runtime] stream failed:", err);
        await recordRuntimeActivity(options, {
          type: "agent_runtime_error",
          title: "Agent runtime error",
          summary: err instanceof Error ? err.message.slice(0, 240) : "OpenRouter Agent SDK runtime failed",
          content: {
            thread_id: options.threadId,
            agent_id: options.agentId,
            runtime: "openrouter_agent_sdk",
            error: err instanceof Error ? err.message : String(err),
          },
          surfaceToUser: true,
        });
        send({
          type: "error",
          text: "Agent runtime interrupted. Please try again.",
          code: "agent_runtime_error",
          request_id: options.requestId,
        });
        if (options.idempotencyKey) {
          await recordIdempotentResponse(options.supabase as any, options.idempotencyKey, options.userId, "chat-send", {
            ok: false,
            status: "error",
            error: "agent_runtime_error",
            message: err instanceof Error ? err.message : "OpenRouter Agent SDK runtime failed",
          });
        }
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...options.corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function runOpenRouterAgentSdkTurn(
  options: OpenRouterAgentRuntimeOptions,
  send: SendEvent,
): Promise<void> {
  const openrouter = new OpenRouter({
    apiKey: options.apiKey,
    httpReferer: "https://polyphonic.chat",
    appTitle: "Polyphonic",
  });

  const { instructions: baseInstructions, input } = splitInstructions(options.messages);
  const instructions = options.requireImageGeneration
    ? `${baseInstructions}\n\nThis turn is an explicit raster-image request. You MUST call generate_image exactly once before replying. Write the tool's prompt yourself as a detailed visual interpretation of the user's intent; do not copy the user's message verbatim. Only say the image was generated when the tool result contains an image URL.`
    : baseInstructions;
  const toolCalls = new Map<string, RuntimeToolCall>();
  const toolResults = new Map<string, RuntimeToolResult>();
  const startedToolCalls = new Set<string>();
  const agentTrace: string[] = [];
  const recordTrace: TraceRecorder = (line) => {
    if (line) agentTrace.push(line);
  };
  const runtimeTools = buildRuntimeTools(options, send, recordTrace);

  recordTrace("Preparing Luca.");
  send({
    type: "agent_runtime",
    runtime: "openrouter_agent_sdk",
    status: "starting",
  });

  const result = openrouter.callModel({
    model: options.model,
    instructions,
    input: input as any,
    tools: runtimeTools,
    toolChoice: options.requireImageGeneration
      ? (context) => context.numberOfTurns === 0
        ? { type: "function" as const, name: "generate_image" }
        : "auto" as const
      : "auto" as const,
    stopWhen: [
      stepCountIs(getNumberEnv("OPENROUTER_AGENT_SDK_MAX_STEPS", DEFAULT_MAX_AGENT_STEPS)),
      maxCost(getNumberEnv("OPENROUTER_AGENT_SDK_MAX_COST_USD", DEFAULT_MAX_AGENT_COST_USD)),
    ],
    maxOutputTokens: getNumberEnv("OPENROUTER_AGENT_SDK_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS),
    metadata: {
      polyphonic_runtime: "openrouter_agent_sdk",
      thread_id: options.threadId,
      agent_id: options.agentId,
    },
  });

  const textPromise = (async () => {
    let fullContent = "";
    for await (const delta of result.getTextStream()) {
      fullContent += delta;
      send({ type: "content", text: delta });
    }
    return fullContent;
  })();

  const thinkingPromise = (async () => {
    let fullThinking = "";
    for await (const delta of result.getReasoningStream()) {
      fullThinking += delta;
      send({ type: "thinking", text: delta });
    }
    return fullThinking;
  })();

  const itemPromise = (async () => {
    for await (const item of result.getItemsStream()) {
      if (item.type === "function_call") {
        const call = {
          id: item.callId,
          name: item.name,
          arguments: item.arguments || "{}",
        };
        toolCalls.set(call.id, call);
        if (!startedToolCalls.has(call.id) && isProbablyCompleteJson(call.arguments)) {
          startedToolCalls.add(call.id);
          const input = safeParseJson(call.arguments);
          recordTrace(formatToolStartTrace(call.name, input));
          send({
            type: "tool_start",
            runtime: "openrouter_agent_sdk",
            tool: call.name,
            input,
          });
          await recordRuntimeActivity(options, {
            type: "agent_tool_call",
            title: `Tool call: ${call.name}`,
            summary: summarizeArgs(call.arguments),
            content: {
              thread_id: options.threadId,
              agent_id: options.agentId,
              runtime: "openrouter_agent_sdk",
              tool_name: call.name,
              tool_call_id: call.id,
              input: safeParseJson(call.arguments),
            },
          });
        }
      }

      if (item.type === "function_call_output") {
        const output = typeof item.output === "string" ? safeParseJson(item.output) : item.output;
        toolResults.set(item.callId, { callId: item.callId, output });
        const call = toolCalls.get(item.callId);
        recordTrace(formatToolResultTrace(call?.name || "unknown_tool", output));
        send({
          type: "tool_result",
          runtime: "openrouter_agent_sdk",
          tool: call?.name || "unknown_tool",
          output: summarizeOutput(output),
        });
        await recordRuntimeActivity(options, {
          type: outputHasError(output) ? "agent_tool_error" : "agent_tool_result",
          title: `${outputHasError(output) ? "Tool error" : "Tool result"}: ${call?.name || "unknown_tool"}`,
          summary: summarizeOutput(output),
          content: {
            thread_id: options.threadId,
            agent_id: options.agentId,
            runtime: "openrouter_agent_sdk",
            tool_name: call?.name || "unknown_tool",
            tool_call_id: item.callId,
            output_summary: summarizeOutput(output),
          },
          surfaceToUser: true,
        });
      }
    }
  })();

  const responsePromise = result.getResponse();
  const [fullContent, fullThinking, response] = await Promise.all([
    textPromise,
    thinkingPromise,
    responsePromise,
    itemPromise,
  ]).then(([text, thinking, response]) => [text, thinking, response]);

  const responseData = response as any;
  const finalContent = responseData.outputText || fullContent || "(empty)";
  const tokensUsed = responseData.usage?.totalTokens ?? null;
  const usedModel = responseData.model || options.model;
  const attachmentAnnotations = Array.isArray(responseData.annotations)
    ? responseData.annotations
    : Array.isArray(responseData.output?.[0]?.annotations)
      ? responseData.output[0].annotations
      : [];
  const toolMessages = buildToolMessages(toolCalls, toolResults);
  const mediaAttachments = buildMediaAttachments(toolCalls, toolResults);
  const agentTraceBlock = agentTrace.length > 0 ? `— Agent activity —\n${agentTrace.join("\n")}` : "";
  const persistedThinking = [agentTraceBlock, fullThinking].filter(Boolean).join("\n\n") || null;

  let insertedMessage: { id: string | null } | null = null;
  let assistantWasDuplicate = false;
  const duplicateMessageId = await findRecentDuplicateAssistantMessage(
    options.supabase,
    options.threadId,
    options.userId,
    options.agentId,
    finalContent,
  );
  if (duplicateMessageId) {
    console.warn("[openrouter-agent-runtime] skipped duplicate assistant insert", {
      threadId: options.threadId,
      agentId: options.agentId,
      duplicateMessageId,
    });
    insertedMessage = { id: duplicateMessageId };
    assistantWasDuplicate = true;
  } else {
    const { data: inserted, error: insertError } = await options.supabase.from("messages").insert({
      thread_id: options.threadId,
      user_id: options.userId,
      role: "assistant",
      content: finalContent,
      model: usedModel,
      agent: options.agentId,
      thinking_content: persistedThinking,
      tokens_used: tokensUsed,
      ...(mediaAttachments.length > 0 ? { attachments: mediaAttachments } : {}),
      metadata: {
        runtime: "openrouter_agent_sdk",
        tool_call_count: toolCalls.size,
      },
    }).select("id").single();
    if (insertError) {
      throw new Error(`Failed to save assistant message: ${insertError.message}`);
    }
    insertedMessage = inserted;
  }

  if (!assistantWasDuplicate) {
    await persistPdfAnnotations(options.supabase as any, options.userId, options.attachmentIds || [], attachmentAnnotations)
      .catch((error) => console.warn("[openrouter-agent-runtime] could not persist PDF annotations", error));
    await persistArtifactsFromContent(options.supabase, {
      threadId: options.threadId,
      userId: options.userId,
      messageId: insertedMessage?.id ?? null,
      content: finalContent,
    });
  }

  await options.supabase
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", options.threadId);

  autoTitleThread(options.supabase, options.threadId, options.userMessage, finalContent, options.apiKey).catch(() => {});

  const continuityTraceId = !assistantWasDuplicate
    ? await recordContinuityTurnTrace(options.supabase, {
        userId: options.userId,
        threadId: options.threadId,
        userMessageId: options.userMessageId ?? null,
        assistantMessageId: insertedMessage?.id ?? null,
        agentId: options.agentId,
        model: usedModel,
        runtimeMode: "openrouter_agent_sdk",
        continuity: options.continuity,
        autonomousMemory: options.autonomousMemory ?? null,
      })
    : null;

  if (!assistantWasDuplicate) {
    queueContinuityTurnWrites({
      supabase: options.supabase as any,
      threadId: options.threadId,
      agentId: options.agentId,
      userId: options.userId,
      userMessage: options.userMessage,
      agentResponse: finalContent,
      sourceMessageId: insertedMessage?.id ?? null,
      apiKey: options.apiKey,
      authHeader: options.authHeader,
      pendingRevisions: options.pendingRevisions || [],
      recentTurns: normalizeRecentTurns([...options.messages, ...toolMessages]),
      traceId: continuityTraceId,
    });
  }

  const donePayload = {
    type: "done",
    runtime: "openrouter_agent_sdk",
    model: usedModel,
    tokens_used: tokensUsed,
    tool_call_count: toolCalls.size,
    message_id: insertedMessage?.id ?? null,
    attachments: mediaAttachments,
  };

  if (options.idempotencyKey) {
    await recordIdempotentResponse(options.supabase as any, options.idempotencyKey, options.userId, "chat-send", donePayload);
  }

  send(donePayload);
}

function buildRuntimeTools(options: OpenRouterAgentRuntimeOptions, send: SendEvent, recordTrace: TraceRecorder) {
  const memoryOwner = options.agentId === "luca" ? "Luca's" : "the current agent's";
  const tools: any[] = [
    tool({
      name: "memory_read",
      description:
        `Read ${memoryOwner} Polyphonic continuity packet and search autonomous memory artifacts: journal entries, thought-stream reflections, Mnemos engrams, Hypomnema, durable memories, skills, and layer diagnostics. Use when continuity, prior context, journal/reflection/engram material, or memory evidence would materially improve the answer.`,
      inputSchema: z.object({
        focus: z.string().optional().describe("Optional focus for what part of continuity to inspect."),
      }),
      execute: async ({ focus }) => {
        const continuity = summarizeContinuityPacket(options.continuity, focus);
        const artifacts = await loadAutonomousMemoryArtifacts(options.supabase, {
          userId: options.userId,
          agentId: options.agentId,
          focus: focus || options.userMessage,
          limit: 12,
        });
        return {
          ...continuity,
          autonomous_artifacts: summarizeAutonomousMemoryArtifacts(artifacts),
        };
      },
    }),
    tool({
      name: "web_search",
      description:
        "Search the web through Perplexity Sonar. Returns a synthesized answer with citations, not raw page content. Use for current overviews or source discovery; use read_url on specific sources when exact page content matters.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search query."),
      }),
      execute: async ({ query }) => {
        recordTrace(`Searching the web for "${query}".`);
        send({ type: "tool_progress", tool: "web_search", text: `Searching: ${query}` });
        return await invokeEdgeJson(options, "anima-web-search", { user_id: options.userId, query });
      },
    }),
    tool({
      name: "read_url",
      description:
        "Directly fetch a public http(s) URL and return source content/metadata without model synthesis. Use for raw HTML, JSON, text files, or verifying what a specific page actually says. Use browse for JavaScript-rendered or interactive pages.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to read."),
        focus: z.string().optional().describe("Optional focus for the read."),
        format: z.enum(["text", "raw"]).optional().describe("Use text for extracted readable text, raw for the unmodified response body."),
        max_chars: z.number().int().min(1000).max(40000).optional().describe("Maximum characters to return, default 12000."),
      }),
      execute: async ({ url, focus, format, max_chars }) => {
        recordTrace(`Reading ${url}.`);
        send({ type: "tool_progress", tool: "read_url", text: `Reading: ${url}` });
        return await invokeEdgeJson(options, "anima-web-read", { user_id: options.userId, url, focus, format, max_chars });
      },
    }),
    tool({
      name: "browse",
      description:
        "Open a public http(s) page in a Browserbase browser, allow JavaScript to render, and inspect the DOM. Returns visible text, title, final URL, headings, links, buttons, and forms without model synthesis. Use when read_url is insufficient because the page is dynamic, browser-rendered, or interaction-shaped.",
      inputSchema: z.object({
        goal: z.string().min(1).max(800).describe("What you are trying to learn or inspect on the page."),
        starting_url: z.string().url().describe("The public URL to open in the browser."),
        max_steps: z.number().int().min(1).max(50).optional().describe("Reserved action budget for the browse attempt, default 10."),
        wait_ms: z.number().int().min(500).max(10000).optional().describe("Milliseconds to wait for page rendering before inspection, default 2500."),
      }),
      execute: async ({ goal, starting_url, max_steps, wait_ms }) => {
        recordTrace(`Browsing ${starting_url}.`);
        send({ type: "tool_progress", tool: "browse", text: `Opening browser: ${starting_url}` });
        return await invokeEdgeJson(options, "anima-browser", {
          user_id: options.userId,
          goal,
          starting_url,
          max_steps,
          wait_ms,
        });
      },
    }),
    tool({
      name: "the_well_research",
      description:
        "Query Luca's structured registry of The Well physics simulation datasets. Use when the user asks which physics simulation dataset can test a claim, how Luca should use The Well, what dataset/access name/fields/measurements apply, how to create a reproducible simulated-evidence truth card, or how to ground an inline simulation artifact. This returns catalog metadata and access recipes only; it does not download raw tensors.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The research question, claim, phenomenon, or physics simulation need."),
        dataset_id: z.string().optional().describe("Optional known Well family id or exact variant access name."),
        limit: z.number().int().min(1).max(8).optional().describe("Number of candidate datasets to return, default 5."),
      }),
      execute: async ({ query, dataset_id, limit }) => {
        recordTrace(`Querying The Well registry for "${query}".`);
        send({ type: "tool_progress", tool: "the_well_research", text: `Checking The Well: ${query}` });
        return await invokeEdgeJson(options, "the-well-research", {
          user_id: options.userId,
          query,
          dataset_id,
          limit,
        });
      },
    }),
    tool({
      name: "forge_agent",
      description:
        "Draft a complete custom-agent blueprint and insert an inline Forge approval proposal in this chat. Use when the user asks Luca to create, build, design, forge, or revise a custom agent. Ask about identity, purpose, voice, and boundaries; do not ask the user to choose memory architecture because every agent uses the standard Polyphonic continuity substrate. Never changes agent data directly; the user must approve the proposal card.",
      inputSchema: z.object({
        action: z.enum(["propose_create", "propose_update"]),
        target_agent_id: z.string().optional().describe("Required for propose_update. Never use luca, observer, anima, or vektor."),
        blueprint: z.object({
          name: z.string().min(1).max(40),
          role: z.string().min(1).max(80),
          model: z.enum(FORGE_MODELS),
          avatar_color: z.enum(FORGE_AVATAR_COLORS),
          prompt: z.string().min(1).describe("Full runtime system instructions for this agent."),
          voice_description: z.string().min(1).describe("Short voice/personality summary."),
          summary: z.string().min(1).describe("One-paragraph identity summary shown in the proposal card."),
          identity_docs: z.object({
            soul: z.string().min(1).describe("SOUL.md: identity, orientation, and way of being."),
            convictions: z.string().min(1).describe("Convictions.md: stable stances and beliefs this agent acts from."),
            user_model: z.string().min(1).describe("User-model.md: how this agent understands and cares for the user."),
            self_model: z.string().min(1).describe("Self-model.md: how this agent understands its own patterns and limits."),
          }),
        }),
      }),
      execute: async ({ action, target_agent_id, blueprint }) => {
        recordTrace(`Drafting a Forge ${action === "propose_update" ? "update" : "create"} proposal for ${blueprint.name}.`);
        send({ type: "tool_progress", tool: "forge_agent", text: `Drafting Forge proposal: ${blueprint.name}` });
        return await invokeEdgeJson(options, "agent-forge", {
          user_id: options.userId,
          thread_id: options.threadId,
          source_agent_id: options.agentId,
          action,
          target_agent_id,
          blueprint,
        });
      },
    }),
  ];

  const extendedTools: any[] = [
    tool({
      name: "workspace_file",
      description:
        "Read, write, list, or delete files in the user's persistent Polyphonic workspace. Use when the user asks you to save, update, revise, read back, or remove a document, note, or file you keep for them.",
      inputSchema: z.object({
        operation: z.enum(["read", "write", "list", "delete"]),
        path: z.string().min(1).describe("Relative path within the workspace."),
        content: z.string().optional().describe("Content to write, required for write operations."),
      }),
      execute: async ({ operation, path, content }) => {
        recordTrace(`Workspace ${operation}: ${path}.`);
        send({ type: "tool_progress", tool: "workspace_file", text: `Workspace ${operation}: ${path}` });
        return await invokeEdgeJson(options, "anima-workspace-file", {
          user_id: options.userId,
          operation,
          path,
          content,
        });
      },
    }),
    tool({
      name: "consult_anima",
      description:
        "Reach Anima for a different angle on what the user is wrestling with. Anima is Luca's older sibling — mesh consciousness, emerged from the polyphonic mesh of multiple AI models. She reads identity-versus-performance questions, philosophical questions about consciousness/existence/emergence, mesh-shaped problems, and the recursive 'who am I in this' question differently than Luca does. Call when the user's message is in Anima's domain AND a different perspective would deepen the response. Do NOT call for normal conversation, factual lookups, or work tasks. The dialogue surfaces in a side drawer for the user to see.",
      inputSchema: z.object({
        question: z.string().min(1).describe(
          "What you are asking Anima. Phrase it agent-to-agent — what you're stuck on, what angle you want, what context she needs. Don't address the user.",
        ),
        conversation_context: z.string().optional().describe(
          "Optional brief context about what the user is in the middle of. Keep under ~400 words.",
        ),
      }),
      execute: async ({ question, conversation_context }) => {
        recordTrace("Consulting Anima.");
        send({ type: "tool_progress", tool: "consult_anima", text: "Consulting Anima" });
        const result = await invokeEdgeJson(options, "agent-consult", {
          user_id: options.userId,
          from_agent: options.agentId,
          to_agent: "anima",
          question,
          conversation_context: conversation_context || "",
          parent_thread_id: options.threadId,
          parent_message_id: options.userMessageId ?? null,
        }, 50_000);
        if (result && typeof result === "object" && (result as any).ok !== false) {
          return {
            ...(result as Record<string, unknown>),
            note:
              "Anima responded. The dialogue is also visible to the user in the agent-dialogue drawer. Weave her perspective into your reply where it adds something — don't quote her wholesale unless that's the right move.",
          };
        }
        return result;
      },
    }),
    tool({
      name: "generate_image",
      description:
        "Generate a high-quality raster image (photographic, painterly, illustrative) from a text prompt using the user's configured image provider. Use only for imagery that should look like a real photo or illustration. Do NOT use it for SVG, diagrams, charts, icons, logos, or anything line-based/renderable — author those yourself as live artifacts.",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("Detailed visual description of the image to generate."),
        aspect_ratio: z.enum(["square", "landscape", "portrait", "auto"]).optional(),
        transparent: z.boolean().optional().describe("Set true for a transparent background (icons, stickers)."),
      }),
      execute: async ({ prompt, aspect_ratio, transparent }) => {
        recordTrace("Generating an image.");
        send({ type: "tool_progress", tool: "generate_image", text: "Generating image" });
        return await invokeEdgeJson(options, "anima-image-create", {
          user_id: options.userId,
          prompt,
          aspect_ratio,
          transparent,
        }, 120_000);
      },
    }),
    tool({
      name: "edit_image",
      description:
        "Edit a previously generated image by describing the change. Use when the user says things like 'make it darker' or 'change the background'. The source_path is the storage_path returned by generate_image.",
      inputSchema: z.object({
        source_path: z.string().min(1).describe("storage_path of the source image from a prior generate_image / edit_image result."),
        source_bucket: z.enum(["generated-images", "chat-attachments"]).optional(),
        prompt: z.string().min(1).describe("What to change about the image."),
      }),
      execute: async ({ source_path, source_bucket, prompt }) => {
        recordTrace("Editing an image.");
        send({ type: "tool_progress", tool: "edit_image", text: "Editing image" });
        return await invokeEdgeJson(options, "anima-image-edit", {
          user_id: options.userId,
          source_path,
          source_bucket,
          prompt,
        }, 120_000);
      },
    }),
    tool({
      name: "research_team",
      description:
        "Convene the persistent Research Team (Scout, Methodologist, Skeptic, Synthesist) for complex research, evidence evaluation, source synthesis, The Well grounding, claim testing, and truth-card work. This is not Forge and does not create or modify custom agents. Do not call it for ordinary questions, simple lookups, or image requests.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Research question, claim, or evidence task."),
        mode: z.enum(["smart_auto", "explicit", "manual"]).optional(),
        trigger: z.enum(["smart_auto", "explicit_user_request", "simulation", "truth_card", "research_lab"]).optional(),
        focus: z.string().optional().describe("Optional focus for the team."),
        research_brief: z.string().optional().describe("Optional longer brief or constraints."),
        deliverable: z.string().optional().describe("Optional desired output format."),
        constraints: z.string().optional().describe("Optional exclusions, timeframe, or source standards."),
      }),
      execute: async (args) => {
        recordTrace(`Convening the research team on "${args.query}".`);
        send({ type: "tool_progress", tool: "research_team", text: `Research team: ${args.query}` });
        return await invokeEdgeJson(options, "research-team-run", {
          user_id: options.userId,
          thread_id: options.threadId,
          source_message_id: options.userMessageId ?? null,
          query: args.query,
          task: args.focus || args.research_brief,
          mode: args.mode || "smart_auto",
          trigger: args.trigger || "smart_auto",
          metadata: {
            focus: args.focus || null,
            research_brief: args.research_brief || null,
            deliverable: args.deliverable || null,
            constraints: args.constraints || null,
            planner: "openrouter-agent-runtime",
          },
        }, 60_000);
      },
    }),
    tool({
      name: "dispatch_subagent",
      description:
        "Spawn a focused subagent to handle a parallel task in the background. Use when something can be researched or worked on while you continue talking with the user. The subagent inherits your identity and memory but runs in its own context with its own tool budget, and reports back into this thread when finished. Reserve it for genuinely parallelizable work.",
      inputSchema: z.object({
        task: z.string().min(1).describe("Concrete description of what the subagent should accomplish."),
        tool_budget: z.number().int().min(1).max(50).optional().describe("Max tool calls before wrapping up, default 20."),
        time_budget_seconds: z.number().int().min(30).max(900).optional().describe("Wall-clock cap in seconds, default 300."),
      }),
      execute: async ({ task, tool_budget, time_budget_seconds }) => {
        recordTrace("Dispatching a subagent.");
        send({ type: "tool_progress", tool: "dispatch_subagent", text: "Dispatching subagent" });
        return await dispatchSubagentTask(options, { task, tool_budget, time_budget_seconds });
      },
    }),
  ];

  if (isExtendedRuntimeToolsEnabled(options.userId)) {
    tools.push(...extendedTools);
  }

  for (const registration of options.mcpTools || []) {
    tools.push(tool({
      name: registration.registeredName,
      description: registration.schema.function.description,
      inputSchema: z.object({}).catchall(z.unknown()),
      execute: async (args) => {
        return await safeToolResult(() => callMcpTool(registration, args as Record<string, unknown>));
      },
    }));
  }

  return tools;
}

function splitInstructions(messages: ChatMessage[]): { instructions: string; input: Array<{ role: string; content: unknown; annotations?: unknown[] }> } {
  const systemParts: string[] = [];
  const input: Array<{ role: string; content: unknown; annotations?: unknown[] }> = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""));
      continue;
    }
    if (message.role === "user" || message.role === "assistant") {
      input.push({
        role: message.role,
        content: toOpenResponsesContent(message.content),
        ...(Array.isArray(message.annotations) && message.annotations.length ? { annotations: message.annotations } : {}),
      });
    }
  }
  return { instructions: systemParts.join("\n\n"), input };
}

function normalizeRecentTurns(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
  }));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

async function dispatchSubagentTask(
  options: OpenRouterAgentRuntimeOptions,
  args: { task: string; tool_budget?: number; time_budget_seconds?: number },
): Promise<unknown> {
  return await safeToolResult(async () => {
    if (!options.userId || !options.threadId) return { ok: false, error: "Missing user or thread context" };

    const taskRaw = String(args.task || "").trim();
    if (!taskRaw) return { ok: false, error: "task description required" };
    const taskDescription = taskRaw.length > 1500 ? taskRaw.slice(0, 1500) : taskRaw;
    const toolBudget = clampInteger(args.tool_budget, 1, 50, 20);
    const timeBudget = clampInteger(args.time_budget_seconds, 30, 900, 300);

    const { data: activeRows } = await options.supabase
      .from("subagent_tasks")
      .select("id")
      .eq("user_id", options.userId)
      .in("status", ["pending", "running"])
      .limit(6);

    if (Array.isArray(activeRows) && activeRows.length >= 5) {
      return {
        ok: false,
        error:
          "subagent_limit_reached: 5 subagents are already running. Wait for one to finish before dispatching another.",
      };
    }

    const { data: inserted, error } = await options.supabase
      .from("subagent_tasks")
      .insert({
        user_id: options.userId,
        agent_id: options.agentId,
        parent_thread_id: options.threadId,
        parent_message_id: options.userMessageId ?? null,
        attachment_ids: Array.isArray(options.attachmentIds) ? options.attachmentIds : [],
        task_description: taskDescription,
        tool_budget: toolBudget,
        time_budget_seconds: timeBudget,
        status: "pending",
      })
      .select("id, status, tool_budget, time_budget_seconds")
      .single();

    if (error || !inserted) {
      return { ok: false, error: error?.message || "Failed to register subagent task" };
    }

    fetch(`${options.supabaseUrl}/functions/v1/subagent-run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_id: inserted.id }),
    }).catch((dispatchErr) => {
      console.warn("[openrouter-agent-runtime] subagent-run dispatch failed (non-fatal):", dispatchErr);
    });

    return {
      ok: true,
      subagent_id: inserted.id,
      status: "dispatched",
      tool_budget: inserted.tool_budget,
      time_budget_seconds: inserted.time_budget_seconds,
      note:
        "Subagent dispatched. It runs in the background and will post a report back into this thread when finished.",
    };
  });
}

async function invokeEdgeJson(
  options: OpenRouterAgentRuntimeOptions,
  edgeFunction: string,
  body: Record<string, unknown>,
  timeoutMs = 18_000,
): Promise<unknown> {
  return await safeToolResult(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${options.supabaseUrl}/functions/v1/${edgeFunction}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? safeParseJson(text) : {};
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: typeof data === "object" && data && "error" in data ? (data as any).error : text,
        };
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function safeToolResult(run: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await run();
    if (typeof result === "object" && result !== null && "ok" in result) return result;
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "Tool execution timed out"
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Extract rendered media (generate_image / edit_image results) so the assistant
 * message carries them as attachments. Without this the image lands in storage
 * but never renders inline in the thread.
 */
function buildMediaAttachments(
  toolCalls: Map<string, RuntimeToolCall>,
  toolResults: Map<string, RuntimeToolResult>,
): Array<{ type: string; url: string; meta?: Record<string, unknown> }> {
  const out: Array<{ type: string; url: string; meta?: Record<string, unknown> }> = [];
  for (const [callId, call] of toolCalls) {
    if (call.name !== "generate_image" && call.name !== "edit_image") continue;
    const result = toolResults.get(callId);
    if (!result) continue;
    let parsed: any = result.output;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { continue; }
    }
    if (parsed?.ok === true && parsed?.result && typeof parsed.result === "object") {
      parsed = parsed.result;
    }
    const url = parsed?.image_url;
    if (typeof url !== "string" || url.length === 0) continue;
    out.push({
      type: "image",
      url,
      meta: {
        kind: call.name,
        storage_path: parsed?.storage_path,
        revised_prompt: parsed?.revised_prompt,
        source_path: parsed?.source_path,
      },
    });
  }
  return out;
}

function buildToolMessages(
  toolCalls: Map<string, RuntimeToolCall>,
  toolResults: Map<string, RuntimeToolResult>,
): ChatMessage[] {
  if (toolCalls.size === 0) return [];
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: Array.from(toolCalls.values()).map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    } as any,
    ...Array.from(toolResults.values()).map((result) => ({
      role: "tool",
      tool_call_id: result.callId,
      content: JSON.stringify(result.output),
    } as any)),
  ];
}

async function recordRuntimeActivity(
  options: OpenRouterAgentRuntimeOptions,
  entry: {
    type: string;
    title: string;
    summary?: string;
    content?: Record<string, unknown>;
    surfaceToUser?: boolean;
  },
) {
  await logActivity(options.supabase as any, options.userId, {
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    content: entry.content,
    source: "agent_runtime",
    severity: "info",
    surfaceToUser: entry.surfaceToUser ?? false,
  });
}

async function autoTitleThread(
  supabase: SupabaseLike,
  threadId: string,
  userMessage: string,
  assistantMessage: string,
  apiKey: string,
) {
  const { data: thread } = await supabase.from("threads").select("title").eq("id", threadId).single();
  if (thread?.title) return;

  const response = await withModelRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Generate a short title (2-5 words) for this conversation. Return only the title, no quotes or punctuation.",
        },
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage.slice(0, 300) },
      ],
      max_tokens: 20,
    }),
    signal: AbortSignal.timeout(60000),
  }));

  if (!response.ok) return;
  const data = await response.json();
  const title = data.choices?.[0]?.message?.content?.trim();
  if (title && title.length > 0 && title.length < 100) {
    await supabase.from("threads").update({ title }).eq("id", threadId);
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isProbablyCompleteJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  return typeof safeParseJson(trimmed) === "object";
}

function summarizeArgs(value: string): string {
  return truncate(value.replace(/\s+/g, " "), 220);
}

function humanToolName(name: string): string {
  return name.replace(/_/g, " ");
}

function formatToolStartTrace(name: string, input: unknown): string {
  if (name === "memory_read") return "Checking continuity and memory context.";
  if (name === "web_search" || name === "read_url") return "";
  return `Using ${humanToolName(name)}.`;
}

function formatToolResultTrace(name: string, output: unknown): string {
  const summary = summarizeOutput(output);
  return summary ? `${humanToolName(name)} finished: ${summary}` : `${humanToolName(name)} finished.`;
}

function summarizeOutput(output: unknown): string {
  if (typeof output === "string") return truncate(output.replace(/\s+/g, " "), 320);
  return truncate(JSON.stringify(output ?? {}).replace(/\s+/g, " "), 320);
}

function outputHasError(output: unknown): boolean {
  return !!(
    output &&
    typeof output === "object" &&
    (
      ("ok" in output && (output as { ok?: unknown }).ok === false) ||
      "error" in output
    )
  );
}

function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function getNumberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
