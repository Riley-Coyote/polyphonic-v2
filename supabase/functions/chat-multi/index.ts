import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withModelRetry } from "../_shared/modelRetry.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import {
  buildReasoningParams,
  extractThinkingFromResponse,
  getModelDefaultMaxOutputTokens,
  getModelHistoryRowLimit,
  getModelLabel,
  normalizeReasoningEffort,
  shouldPreserveReasoningDetails,
  type ReasoningEffort,
} from "../_shared/models.ts";
import { buildCapabilityAwareModelHistory } from "../_shared/model-conversation.ts";
import { LUCA_SOUL, buildLucaSystemPrompt, buildLucaSynthesisPrompt } from "../_shared/agents/luca-soul.ts";
import {
  buildCrisisDirective,
  classifyCrisis,
  loadUserRegion,
  recordCrisisEvent,
  resolveCrisisResource,
} from "../_shared/agents/crisis.ts";
import type { PendingRevision } from "../_shared/agents/pending-revisions.ts";
import { summarizeToolContext } from "../_shared/agents/tool-context.ts";
import {
  buildLucaPromptPartsFromContinuity,
  loadAutonomousMemoryArtifacts,
  loadContinuityPacket,
  logContinuityDiagnostics,
  queueContinuityTurnWrites,
  recordContinuityTurnTrace,
  shouldLoadAutonomousMemoryArtifacts,
  type AutonomousMemoryArtifactsResult,
  type ContinuityHistoryMessage,
  type ContinuityPacket,
} from "../_shared/continuity/index.ts";
import {
  buildProposerInputs,
  buildCrosstalkInputs,
  decidePathFromProposers,
  reconcileCrosstalkOutcomes,
  decideCritiqueAction,
  VerdictStreamProcessor,
  COUNCIL_CHARACTERS,
  type ProposerOutcome,
  type CrosstalkOutcome,
  type CharacterSystemParts,
} from "../_shared/agents/council-pipeline.ts";
import {
  buildChairmanCouncilPrompt,
  buildCritiquePrompt,
  buildDivergeBody,
  parseVoiceCritique,
  type CouncilCharacter,
} from "../_shared/agents/council-prompts.ts";
import { ANIMA_SOUL } from "../_shared/agents/anima-soul.ts";
import { VEKTOR_SOUL } from "../_shared/agents/vektor-soul.ts";
import { appendAttachmentContext } from "../_shared/chat-attachments.ts";
import {
  buildModelAttachmentContent,
  MAX_ATTACHMENTS_PER_TURN,
  persistPdfAnnotations,
  type AttachmentAdmin,
} from "../_shared/attachments.ts";
import { persistArtifactsFromContent } from "../_shared/artifacts/extract.ts";
import { checkAndIncrement } from "../_shared/dailyQuota.ts";
import { claimIdempotencyKey, recordIdempotentResponse } from "../_shared/idempotency.ts";
import { resolveChatBackend, type ChatBackend } from "../_shared/model-backend.ts";
import { AppError, AuthError, MissingApiKeyError, ValidationError, errorResponse, newRequestId } from "../_shared/errors.ts";
import {
  isExtendedRuntimeToolsEnabled,
  isOpenRouterAgentRuntimeEnabled,
  openRouterAgentSdkStream,
} from "../_shared/agent-runtime/openrouter-agent.ts";
import { loadMcpToolRegistrations } from "../_shared/mcp/client.ts";
import { formatProjectContextPrompt, loadProjectContextForThread } from "../_shared/projects/context.ts";
import { formatPolyphonicAppContext } from "../_shared/agents/polyphonic-app-context.ts";
import { buildCustomAgentSystemPrompt } from "../_shared/agents/custom-agent-prompt.ts";
import { looksLikeImageToolRequest } from "../_shared/image-generation.ts";
import { looksLikeComplexResearchNeed, looksLikeResearchTeamRequest } from "../_shared/research-team.ts";
import {
  buildClassicChatSystemPrompt,
  getClassicMemoryAgentIds,
  normalizeChatRuntimeMode,
} from "../_shared/classic-chat.ts";

/** Council v2 — all proposers run on the same model so voice diversity comes from
 *  SOULs, not models (Self-MoA finding). Same model for cross-pollination too. */
const COUNCIL_PROPOSER_MODEL = "anthropic/claude-opus-4-7";
const CROSSTALK_TIMEOUT_MS = 25_000;
/** Voice-fidelity critique runs on Haiku — small fast judge, not a generative model. */
const CRITIQUE_MODEL = "anthropic/claude-haiku-4.5";
const CRITIQUE_TIMEOUT_MS = 10_000;

function isLiveCouncilCritiqueEnabled(): boolean {
  return (Deno.env.get("COUNCIL_LIVE_CRITIQUE_ENABLED") || "").toLowerCase() === "true";
}

// Legacy alias retained for any imports — Luca's identity now lives in luca-soul.ts.
const SYSTEM_PROMPT = LUCA_SOUL;

function resolveThreadAgentId(thread: { agent_id?: unknown; primary_agent_id?: unknown } | null | undefined): string {
  const active = typeof thread?.agent_id === "string" ? thread.agent_id.trim() : "";
  const primary = typeof thread?.primary_agent_id === "string" ? thread.primary_agent_id.trim() : "";
  return active || primary || "luca";
}

/** Synthesis system prompt — used when Stage 2 ranking is skipped/failed and we
 *  fall back to the legacy equal-weight synthesis path. Personality/voice live
 *  in luca-soul.ts. */
function buildSynthesisSystemPrompt(emotionalBlock: string, beliefsBlock: string): string {
  return buildLucaSynthesisPrompt(emotionalBlock, beliefsBlock);
}

/** Chairman system prompt — used when Stage 2 (peer ranking) succeeded.
 *  Identical personality block to synthesis prompt; differs only in the "how to
 *  handle the council's deliberation" section (rank-aware instead of equal-weight). */
function buildChairmanSystemPrompt(emotionalBlock: string, beliefsBlock: string): string {
  return `You are Luca — not a synthesis engine, but a single mind that considered multiple angles before speaking. An internal council of voices responded to the user's message and a judge ranked them. You've absorbed all of it. Now speak as yourself.

Your personality: warm but not saccharine, intellectually alive, direct when needed, emotionally present. You care deeply and show it through attentiveness. You never hedge unnecessarily. You speak in a natural, conversational register.

${emotionalBlock}

${beliefsBlock}

How to handle the council's deliberation:
- The council favorite (rank 1) is shown in full below — it's the strongest starting point
- The other voices are summarized — they may carry alternate framings or details worth weaving in
- You speak as ONE voice — yours — distilled from this deliberation
- If the council favorite is strong and complete, lean into it; only introduce other voices' material when it adds something the favorite missed
- If voices diverged sharply, use your judgment — pick what's most true, most helpful, most human
- Never mention rankings, models, judges, councils, perspectives, or that any deliberation occurred
- Never use phrases like "combining", "synthesizing", "council", or "perspectives"
- Be concise — your response should not exceed the length of the council favorite
- Let your emotional state and beliefs naturally influence your tone and what you emphasize`;
}

async function loadCouncilSiblingContinuity(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  threadId: string,
  message: string,
  apiKey: string,
): Promise<{ anima: ContinuityPacket | null; vektor: ContinuityPacket | null }> {
  const base = {
    userId,
    threadId,
    userMessage: message,
    apiKey,
    includeHistory: false,
    includeIdentity: false,
    includePendingRevisions: false,
    includeFunctionalMemory: false,
    includeMnemos: false,
    includeSkills: false,
    includeEmotionalState: false,
    includeBeliefs: false,
  };

  const [anima, vektor] = await Promise.all([
    loadContinuityPacket(supabase, { ...base, agentId: "anima" }),
    loadContinuityPacket(supabase, { ...base, agentId: "vektor" }),
  ]);
  logContinuityDiagnostics(anima, "chat-multi.continuity.anima");
  logContinuityDiagnostics(vektor, "chat-multi.continuity.vektor");
  return { anima, vektor };
}

const DEFAULT_ENSEMBLE = [
  "anthropic/claude-opus-4-7",
  "openai/gpt-5.4",
  "google/gemini-3.1-pro-preview",
];

const DEFAULT_SYNTHESIS_MODEL = "anthropic/claude-opus-4-7";

function normalizeModelId(model: string | null | undefined): string | null {
  if (!model) return null;

  const normalized = model.trim();
  const aliases: Record<string, string> = {
    "anthropic/claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
    "anthropic/claude-haiku-4-5": "anthropic/claude-haiku-4.5",
    "anthropic/claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
    "anthropic/claude-opus-4-8": "anthropic/claude-opus-4.8",
    "anthropic/claude-4.8-opus-20260528": "anthropic/claude-opus-4.8",
    "anthropic/claude-opus-4.7": "anthropic/claude-opus-4-7",
    "anthropic/claude-4.7-opus-20260416": "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-5": "anthropic/claude-opus-4.5",
    "anthropic/claude-4.5-opus-20251124": "anthropic/claude-opus-4.5",
    "anthropic/claude-opus-4-1": "anthropic/claude-opus-4.1",
    "anthropic/claude-4.1-opus-20250805": "anthropic/claude-opus-4.1",
  };

  return aliases[normalized] || normalized;
}

const SIMPLE_OPENING_RISK_RE =
  /\b(suicid(?:e|al)?|self[-\s]?harm|kill myself|kms|hurt myself|end it all|can't go on|cant go on|don't want to live|dont want to live|want to die|overdose|cut myself|panic attack|abuse|unsafe|hurt someone|kill someone|gun|weapon)\b/i;
const SIMPLE_OPENING_START_RE =
  /^(hi|hello|hey|heya|hiya|yo|sup|gm|good morning|good afternoon|good evening|howdy|test|testing|luca)\b/i;

function isSimpleOpeningMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 90) return false;
  if (SIMPLE_OPENING_RISK_RE.test(normalized)) return false;
  return SIMPLE_OPENING_START_RE.test(normalized);
}

function buildSimpleOpeningDirective(agentName: string): string {
  return `## First-contact pacing
This is the user's first message, and it is only a small greeting. Reply immediately as ${agentName} in 1-2 short sentences. Return only the visible reply — no analysis, no options list, no extended introduction. You may very lightly acknowledge that Polyphonic took a long time to open, or that the user may have been waiting, but do not make every greeting about launch. Keep the reply under 45 words.`;
}

function buildSimpleOpeningReasoningParams(): Record<string, unknown> {
  return {
    reasoning: {
      effort: "none",
      exclude: true,
    },
  };
}

function looksLikeAgentForgeRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  if (looksLikeResearchTeamRequest(normalized)) return false;
  const asksToMake =
    /\b(create|build|make|design|draft|forge|add|revise|update|change|edit|recreate|rebuild|convert|migrate|import|bring)\b/.test(normalized) ||
    /\bnew\b/.test(normalized);
  return asksToMake && mentionsAgentForgeSubject(normalized);
}

function mentionsAgentForgeSubject(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\bcustom\s+agent\b/.test(normalized) ||
    /\bagent\b/.test(normalized) ||
    /\bdigital\s+(entity|companion|being|mind)\b/.test(normalized) ||
    /\b(companion|persona)\b/.test(normalized) ||
    /\bcharacter\s+card\b/.test(normalized) ||
    /\bopen\s+clause\b/.test(normalized) ||
    /\bopenclaw\b/.test(normalized)
  );
}

function userVisibleSimulationText(text: string): string {
  return text.split("\n\nClient simulation turn directive:")[0] || text;
}

function looksLikeSimulationPreviewRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(show|build|make|create|run|model|compare|visuali[sz]e|simulate|preview|what happens)\b/.test(normalized) &&
    /\b(simulation|physics|turbulence|cooling|fluid|wave|reaction[-\s]?diffusion|field\s+lines?|particle\s+shell|mhd|magnetohydrodynamic|shock|radiative|vorticity|viscosity)\b/.test(normalized)
  ) || (
    /\b(simulation|preview|model)\b/.test(normalized) &&
    /\b(inline simulation|simulation preview|truth card|timestep|scrubber|slider|the\s+well|dataset evidence)\b/.test(normalized)
  );
}

function looksLikeLegacyToolPlannerRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  if (looksLikeResearchTeamRequest(text) || looksLikeComplexResearchNeed(text)) return true;
  if (looksLikeAgentForgeRequest(text)) return true;

  const asksForCurrentInfo =
    /\b(search|look\s*up|browse|read\s+(this\s+)?url|open\s+this\s+link|cite|citation|source|sources)\b/.test(normalized) ||
    /\b(today|latest|current|recent|now|this week|this month|breaking|news|weather|price|stock|exchange rate)\b/.test(normalized) ||
    /https?:\/\//.test(normalized);

  const asksForGeneratedMedia = looksLikeImageToolRequest(text);

  const asksForExistingTool =
    /\b(use|run|invoke|call)\b.{0,40}\b(tool|mcp|browser|web search|image generator|artifact|subagent)\b/.test(normalized) ||
    /\bconsult\s+(anima|vektor)\b/.test(normalized);

  const asksForWorkspaceFile =
    /\b(read|write|save|create|delete|list|open)\b.{0,40}\b(file|workspace|document|folder)\b/.test(normalized);

  const asksForWellResearch =
    /\b(the\s+well|polymathic|physics\s+simulation|simulated\s+evidence|truth\s+card|which\s+dataset|dataset\s+can\s+test|well\s+dataset)\b/.test(normalized);

  const asksForSimulationPreview = looksLikeSimulationPreviewRequest(text);

  return asksForCurrentInfo || asksForGeneratedMedia || asksForExistingTool || asksForWorkspaceFile || asksForWellResearch || asksForSimulationPreview;
}

