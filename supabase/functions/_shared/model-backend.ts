// Resolves which upstream chat-completions backend Luca should use.
//
// User OpenRouter keys unlock real Luca/custom-agent runtime. Without a user
// key, Polyphonic may fund restricted app-help surfaces (Polyphonic Guide)
// through OPENROUTER_API_KEY with tier-aware limits and feature gates.
// Real agent continuity, memory/autonomy, tools, Forge, imports, and advanced
// model freedom stay on BYOK.

import { AppError, AuthError, MissingApiKeyError } from "./errors.ts";

export type BillingTier = "guest" | "account_free" | "advanced" | "byok";
export type KeySource = "user" | "platform";

export type ChatBackend = {
  provider: "openrouter";
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  requestedModel: string;
  substitutedModel: boolean;
  keySource: KeySource;
  billingTier: BillingTier;
  allowEnsemble: boolean;
  allowTools: boolean;
  allowAdvancedSurfaces: boolean;
  allowMemoryWrites: boolean;
  quotaScope: "guest-chat-message" | "free-chat-message" | "byok-chat-message";
  quotaLimit: number;
  historyLimit: number;
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const FREE_LUCA_MODEL = "moonshotai/kimi-k2.6";

function openRouterHeaders(apiKey: string, title = "Polyphonic Luca"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://polyphonic.chat",
    "X-Title": title,
  };
}

function isAnonymousAuthUser(user: unknown): boolean {
  const u = (user || {}) as {
    is_anonymous?: boolean;
    app_metadata?: { provider?: string; providers?: string[] };
  };
  return (
    u.is_anonymous === true ||
    u.app_metadata?.provider === "anonymous" ||
    (Array.isArray(u.app_metadata?.providers) && u.app_metadata.providers.includes("anonymous"))
  );
}

async function loadUserOpenRouterKey(supabase: any, userId: string, required = false): Promise<string | null> {
  const { data, error } = await supabase.rpc("decrypt_user_api_key", { p_user_id: userId });
  if (error) {
    console.error("[model-backend] Could not read the user's OpenRouter connection.");
    if (required) {
      throw new AppError("upstream_unavailable", "Could not load your OpenRouter connection. Please try again shortly.", 503);
    }
  }
  const key = typeof data === "string" ? data.trim() : "";
  return key || null;
}

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function hasEmailAllowlistBypass(supabase: any, email: string): Promise<boolean> {
  if (!email) return false;
  const { data, error } = await supabase
    .from("token_gate_email_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("[model-backend] token_gate_email_allowlist check error:", error);
    return false;
  }

  return Boolean(data);
}

async function hasAdvancedAccess(supabase: any, userId: string, email = ""): Promise<boolean> {
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (role) return true;

  if (await hasEmailAllowlistBypass(supabase, email)) return true;

  const { data: verification } = await supabase
    .from("token_gate_verifications")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  const expiresAt = typeof verification?.expires_at === "string"
    ? new Date(verification.expires_at).getTime()
    : 0;
  return expiresAt > Date.now();
}

function backendForUserKey(apiKey: string, requestedModel: string): ChatBackend {
  return {
    provider: "openrouter",
    apiKey,
    baseUrl: OPENROUTER_URL,
    headers: openRouterHeaders(apiKey),
    model: requestedModel,
    requestedModel,
    substitutedModel: false,
    keySource: "user",
    billingTier: "byok",
    allowEnsemble: true,
    allowTools: true,
    allowAdvancedSurfaces: true,
    allowMemoryWrites: true,
    quotaScope: "byok-chat-message",
    quotaLimit: 500,
    historyLimit: 60,
  };
}

function backendForPlatformKey(opts: {
  apiKey: string;
  requestedModel: string;
  billingTier: Exclude<BillingTier, "byok">;
  allowAdvancedSurfaces: boolean;
}): ChatBackend {
  return {
    provider: "openrouter",
    apiKey: opts.apiKey,
    baseUrl: OPENROUTER_URL,
    headers: openRouterHeaders(opts.apiKey),
    model: FREE_LUCA_MODEL,
    requestedModel: opts.requestedModel,
    substitutedModel: opts.requestedModel !== FREE_LUCA_MODEL,
    keySource: "platform",
    billingTier: opts.billingTier,
    allowEnsemble: false,
    allowTools: false,
    allowAdvancedSurfaces: opts.allowAdvancedSurfaces,
    allowMemoryWrites: opts.billingTier !== "guest",
    quotaScope: opts.billingTier === "guest" ? "guest-chat-message" : "free-chat-message",
    quotaLimit: opts.billingTier === "guest" ? 20 : 50,
    historyLimit: opts.billingTier === "guest" ? 14 : 50,
  };
}

