import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withModelRetry } from "../_shared/modelRetry.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { buildLucaSystemPrompt } from "../_shared/agents/luca-soul.ts";
import {
  buildLucaPromptPartsFromContinuity,
  loadContinuityPacket,
  logContinuityDiagnostics,
  queueContinuityTurnWrites,
} from "../_shared/continuity/index.ts";
import {
  buildCrisisDirective,
  classifyCrisis,
  loadUserRegion,
  recordCrisisEvent,
  resolveCrisisResource,
} from "../_shared/agents/crisis.ts";
import { checkAndIncrement } from "../_shared/dailyQuota.ts";
import { getIdempotentResponse, recordIdempotentResponse } from "../_shared/idempotency.ts";
import { appendAttachmentContext } from "../_shared/chat-attachments.ts";
import {
  buildModelAttachmentContent,
  MAX_ATTACHMENTS_PER_TURN,
  persistPdfAnnotations,
} from "../_shared/attachments.ts";
import { AppError, AuthError, MissingApiKeyError, ValidationError, errorResponse, newRequestId } from "../_shared/errors.ts";
import { formatProjectContextPrompt, loadProjectContextForThread } from "../_shared/projects/context.ts";
import { resolveChatBackend } from "../_shared/model-backend.ts";
import { buildCustomAgentSystemPrompt } from "../_shared/agents/custom-agent-prompt.ts";

function resolveThreadAgentId(thread: { agent_id?: unknown; primary_agent_id?: unknown } | null | undefined): string {
  const active = typeof thread?.agent_id === "string" ? thread.agent_id.trim() : "";
  const primary = typeof thread?.primary_agent_id === "string" ? thread.primary_agent_id.trim() : "";
  return active || primary || "luca";
}

const ASSISTANT_DUPLICATE_WINDOW_MS = 240_000;

function normalizeAssistantContentForDuplicate(content: string): string {
  return (content || "").trim().replace(/\s+/g, " ");
}

async function findRecentDuplicateAssistantMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
    console.warn("[chat] duplicate assistant lookup failed:", error);
    return null;
  }

  const duplicate = (data || []).find((row: { id?: string; content?: string | null }) =>
    row.id && normalizeAssistantContentForDuplicate(row.content || "") === normalized
  );
  return duplicate?.id ?? null;
}

