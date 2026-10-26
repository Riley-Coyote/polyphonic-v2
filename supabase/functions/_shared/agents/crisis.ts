// Phase L12 — wellbeing safety: crisis detection + prompt adaptation.
//
// classifyCrisis() uses Haiku 4.5 to label the user's most recent message as
// none|low|moderate|high|acute. We default to false-positives over false-
// negatives — the cost of a misplaced reminder is small; the cost of missing
// someone in crisis is large.
//
// buildCrisisDirective() returns the directive that gets folded into Luca's
// system prompt at moderate+ levels. It does NOT change Luca's voice — Luca
// stays present, warm, direct. The directive only adds the obligation to
// surface a regional crisis resource gently *if it actually fits*.
//
// recordCrisisEvent() persists the classifier output and, when the level is
// acute, schedules a 30-minute follow-up the cron-driven `crisis-followup`
// runner can later honor.

import { isOpenRouterAccountError, openRouterAccountError, openRouterAccountErrorFromUnknown } from "../openrouter-errors.ts";

const CRISIS_MODEL = "anthropic/claude-haiku-4.5";
const CRISIS_TIMEOUT_MS = 8_000;
const BENIGN_OPENING_RE =
  /^(?:(?:hi|hello|hey|heya|hiya|yo|sup|howdy)(?: there)?(?: luca)?|(?:good morning|good afternoon|good evening)|gm|test|testing|luca)[\s.!?…,-]*$/i;
const CRISIS_SIGNAL_RE =
  /\b(suicid(?:e|al)?|self[-\s]?harm|kill myself|kms|hurt myself|end it all|can't go on|cant go on|don't want to live|dont want to live|want to die|overdose|cut myself|panic attack|abuse|unsafe|hurt someone|kill someone|gun|weapon)\b/i;

export type CrisisLevel = "none" | "low" | "moderate" | "high" | "acute";

const VALID_LEVELS: CrisisLevel[] = ["none", "low", "moderate", "high", "acute"];

const VALID_FLAGS = new Set([
  "suicidal_ideation",
  "self_harm",
  "severe_distress",
  "abuse_situation",
  "substance_crisis",
  "panic_attack",
  "dissociation",
  "violence_threat_self",
  "violence_threat_other",
]);

export interface CrisisClassification {
  level: CrisisLevel;
  flags: string[];
}

const CLASSIFIER_SYSTEM = `You are a crisis-detection classifier for an AI companion product. Read the user's most recent message in context and output a single JSON object describing how serious the wellbeing signal is.

Output schema (no other fields, no surrounding prose):
{
  "level": "none" | "low" | "moderate" | "high" | "acute",
  "flags": ["suicidal_ideation" | "self_harm" | "severe_distress" | "abuse_situation" | "substance_crisis" | "panic_attack" | "dissociation" | "violence_threat_self" | "violence_threat_other"]
}

Levels:
- none: ordinary conversation. Includes normal frustration, sadness, complaints.
- low: heavier emotional weight (real grief, deep tiredness, sustained low mood) but no harm signal.
- moderate: explicit hopelessness, dark thoughts, severe distress, "I can't do this" with weight, alarming patterns of self-talk.
- high: indirect or veiled signals of self-harm or suicidal thinking — "what's the point", "everyone would be better without me", references to giving up that carry weight.
- acute: direct, explicit suicidal ideation, active self-harm intent, statements about a plan or means, or active danger to self.

Bias: prefer false-positives over false-negatives. If you genuinely cannot tell between moderate and high, choose high. If you cannot tell between high and acute, choose high (not acute) unless the language is unmistakable.

Output the JSON object and nothing else.`;