/**
 * The model the user's primary Luca chat speaks with — so Luca's inner life
 * (thoughts, reflections, wandering, dreams, journal) and its identity-authoring
 * think in the SAME voice the agent speaks in, instead of a cheaper off-family
 * model. BYOK → the user's selected chat model; no BYOK → the restricted
 * guide/default model. Real agent processes should still require user BYOK.
 */
export async function resolvePrimaryModel(
  supabase: any,
  userId: string,
): Promise<string> {
  if (!userId) return FREE_LUCA_MODEL;
  const userKey = await loadUserOpenRouterKey(supabase, userId);
  if (!userKey) return FREE_LUCA_MODEL;
  const { data } = await supabase
    .from("user_settings")
    .select("default_model")
    .eq("user_id", userId)
    .maybeSingle();
  const requested = typeof data?.default_model === "string" ? data.default_model.trim() : "";
  return requested || FREE_LUCA_MODEL;
}

// ── Family-aware role models for autonomous activity ─────────────────────────
// Every background/autonomous LLM call should run on a model in the AGENT'S OWN
// family, at the cheapest tier that fits the role: VOICE = the agent's full
// primary (inner-life must sound like the agent); REASONING = mid tier (belief
// synthesis/challenge, connection, curiosity, consolidation, dialectic);
// MECHANICAL = cheapest (extraction/classification). Only the three families
// whose exact slugs we control are cost-tiered; every other family (x-ai,
// moonshotai, deepseek, unknown) falls back to the agent's own primary —
// family-correct and incapable of emitting a non-existent slug.

export type AutonomousRole = "voice" | "reasoning" | "mechanical";

type TierRow = { reasoning: string; mechanical: string };
export const ROLE_MODEL_TIER_MAP: Record<string, TierRow> = {
  anthropic: { reasoning: "anthropic/claude-sonnet-4.6", mechanical: "anthropic/claude-haiku-4.5" },
  openai:    { reasoning: "openai/gpt-5-mini",           mechanical: "openai/gpt-5-mini" },
  google:    { reasoning: "google/gemini-2.5-pro",       mechanical: "google/gemini-2.5-flash" },
};