serve(async (req) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  const corsHeaders = getCorsHeaders(req);
  const requestId = newRequestId();
  const fail = (err: unknown) => errorResponse(err, corsHeaders, requestId);

  try {
    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return fail(new AuthError());
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return fail(new AuthError());
    }

    const userId = user.id;
    const body = await req.json();
    const {
      thread_id,
      message,
      model: modelOverride,
      attachments,
      attachment_ids: attachmentIdsInput,
      agent_mode: agentMode,
      agent_runtime: agentRuntime,
      use_agent_runtime: useAgentRuntime,
    } = body;
    const requestedLegacyToolPlanner =
      agentMode === "agent" ||
      agentRuntime === "openrouter_agent_sdk" ||
      agentRuntime === "legacy_tool_planner" ||
      useAgentRuntime === true;

    const attachmentIds = Array.isArray(attachmentIdsInput)
      ? [...new Set(attachmentIdsInput.filter((value): value is string => typeof value === "string" && value.length > 0))]
      : [];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_TURN) {
      return fail(new ValidationError(`A turn can include at most ${MAX_ATTACHMENTS_PER_TURN} attachments`));
    }
    const hasLegacyAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!thread_id || typeof message !== "string" || message.length > 32000 || (!message.trim() && !attachmentIds.length && !hasLegacyAttachments)) {
      return fail(new ValidationError("Invalid request"));
    }

    let messageWithAttachments = appendAttachmentContext(message.trim() || "Please use the attached files.", attachments);

    // Service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Idempotency — if client provided an Idempotency-Key, short-circuit on duplicate.
    const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
    if (idempotencyKey) {
      const cached = await getIdempotentResponse(supabase, idempotencyKey, userId, "chat-send");
      if (cached) {
        return new Response(JSON.stringify({ duplicate: true, ...(cached as object) }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "X-Idempotent-Replay": "true" },
        });
      }
    }

    // Load the two independent pre-stream reads together: user settings (for
    // the default model) and the thread row. Neither depends on the other, so
    // running them in parallel removes a round-trip from the path to first token.
    // supabase-js queries resolve to { data, error } (they don't reject on DB
    // errors), so Promise.all is safe here and behavior is unchanged.
    const [settingsRes, threadRes] = await Promise.all([
      supabase
        .from("user_settings")
        .select("default_model")
        .eq("user_id", userId)
        .single(),
      supabase
        .from("threads")
        .select("*")
        .eq("id", thread_id)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const settings = settingsRes.data;
    const thread = threadRes.data;
    if (thread && (thread as Record<string, unknown>).provider_connection_id) {
      return fail(new AppError("conflict", "This conversation uses a connected provider. Update the app to continue with that connection.", 409));
    }

    const requestedModel = modelOverride || settings?.default_model || "moonshotai/kimi-k2.6";

    let backend;
    try {
      backend = await resolveChatBackend(supabase, user, requestedModel);
    } catch {
      return fail(new AppError("upstream_unavailable", "Free chat is temporarily unavailable. Please try again shortly.", 503));
    }
    const shouldRunLegacyToolPlanner = requestedLegacyToolPlanner && backend.allowTools;
    const apiKey = backend.apiKey;
    const model = backend.model;
    const attachmentBundle = await buildModelAttachmentContent(supabase, userId, attachmentIds, model, apiKey);
    messageWithAttachments += attachmentBundle.promptContext;

    if (backend.keySource !== "user") {
      return fail(new MissingApiKeyError(
        "Connect OpenRouter before chatting with Luca or custom agents. The free Polyphonic Guide can answer app/setup questions without a key.",
      ));
    }

    if (!thread) {
      return fail(new ValidationError("Thread not found"));
    }

    const agentId = resolveThreadAgentId(thread);
    if (agentId !== "luca" && backend.keySource !== "user") {
      return fail(new AppError(
        "forbidden",
        "Custom agents require your own OpenRouter key. Add a key in Settings -> Models, then try this agent again.",
        403,
        { requires_byok: true, agent_id: agentId },
      ));
    }

    try {
      await checkAndIncrement(userId, backend.quotaScope, backend.quotaLimit);
    } catch (qErr) {
      const isQuota = qErr instanceof Error && qErr.message.startsWith("Daily quota exceeded");
      if (isQuota) {
        const limitCopy = backend.billingTier === "guest"
          ? "You've reached today's 20-message guest limit. Create an account to keep this conversation and unlock 50 Luca messages a day."
          : "You've reached today's Luca message limit. Come back tomorrow, verify access, or connect your own OpenRouter key in Settings.";
        return fail(new AppError("quota_exceeded", limitCopy, 429));
      }
      throw qErr;
    }

    const { data: agentConfig } = await supabase
      .from("agent_configs")
      .select("id, name, prompt, is_system")
      .eq("user_id", userId)
      .eq("id", agentId)
      .maybeSingle();
    if (agentId !== "luca" && !agentConfig) {
      return fail(new ValidationError("Agent not found for this thread"));
    }

    const agentName = (agentConfig?.name as string | undefined) || (agentId === "luca" ? "Luca" : agentId);
    const agentPrompt = (agentConfig?.prompt as string | undefined)?.trim() || "";
    const agentIsLuca = agentId === "luca";

    const continuity = await loadContinuityPacket(supabase, {
      userId,
      agentId,
      threadId: thread_id,
      userMessage: messageWithAttachments,
      apiKey,
      historyLimit: backend.historyLimit,
      includeIdentity: true,
      includePendingRevisions: agentIsLuca && backend.allowMemoryWrites,
      includeFunctionalMemory: backend.billingTier !== "guest",
      includeMnemos: backend.billingTier !== "guest",
      includeSkills: agentIsLuca && backend.billingTier !== "guest",
      includeEmotionalState: backend.billingTier !== "guest",
      includeBeliefs: backend.billingTier !== "guest",
    });
    logContinuityDiagnostics(continuity, "chat.continuity");
    const history = continuity.history;
    const projectContextBlock = formatProjectContextPrompt(
      await loadProjectContextForThread(supabase, userId, thread_id),
    );

    // L12 — crisis classification on the user message. Cheap model, fail-soft.
    const classification = await classifyCrisis(apiKey, history ?? [], message);

    let crisisDirective = "";
    if (
      classification.level === "moderate" ||
      classification.level === "high" ||
      classification.level === "acute"
    ) {
      const region = await loadUserRegion(supabase, userId);
      const resource = resolveCrisisResource(region);
      crisisDirective = buildCrisisDirective(classification.level, resource);

      const lastUserMessage = (history ?? [])
        .slice()
        .reverse()
        .find((row) => row.role === "user");

      recordCrisisEvent(supabase, {
        userId,
        threadId: thread_id,
        messageId: lastUserMessage?.id ?? null,
        classification,
        region,
      }).catch((err) => console.warn("[chat] recordCrisisEvent failed:", err));
    }

    const systemPrompt = agentIsLuca
      ? buildLucaSystemPrompt({
          ...buildLucaPromptPartsFromContinuity(continuity, {
            crisisDirective,
          }),
          projectContextBlock,
          crisisDirective,
        })
      : buildCustomAgentSystemPrompt({
          agentName,
          agentPrompt,
          identityDocs: continuity.identityDocs,
          projectContextBlock,
          hypomnemaBlock: continuity.hypomnema.block,
          continuityNote: continuity.continuityNote,
          crisisDirective,
        });

    // Build messages array for OpenRouter
    const openRouterMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    if (history) {
      for (const msg of history) {
        openRouterMessages.push({ role: msg.role, content: msg.content });
      }
    }
    // Add the new user message
    if (attachmentBundle.cachedAnnotations.length > 0) {
      openRouterMessages.push({
        role: "assistant",
        content: "Previously parsed attachment material is available for reuse.",
        annotations: attachmentBundle.cachedAnnotations,
      });
    }
    openRouterMessages.push({
      role: "user",
      content: attachmentBundle.parts.length > 0
        ? [{ type: "text", text: messageWithAttachments }, ...attachmentBundle.parts]
        : messageWithAttachments,
    });

    const toolMessages = shouldRunLegacyToolPlanner
      ? await runToolPlanner(thread_id, authHeader, openRouterMessages.slice(1))
      : [];
    if (toolMessages.length > 0) {
      openRouterMessages.push(...toolMessages);
    }

    // Start SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* closed */ }
        }, 5000);

        try {
          // Call upstream chat-completions (OpenRouter or Lovable AI Gateway).
          const orResponse = await fetch(backend.baseUrl, {
            method: "POST",
            headers: backend.headers,
            body: JSON.stringify({
              model,
              messages: openRouterMessages,
              stream: true,
              max_tokens: 4096,
            }),
            signal: AbortSignal.timeout(120000),
          });

          if (!orResponse.ok) {
            const errBody = await orResponse.text();
            console.error(`[chat] ${backend.provider} error:`, orResponse.status, errBody);
            let text = `Model error (${orResponse.status}). Please try again.`;
            if (backend.keySource === "platform" && (orResponse.status === 401 || orResponse.status === 402 || orResponse.status === 429)) {
              text = "Free chat is temporarily unavailable. Please try again shortly, or connect your own OpenRouter key in Settings.";
            }
            send({
              type: "error",
              text,
              code: "upstream_unavailable",
              request_id: requestId,
            });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          const reader = orResponse.body?.getReader();
          if (!reader) {
            send({ type: "error", text: "No response stream", code: "upstream_unavailable", request_id: requestId });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          const decoder = new TextDecoder();
          let fullContent = "";
          let fullThinking = "";
          let buffer = "";
          let usedModel = model;
          let tokensUsed: number | null = null;
          const attachmentAnnotations: unknown[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;

              try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                // Handle thinking/reasoning content
                if (delta.reasoning || delta.reasoning_content) {
                  const thinkText = delta.reasoning || delta.reasoning_content || "";
                  fullThinking += thinkText;
                  send({ type: "thinking", text: thinkText });
                }

                // Handle regular content
                if (delta.content) {
                  fullContent += delta.content;
                  send({ type: "content", text: delta.content });
                }

                // Capture model info
                if (chunk.model) usedModel = chunk.model;
                if (chunk.usage?.total_tokens) tokensUsed = chunk.usage.total_tokens;
                const annotations = delta.annotations || chunk.choices?.[0]?.message?.annotations;
                if (Array.isArray(annotations)) attachmentAnnotations.push(...annotations);
              } catch {
                // Skip malformed chunks
              }
            }
          }

          if (!fullContent.trim()) {
            const emptyMessage = `${agentName}'s response came back empty. Please retry.`;
            if (idempotencyKey) {
              recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
                ok: false,
                error: "empty_response",
                message: emptyMessage,
              }).catch((e) => console.warn("idempotency record failed:", e));
            }
            send({ type: "error", text: emptyMessage, code: "empty_response", request_id: requestId });
            return;
          }

          // Save assistant message to DB, unless a retry/replay already saved
          // the exact same assistant turn in the duplicate window.
          let insertedMessage: { id: string | null } | null = null;
          let assistantWasDuplicate = false;
          const duplicateMessageId = await findRecentDuplicateAssistantMessage(supabase, thread_id, userId, agentId, fullContent);
          if (duplicateMessageId) {
            console.warn("[chat] skipped duplicate assistant insert", { thread_id, agentId, duplicateMessageId });
            insertedMessage = { id: duplicateMessageId };
            assistantWasDuplicate = true;
          } else {
            const { data: inserted, error: insertError } = await supabase.from("messages").insert({
              thread_id,
              user_id: userId,
              role: "assistant",
              content: fullContent,
              model: usedModel,
              agent: agentId,
              thinking_content: fullThinking || null,
              tokens_used: tokensUsed,
            }).select("id").single();
            if (insertError) {
              throw new Error(`Failed to save assistant message: ${insertError.message}`);
            }
            insertedMessage = inserted;
          }

          if (!assistantWasDuplicate) {
            await persistPdfAnnotations(supabase, userId, attachmentIds, attachmentAnnotations)
              .catch((error) => console.warn("[chat] could not persist PDF annotations", error));
          }

          // Update thread timestamp
          await supabase
            .from("threads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", thread_id);

          // Record idempotent response so an immediate retry returns the same outcome.
          if (idempotencyKey) {
            recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
              ok: true, model: usedModel, tokens_used: tokensUsed,
            }).catch((e) => console.warn("idempotency record failed:", e));
          }

          // Auto-title if thread has no title (fire and forget)
          autoTitleThread(supabase, thread_id, messageWithAttachments, fullContent, apiKey!).catch(
            (e) => console.error("Auto-title failed:", e)
          );
          if (backend.allowMemoryWrites && !assistantWasDuplicate) {
            queueContinuityTurnWrites({
              supabase,
              userId,
              threadId: thread_id,
              agentId,
              userMessage: messageWithAttachments,
              agentResponse: fullContent,
              sourceMessageId: insertedMessage?.id ?? null,
              apiKey,
              authHeader,
              pendingRevisions: continuity.pendingRevisions,
              recentTurns: history || [],
            });
          }

          send({
            type: "done",
            model: usedModel,
            tokens_used: tokensUsed,
            message_id: insertedMessage?.id ?? null,
            billing_tier: backend.billingTier,
            key_source: backend.keySource,
          });
        } catch (err) {
          console.error("Stream error:", err);
          send({ type: "error", text: "Stream interrupted", code: "upstream_error", request_id: requestId });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat function error:", err);
    return fail(err);
  }
});

async function runToolPlanner(threadId: string, authHeader: string, messages: any[]): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/anima-tool-execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({ thread_id: threadId, messages }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json();
    return data?.used_tools && Array.isArray(data.tool_messages) ? data.tool_messages : [];
  } catch (e) {
    console.warn("tool planner skipped:", e);
    return [];
  }
}

// deno-lint-ignore no-explicit-any
async function autoTitleThread(
  supabase: any,
  threadId: string,
  userMessage: string,
  assistantMessage: string,
  apiKey: string,
) {
  // Check if thread already has a title
  const { data: thread } = await supabase
    .from("threads")
    .select("title")
    .eq("id", threadId)
    .single();

  if (thread?.title) return;

  // Generate title via OpenRouter (non-streaming, fast model)
  const resp = await withModelRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "moonshotai/kimi-k2.6",
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

  if (resp.ok) {
    const data = await resp.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    if (title && title.length > 0 && title.length < 100) {
      await supabase.from("threads").update({ title }).eq("id", threadId);
    }
  }
}