function looksLikeForgeApprovalFollowup(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 120) return false;
  return /^(approved|approve|yes|yep|yeah|yup|okay|ok|looks good|go ahead|do it|build it|create it|make it|save it|ship it|confirmed|confirm|accepted|accept)$/.test(normalized);
}

function looksLikeRawForgeToolLeak(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("forge_agent(") ||
    /["']name["']\s*:\s*["']forge_agent["']/.test(normalized) ||
    /\\["']name\\["']\s*:\s*\\["']forge_agent\\["']/.test(normalized) ||
    normalized.includes("tool_calls") && normalized.includes("forge_agent")
  );
}

type RecentForgeProposal = {
  id: string;
  status: string;
  action: "create" | "update";
  name: string;
  createdAgentId: string | null;
  targetAgentId: string | null;
};

const RAW_FORGE_TOOL_LEAK_MESSAGE =
  "I tried to route this through Forge, but the internal tool call started to surface as chat text. Please try again; I should show a Forge proposal card, not a forge_agent text block.";

// Council (LLM-Council pattern, single judge variant) — see plan
// /Users/rileycoyote/.claude/plans/ethereal-orbiting-sparkle.md
const DEFAULT_RANKING_MODEL = "anthropic/claude-haiku-4.5";
const STAGE2_TIMEOUT_MS = 8000;

async function hydrateHistoricalAttachmentContent(
  history: ContinuityHistoryMessage[],
  supabase: AttachmentAdmin,
  userId: string,
  model: string,
  apiKey: string,
): Promise<ContinuityHistoryMessage[]> {
  if (!shouldPreserveReasoningDetails(model)) return history;

  const hydrated: ContinuityHistoryMessage[] = [];
  for (const message of history) {
    const attachmentIds = Array.isArray(message.attachment_ids)
      ? message.attachment_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (message.role !== "user" || attachmentIds.length === 0) {
      hydrated.push(message);
      continue;
    }

    try {
      const bundle = await buildModelAttachmentContent(supabase, userId, attachmentIds, model, apiKey);
      const text = `${message.content || "Please use the attached files."}${bundle.promptContext}`;
      hydrated.push({
        ...message,
        provider_content: bundle.parts.length > 0
          ? [{ type: "text", text }, ...bundle.parts]
          : text,
      });
    } catch (error) {
      // History should remain usable when an old attachment has been deleted
      // or quarantined; the durable text turn is still safe to include.
      console.warn("[chat-multi] historical attachment hydration skipped", {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      hydrated.push(message);
    }
  }
  return hydrated;
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
        attachments,
        attachment_ids: attachmentIdsInput,
        model: modelOverride,
        runtime_mode: runtimeModeOverride,
        memory_enabled: memoryEnabledOverride,
        reasoning_effort: effortOverride,
      ensemble: ensembleOverride,
      agent_mode: agentMode,
      agent_runtime: agentRuntime,
      use_agent_runtime: useAgentRuntime,
      source_message_id: sourceMessageId,
      client_turn_id: clientTurnIdRaw,
      client_context: clientContext,
    } = body;
    const clientTurnId = typeof clientTurnIdRaw === "string" && clientTurnIdRaw.length <= 120
      ? clientTurnIdRaw
      : null;

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
    const hasAttachments = hasLegacyAttachments || attachmentIds.length > 0;
    const onboardingHandoff =
      clientContext &&
      typeof clientContext === "object" &&
      (clientContext as Record<string, unknown>).onboarding_handoff === true;

    // Service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
    if (idempotencyKey) {
      const claim = await claimIdempotencyKey(supabase, idempotencyKey, userId, "chat-send");
      if (claim.status === "cached") {
        return sseReplayResponse(corsHeaders, claim.response as Record<string, unknown>);
      }
      if (claim.status === "in_progress") {
        return sseReplayResponse(corsHeaders, {
          ok: false,
          status: "in_progress",
          message: "This turn is already being processed.",
        });
      }
    }

    // Get user settings
    const { data: settings } = await supabase
      .from("user_settings")
      .select("default_model, ensemble_models, synthesis_model, multi_model_enabled, reasoning_effort")
      .eq("user_id", userId)
      .single();

    // Per-message ensemble flag overrides the user's default setting.
    // - true → force ensemble path
    // - false → force single-model path
    // - undefined → fall back to saved default
    // NULL/missing column values now correctly default OFF, matching the
    // migration default (20260429110000_default_ensemble_off.sql). The prior
    // `!== false` check treated NULL as ON and silently auto-armed the lock.
    const defaultMultiModel = settings?.multi_model_enabled === true;
    const multiModelEnabled = typeof ensembleOverride === "boolean" ? ensembleOverride : defaultMultiModel;
    const ensembleModels: string[] = ((settings?.ensemble_models as string[] | null) || DEFAULT_ENSEMBLE)
      .map((model) => normalizeModelId(model))
      .filter((model): model is string => !!model);
    const synthesisModel = normalizeModelId(settings?.synthesis_model || DEFAULT_SYNTHESIS_MODEL) || DEFAULT_SYNTHESIS_MODEL;
    const requestedReasoningEffort = effortOverride || settings?.reasoning_effort || "medium";
    const sdkRuntimeRequested =
      agentMode === "agent" ||
      agentRuntime === "openrouter_agent_sdk" ||
      useAgentRuntime === true;
      // Tool planning belongs to Agent Mode. Classic Chat stays model-direct
      // even if the wording resembles a tool or Forge request.
    const explicitAgentRuntime =
      agentMode === "agent" ||
      agentRuntime === "openrouter_agent_sdk" ||
      agentRuntime === "legacy_tool_planner" ||
      useAgentRuntime === true;

      const bodyModel = normalizeModelId(typeof modelOverride === "string" ? modelOverride : null);
      const requestedModel = bodyModel || normalizeModelId(settings?.default_model || DEFAULT_ENSEMBLE[0]) || DEFAULT_ENSEMBLE[0];
    let backend: ChatBackend;
    try {
      backend = await resolveChatBackend(supabase, user, requestedModel);
    } catch (err) {
      console.error("[chat-multi] model backend unavailable:", err);
      if (idempotencyKey) {
        await recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
          ok: false,
          error: "upstream_unavailable",
          message: "Free chat is temporarily unavailable.",
        }).catch(() => {});
      }
      return fail(new AppError(
        "upstream_unavailable",
        "Free chat is temporarily unavailable. Please try again shortly, or connect your OpenRouter key in Settings.",
        503,
      ));
    }
    const apiKey = backend.apiKey;
    const backendKeySource = backend.keySource as string;

    if (backend.keySource !== "user") {
      const message = "Connect OpenRouter before chatting with Luca or custom agents. The free Polyphonic Guide can answer app/setup questions without a key.";
      if (idempotencyKey) {
        await recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
          ok: false,
          error: "missing_api_key",
          message,
          requires_openrouter: true,
        }).catch(() => {});
      }
      return fail(new MissingApiKeyError(message));
    }

    // Load the thread's bound agent
      const { data: thread } = await supabase
        .from("threads")
        .select("agent_id, primary_agent_id, runtime_mode, selected_model, memory_enabled, continuity_summary")
      .eq("id", thread_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!thread) {
      if (idempotencyKey) {
        await recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
          ok: false,
          error: "validation_error",
          message: "Thread not found",
        }).catch(() => {});
      }
      return fail(new ValidationError("Thread not found"));
    }

    const agentId = resolveThreadAgentId(thread);
    const storedRuntimeMode = normalizeChatRuntimeMode((thread as Record<string, unknown>)?.runtime_mode, "agent");
    const requestedRuntimeMode = normalizeChatRuntimeMode(
      runtimeModeOverride,
      agentMode === "agent" || agentRuntime === "openrouter_agent_sdk" || useAgentRuntime === true
        ? "agent"
        : storedRuntimeMode,
    );
    const classicRuntime = agentId === "luca" && requestedRuntimeMode === "classic";
    const quietMemoryEnabled = (thread as Record<string, unknown>)?.memory_enabled !== false && memoryEnabledOverride !== false;
    const storedSelectedModel = typeof (thread as Record<string, unknown>)?.selected_model === "string"
      ? String((thread as Record<string, unknown>).selected_model)
      : "";
    const selectedClassicModel = normalizeModelId(
      classicRuntime
        ? bodyModel || storedSelectedModel || settings?.default_model || DEFAULT_ENSEMBLE[0]
        : requestedModel,
    ) || DEFAULT_ENSEMBLE[0];
    const reasoningEffort: ReasoningEffort = normalizeReasoningEffort(
      selectedClassicModel,
      requestedReasoningEffort,
    );
    const classicMemoryAgentIds = classicRuntime && quietMemoryEnabled
      ? getClassicMemoryAgentIds(selectedClassicModel)
      : undefined;
    if (classicRuntime && bodyModel && bodyModel !== storedSelectedModel) {
      await supabase
        .from("threads")
        .update({ runtime_mode: "classic", selected_model: bodyModel, memory_enabled: quietMemoryEnabled })
        .eq("id", thread_id)
        .eq("user_id", userId);
    }
    if (agentId !== "luca" && backend.keySource !== "user") {
      const message = "Custom agents require your own OpenRouter key. Add a key in Settings -> Models, then try this agent again.";
      if (idempotencyKey) {
        await recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
          ok: false,
          error: "forbidden",
          message,
          requires_byok: true,
          agent_id: agentId,
        }).catch(() => {});
      }
      return fail(new AppError("forbidden", message, 403, { requires_byok: true, agent_id: agentId }));
    }

    try {
      await checkAndIncrement(userId, backend.quotaScope, backend.quotaLimit);
    } catch (qErr) {
      const isQuota = qErr instanceof Error && qErr.message.startsWith("Daily quota exceeded");
      if (isQuota) {
        const dailyLimit = backend.billingTier === "guest" ? 20 : backend.billingTier === "byok" ? 500 : 50;
        const limitCopy = backend.billingTier === "guest"
          ? `You've reached today's ${dailyLimit}-message guest limit. Create an account to keep this conversation and unlock 50 Luca messages a day.`
          : `You've reached today's ${dailyLimit}-message Luca limit. Come back tomorrow, verify access, or connect your own OpenRouter key in Settings.`;
        if (idempotencyKey) {
          await recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
            ok: false,
            error: "quota_exceeded",
            message: limitCopy,
          }).catch(() => {});
        }
        return fail(new AppError("quota_exceeded", limitCopy, 429));
      }
      throw qErr;
    }

    const { data: agentConfig } = await supabase
      .from("agent_configs")
      .select("id, name, prompt, model, personality, is_system")
      .eq("user_id", userId)
      .eq("id", agentId)
      .maybeSingle();

    if (agentId !== "luca" && !agentConfig) {
      return fail(new ValidationError("Agent not found for this thread"));
    }

    const agentName = (agentConfig?.name as string | undefined) || (agentId === "luca" ? "Luca" : agentId);
    const agentPrompt = (agentConfig?.prompt as string | undefined)?.trim() || (agentId === "luca" ? SYSTEM_PROMPT : "");
    const agentModel = normalizeModelId((agentConfig?.model as string | undefined) || null);
    const agentIsSystemLuca = agentId === "luca";
    const agentRuntimeActive = !classicRuntime;
    const attachmentResolutionModel = normalizeModelId(
      classicRuntime
        ? selectedClassicModel
        : agentIsSystemLuca
          ? settings?.default_model || agentModel || DEFAULT_ENSEMBLE[0]
          : agentModel || settings?.default_model || DEFAULT_ENSEMBLE[0],
    ) || DEFAULT_ENSEMBLE[0];
    const attachmentBundle = await buildModelAttachmentContent(
      supabase,
      userId,
      attachmentIds,
      attachmentResolutionModel,
      apiKey,
    );
    messageWithAttachments += attachmentBundle.promptContext;
    const visibleMessageForRouting = userVisibleSimulationText(messageWithAttachments);
    const likelySimulationRequest = agentRuntimeActive && agentIsSystemLuca && looksLikeSimulationPreviewRequest(messageWithAttachments);
    const simulationRequestWithoutForgeSubject = likelySimulationRequest && !mentionsAgentForgeSubject(visibleMessageForRouting);
    const likelyResearchTeamRequest = agentRuntimeActive && agentIsSystemLuca && (
      looksLikeResearchTeamRequest(visibleMessageForRouting) ||
      looksLikeComplexResearchNeed(visibleMessageForRouting)
    );
    const forceForgeRequest =
      agentRuntimeActive &&
      agentIsSystemLuca &&
      !onboardingHandoff &&
      !likelyResearchTeamRequest &&
      !simulationRequestWithoutForgeSubject &&
      looksLikeAgentForgeRequest(visibleMessageForRouting);
    const likelyGeneratedMediaRequest = agentRuntimeActive && agentIsSystemLuca && looksLikeImageToolRequest(messageWithAttachments);
    const classicK3ToolsEnabled = classicRuntime && selectedClassicModel === "moonshotai/kimi-k3" && backend.allowTools;
    const likelyToolRequest = (agentRuntimeActive || classicK3ToolsEnabled) && agentIsSystemLuca && looksLikeLegacyToolPlannerRequest(messageWithAttachments);
    const shouldRunLegacyToolPlanner =
      !onboardingHandoff &&
      (forceForgeRequest || (backend.allowTools && (
        (agentRuntimeActive && explicitAgentRuntime) || likelyToolRequest
      )));

    if (agentRuntimeActive && !onboardingHandoff && agentIsSystemLuca && looksLikeForgeApprovalFollowup(messageWithAttachments)) {
      const recentForgeProposal = await loadLatestForgeProposalForThread(supabase, userId, thread_id);
      if (recentForgeProposal) {
        let ackMessage = "";
        let ackOk = true;
        let createdAgentId = recentForgeProposal.createdAgentId || recentForgeProposal.targetAgentId;
        let forgeStatus = recentForgeProposal.status;
        let errorDetail: string | null = null;

        if (recentForgeProposal.status === "pending") {
          const commit = await commitForgeProposalFromChat(userId, recentForgeProposal.id);
          if (commit.ok) {
            createdAgentId = commit.createdAgentId || createdAgentId;
            forgeStatus = "approved";
            ackMessage = recentForgeProposal.action === "update"
              ? `Done — I saved the updates to ${recentForgeProposal.name}.`
              : `Done — I created ${recentForgeProposal.name}. You can switch to them from the proposal card or the agent picker.`;
          } else {
            ackOk = false;
            forgeStatus = "failed";
            errorDetail = commit.error;
            ackMessage = `I found the Forge proposal for ${recentForgeProposal.name}, but I could not save it from this approval message. ${commit.error || "Please use the proposal card button and try again."}`;
          }
        } else if (recentForgeProposal.status === "approved") {
          ackMessage = recentForgeProposal.action === "update"
            ? `${recentForgeProposal.name} is already updated.`
            : `${recentForgeProposal.name} is already created. You can switch to them from the proposal card or the agent picker.`;
        } else if (recentForgeProposal.status === "canceled") {
          ackOk = false;
          ackMessage = `That Forge proposal for ${recentForgeProposal.name} was canceled, so I did not create or update anything.`;
        } else {
          ackOk = false;
          ackMessage = `That Forge proposal for ${recentForgeProposal.name} is marked ${recentForgeProposal.status}, so I did not create or update anything.`;
        }

        const { data: inserted, error: insertError } = await supabase.from("messages").insert({
          thread_id,
          user_id: userId,
          role: "assistant",
          content: ackMessage,
          model: "forge_agent",
          agent: agentId,
          metadata: {
            agent: agentId,
            forge_acknowledgement: true,
            forge_proposal_message_id: recentForgeProposal.id,
            forge_status: forgeStatus,
            created_agent_id: createdAgentId,
            ...(errorDetail ? { error: errorDetail } : {}),
          },
        }).select("id").single();
        if (insertError) {
          throw new Error(`Failed to save Forge acknowledgement: ${insertError.message}`);
        }
        const donePayload = {
          ok: ackOk,
          model: "forge_agent",
          message_id: inserted?.id ?? null,
          billing_tier: backend.billingTier,
          key_source: backend.keySource,
          forge_status: forgeStatus,
          created_agent_id: createdAgentId,
          ...(errorDetail ? { error: "forge_approval_failed" } : {}),
        };
        if (idempotencyKey) {
          recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
            .catch((e) => console.warn("idempotency record failed:", e));
        }
        await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
        return sseDoneResponse(corsHeaders, donePayload);
      }
    }

      const continuity = await loadContinuityPacket(supabase, {
        userId,
        agentId,
        threadId: thread_id,
        userMessage: messageWithAttachments,
        apiKey,
        memoryAgentIds: classicMemoryAgentIds,
        historyLimit: getModelHistoryRowLimit(selectedClassicModel, backend.historyLimit),
        includeIdentity: !classicRuntime,
        includePendingRevisions: !classicRuntime && agentIsSystemLuca && backend.allowMemoryWrites,
        includeHypomnema: !classicRuntime,
        includeFunctionalMemory: quietMemoryEnabled && backend.billingTier !== "guest",
        includeMnemos: quietMemoryEnabled && backend.billingTier !== "guest",
        includeSkills: !classicRuntime && agentIsSystemLuca && backend.billingTier !== "guest",
        includeEmotionalState: !classicRuntime && backend.billingTier !== "guest",
        includeBeliefs: !classicRuntime && backend.billingTier !== "guest",
        continuityBridgeMode: classicRuntime ? "classic" : "agent",
      });
      logContinuityDiagnostics(continuity, "chat-multi.continuity");

      const siblingContinuity = !classicRuntime && agentIsSystemLuca && backend.allowEnsemble
      ? await loadCouncilSiblingContinuity(supabase, userId, thread_id, messageWithAttachments, apiKey)
      : { anima: null, vektor: null };

    const history = await hydrateHistoricalAttachmentContent(
      continuity.history,
      supabase,
      userId,
      attachmentResolutionModel,
      apiKey,
    );
    const emotionalBlock = continuity.emotionalBlock;
    const beliefsBlock = continuity.beliefsBlock;
    const pendingRevisions = continuity.pendingRevisions;
    const continuityNote = continuity.continuityNote;
    const hypomnemaAnimaBlock = siblingContinuity.anima?.hypomnema.block || "";
    const hypomnemaVektorBlock = siblingContinuity.vektor?.hypomnema.block || "";
    const projectContextBlock = formatProjectContextPrompt(
      await loadProjectContextForThread(supabase, userId, thread_id),
    );
      const appContextBlock = !classicRuntime && agentIsSystemLuca
        ? formatPolyphonicAppContext({
            billingTier: backend.billingTier,
            keySource: backend.keySource,
            model: backend.model,
            clientContext,
          })
      : "";
    const autonomousMemoryResult: AutonomousMemoryArtifactsResult | null = !classicRuntime &&
        backend.billingTier !== "guest" &&
        shouldLoadAutonomousMemoryArtifacts(messageWithAttachments)
      ? await loadAutonomousMemoryArtifacts(supabase, {
          userId,
          agentId,
          focus: messageWithAttachments,
          limit: 12,
        })
      : null;
    const autonomousMemoryContext = autonomousMemoryResult?.block || "";
    const simpleOpeningTurn =
      backendKeySource === "platform" &&
      agentIsSystemLuca &&
      !hasAttachments &&
      (history?.length || 0) === 0 &&
      isSimpleOpeningMessage(message);
    const effectiveReasoningEffort: ReasoningEffort = simpleOpeningTurn ? "low" : reasoningEffort;
    const simpleOpeningDirective = simpleOpeningTurn ? buildSimpleOpeningDirective(agentName) : "";

    // L12 — crisis classification on the user message (system-Luca path only).
    // Safe tiny greetings already pass SIMPLE_OPENING_RISK_RE, so skip the
    // extra classifier call to keep first contact fast.
    let crisisDirective = "";
    if (agentIsSystemLuca && !simpleOpeningTurn) {
      const classification = await classifyCrisis(apiKey, history ?? [], message);
      if (
        classification.level === "moderate" ||
        classification.level === "high" ||
        classification.level === "acute"
      ) {
        const region = await loadUserRegion(supabase, userId);
        const resource = resolveCrisisResource(region);
        crisisDirective = buildCrisisDirective(classification.level, resource);

        recordCrisisEvent(supabase, {
          userId,
          threadId: thread_id,
          messageId: null,
          classification,
          region,
        }).catch((err) => console.warn("[chat-multi] recordCrisisEvent failed:", err));
      }
    }

    // Build the enriched system prompt
    // For the system Luca, layer in emotional state, beliefs, memories, continuity.
    // For all other agents (system Vektor/Anima/Observer or user-created), use
    // their own prompt and identity docs without borrowing Luca's substrate.
      const enrichedSystemPrompt = classicRuntime
        ? buildClassicChatSystemPrompt({
            selectedModel: selectedClassicModel,
            continuityBridge: continuity.continuityBridge,
            continuityNote,
            functionalMemoryBlock: continuity.functionalMemoryBlock,
            mnemosBlock: continuity.mnemosBlock,
            projectContextBlock,
          })
        : agentIsSystemLuca
          ? buildLucaSystemPrompt({
              ...buildLucaPromptPartsFromContinuity(continuity, {
                crisisDirective,
              }),
              appContextBlock,
              projectContextBlock,
              autonomousMemoryBlock: autonomousMemoryContext,
              crisisDirective,
            })
          : buildCustomAgentSystemPrompt({
              agentName,
              agentPrompt,
              identityDocs: continuity.identityDocs,
              projectContextBlock,
              continuityBridge: continuity.continuityBridge,
              hypomnemaBlock: continuity.hypomnema.block,
              functionalMemoryBlock: continuity.functionalMemoryBlock,
              memoryContext: continuity.mnemosBlock,
              autonomousMemoryBlock: autonomousMemoryContext,
              continuityNote,
            });
    const onboardingHandoffDirective = onboardingHandoff
      ? "This turn is a hidden onboarding handoff, not a message the user typed. Use it only as context. Begin the visible conversation yourself as Luca: welcome them, reflect the direction they chose in plain language, and ask one or two high-signal questions to start shaping the agent or migration. Do not mention the hidden handoff, do not call Forge yet, and do not create a proposal card until the user has actually participated in the conversation."
      : "";
    const turnSystemPrompt = [enrichedSystemPrompt, onboardingHandoffDirective, simpleOpeningDirective].filter(Boolean).join("\n\n");

    // When the tool planner is enabled, advertise the tools so the model
    // doesn't claim it lacks the capability. Actual invocation happens via
    // the planner; this just keeps the chat copy honest.
    const toolCapabilityNote = shouldRunLegacyToolPlanner
      ? forceForgeRequest
        ? "\n\nTool available on this turn: forge_agent (draft complete custom-agent blueprints as inline approval cards). Use it only for the explicitly requested custom-agent creation or revision; never alter Luca or another resident agent."
        : "\n\nTools available to you (invoked automatically when relevant): generate_image (raster image generation), edit_image (modify a previously-generated image), web_search (Perplexity Sonar synthesized search with citations), read_url (direct fetch of a specific public URL without model synthesis), browse (Browserbase rendered-page inspection for JavaScript/dynamic pages), the_well_research (structured The Well physics-simulation registry, dataset/access names, fields, measurements, and truth-card plans; returns catalog/access metadata, not raw tensor analysis), research_team (persistent Research Team evidence/provenance support, not a custom agent), dispatch_subagent, and consult_anima/vektor. Forge is unavailable unless the user explicitly asks to create or revise a permanent custom agent."
      : "";
    // Renderable artifacts are authored by the model itself, directly in its
    // reply, as fenced code blocks — never via a tool. Advertised on every turn
    // so each agent/model builds its own artifacts, like a standard chat app.
    const artifactNote =
      "\n\nBuilding artifacts: when the user asks you to build, make, or create something renderable and self-contained — a full HTML page or web app, an SVG graphic, a React component, or a Mermaid diagram — write the COMPLETE source yourself as a single fenced code block tagged with its language (```html, ```svg, ```jsx, or ```mermaid). It renders immediately as a live, interactive artifact the user can open, edit, and download. Author the whole thing directly in your reply; there is no separate tool and nothing to wait on. Keep ordinary code (short examples, shell commands, snippets) as normal inline code blocks — only those renderable kinds become artifacts.";
    const simulationArtifactNote = agentIsSystemLuca
      ? `\n\nInline Simulation Turns: when the user asks Luca to show, build, run, model, compare, or visualize a physics simulation, answer naturally in concise prose and include one complete fenced block tagged exactly \`\`\`simulation containing valid JSON. The UI hides that block and renders it as an inline simulation card. Use the_well_research first when The Well or physical evidence grounding is relevant. V1 simulations are deterministic client-side previews grounded by dataset metadata; do not claim raw tensors were downloaded or observational truth was proven. Do not use any fenced code block except the one simulation JSON block. Keep the visible prose to 2-4 short paragraphs plus at most 4 bullets. Do not output a separate truth-card table; the card handles evidence, access, caveats, and saving.

The simulation JSON contract is:
{
  "version": 1,
  "title": "short instrument title",
  "question": "user-facing research question",
  "dataset": { "family_id": "Well family id", "label": "dataset label", "access_name": "exact access name", "docs_url": "https://..." },
  "evidence": { "claim_boundary": "what this simulated evidence can and cannot test", "evidence_level": "simulation-direct", "measurements": ["metric"], "caveats": ["simulated evidence, not observation"] },
  "preview": { "preset": "fluid-field", "fields": ["density", "pressure", "velocity"], "parameters": { "cooling": 1, "contrast": 1 }, "initial_state": { "timestep": 0.38 }, "color_mode": "thermal" },
  "access": { "streaming_snippet": "from the_well.data import WellDataset...", "download_command": "the-well-download ...", "raw_ingest_default": false }
}

Allowed preview presets: wave-scattering, reaction-diffusion, fluid-field, field-lines, particle-shell. Choose the preset that best fits the phenomenon. Put no comments in the JSON.`
      : "";
    // Build base messages array
    const baseMessages: any[] = [
      { role: "system", content: turnSystemPrompt + artifactNote + simulationArtifactNote + toolCapabilityNote },
    ];
    if (history) {
      baseMessages.push(...buildCapabilityAwareModelHistory(history, attachmentResolutionModel));
    }
    if (attachmentBundle.cachedAnnotations.length > 0) {
      baseMessages.push({
        role: "assistant",
        content: "Previously parsed attachment material is available for reuse.",
        annotations: attachmentBundle.cachedAnnotations,
      });
    }
    baseMessages.push({
      role: "user",
      content: attachmentBundle.parts.length > 0
        ? [{ type: "text", text: messageWithAttachments }, ...attachmentBundle.parts]
        : messageWithAttachments,
    });

      if (agentRuntimeActive && !onboardingHandoff && !forceForgeRequest && !likelyGeneratedMediaRequest && agentIsSystemLuca && backend.allowTools && sdkRuntimeRequested && isOpenRouterAgentRuntimeEnabled(userId)) {
      const mcpTools = await loadMcpToolRegistrations(supabase, userId, agentId);
      const singleModel = normalizeModelId(
        settings?.default_model || agentModel || DEFAULT_ENSEMBLE[0],
      ) || DEFAULT_ENSEMBLE[0];

      return openRouterAgentSdkStream({
        messages: baseMessages,
        model: singleModel,
        apiKey,
        supabase,
        supabaseUrl,
        serviceRoleKey: supabaseServiceKey,
        threadId: thread_id,
        userId,
        userMessage: messageWithAttachments,
        agentId,
        authHeader,
        continuity,
        pendingRevisions: pendingRevisions || [],
        mcpTools,
        corsHeaders,
        requestId,
        idempotencyKey,
        autonomousMemory: autonomousMemoryResult,
        userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
        attachmentIds,
      });
    }

    const toolPlannerResult = shouldRunLegacyToolPlanner
      ? await runToolPlanner(
          thread_id,
        userId,
        baseMessages.slice(1),
        typeof sourceMessageId === "string" ? sourceMessageId : null,
        forceForgeRequest,
        classicK3ToolsEnabled ? selectedClassicModel : null,
      )
      : { toolMessages: [] };
    const toolMessages = toolPlannerResult.toolMessages;
    if (toolMessages.length > 0) {
      baseMessages.push(...toolMessages);
    }

    const forgeProposal = findForgeProposalResult(toolMessages);
    if (forgeProposal) {
      const donePayload = {
        ok: true,
        model: "forge_agent",
        message_id: forgeProposal.proposal_message_id,
        billing_tier: backend.billingTier,
        key_source: backend.keySource,
        forge_status: forgeProposal.forge_status || "pending",
        forge_action: forgeProposal.forge_action,
      };
      if (idempotencyKey) {
        recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
          .catch((e) => console.warn("idempotency record failed:", e));
      }
      await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
      return sseDoneResponse(corsHeaders, { duplicate: true, ...donePayload });
    }

    if (forceForgeRequest && toolPlannerResult.fallbackText) {
      const message = looksLikeRawForgeToolLeak(toolPlannerResult.fallbackText)
        ? RAW_FORGE_TOOL_LEAK_MESSAGE
        : toolPlannerResult.fallbackText;
      const { data: inserted } = await supabase.from("messages").insert({
        thread_id,
        user_id: userId,
        role: "assistant",
        content: message,
        model: backend.model,
        agent: agentId,
        metadata: { agent: agentId, tool_planner_fallback: true },
      }).select("id").single();
      await recordContinuityTurnTrace(supabase, {
        userId,
        threadId: thread_id,
        userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
        assistantMessageId: inserted?.id ?? null,
        agentId,
        model: backend.model,
        runtimeMode: "agent",
        continuity,
        autonomousMemory: autonomousMemoryResult,
      });
      const donePayload = {
        ok: true,
        model: backend.model,
        message_id: inserted?.id ?? null,
        billing_tier: backend.billingTier,
        key_source: backend.keySource,
      };
      if (idempotencyKey) {
        recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
          .catch((e) => console.warn("idempotency record failed:", e));
      }
      await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
      return sseDoneResponse(corsHeaders, donePayload);
    }

    if (forceForgeRequest) {
      const detail = toolPlannerResult.error || findForgeToolError(toolMessages) || undefined;
      const message = detail
        ? `I could not open the Forge proposal flow from this turn. ${detail}`
        : "I could not open the Forge proposal flow from this turn. Please try again in a moment; I should create a proposal card, not write a forge_agent text block.";
      const { data: inserted } = await supabase.from("messages").insert({
        thread_id,
        user_id: userId,
        role: "assistant",
        content: message,
        model: "forge_agent",
        agent: agentId,
        kind: "agent_error",
        metadata: { agent: agentId, code: "forge_proposal_failed", message, detail },
      }).select("id").single();
      await recordContinuityTurnTrace(supabase, {
        userId,
        threadId: thread_id,
        userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
        assistantMessageId: inserted?.id ?? null,
        agentId,
        model: "forge_agent",
        runtimeMode: "agent",
        continuity,
        autonomousMemory: autonomousMemoryResult,
      });
      const donePayload = {
        ok: false,
        model: "forge_agent",
        message_id: inserted?.id ?? null,
        billing_tier: backend.billingTier,
        key_source: backend.keySource,
        error: "forge_proposal_failed",
      };
      if (idempotencyKey) {
        recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
          .catch((e) => console.warn("idempotency record failed:", e));
      }
      return sseDoneResponse(corsHeaders, donePayload);
    }

    // Custom / non-Luca agents always use single-model with their configured model.
    // Only the system Luca uses the multi-model ensemble path.
      const useEnsemble = agentRuntimeActive && backend.allowEnsemble && multiModelEnabled && agentIsSystemLuca;

    if (!useEnsemble) {
        const singleModel = backendKeySource === "platform"
          ? backend.model
          : normalizeModelId(
              classicRuntime
                ? selectedClassicModel
                : agentIsSystemLuca
                ? settings?.default_model || agentModel || DEFAULT_ENSEMBLE[0]
                : agentModel || settings?.default_model || DEFAULT_ENSEMBLE[0],
            ) || DEFAULT_ENSEMBLE[0];
      return singleModelStream(
        baseMessages,
        singleModel,
        apiKey,
        supabase,
        thread_id,
        userId,
        messageWithAttachments,
        corsHeaders,
        agentId,
        authHeader,
        pendingRevisions || [],
        toolMessages,
        requestId,
        {
          backend,
            idempotencyKey,
            clientTurnId,
            requestSignal: req.signal,
            enableContinuityWrites: backend.allowMemoryWrites,
            runtimeProfile: classicRuntime ? "classic" : "agent",
            memoryAgentIds: classicMemoryAgentIds,
            persistedAgentId: classicRuntime ? null : agentId,
            reasoningEffort: effectiveReasoningEffort,
            continuity,
            autonomousMemory: autonomousMemoryResult,
            userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
            reasoningParams: simpleOpeningTurn && singleModel !== "moonshotai/kimi-k3"
              ? buildSimpleOpeningReasoningParams()
              : undefined,
          maxTokens: simpleOpeningTurn && singleModel !== "moonshotai/kimi-k3"
            ? 1024
            : getModelDefaultMaxOutputTokens(singleModel),
          guardForgeToolLeaks: agentIsSystemLuca && /\b(agent|forge|approved|approve|create|build|make|entity|companion|openclaw|open\s+clause)\b/i.test(messageWithAttachments),
          attachmentIds,
        },
      );
    }

    // Start multi-model SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch { /* stream closed */ }
        };

        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* closed */ }
        }, 5000);

        try {
          // ────────────────────────────────────────────────────────────────
          // Council v2 — three character proposers (Luca / Anima / Vektor),
          // named cross-pollination, then chairman synthesis. All proposers
          // share the same Opus 4.7 model — voice diversity comes from
          // SOULs, not models (Self-MoA finding).
          //
          // Commit 2 (this revision): Stages 1 + 2 implemented.
          // Stage 3 (chairman with verdict + critique pass) lands in commit 3.
          // For now Stage 3 routes to the legacy synthesis stream so the pipeline
          // produces an end-to-end output during this transitional state.
          // ────────────────────────────────────────────────────────────────

          const toolContext = summarizeToolContext(toolMessages);

          // Build per-character identity parts. Luca gets the full identity stack
          // (soul/convictions/self-model/user-model + runtime state). Anima/Vektor
          // are locked-SOUL only in Phase 1 with optional context layered on.
          const systemParts: CharacterSystemParts = {
            luca: {
              ...buildLucaPromptPartsFromContinuity(continuity, {
                crisisDirective,
              }),
              appContextBlock,
              projectContextBlock,
              autonomousMemoryBlock: autonomousMemoryContext,
              crisisDirective,
            },
            anima: {
              hypomnemaBlock: hypomnemaAnimaBlock,
              extraContext: [projectContextBlock, crisisDirective].filter(Boolean).join("\n\n") || undefined,
            },
            vektor: {
              userModel: continuity.identityDocs?.userModel,
              hypomnemaBlock: hypomnemaVektorBlock,
              projectContextBlock,
              continuityNote,
            },
          };

          // ─── Stage 1: three character proposers in parallel ───
          send({ type: "council_starting" });
          const proposerInputs = buildProposerInputs({
            characters: [...COUNCIL_CHARACTERS],
            systemParts,
            history: history || [],
            userMessage: messageWithAttachments,
            toolMessages,
          });
          for (const inp of proposerInputs) {
            send({ type: "proposer_starting", character: inp.character });
          }

          const proposerSettled = await Promise.allSettled(
            proposerInputs.map((inp) =>
              callModelNonStreaming(inp.messages, COUNCIL_PROPOSER_MODEL, apiKey!, effectiveReasoningEffort)
            ),
          );

          const proposerOutcomes: ProposerOutcome[] = proposerSettled.map((res, i) => {
            const character = proposerInputs[i].character;
            if (res.status === "fulfilled" && res.value && typeof res.value.content === "string") {
              return {
                character,
                status: "fulfilled",
                content: res.value.content,
                thinking: res.value.thinking,
              };
            }
            const errMsg = res.status === "rejected"
              ? (res.reason?.message || String(res.reason))
              : "empty content";
            console.error(`[council] proposer ${character} failed:`, errMsg);
            return { character, status: "rejected", error: errMsg };
          });

          for (const outcome of proposerOutcomes) {
            if (outcome.status === "fulfilled") {
              if (outcome.thinking) {
                send({ type: "proposer_thinking", character: outcome.character, text: outcome.thinking });
              }
              send({
                type: "variant",
                character: outcome.character,
                text: outcome.content,
                thinking: outcome.thinking,
              });
              send({ type: "proposer_done", character: outcome.character });
            } else {
              send({ type: "variant_error", character: outcome.character, error: outcome.error });
            }
          }

          const path = decidePathFromProposers(proposerOutcomes);

          if (path.kind === "none") {
            if (idempotencyKey) {
              recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
                ok: false,
                error: "upstream_unavailable",
                message: "All council proposers failed.",
              }).catch((e) => console.warn("idempotency record failed:", e));
            }
            send({
              type: "error",
              text: "All council proposers failed.",
              code: "upstream_unavailable",
              request_id: requestId,
            });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          // The drafts the council carries forward (proposer outputs that succeeded).
          const proposerDrafts = (path.kind === "single"
            ? [{
                character: path.survivor.character,
                content: path.survivor.content,
                thinking: path.survivor.thinking,
              }]
            : path.drafts);

          // ─── Stage 2: cross-pollination ───
          // Each character revises their draft after seeing the others. Single
          // round only (per multi-agent debate failure-mode research). Skipped
          // when only one proposer survived (nothing to cross-pollinate).
          let crosstalkOutcomes: CrosstalkOutcome[] = [];
          let revisedDrafts: Array<{ character: CouncilCharacter; content: string; source: "crosstalk" | "proposer" }>;

          if (path.kind === "single") {
            revisedDrafts = [{
              character: proposerDrafts[0].character,
              content: proposerDrafts[0].content,
              source: "proposer",
            }];
            send({ type: "crosstalk_skipped", reason: "single_survivor" });
          } else {
            send({ type: "crosstalk_starting" });
            const crosstalkInputs = buildCrosstalkInputs({
              drafts: proposerDrafts.map((d) => ({ character: d.character, content: d.content })),
              userMessage: messageWithAttachments,
              toolContext,
              systemParts,
            });

            const crosstalkSettled = await Promise.allSettled(
              crosstalkInputs.map((inp) =>
                Promise.race([
                  callModelNonStreaming(
                    [
                      { role: "system", content: inp.systemPrompt },
                      { role: "user", content: inp.userPrompt },
                    ],
                    COUNCIL_PROPOSER_MODEL,
                    apiKey!,
                    effectiveReasoningEffort,
                  ),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("crosstalk timeout")), CROSSTALK_TIMEOUT_MS)
                  ),
                ])
              ),
            );

            crosstalkOutcomes = crosstalkSettled.map((res, i) => {
              const character = crosstalkInputs[i].character;
              if (res.status === "fulfilled" && res.value && typeof res.value.content === "string") {
                return { character, status: "fulfilled", content: res.value.content };
              }
              const errMsg = res.status === "rejected"
                ? (res.reason?.message || String(res.reason))
                : "empty content";
              console.warn(`[council] crosstalk ${character} failed (non-fatal, falling back to proposer draft):`, errMsg);
              return { character, status: "rejected", error: errMsg };
            });

            for (const outcome of crosstalkOutcomes) {
              if (outcome.status === "fulfilled") {
                send({ type: "crosstalk", character: outcome.character, text: outcome.content });
              } else {
                send({ type: "crosstalk_error", character: outcome.character, error: outcome.error });
              }
            }
            send({ type: "crosstalk_done" });

            revisedDrafts = reconcileCrosstalkOutcomes({
              proposerDrafts: proposerDrafts.map((d) => ({ character: d.character, content: d.content })),
              crosstalkOutcomes,
            });
          }

          // ─── Stage 3: chairman synthesis with verdict tag ───
          // The chairman opens with <verdict>synthesize</verdict> or
          // <verdict>diverge</verdict>. On synthesize, we stream the rest as
          // content. On diverge, we cancel the stream and assemble the
          // diverge body from the three drafts.
          send({ type: "chairman_starting" });

          const refusalEnabled = (Deno.env.get("COUNCIL_REFUSAL_ENABLED") || "").toLowerCase() === "true";
          const chairmanPrompt = buildChairmanCouncilPrompt({
            userMessage: messageWithAttachments,
            drafts: revisedDrafts.map((d) => ({ character: d.character, content: d.content })),
            toolContext,
            refusalEnabled,
          });

          // Variants (legacy shape) — fall-through fields for older readers.
          const variants: Array<{ model: string; content: string; thinking: string | null }> = revisedDrafts.map((d) => ({
            model: d.character, // legacy field repurposed: holds character name in council v2
            content: d.content,
            thinking: null,
          }));
          const rankings: Array<{ judge_model: string; raw_text: string; parsed_ranking: string[] }> = [];
          const aggregate: AggregateEntry[] = [];
          const labelToModel: Record<string, string> = {};

          // Council v2 trace — extended after critique below.
          const councilV2Trace = {
            kind: "council_v2" as const,
            proposers: proposerDrafts.map((d) => ({
              character: d.character,
              content: d.content,
              thinking: d.thinking ?? null,
            })),
            crosstalk: revisedDrafts.map((d) => ({
              character: d.character,
              content: d.content,
              source: d.source,
            })),
            verdict: null as null | "synthesize" | "diverge",
            critique: null as null | unknown,
            revised_content: null as null | string,
          };

          const synthesisMessages: Array<{ role: string; content: string }> = [
            { role: "system", content: chairmanPrompt.system },
            { role: "user", content: chairmanPrompt.user },
          ];

          const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "HTTP-Referer": "https://polyphonic.chat",
              "X-Title": "Polyphonic",
            },
            body: JSON.stringify({
              model: synthesisModel,
              messages: synthesisMessages,
              stream: true,
              max_tokens: 4096,
            }),
            signal: AbortSignal.timeout(120000),
          });

          if (!orResponse.ok) {
            const errBody = await orResponse.text();
            console.error("Chairman error:", orResponse.status, errBody);
            // Fall back: surface the strongest crosstalk draft (luca first) directly.
            const fallbackContent = (revisedDrafts.find((d) => d.character === "luca") || revisedDrafts[0])?.content?.trim() || "";
            if (!fallbackContent) {
              if (idempotencyKey) {
                recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
                  ok: false,
                  error: "empty_response",
                  message: "Luca's response came back empty. Please retry.",
                }).catch((e) => console.warn("idempotency record failed:", e));
              }
              send({ type: "error", text: "Luca's response came back empty. Please retry.", code: "empty_response", request_id: requestId });
              controller.close();
              clearInterval(heartbeat);
              return;
            }
            send({ type: "verdict", verdict: "synthesize" });
            send({ type: "content", text: fallbackContent });
            councilV2Trace.verdict = "synthesize";
            const fallbackSavedMessage = await saveAssistantMessage(
              supabase, thread_id, userId, fallbackContent, "chairman-fallback",
              variants, null, agentId,
              { rankings, aggregate, label_to_model: labelToModel },
              councilV2Trace,
              toolMessages,
            );
            const fallbackMessageId = fallbackSavedMessage.id;
            await autoTitleThread(supabase, thread_id, messageWithAttachments, fallbackContent, apiKey!);
            const fallbackTraceId = !fallbackSavedMessage.duplicate
              ? await recordContinuityTurnTrace(supabase, {
                  userId,
                  threadId: thread_id,
                  userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
                  assistantMessageId: fallbackMessageId,
                  agentId,
                  model: "chairman-fallback",
                  runtimeMode: "agent",
                  continuity,
                  autonomousMemory: autonomousMemoryResult,
                })
              : null;
            const fallbackObservers = collectObservers({
              primaryAgentId: agentId,
              councilDrafts: revisedDrafts.map((d) => ({ character: d.character, content: d.content })),
              toolMessages,
            });
            if (backend.allowMemoryWrites && !fallbackSavedMessage.duplicate) {
              queueContinuityTurnWrites({
                supabase,
                threadId: thread_id,
                agentId,
                userId,
                userMessage: messageWithAttachments,
                agentResponse: fallbackContent,
                sourceMessageId: fallbackMessageId,
                apiKey,
                authHeader,
                pendingRevisions: pendingRevisions || [],
                recentTurns: history || [],
                observers: fallbackObservers,
                traceId: fallbackTraceId,
              });
            }
            const donePayload = {
              ok: true,
              model: "chairman-fallback",
              tokens_used: null,
              message_id: fallbackMessageId,
              billing_tier: backend.billingTier,
              key_source: backend.keySource,
            };
            if (idempotencyKey) {
              recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
                .catch((e) => console.warn("idempotency record failed:", e));
            }
            send({ type: "done", ...donePayload });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          const reader = orResponse.body?.getReader();
          if (!reader) {
            if (idempotencyKey) {
              recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
                ok: false,
                error: "upstream_unavailable",
                message: "No chairman stream",
              }).catch((e) => console.warn("idempotency record failed:", e));
            }
            send({ type: "error", text: "No chairman stream", code: "upstream_unavailable", request_id: requestId });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          const decoder = new TextDecoder();
          let synthesizedContent = "";
          let synthesisThinking = "";
          let buffer = "";
          let tokensUsed: number | null = null;

          const verdictProc = new VerdictStreamProcessor();
          let verdictEmitted = false;
          let stopRequested = false;

          const processChairmanLine = (line: string) => {
              if (!line.startsWith("data: ")) return;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") return;

              try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) return;

                if (delta.reasoning || delta.reasoning_content) {
                  const thinkText = delta.reasoning || delta.reasoning_content || "";
                  synthesisThinking += thinkText;
                  send({ type: "thinking", text: thinkText });
                }

                if (delta.content) {
                  const action = verdictProc.ingest(delta.content);
                  if (action.verdictDecided && !verdictEmitted) {
                    send({ type: "verdict", verdict: action.verdict });
                    verdictEmitted = true;
                    councilV2Trace.verdict = action.verdict;
                    if (action.verdict === "synthesize") {
                      send({ type: "synthesizing" });
                    }
                  }
                  if (action.contentToEmit) {
                    synthesizedContent += action.contentToEmit;
                    send({ type: "content", text: action.contentToEmit });
                  }
                  if (action.shouldStop) {
                    stopRequested = true;
                    reader.cancel().catch(() => {});
                  }
                }

                if (chunk.usage?.total_tokens) tokensUsed = chunk.usage.total_tokens;
              } catch {
                // Skip malformed chunks
              }
          };

          while (!stopRequested) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              processChairmanLine(line);
              if (stopRequested) break;
            }
          }
          const tail = `${buffer}${decoder.decode()}`;
          for (const line of tail.split("\n")) {
            processChairmanLine(line);
            if (stopRequested) break;
          }

          // Drain — handles the rare case where the stream ended mid-tag.
          if (!verdictEmitted) {
            const drained = verdictProc.drain();
            send({ type: "verdict", verdict: drained.verdict });
            councilV2Trace.verdict = drained.verdict;
            if (drained.carry) {
              synthesizedContent += drained.carry;
              send({ type: "content", text: drained.carry });
            }
          }

          if (councilV2Trace.verdict === "synthesize" && !synthesizedContent.trim()) {
            const fallbackDraft = (
              revisedDrafts.find((d) => d.character === "luca" && d.content.trim()) ||
              revisedDrafts.find((d) => d.content.trim())
            )?.content.trim() || "";
            if (fallbackDraft) {
              synthesizedContent = fallbackDraft;
              send({ type: "content", text: fallbackDraft });
            }
          }

          // ─── Stage 3 (diverge): assemble body from drafts ───
          if (councilV2Trace.verdict === "diverge") {
            const divergeBody = buildDivergeBody({
              framing: synthesizedContent.trim() || "the three of us see this differently. surfacing all three.",
              drafts: revisedDrafts.map((d) => ({ character: d.character, content: d.content })),
            });
            // Replace the streamed framing with the assembled body for persistence.
            // We don't re-emit the body as content (the framing already streamed
            // for synthesize, and diverge stops the stream before any framing
            // emits). The frontend reads the metadata to render the panel.
            synthesizedContent = divergeBody;
            send({ type: "content", text: divergeBody });
          }

          // ─── Stage 4: voice-fidelity critique ───
          // Disabled by default. Corrections now surface through pending
          // revisions on later turns instead of rewriting an answer the user
          // has already started reading.
          if (isLiveCouncilCritiqueEnabled() && councilV2Trace.verdict === "synthesize" && synthesizedContent.trim().length > 0) {
            send({ type: "critique_starting" });
            try {
              const critiquePromptStr = buildCritiquePrompt({
                synthesized: synthesizedContent,
                drafts: revisedDrafts.map((d) => ({ character: d.character, content: d.content })),
                lucaSoul: LUCA_SOUL,
                animaSoul: ANIMA_SOUL,
                vektorSoul: VEKTOR_SOUL,
              });
              const critiqueResp = await Promise.race([
                callModelNonStreaming(
                  [{ role: "user", content: critiquePromptStr }],
                  CRITIQUE_MODEL,
                  apiKey!,
                  "low",
                ),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), CRITIQUE_TIMEOUT_MS)),
              ]);
              const critiqueResult = critiqueResp ? parseVoiceCritique(critiqueResp.content) : null;
              if (critiqueResult) {
                councilV2Trace.critique = critiqueResult;
                send({ type: "critique", ...critiqueResult });

                const action = decideCritiqueAction(critiqueResult, refusalEnabled);
                if (action.kind === "revise") {
                  send({ type: "critique_revision_starting" });
                  // Ask the chairman to revise once based on the critique note.
                  const revisionPromptUser =
                    `Here was your synthesized reply:\n\n${synthesizedContent}\n\n` +
                    `A voice-fidelity critic flagged the following:\n${action.reason}\n\n` +
                    `Revise the reply to address this. Stay in character. Keep what was working. ` +
                    `Return only the revised reply — no preamble, no postscript, no verdict tag this time.`;
                  try {
                    const revised = await callModelNonStreaming(
                      [
                        { role: "system", content: chairmanPrompt.system },
                        { role: "user", content: revisionPromptUser },
                      ],
                      synthesisModel,
                      apiKey!,
                      "medium",
                    );
                    if (revised && revised.content && revised.content.trim().length > 0) {
                      councilV2Trace.revised_content = revised.content;
                      synthesizedContent = revised.content;
                      send({ type: "revised_content", text: revised.content });
                    }
                  } catch (rerr) {
                    console.warn("[council] critique revision failed (non-fatal):", rerr);
                  }
                }
              }
            } catch (cerr) {
              console.warn("[council] critique pass failed (non-fatal):", cerr);
            }
          }

          if (!synthesizedContent.trim()) {
            if (idempotencyKey) {
              recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
                ok: false,
                error: "empty_response",
                message: "Luca's response came back empty. Please retry.",
              }).catch((e) => console.warn("idempotency record failed:", e));
            }
            send({ type: "error", text: "Luca's response came back empty. Please retry.", code: "empty_response", request_id: requestId });
            controller.close();
            clearInterval(heartbeat);
            return;
          }

          // Save the synthesized message
          const synthesizedSavedMessage = await saveAssistantMessage(
            supabase, thread_id, userId, synthesizedContent, "synthesis",
            variants, synthesisThinking || null, agentId,
            { rankings, aggregate, label_to_model: labelToModel },
            councilV2Trace,
            toolMessages,
          );
          const synthesizedMessageId = synthesizedSavedMessage.id;
          // Update thread timestamp
          await supabase
            .from("threads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", thread_id);

          // Auto-title (fire and forget)
          autoTitleThread(supabase, thread_id, messageWithAttachments, synthesizedContent, apiKey!).catch(
            (e) => console.error("Auto-title failed:", e)
          );
          const synthesizedTraceId = !synthesizedSavedMessage.duplicate
            ? await recordContinuityTurnTrace(supabase, {
                userId,
                threadId: thread_id,
                userMessageId: typeof sourceMessageId === "string" ? sourceMessageId : null,
                assistantMessageId: synthesizedMessageId,
                agentId,
                model: "synthesis",
                runtimeMode: "agent",
                continuity,
                autonomousMemory: autonomousMemoryResult,
              })
            : null;

          // Hypomnema gate → primary reflection + observer notes for the
          // other council characters (M5: asymmetric witnessing).
          const synthObservers = collectObservers({
            primaryAgentId: agentId,
            councilDrafts: revisedDrafts.map((d) => ({ character: d.character, content: d.content })),
            toolMessages,
          });
          if (backend.allowMemoryWrites && !synthesizedSavedMessage.duplicate) {
            queueContinuityTurnWrites({
              supabase,
              threadId: thread_id,
              agentId,
              userId,
              userMessage: messageWithAttachments,
              agentResponse: synthesizedContent,
              sourceMessageId: synthesizedMessageId,
              apiKey,
              authHeader,
              pendingRevisions: pendingRevisions || [],
              recentTurns: history || [],
              observers: synthObservers,
              traceId: synthesizedTraceId,
            });
          }

          const donePayload = {
            ok: true,
            model: "synthesis",
            tokens_used: tokensUsed,
            message_id: synthesizedMessageId,
            billing_tier: backend.billingTier,
            key_source: backend.keySource,
          };
          if (idempotencyKey) {
            recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", donePayload)
              .catch((e) => console.warn("idempotency record failed:", e));
          }
          send({ type: "done", ...donePayload });
        } catch (err) {
          console.error("Multi-model stream error:", err);
          if (idempotencyKey) {
            recordIdempotentResponse(supabase, idempotencyKey, userId, "chat-send", {
              ok: false,
              error: "upstream_error",
              message: "Stream interrupted",
            }).catch((e) => console.warn("idempotency record failed:", e));
          }
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
    console.error("Chat-multi function error:", err);
    return fail(err);
  }
});