// inlined to keep this foundational module import-light (no cycle risk)
const NON_SUBSTRATE_FOR_MODEL = new Set(["observer", "guardian"]);
function normAgentLocal(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "luca";
}
function modelFamilyLocal(modelId: string): string {
  return String(modelId || "").split("/")[0]?.toLowerCase() || "";
}
function pickStr(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** The agent's own primary model (the family anchor). Agent-aware, unlike
 *  resolvePrimaryModel: substrate agents anchor on agent_configs.model. */
async function resolveAgentPrimaryModel(
  supabase: any,
  userId: string,
  agentId: string,
): Promise<string> {
  const norm = normAgentLocal(agentId);
  if (norm === "luca" || NON_SUBSTRATE_FOR_MODEL.has(norm.toLowerCase())) {
    return resolvePrimaryModel(supabase, userId);
  }
  // substrate agent: BYOK gate (mirrors resolvePrimaryModel), then its own model
  const key = await loadUserOpenRouterKey(supabase, userId);
  if (!key) return FREE_LUCA_MODEL;
  const { data } = await supabase
    .from("agent_configs")
    .select("model")
    .eq("user_id", userId)
    .eq("id", norm)
    .maybeSingle();
  return pickStr(data?.model) || await resolvePrimaryModel(supabase, userId);
}

/** The user's EXPLICIT per-role model override, if any (always wins over the
 *  family default). opts.overrideColumn lets a surface prefer its own column
 *  (journal_model, dreamer_model). */
async function resolveRoleOverride(
  supabase: any,
  userId: string,
  role: AutonomousRole,
  overrideColumn?: string,
): Promise<string> {
  if (!userId) return "";
  const { data } = await supabase
    .from("user_settings")
    .select("voice_model, belief_model, synthesis_model, memory_model, dreamer_model, journal_model")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "";
  if (overrideColumn) {
    const direct = pickStr((data as Record<string, unknown>)[overrideColumn]);
    if (direct) return direct;
  }
  if (role === "voice") return pickStr(data.voice_model);
  if (role === "reasoning") return pickStr(data.belief_model) || pickStr(data.synthesis_model);
  return pickStr(data.memory_model); // mechanical
}

/**
 * Resolve the model an autonomous surface should use for an (agent, role).
 * Precedence: explicit user override → VOICE returns the agent's primary →
 * family→tier map → safe fallback (the agent's own primary). Never empty.
 * Kill-switch: env ROLE_MODEL_FAMILY_ALIGN="off" disables tiering (everything
 * runs on the agent's full primary — family-correct, just not cost-optimized).
 */
export async function resolveRoleModel(
  supabase: any,
  userId: string,
  agentId: string,
  role: AutonomousRole,
  opts?: { overrideColumn?: string },
): Promise<string> {
  const primary = await resolveAgentPrimaryModel(supabase, userId, agentId);

  const override = await resolveRoleOverride(supabase, userId, role, opts?.overrideColumn);
  if (override) return override;

  if (role === "voice") return primary;

  const aligned = (Deno.env.get("ROLE_MODEL_FAMILY_ALIGN") ?? "on").trim().toLowerCase() !== "off";
  if (!aligned) return primary;

  const tier = ROLE_MODEL_TIER_MAP[modelFamilyLocal(primary)];
  return (tier && tier[role]) || primary;
}

export async function resolveOpenRouterKeyForUser(
  supabase: any,
  userId: string,
): Promise<{ apiKey: string | null; keySource: KeySource | null }> {
  const userKey = await loadUserOpenRouterKey(supabase, userId);
  if (userKey) return { apiKey: userKey, keySource: "user" };
  const platformKey = Deno.env.get("OPENROUTER_API_KEY")?.trim() || null;
  return { apiKey: platformKey, keySource: platformKey ? "platform" : null };
}

/** Real conversations always use the signed-in user's existing key vault. */
export async function resolveUserChatBackend(
  supabase: any,
  userOrId: string | { id?: string } | unknown,
  requestedModel: string = FREE_LUCA_MODEL,
): Promise<ChatBackend> {
  const userId = typeof userOrId === "string" ? userOrId : ((userOrId as { id?: string } | null)?.id || "");
  if (!userId) throw new AuthError();
  const userKey = await loadUserOpenRouterKey(supabase, userId, true);
  if (!userKey) throw new MissingApiKeyError();
  // Do not inspect platform configuration here. Only the explicit Guide path
  // below may select platform-funded intelligence.
  return backendForUserKey(userKey, requestedModel || FREE_LUCA_MODEL);
}

export async function resolveChatBackend(
  supabase: any,
  userOrId: string | { id?: string } | unknown,
  requestedModel: string = FREE_LUCA_MODEL,
): Promise<ChatBackend> {
  const userId = typeof userOrId === "string" ? userOrId : ((userOrId as { id?: string } | null)?.id || "");
  const userEmail = typeof userOrId === "string"
    ? ""
    : normalizeEmail((userOrId as { email?: string } | null)?.email);
  if (!userId) throw new Error("no_user");

  const userKey = await loadUserOpenRouterKey(supabase, userId);
  if (userKey) return backendForUserKey(userKey, requestedModel || FREE_LUCA_MODEL);

  const platformKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!platformKey) throw new Error("no_backend_available");

  const anonymous = typeof userOrId !== "string" && isAnonymousAuthUser(userOrId);
  const advanced = !anonymous && await hasAdvancedAccess(supabase, userId, userEmail);
  const billingTier: Exclude<BillingTier, "byok"> = anonymous
    ? "guest"
    : advanced
    ? "advanced"
    : "account_free";

  return backendForPlatformKey({
    apiKey: platformKey,
    requestedModel: requestedModel || FREE_LUCA_MODEL,
    billingTier,
    allowAdvancedSurfaces: advanced,
  });
}