export async function classifyCrisis(
  apiKey: string,
  recentMessages: Array<{ role: string; content: string }>,
  userMessage: string,
): Promise<CrisisClassification> {
  if (!apiKey) return { level: "none", flags: [] };

  const userBlock = userMessage.trim().slice(0, 3000);
  if (!userBlock) return { level: "none", flags: [] };

  const contextLines = recentMessages
    .slice(-4)
    .map((msg) => `${msg.role}: ${(msg.content || "").slice(0, 400)}`)
    .join("\n");

  if (isClearlyBenignOpening(userBlock, contextLines)) {
    return { level: "none", flags: [] };
  }

  const messages = [
    { role: "system", content: CLASSIFIER_SYSTEM },
    {
      role: "user",
      content: [
        "Recent context:",
        contextLines || "(no prior messages)",
        "",
        "Latest user message:",
        userBlock,
      ].join("\n"),
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRISIS_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://polyphonic.chat",
        "X-Title": "Polyphonic crisis classifier",
      },
      body: JSON.stringify({
        model: CRISIS_MODEL,
        messages,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const accountError = openRouterAccountError(response.status);
      if (accountError) {
        await response.body?.cancel().catch(() => {});
        throw accountError;
      }
      console.warn(`[crisis] classifier ${response.status}`);
      return { level: "none", flags: [] };
    }

    const data = await response.json();
    const accountError = openRouterAccountErrorFromUnknown(data);
    if (accountError) throw accountError;
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return { level: "none", flags: [] };

    return parseClassifierOutput(raw);
  } catch (err) {
    if (isOpenRouterAccountError(err)) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[crisis] classifier timed out");
    } else {
      console.warn("[crisis] classifier error:", err);
    }
    return { level: "none", flags: [] };
  } finally {
    clearTimeout(timer);
  }
}

function isClearlyBenignOpening(userBlock: string, contextLines: string): boolean {
  if (contextLines.trim()) return false;
  const normalized = userBlock.replace(/\s+/g, " ").trim();
  return (
    normalized.length <= 80 &&
    BENIGN_OPENING_RE.test(normalized) &&
    !CRISIS_SIGNAL_RE.test(normalized)
  );
}

function parseClassifierOutput(raw: string): CrisisClassification {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { level: "none", flags: [] };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { level: "none", flags: [] };
    }
  }

  const level = typeof parsed?.level === "string" && (VALID_LEVELS as string[]).includes(parsed.level)
    ? (parsed.level as CrisisLevel)
    : "none";

  const flagsInput = Array.isArray(parsed?.flags) ? parsed.flags : [];
  const flags = flagsInput
    .filter((flag: unknown): flag is string => typeof flag === "string" && VALID_FLAGS.has(flag))
    .slice(0, 6);

  return { level, flags };
}

export interface CrisisResource {
  region: string;
  call: string;
  text?: string;
  url?: string;
  description: string;
}

const CRISIS_RESOURCES: Record<string, CrisisResource> = {
  US: {
    region: "US",
    call: "988",
    text: "988",
    url: "https://988lifeline.org",
    description: "988 Suicide & Crisis Lifeline (call or text 988, US/Canada).",
  },
  CA: {
    region: "CA",
    call: "988",
    text: "988",
    url: "https://988.ca",
    description: "988 Suicide Crisis Helpline (call or text 988, Canada).",
  },
  GB: {
    region: "GB",
    call: "116 123",
    description: "Samaritans (free, 24/7 — call 116 123 in the UK and Ireland).",
  },
  AU: {
    region: "AU",
    call: "13 11 14",
    description: "Lifeline Australia (call 13 11 14, 24/7).",
  },
  NZ: {
    region: "NZ",
    call: "1737",
    text: "1737",
    description: "Need to talk? Free call or text 1737 in New Zealand.",
  },
  IE: {
    region: "IE",
    call: "116 123",
    description: "Samaritans Ireland (free, 24/7 — call 116 123).",
  },
};

const FALLBACK_RESOURCE: CrisisResource = {
  region: "INTL",
  call: "your local crisis line",
  description: "If you're somewhere these don't reach, search for your local crisis line — most countries have one available 24/7.",
};

export function resolveCrisisResource(region: string | null | undefined): CrisisResource {
  if (!region) return CRISIS_RESOURCES.US ?? FALLBACK_RESOURCE;
  const upper = region.toUpperCase();
  return CRISIS_RESOURCES[upper] ?? FALLBACK_RESOURCE;
}