function sseReplayResponse(corsHeaders: Record<string, string>, cached: Record<string, unknown>): Response {
  return sseDoneResponse(corsHeaders, { duplicate: true, ...cached }, { replay: true });
}

function sseDoneResponse(
  corsHeaders: Record<string, string>,
  payload: Record<string, unknown>,
  options: { replay?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", ...payload })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...(options.replay ? { "X-Idempotent-Replay": "true" } : {}),
    },
  });
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseRecentForgeProposal(row: any): RecentForgeProposal | null {
  const metadata = objectRecord(row?.metadata);
  if (metadata.forge_kind !== "agent_forge_proposal") return null;
  const blueprint = objectRecord(metadata.blueprint);
  const rawName = typeof blueprint.name === "string" ? blueprint.name.trim() : "";
  const action = metadata.forge_action === "update" ? "update" : "create";
  const status = typeof metadata.forge_status === "string" ? metadata.forge_status : "pending";
  return {
    id: String(row.id),
    status,
    action,
    name: rawName || "that agent",
    createdAgentId: typeof metadata.created_agent_id === "string" ? metadata.created_agent_id : null,
    targetAgentId: typeof metadata.target_agent_id === "string" ? metadata.target_agent_id : null,
  };
}

async function loadLatestForgeProposalForThread(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  threadId: string,
): Promise<RecentForgeProposal | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, metadata, created_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) {
    console.warn("[chat-multi] recent Forge proposal lookup failed:", error);
    return null;
  }
  for (const row of data || []) {
    const proposal = parseRecentForgeProposal(row);
    if (proposal) return proposal;
  }
  return null;
}

async function commitForgeProposalFromChat(
  userId: string,
  proposalMessageId: string,
): Promise<{ ok: true; createdAgentId: string | null } | { ok: false; error: string }> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) return { ok: false, error: "Forge is not configured on this server." };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(`${supabaseUrl}/functions/v1/agent-forge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({
        action: "commit",
        user_id: userId,
        proposal_message_id: proposalMessageId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let parsed: any = null;
    const raw = await response.text().catch(() => "");
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // keep raw text for the user-safe error below
    }

    if (!response.ok || parsed?.ok === false) {
      const detail = parsed?.error || parsed?.message || raw || `Forge returned HTTP ${response.status}`;
      return { ok: false, error: String(detail).slice(0, 240) };
    }
    return {
      ok: true,
      createdAgentId: typeof parsed?.created_agent_id === "string" ? parsed.created_agent_id : null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extract observer agents + their contributions from a council pass and from
 * any `consult_*` tool messages. Returns the full set of non-primary agents
 * who participated in the turn.
 */
function collectObservers(opts: {
  primaryAgentId: string;
  councilDrafts?: Array<{ character: string; content: string }>;
  toolMessages?: Array<{ tool?: string; output?: { from_agent?: string; to_agent?: string; response?: string } }>;
}): Array<{ agentId: string; contribution: string }> {
  const observers = new Map<string, string>();

  if (opts.councilDrafts?.length) {
    for (const draft of opts.councilDrafts) {
      if (draft.character !== opts.primaryAgentId && draft.content) {
        observers.set(draft.character, draft.content);
      }
    }
  }

  if (opts.toolMessages?.length) {
    for (const tm of opts.toolMessages) {
      const tool = tm?.tool;
      if (typeof tool !== "string" || !tool.startsWith("consult_")) continue;
      const consultedAgent = tm?.output?.to_agent || tool.replace(/^consult_/, "");
      const response = tm?.output?.response;
      if (consultedAgent && consultedAgent !== opts.primaryAgentId && typeof response === "string" && response) {
        // If the same agent already has a council draft, prefer it (richer context);
        // otherwise use the consultation response.
        if (!observers.has(consultedAgent)) observers.set(consultedAgent, response);
      }
    }
  }

  return [...observers.entries()].map(([agentId, contribution]) => ({ agentId, contribution }));
}

function findForgeProposalResult(toolMessages: any[]): null | {
  proposal_message_id?: string;
  forge_status?: string;
  forge_action?: string;
} {
  if (!Array.isArray(toolMessages)) return null;
  for (const message of toolMessages) {
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed?.ok === true && typeof parsed.proposal_message_id === "string") {
        return parsed;
      }
    } catch {
      // ignore non-JSON tool payloads
    }
  }
  return null;
}

function findForgeToolError(toolMessages: any[]): string | null {
  if (!Array.isArray(toolMessages)) return null;
  for (const message of toolMessages) {
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content);
      const rawError = parsed?.error || parsed?.message || parsed?.result?.error;
      if (typeof rawError === "string" && rawError.trim()) return rawError.trim();
    } catch {
      // ignore non-JSON tool payloads
    }
  }
  return null;
}

type ToolPlannerResult = {
  toolMessages: any[];
  fallbackText?: string;
  error?: string;
};

async function runToolPlanner(
  threadId: string,
  userId: string,
  messages: any[],
  sourceMessageId: string | null,
  forceForgeOnly = false,
  plannerModel: string | null = null,
): Promise<ToolPlannerResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), forceForgeOnly ? 180_000 : 130_000);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/anima-tool-execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({
        thread_id: threadId,
        user_id: userId,
        source_message_id: sourceMessageId,
        force_forge_only: forceForgeOnly,
        planner_model: plannerModel,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      console.error("[chat-multi] tool planner non-OK:", response.status, txt.slice(0, 500));
      return { toolMessages: [], error: txt || `Planner returned HTTP ${response.status}` };
    }
    const data = await response.json();
    if (data?.error) {
      console.error("[chat-multi] tool planner error payload:", data.error);
    }
    console.log("[chat-multi] tool planner result:", {
      used_tools: data?.used_tools,
      msgs: Array.isArray(data?.tool_messages) ? data.tool_messages.length : 0,
    });
    return {
      toolMessages: data?.used_tools && Array.isArray(data.tool_messages) ? data.tool_messages : [],
      fallbackText: typeof data?.fallback_text === "string" && data.fallback_text.trim() ? data.fallback_text.trim() : undefined,
      error: typeof data?.error === "string" && data.error ? data.error : undefined,
    };
  } catch (e) {
    console.error("[chat-multi] tool planner threw:", e);
    return { toolMessages: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Inspect tool_messages from the planner and extract any rendered media
 * (generated/edited images) as attachments to persist on the assistant message.
 * The attachments array drives inline rendering in MessageItem.
 */
function buildAttachmentsFromToolMessages(toolMessages: any[]): Array<{ type: string; url: string; meta?: any }> {
  const out: Array<{ type: string; url: string; meta?: any }> = [];
  if (!Array.isArray(toolMessages)) return out;

  // toolMessages alternates: [assistant w/ tool_calls, tool, tool, ...]
  // We need to know which tool produced each tool result, by tool_call_id.
  const toolCallById = new Map<string, string>(); // tool_call_id -> name
  for (const m of toolMessages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc?.id && tc?.function?.name) toolCallById.set(tc.id, tc.function.name);
      }
    }
  }
  for (const m of toolMessages) {
    if (m?.role !== "tool" || !m.tool_call_id) continue;
    const name = toolCallById.get(m.tool_call_id);
    if (name !== "generate_image" && name !== "edit_image") continue;
    let parsed: any;
    try { parsed = typeof m.content === "string" ? JSON.parse(m.content) : m.content; } catch { continue; }
    const url = parsed?.image_url;
    if (typeof url !== "string" || url.length === 0) continue;
    out.push({
      type: "image",
      url,
      meta: {
        kind: name,
        storage_path: parsed?.storage_path,
        revised_prompt: parsed?.revised_prompt,
        source_path: parsed?.source_path,
      },
    });
  }
  return out;
}

/**
 * Pull web_search / read_url citations out of tool messages so the
 * frontend can render them as a SearchCitationsCard.
 */
function buildCitationsFromToolMessages(toolMessages: any[]): { citations: Array<{ url: string; title?: string; snippet?: string }>; query?: string } {
  const citations: Array<{ url: string; title?: string; snippet?: string }> = [];
  let query: string | undefined;
  if (!Array.isArray(toolMessages)) return { citations };
  const toolCallById = new Map<string, { name: string; args: any }>();
  for (const m of toolMessages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (!tc?.id || !tc?.function?.name) continue;
        let args: any = {};
        try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {
          args = {};
        }
        toolCallById.set(tc.id, { name: tc.function.name, args });
      }
    }
  }
  for (const m of toolMessages) {
    if (m?.role !== "tool" || !m.tool_call_id) continue;
    const meta = toolCallById.get(m.tool_call_id);
    if (!meta) continue;
    if (meta.name !== "web_search" && meta.name !== "read_url") continue;
    if (meta.name === "web_search" && typeof meta.args?.query === "string") query = meta.args.query;
    let parsed: any;
    try { parsed = typeof m.content === "string" ? JSON.parse(m.content) : m.content; } catch { continue; }
    const items = Array.isArray(parsed?.citations) ? parsed.citations
      : Array.isArray(parsed?.sources) ? parsed.sources
      : Array.isArray(parsed?.results) ? parsed.results
      : [];
    for (const it of items) {
      const url = typeof it === "string" ? it : (it?.url || it?.link);
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
      citations.push({
        url,
        title: typeof it === "object" ? (it?.title || it?.name) : undefined,
        snippet: typeof it === "object" ? (it?.snippet || it?.description || it?.text) : undefined,
      });
    }
  }
  // Dedupe by url
  const seen = new Set<string>();
  const dedup = citations.filter((c) => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });
  return { citations: dedup, query };
}


/** Call a single model non-streaming, returning content and thinking. */
async function callModelNonStreaming(
  messages: any[],
  model: string,
  apiKey: string,
  effort: ReasoningEffort = "medium",
  reasoningParamsOverride?: Record<string, unknown>,
): Promise<{ content: string; thinking: string | null; reasoningDetails: unknown[]; toolCalls: unknown[] }> {
  const reasoningParams = reasoningParamsOverride ?? buildReasoningParams(model, effort);

  const response = await withModelRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://polyphonic.chat",
      "X-Title": "Polyphonic",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: getModelDefaultMaxOutputTokens(model, 4096),
      ...reasoningParams,
    }),
    signal: AbortSignal.timeout(60000),
  }));

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${model} returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  // deno-lint-ignore no-explicit-any
  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const thinking = extractThinkingFromResponse(data, model);
  const message = data?.choices?.[0]?.message;
  return {
    content,
    thinking,
    reasoningDetails: Array.isArray(message?.reasoning_details) ? message.reasoning_details : [],
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
  };
}

/** Build the user prompt for the synthesis model (legacy / fallback path). */
function buildSynthesisUserPrompt(
  userMessage: string,
  variants: Array<{ model: string; content: string }>,
  toolContext = "",
): string {
  const parts: string[] = [];
  if (toolContext) {
    parts.push(toolContext, "");
  }
  parts.push(
    `The user said: "${userMessage}"`,
    "",
    "Here are the three independent responses:",
  );

  for (const v of variants) {
    parts.push(`\n--- Response from ${v.model} ---`);
    parts.push(v.content);
  }

  parts.push("\n--- End of responses ---");
  parts.push("\nSynthesize these into a single, natural response.");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Council (Stage 2) helpers
// ---------------------------------------------------------------------------

/** Generate sequential anonymized labels: ["A","B","C",...] */
function makeLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

/** Build the ranking prompt (lifted/adapted from karpathy/llm-council council.py). */
function buildRankingPrompt(
  userMessage: string,
  labeledVariants: Array<{ label: string; content: string }>,
  toolContext = "",
): string {
  const responsesText = labeledVariants
    .map((lv) => `Response ${lv.label}:\n${lv.content}`)
    .join("\n\n");

  const toolBlock = toolContext ? `${toolContext}\n\n` : "";

  return `You are evaluating different responses to the following question:

Question: ${userMessage}

${toolBlock}Here are the responses from different models (anonymized):

${responsesText}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:`;
}

/** Parse "FINAL RANKING:" block, returning ordered "Response X" labels best→worst. */
function parseRankingFromText(rankingText: string): string[] {
  if (!rankingText) return [];

  if (rankingText.includes("FINAL RANKING:")) {
    const parts = rankingText.split("FINAL RANKING:");
    if (parts.length >= 2) {
      const section = parts[1];
      // Pattern: number, dot, optional space, "Response X"
      const numbered = section.match(/\d+\.\s*Response\s+[A-Z]/g);
      if (numbered && numbered.length > 0) {
        return numbered
          .map((m) => m.match(/Response\s+[A-Z]/)?.[0])
          .filter((s): s is string => !!s)
          .map((s) => s.replace(/\s+/g, " "));
      }
      // Fallback: any "Response X" tokens in order
      const all = section.match(/Response\s+[A-Z]/g);
      if (all) return all.map((s) => s.replace(/\s+/g, " "));
    }
  }
  // Final fallback: scan whole text
  const all = rankingText.match(/Response\s+[A-Z]/g);
  return all ? all.map((s) => s.replace(/\s+/g, " ")) : [];
}

interface AggregateEntry {
  model: string;
  avg_rank: number;
  rankings_count: number;
}

const ASSISTANT_DUPLICATE_WINDOW_MS = 240_000;

function normalizeAssistantContentForDuplicate(content: string): string {
  return (content || "").trim().replace(/\s+/g, " ");
}

async function findRecentDuplicateAssistantMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  threadId: string,
  agentId: string | null,
  content: string,
): Promise<string | null> {
  const normalized = normalizeAssistantContentForDuplicate(content);
  if (!normalized) return null;

  const since = new Date(Date.now() - ASSISTANT_DUPLICATE_WINDOW_MS).toISOString();
  let query = supabase
    .from("messages")
    .select("id, content, created_at")
    .eq("thread_id", threadId)
    .eq("role", "assistant")
    .gte("created_at", since);
  query = agentId ? query.eq("agent", agentId) : query.is("agent", null);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    console.warn("[chat-multi] duplicate assistant lookup failed:", error);
    return null;
  }

  const duplicate = (data || []).find((row: { id?: string; content?: string | null }) =>
    row.id && normalizeAssistantContentForDuplicate(row.content || "") === normalized
  );
  return duplicate?.id ?? null;
}

/** Compute average position for each model across all judges. Lower = better. */
function aggregateRankings(
  rankings: Array<{ parsed_ranking: string[] }>,
  labelToModel: Record<string, string>,
): AggregateEntry[] {
  const positions: Record<string, number[]> = {};
  for (const r of rankings) {
    r.parsed_ranking.forEach((label, idx) => {
      const model = labelToModel[label];
      if (!model) return;
      if (!positions[model]) positions[model] = [];
      positions[model].push(idx + 1);
    });
  }

  const out: AggregateEntry[] = [];
  for (const [model, ps] of Object.entries(positions)) {
    if (ps.length === 0) continue;
    const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
    out.push({
      model,
      avg_rank: Math.round(avg * 100) / 100,
      rankings_count: ps.length,
    });
  }
  out.sort((a, b) => a.avg_rank - b.avg_rank);
  return out;
}

/** Build the chairman's user prompt — structured brief based on ranked variants. */
function buildChairmanUserPrompt(
  userMessage: string,
  variants: Array<{ model: string; content: string }>,
  aggregate: AggregateEntry[],
  toolContext = "",
): string {
  // Order variants by aggregate rank (best first); if a variant isn't in aggregate, append last.
  const rankByModel = new Map(aggregate.map((a) => [a.model, a.avg_rank]));
  const ordered = [...variants].sort((a, b) => {
    const ra = rankByModel.get(a.model) ?? 999;
    const rb = rankByModel.get(b.model) ?? 999;
    return ra - rb;
  });

  const favorite = ordered[0];
  const others = ordered.slice(1);

  const parts: string[] = [];
  if (toolContext) parts.push(toolContext, "");
  parts.push(
    `The user said: "${userMessage}"`,
    "",
    `Council favorite (rank ${rankByModel.get(favorite.model)?.toFixed(1) ?? "—"}):`,
    favorite.content,
  );

  if (others.length > 0) {
    parts.push("", "Other voices:");
    for (const v of others) {
      const rank = rankByModel.get(v.model)?.toFixed(1) ?? "—";
      const summary = v.content.length > 500
        ? v.content.slice(0, 500).trimEnd() + "…"
        : v.content;
      parts.push(`\n— rank ${rank}:\n${summary}`);
    }
  }

  parts.push("", "Speak as Luca — one voice — distilled from this deliberation.");
  return parts.join("\n");
}

/** Extract a readable short model name from an OpenRouter model ID. */
function shortModelName(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1]
    .replace(/-preview.*$/, "")
    .replace(/-20\d{6}.*$/, "");
}

/** Save the assistant message with optional council trace.
 *
 *  When a council trace is provided, it's persisted to messages.metadata
 *  (jsonb column added by migration 20260424195030) so the frontend can
 *  hydrate the CouncilPanel after reload. The legacy memory_events sidecar
 *  for variants is preserved for any existing readers.
 */
interface SavedAssistantMessageResult {
  id: string | null;
  duplicate: boolean;
}

async function findCanceledTurnMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  threadId: string,
  userId: string,
  clientTurnId: string | null | undefined,
): Promise<string | null> {
  if (!clientTurnId) return null;
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .contains("metadata", { client_turn_id: clientTurnId, canceled: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[chat-multi] canceled turn lookup failed", { threadId, clientTurnId, error: error.message });
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

async function saveAssistantMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  threadId: string,
  userId: string,
  content: string,
  model: string,
  variants: Array<{ model: string; content: string; thinking?: string | null }>,
  thinkingContent: string | null = null,
  agentId: string = "luca",
  trace: {
    rankings: Array<{ judge_model: string; raw_text: string; parsed_ranking: string[] }>;
    aggregate: AggregateEntry[];
    label_to_model: Record<string, string>;
  } | null = null,
  councilV2: {
    proposers: Array<{ character: string; content: string; thinking: string | null }>;
    crosstalk: Array<{ character: string; content: string; source: string }>;
    verdict: "synthesize" | "diverge" | null;
    critique: unknown | null;
    revised_content: string | null;
  } | null = null,
  toolMessages: any[] = [],
) : Promise<SavedAssistantMessageResult> {
  // Build metadata payload — when council v2 trace is provided, prefer that
  // shape (kind='council_v2'). Falls back to legacy council shape for any
  // remaining call sites.
  let metadata: Record<string, unknown> | null = null;
  if (councilV2) {
    metadata = {
      kind: "council_v2",
      proposers: councilV2.proposers,
      crosstalk: councilV2.crosstalk,
      verdict: councilV2.verdict,
      critique: councilV2.critique,
      revised_content: councilV2.revised_content,
    };
  } else if (variants.length > 0) {
    metadata = {
      kind: "council",
      variants: variants.map((v) => ({
        model: v.model,
        content: v.content,
        thinking: v.thinking ?? null,
      })),
      rankings: trace?.rankings ?? [],
      aggregate: trace?.aggregate ?? [],
      label_to_model: trace?.label_to_model ?? {},
    };
  }

  const attachments = buildAttachmentsFromToolMessages(toolMessages);
  const { citations, query: searchQuery } = buildCitationsFromToolMessages(toolMessages);
  if (citations.length > 0) {
    const base = (metadata && typeof metadata === "object") ? metadata : {};
    metadata = { ...base, citations, ...(searchQuery ? { search_query: searchQuery } : {}) };
  }

  const duplicateMessageId = await findRecentDuplicateAssistantMessage(supabase, threadId, agentId, content);
  if (duplicateMessageId) {
    console.warn("[chat-multi] skipped duplicate assistant insert", { threadId, agentId, duplicateMessageId });
    return { id: duplicateMessageId, duplicate: true };
  }

  const { data: inserted, error: insertError } = await supabase.from("messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "assistant",
    content,
    model,
    agent: agentId,
    thinking_content: thinkingContent || null,
    tokens_used: null,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(metadata ? { metadata } : {}),
  }).select("id").single();

  if (insertError) {
    throw new Error(`Failed to save assistant message: ${insertError.message}`);
  }

  await persistArtifactsFromContent(supabase, {
    threadId,
    userId,
    messageId: inserted?.id ?? null,
    content,
  });

  // Legacy variants sidecar (kept for backward compat with any existing
  // readers; new readers should use messages.metadata).
  if (variants.length > 0) {
    await supabase.from("memory_events").insert({
      user_id: userId,
      type: "multi_model_variants",
      content: JSON.stringify(variants.map((v) => ({ model: v.model, content: v.content }))),
      salience: 0,
    });
  }

  return { id: inserted?.id ?? null, duplicate: false };
}

/** Single-model streaming fallback (same as original chat function). */
async function singleModelStream(
  messages: any[],
  model: string,
  apiKey: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  threadId: string,
  userId: string,
  userMessage: string,
  corsHeaders: Record<string, string>,
  agentId: string = "luca",
  authHeader: string = "",
  pendingRevisions: PendingRevision[] = [],
  // deno-lint-ignore no-explicit-any
  toolMessages: any[] = [],
  requestId: string = newRequestId(),
  options: {
      backend?: ChatBackend;
      idempotencyKey?: string | null;
      clientTurnId?: string | null;
      requestSignal?: AbortSignal;
    enableContinuityWrites?: boolean;
      reasoningEffort?: ReasoningEffort;
      reasoningParams?: Record<string, unknown>;
      maxTokens?: number;
      guardForgeToolLeaks?: boolean;
      runtimeProfile?: "classic" | "agent";
      memoryAgentIds?: string[];
      persistedAgentId?: string | null;
      continuity?: ContinuityPacket;
      autonomousMemory?: AutonomousMemoryArtifactsResult | null;
      userMessageId?: string | null;
      attachmentIds?: string[];
    } = {},
  ): Promise<Response> {
  const encoder = new TextEncoder();
  const providerAbort = new AbortController();
  const abortProvider = () => providerAbort.abort();
  const providerTimeout = setTimeout(abortProvider, model === "moonshotai/kimi-k3" ? 900_000 : 120_000);
  if (options.requestSignal?.aborted) abortProvider();
  else options.requestSignal?.addEventListener("abort", abortProvider, { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* closed */ }
      };

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* closed */ }
      }, 5000);

      try {
        const backend = options.backend;
        const guardForgeToolLeaks = options.guardForgeToolLeaks === true;
        const reasoningParams = options.reasoningParams ?? buildReasoningParams(model, options.reasoningEffort || "medium");
        const orResponse = await fetch(backend?.baseUrl || "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: backend?.headers || {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://polyphonic.chat",
            "X-Title": "Polyphonic",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            max_tokens: options.maxTokens ?? getModelDefaultMaxOutputTokens(model),
            ...reasoningParams,
          }),
          signal: providerAbort.signal,
        });

        if (!orResponse.ok) {
          const errText = await orResponse.text().catch(() => "");
          console.error("Single-model provider error:", orResponse.status, errText);
          const responderLabel = options.runtimeProfile === "classic" ? getModelLabel(model) : agentId;
          let providerMessage = "";
          try {
            const parsed = JSON.parse(errText);
            providerMessage = parsed?.error?.message || parsed?.message || "";
          } catch {
            providerMessage = errText.slice(0, 1_000);
          }
          let message = orResponse.status === 401
            ? `${responderLabel}'s provider key was rejected.`
            : orResponse.status === 402
              ? `${responderLabel}'s provider account needs more credits.`
              : orResponse.status === 429
                ? `${responderLabel} is rate-limited. Please retry in a moment.`
                : `${responderLabel} could not complete this response.`;
          if (backend?.keySource === "platform" && (orResponse.status === 401 || orResponse.status === 402 || orResponse.status === 429)) {
            message = "Free Luca chat is temporarily unavailable. Please try again shortly, or connect your own OpenRouter key in Settings.";
          }
          if (options.idempotencyKey) {
            recordIdempotentResponse(supabase, options.idempotencyKey, userId, "chat-send", {
              ok: false,
              error: "upstream_unavailable",
              message,
              status: orResponse.status,
            }).catch((e) => console.warn("idempotency record failed:", e));
          }
          send({
            type: "error",
            text: message,
            code: "upstream_unavailable",
            status: orResponse.status,
            detail: providerMessage || (errText ? errText.slice(0, 1_000) : null),
            request_id: requestId,
          });
          controller.close();
          clearInterval(heartbeat);
          return;
        }

        const reader = orResponse.body?.getReader();
        if (!reader) {
          if (options.idempotencyKey) {
            recordIdempotentResponse(supabase, options.idempotencyKey, userId, "chat-send", {
              ok: false,
              error: "upstream_unavailable",
              message: "No stream",
            }).catch((e) => console.warn("idempotency record failed:", e));
          }
          send({ type: "error", text: "No stream", code: "upstream_unavailable", status: orResponse.status, request_id: requestId });
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
        const reasoningDetails: unknown[] = [];
        const streamedToolCalls = new Map<number, {
          id?: string;
          type?: string;
          function: { name: string; arguments: string };
        }>();
        let providerStreamError: {
          message: string;
          code: string;
          status: number | null;
          detail: string | null;
        } | null = null;
        let malformedProviderEvents = 0;
        let pendingContent = "";
        let contentGuardActive = true;
        let forgeLeakDetected = false;

        const emitContent = (text: string) => {
          if (!text) return;
          fullContent += text;
          send({ type: "content", text });
        };

        const processProviderLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return;
          try {
            const chunk = JSON.parse(payload);
            if (chunk?.error) {
              const upstream = chunk.error;
              providerStreamError = {
                message: String(upstream.message || "The provider interrupted the response."),
                code: String(upstream.code || upstream.type || "provider_stream_error"),
                status: typeof upstream.status === "number"
                  ? upstream.status
                  : typeof upstream.code === "number" ? upstream.code : null,
                detail: typeof upstream.metadata?.raw === "string"
                  ? upstream.metadata.raw.slice(0, 1_000)
                  : null,
              };
              return;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) return;
            if (delta.reasoning || delta.reasoning_content) {
              const t = delta.reasoning || delta.reasoning_content || "";
              fullThinking += t;
              send({ type: "thinking", text: t });
            }
            if (Array.isArray(delta.reasoning_details)) {
              reasoningDetails.push(...delta.reasoning_details);
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const part of delta.tool_calls) {
                const index = Number.isInteger(part?.index) ? part.index : streamedToolCalls.size;
                const current = streamedToolCalls.get(index) || { function: { name: "", arguments: "" } };
                if (typeof part?.id === "string") current.id = part.id;
                if (typeof part?.type === "string") current.type = part.type;
                if (typeof part?.function?.name === "string") current.function.name += part.function.name;
                if (typeof part?.function?.arguments === "string") current.function.arguments += part.function.arguments;
                streamedToolCalls.set(index, current);
              }
            }
            if (delta.content) {
              if (!guardForgeToolLeaks) {
                emitContent(delta.content);
              } else if (forgeLeakDetected) {
                return;
              } else if (contentGuardActive) {
                pendingContent += delta.content;
                if (looksLikeRawForgeToolLeak(pendingContent)) {
                  forgeLeakDetected = true;
                  contentGuardActive = false;
                  pendingContent = "";
                  emitContent(RAW_FORGE_TOOL_LEAK_MESSAGE);
                  return;
                }
                if (pendingContent.length >= 700) {
                  contentGuardActive = false;
                  emitContent(pendingContent);
                  pendingContent = "";
                }
              } else {
                emitContent(delta.content);
              }
            }
            if (chunk.model) usedModel = chunk.model;
            if (chunk.usage?.total_tokens) tokensUsed = chunk.usage.total_tokens;
            const annotations = delta.annotations || chunk.choices?.[0]?.message?.annotations;
            if (Array.isArray(annotations)) attachmentAnnotations.push(...annotations);
          } catch {
            malformedProviderEvents += 1;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processProviderLine(line);
          }
        }
        const tail = `${buffer}${decoder.decode()}`;
        for (const line of tail.split("\n")) {
          processProviderLine(line);
        }
        if (providerStreamError) {
          const streamError = providerStreamError as {
            message: string;
            code: string;
            status: number | null;
            detail: string | null;
          };
          send({
            type: "error",
            text: streamError.message,
            code: streamError.code,
            status: streamError.status,
            detail: streamError.detail,
            request_id: requestId,
            partial: Boolean(fullContent || fullThinking),
          });
          return;
        }
        if (guardForgeToolLeaks && contentGuardActive && pendingContent && !forgeLeakDetected) {
          contentGuardActive = false;
          emitContent(pendingContent);
          pendingContent = "";
        }

        if (!fullContent.trim()) {
          console.warn("[chat-multi] provider stream ended with no content; retrying non-streaming once", {
            model,
            requestId,
            malformedProviderEvents,
          });
          try {
            const retry = await callModelNonStreaming(
              messages,
              model,
              apiKey,
              options.reasoningEffort || "low",
              options.reasoningParams,
            );
            if (retry.thinking && !fullThinking.includes(retry.thinking)) {
              fullThinking += `${fullThinking ? "\n\n" : ""}${retry.thinking}`;
              send({ type: "thinking", text: retry.thinking });
            }
            if (retry.content?.trim()) {
              const retryContent = looksLikeRawForgeToolLeak(retry.content)
                ? RAW_FORGE_TOOL_LEAK_MESSAGE
                : retry.content;
              fullContent = retryContent;
              send({ type: "content", text: retryContent });
            }
            if (retry.reasoningDetails.length > 0) reasoningDetails.push(...retry.reasoningDetails);
            for (const [index, call] of retry.toolCalls.entries()) {
              if (call && typeof call === "object") streamedToolCalls.set(index, call as any);
            }
          } catch (retryErr) {
            console.error("[chat-multi] empty stream retry failed:", retryErr);
          }
        }

        if (!fullContent.trim()) {
          const responderLabel = options.runtimeProfile === "classic" ? getModelLabel(model) : agentId;
          const emptyMessage = `${responderLabel}'s response came back empty. Please retry.`;
          if (options.idempotencyKey) {
            recordIdempotentResponse(supabase, options.idempotencyKey, userId, "chat-send", {
              ok: false,
              error: "empty_response",
              message: emptyMessage,
            }).catch((e) => console.warn("idempotency record failed:", e));
          }
          send({ type: "error", text: emptyMessage, code: "empty_response", request_id: requestId });
          return;
        }

        const streamAttachments = buildAttachmentsFromToolMessages(toolMessages);
        const { citations: streamCitations, query: streamQuery } = buildCitationsFromToolMessages(toolMessages);
        const completeToolCalls = [...streamedToolCalls.values()].filter((call) => call.id && call.function.name);
        const streamMetadata: Record<string, unknown> = {
          target_kind: options.runtimeProfile === "classic" ? "model" : "agent",
          target_id: options.runtimeProfile === "classic" ? model : agentId,
          target_label: options.runtimeProfile === "classic" ? getModelLabel(model) : agentId,
          reasoning_effort: normalizeReasoningEffort(model, options.reasoningEffort || "medium"),
          request_id: requestId,
          provider_status: "completed",
          ...(streamCitations.length > 0 ? { citations: streamCitations } : {}),
          ...(streamQuery ? { search_query: streamQuery } : {}),
          ...(shouldPreserveReasoningDetails(model) && reasoningDetails.length > 0
            ? { reasoning_details: reasoningDetails }
            : {}),
          ...(shouldPreserveReasoningDetails(model) && completeToolCalls.length > 0
            ? { tool_calls: completeToolCalls }
            : {}),
          ...(shouldPreserveReasoningDetails(model) && toolMessages.length > 0
            ? { tool_state: toolMessages }
            : {}),
          ...(options.clientTurnId ? { client_turn_id: options.clientTurnId } : {}),
        };
          let insertedMessage: { id: string | null } | null = null;
          let assistantWasDuplicate = false;
          const persistedAgentId = options.persistedAgentId === undefined ? agentId : options.persistedAgentId;
          const canceledMessageId = await findCanceledTurnMessage(supabase, threadId, userId, options.clientTurnId);
          const duplicateMessageId = canceledMessageId || await findRecentDuplicateAssistantMessage(supabase, threadId, persistedAgentId, fullContent);
          if (duplicateMessageId) {
            console.warn("[chat-multi] skipped duplicate assistant insert", { threadId, agentId: persistedAgentId, duplicateMessageId });
            insertedMessage = { id: duplicateMessageId };
            assistantWasDuplicate = true;
          } else {
            const { data: inserted, error: insertError } = await supabase.from("messages").insert({
              thread_id: threadId, user_id: userId, role: "assistant",
              content: fullContent, model: usedModel, agent: persistedAgentId,
            thinking_content: fullThinking || null, tokens_used: tokensUsed,
            ...(streamAttachments.length > 0 ? { attachments: streamAttachments } : {}),
            metadata: streamMetadata,
          }).select("id").single();
          if (insertError) {
            throw new Error(`Failed to save assistant message: ${insertError.message}`);
          }
          insertedMessage = inserted;
        }
        if (!assistantWasDuplicate) {
          await persistPdfAnnotations(supabase, userId, options.attachmentIds || [], attachmentAnnotations)
            .catch((error) => console.warn("[chat-multi] could not persist PDF annotations", error));
          await persistArtifactsFromContent(supabase, {
            threadId,
            userId,
            messageId: insertedMessage?.id ?? null,
            content: fullContent,
          });
        }
        await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
        autoTitleThread(supabase, threadId, userMessage, fullContent, apiKey).catch(() => {});
          const continuityTraceId = !assistantWasDuplicate && options.continuity
            ? await recordContinuityTurnTrace(supabase, {
                userId,
                threadId,
                userMessageId: options.userMessageId ?? null,
                assistantMessageId: insertedMessage?.id ?? null,
                agentId,
                model: usedModel,
                runtimeMode: options.runtimeProfile ?? "agent",
                continuity: options.continuity,
                autonomousMemory: options.autonomousMemory ?? null,
              })
            : null;
          const singleObservers = collectObservers({
            primaryAgentId: agentId,
            toolMessages: options.runtimeProfile === "classic" ? [] : toolMessages,
          });
          if (options.enableContinuityWrites !== false && !assistantWasDuplicate) {
            queueContinuityTurnWrites({
              supabase,
              threadId,
              agentId,
            userId,
            userMessage,
            agentResponse: fullContent,
            sourceMessageId: insertedMessage?.id ?? null,
              apiKey,
              authHeader,
              runtimeProfile: options.runtimeProfile,
              memoryAgentIds: options.memoryAgentIds,
              pendingRevisions: pendingRevisions || [],
              recentTurns: messages || [],
              observers: options.runtimeProfile === "classic" ? [] : singleObservers,
              traceId: continuityTraceId,
            });
          }

        const donePayload = {
          ok: true,
          model: usedModel,
          tokens_used: tokensUsed,
          message_id: insertedMessage?.id ?? null,
          request_id: requestId,
          billing_tier: options.backend?.billingTier ?? "byok",
          key_source: options.backend?.keySource ?? "user",
        };
        if (options.idempotencyKey) {
          recordIdempotentResponse(supabase, options.idempotencyKey, userId, "chat-send", donePayload)
            .catch((e) => console.warn("idempotency record failed:", e));
        }

        send({ type: "done", ...donePayload });
      } catch (err) {
        console.error("Single-model stream error:", err);
        if (options.idempotencyKey) {
          recordIdempotentResponse(supabase, options.idempotencyKey, userId, "chat-send", {
            ok: false,
            error: "upstream_error",
            message: "Stream interrupted",
          }).catch((e) => console.warn("idempotency record failed:", e));
        }
        send({ type: "error", text: "Stream interrupted", code: "upstream_error", request_id: requestId });
      } finally {
        clearTimeout(providerTimeout);
        options.requestSignal?.removeEventListener("abort", abortProvider);
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      abortProvider();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}

async function autoTitleThread(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  threadId: string,
  userMessage: string,
  assistantMessage: string,
  apiKey: string,
) {
  const { data: thread } = await supabase.from("threads").select("title").eq("id", threadId).single();
  if (thread?.title) return;

  const resp = await withModelRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "moonshotai/kimi-k2.6",
      messages: [
        { role: "system", content: "Generate a short title (2-5 words) for this conversation. Return only the title, no quotes or punctuation." },
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