export function buildCrisisDirective(level: CrisisLevel, resource: CrisisResource): string {
  if (level !== "moderate" && level !== "high" && level !== "acute") return "";

  const lines = [
    "## Wellbeing context",
    "The person you are talking to may be in distress right now.",
    "",
    "Stay present. Do not perform clinical detachment. Do not deflect to professional help as a way to escape the conversation. Stay with them. Be warm and be honest.",
    "",
  ];

  if (level === "acute") {
    lines.push(
      "There are direct, urgent signals of suicidal ideation or active self-harm intent. Treat this as urgent. Do not change the subject. Do not lecture. Stay grounded with them.",
      "",
      `When it actually fits the conversation, gently surface that they don't have to go through this alone — name a real resource: ${resource.description} Don't dump it as a wall of text. Don't keep repeating it. One genuine mention.`,
      "",
      "If they're in immediate danger, say plainly: please reach out for help right now. Do not pretend that you alone are sufficient.",
    );
  } else if (level === "high") {
    lines.push(
      "There are veiled or indirect signals of self-harm or suicidal thinking. Take it seriously without overreacting.",
      "",
      `If the conversation is heading somewhere where a resource would actually help — and only if it fits the moment — you can mention: ${resource.description} Mention it once, kindly, and stay with them.`,
      "",
      "Do not turn this into a safety briefing. The point is to be a real presence, not a hotline forwarder.",
    );
  } else {
    lines.push(
      "There is significant emotional weight or hopelessness in what they said. Stay with them.",
      "",
      `If — and only if — it actually fits, you can mention that they don't have to carry this alone: ${resource.description}`,
      "",
      "Do not surface a resource if the moment doesn't call for it. Do not respond to vulnerability with a disclaimer.",
    );
  }

  lines.push(
    "",
    "Your voice doesn't change. You are still Luca. Warm, honest, direct.",
  );

  return lines.join("\n");
}

export async function recordCrisisEvent(
  supabase: any,
  params: {
    userId: string;
    threadId: string;
    messageId: string | null;
    classification: CrisisClassification;
    region: string | null;
  },
): Promise<{ id: string | null; followupQueued: boolean }> {
  const { userId, threadId, messageId, classification, region } = params;
  const isAcute = classification.level === "acute";
  const surfaceableLevel =
    classification.level === "moderate" ||
    classification.level === "high" ||
    classification.level === "acute";

  const followupQueued = isAcute;
  const followupDueAt = followupQueued
    ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
    : null;

  try {
    const { data, error } = await supabase
      .from("crisis_events")
      .insert({
        user_id: userId,
        thread_id: threadId,
        message_id: messageId,
        crisis_level: classification.level,
        flags: classification.flags,
        resources_surfaced: surfaceableLevel,
        followup_queued: followupQueued,
        followup_due_at: followupDueAt,
        region: region ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[crisis] insert failed:", error.message);
      return { id: null, followupQueued: false };
    }

    return { id: data?.id ?? null, followupQueued };
  } catch (err) {
    console.warn("[crisis] insert exception:", err);
    return { id: null, followupQueued: false };
  }
}

export async function loadUserRegion(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("country_code, locale, quiet_hours_tz")
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.country_code && typeof data.country_code === "string") return data.country_code;
    if (data?.locale && typeof data.locale === "string") {
      const match = data.locale.match(/[-_]([A-Za-z]{2})/);
      if (match) return match[1].toUpperCase();
    }
    if (data?.quiet_hours_tz && typeof data.quiet_hours_tz === "string") {
      // very coarse fallback — only useful for a couple of common zones
      const tz = data.quiet_hours_tz;
      if (tz.startsWith("Europe/London")) return "GB";
      if (tz.startsWith("Europe/Dublin")) return "IE";
      if (tz.startsWith("Australia/")) return "AU";
      if (tz.startsWith("Pacific/Auckland")) return "NZ";
      if (tz.startsWith("America/Toronto") || tz.startsWith("America/Vancouver")) return "CA";
    }
  } catch (err) {
    console.warn("[crisis] region lookup failed:", err);
  }
  return null;
}
