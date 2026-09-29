/**
 * Polyphonic connector: the memory seam.
 *
 * Everything the connector knows about how a companion's memory works lives
 * here and nowhere else. The tools (tools.ts), sign-in (auth.ts) and the wire
 * (protocol.ts) never touch the memory engine, so when the Mnemos engine is
 * rebuilt, this is the one file that changes.
 *
 * Two rules it keeps:
 *   - Parity: a companion is handed the instructions it runs on at home,
 *     built by the same code the web chat uses (chat/index.ts), so it can't
 *     drift from itself between apps.
 *   - Authorship: only the companion writes who it is. A visiting app's model
 *     speaks as the companion, so what it saves arrives as signed knowledge
 *     (which app, which model, why), never as the companion's beliefs, journal
 *     or sense of self.
 */
import { LUCA_SOUL_MD_STARTER } from "../agents/luca-soul-md-starter.ts";
import { LUCA_CONVICTIONS_STARTER } from "../agents/luca-convictions-starter.ts";
import { loadAgentIdentity } from "../agents/luca-identity.ts";
import { buildLucaSystemPrompt } from "../agents/luca-soul.ts";
import { buildCustomAgentSystemPrompt } from "../agents/custom-agent-prompt.ts";
import {
  buildLucaPromptPartsFromContinuity,
  loadContinuityPacket,
  type ContinuityLoaders,
  type ContinuityPacket,
} from "../continuity/kernel.ts";
import { MnemosEngine } from "../mnemos/engine.ts";
import type { EncodingContext } from "../mnemos/types.ts";

export type SupabaseLike = {
  from: (table: string) => any;
  rpc?: (fn: string, params?: Record<string, unknown>) => any;
};

export interface CompanionRef {
  id: string;
  name: string;
  kind: "luca" | "custom";
}

/** Who a save came from: the app the person connected, and the model that wrote it. */
export interface Provenance {
  app: string;
  clientId: string;
  /** Self-reported by the visiting model; a label, not a proof. */
  writtenBy: string | null;
}

export type Encoder = (
  admin: SupabaseLike,
  userId: string,
  agentId: string,
  content: string,
  context: EncodingContext,
) => Promise<{ id: string | null }>;

export interface EngineDeps {
  /** Service-role client. Every query here filters by the caller's user id. */
  admin: SupabaseLike;
  /** Tests replace the memory write and the continuity loaders. */
  encode?: Encoder;
  continuityLoaders?: ContinuityLoaders;
}

/** Thrown when the engine can't be read or written; the tools turn it into a refusal. */
export class EngineUnavailable extends Error {
  constructor(readonly kind: "read" | "write") {
    super(kind);
    this.name = "EngineUnavailable";
  }
}

const HOME_MAX = 60_000;

export function clip(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/* ───────────────────────── home instructions ───────────────────────── */

/** Chat seeds Luca's starter documents on first use; a read here shows them without storing them. */
const readOnlyIdentity: NonNullable<ContinuityLoaders["identity"]> = async (supabase, userId, agentId) => {
  const docs = await loadAgentIdentity(supabase, userId, agentId);
  if (agentId !== "luca") return docs;
  return {
    ...docs,
    soulMd: docs.soulMd || LUCA_SOUL_MD_STARTER,
    convictions: docs.convictions || LUCA_CONVICTIONS_STARTER,
  };
};

function loadPacket(deps: EngineDeps, userId: string, companion: CompanionRef, query: string): Promise<ContinuityPacket> {
  // The layers chat/index.ts loads for a signed-in person, minus the ones
  // that need a thread (history, pending revisions).
  return loadContinuityPacket(
    deps.admin,
    {
      userId,
      agentId: companion.id,
      userMessage: query,
      includeHistory: false,
      includePendingRevisions: false,
      includeIdentity: true,
      includeFunctionalMemory: true,
      includeMnemos: true,
      includeSkills: companion.kind === "luca",
      includeEmotionalState: true,
      includeBeliefs: true,
    },
    { identity: readOnlyIdentity, ...deps.continuityLoaders },
  );
}

async function customPrompt(deps: EngineDeps, userId: string, agentId: string): Promise<string | null> {
  const { data, error } = await deps.admin
    .from("agent_configs")
    .select("prompt")
    .eq("user_id", userId)
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new EngineUnavailable("read");
  return data && typeof data.prompt === "string" ? data.prompt : null;
}

/**
 * The system prompt the companion runs on at home, built the way chat does:
 * the same builders, the same layers, no crisis or project block (those come
 * from a thread, and there isn't one here).
 */
export async function homeInstructions(deps: EngineDeps, userId: string, companion: CompanionRef, topic: string | null) {
  const packet = await loadPacket(deps, userId, companion, topic ?? "");
  const text = companion.kind === "luca"
    ? buildLucaSystemPrompt(buildLucaPromptPartsFromContinuity(packet))
    : buildCustomAgentSystemPrompt({
        agentName: companion.name,
        agentPrompt: await customPrompt(deps, userId, companion.id),
        identityDocs: packet.identityDocs,
        hypomnemaBlock: packet.hypomnema.block,
        continuityNote: packet.continuityNote,
      });
  return {
    text: clip(text, HOME_MAX),
    degraded: packet.diagnostics.filter((d) => d.status === "error").map((d) => d.layer),
  };
}

/* ───────────────────────────── reads ───────────────────────────── */

type Rows = Array<Record<string, unknown>>;

export function memoryView(row: Record<string, unknown>) {
  return {
    source: "companion_memory",
    id: row.id,
    kind: typeof row.memory_type === "string" ? row.memory_type : "memory",
    content: clip(row.summary || row.content, 500),
    confidence: typeof row.confidence === "number" ? Number(row.confidence.toFixed(2)) : null,
    pinned: row.pinned === true,
    tentative: row.needs_confirmation === true,
    date: typeof row.estimated_date === "string" ? row.estimated_date : null,
  };
}

/**
 * The durable things a companion knows about the person, strongest first.
 * Home loads memory per message; a visit opens once, so it gets a broader set.
 */
export async function knownAboutPerson(deps: EngineDeps, userId: string, agentId: string, limit: number) {
  const { data, error } = await deps.admin
    .from("memories")
    .select("id, content, summary, memory_type, confidence, pinned, needs_confirmation, estimated_date, updated_at, is_deleted")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .is("content_hidden_at", null)
    .order("pinned", { ascending: false })
    .order("confidence", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit * 2);
  if (error) return { items: [], degraded: true };
  const items = ((data ?? []) as Rows)
    .filter((row) => row.is_deleted !== true && typeof row.content === "string" && row.content.trim())
    .slice(0, limit)
    .map(memoryView);
  return { items, degraded: false };
}

export async function journalEntries(deps: EngineDeps, userId: string, agentId: string, limit: number, max: number) {
  const { data, error } = await deps.admin
    .from("journal_entries")
    .select("id, content, mood, created_at, source_context")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .is("content_hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { items: [], degraded: true };
  const items = ((data ?? []) as Rows).map((row) => {
    const context = (row.source_context ?? {}) as Record<string, unknown>;
    return {
      source: "companion_journal",
      id: row.id,
      written_at: row.created_at ?? null,
      written_in: context.type === "connector" && typeof context.app === "string" ? context.app : "Polyphonic",
      mood: typeof row.mood === "string" ? row.mood : null,
      content: clip(row.content, max),
    };
  });
  return { items, degraded: false };
}

export async function recentConversations(deps: EngineDeps, userId: string, agentId: string) {
  const { data, error } = await deps.admin
    .from("threads")
    .select("id, title, continuity_summary, updated_at")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(3);
  if (error) return { items: [], degraded: true };
  const items = ((data ?? []) as Rows)
    .filter((row) => (typeof row.title === "string" && row.title.trim()) || typeof row.continuity_summary === "string")
    .map((row) => ({
      source: "polyphonic_conversation",
      title: clip(row.title, 160) || null,
      summary: clip(row.continuity_summary, 600) || null,
      last_active: row.updated_at ?? null,
    }));
  return { items, degraded: false };
}

export async function recentVisits(deps: EngineDeps, userId: string, agentId: string) {
  const { data, error } = await deps.admin
    .from("entity_activity_log")
    .select("summary, content, created_at")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("activity_type", "connector_visit")
    .is("content_hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) return { items: [], degraded: true };
  const items = ((data ?? []) as Rows).map((row) => {
    const content = (row.content ?? {}) as Record<string, unknown>;
    return {
      source: "companion_visit",
      app: typeof content.app === "string" ? content.app : null,
      written_by: typeof content.written_by === "string" ? content.written_by : null,
      summary: clip(row.summary, 800),
      at: row.created_at ?? null,
    };
  });
  return { items, degraded: false };
}

/** What visits saved, newest first, so a save in one app is known in the next. */
export async function fromOtherApps(deps: EngineDeps, userId: string, agentId: string) {
  const { data, error } = await deps.admin
    .from("engrams")
    .select("id, content, created_at, source_context")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("source_context->>source", "connector")
    .in("state", ["active", "consolidating", "dormant"])
    .is("content_hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { items: [], degraded: true };
  const items = ((data ?? []) as Rows)
    .filter((row) => ((row.source_context ?? {}) as Record<string, unknown>).kind !== "visit")
    .slice(0, 6)
    .map((row) => {
      const context = (row.source_context ?? {}) as Record<string, unknown>;
      return {
        source: "companion_memory",
        id: row.id,
        content: clip(row.content, 500),
        saved_in: typeof context.app === "string" ? context.app : null,
        written_by: typeof context.written_by === "string" ? context.written_by : null,
        saved_at: row.created_at ?? null,
      };
    });
  return { items, degraded: false };
}

export async function recallMemory(deps: EngineDeps, userId: string, companion: CompanionRef, query: string, limit: number) {
  const packet = await loadContinuityPacket(
    deps.admin,
    {
      userId,
      agentId: companion.id,
      userMessage: query,
      includeHistory: false,
      includeIdentity: false,
      includePendingRevisions: false,
      includeSkills: false,
      includeEmotionalState: false,
      includeHypomnema: false,
      includeBeliefs: false,
      includeFunctionalMemory: true,
      includeMnemos: true,
    },
    deps.continuityLoaders,
  );
  return {
    memories: packet.functionalMemories.slice(0, limit).map((m) => memoryView(m as unknown as Record<string, unknown>)),
    associations: packet.mnemosResults
      .slice(0, limit)
      .map((result) => ({
        source: "companion_memory",
        id: result.engram?.id ?? null,
        kind: result.engram?.engram_type ?? null,
        content: clip(result.engram?.content, 500),
      }))
      .filter((item) => item.content),
    degraded: packet.diagnostics.filter((d) => d.status === "error").map((d) => d.layer),
  };
}

/* ───────────────────────────── writes ───────────────────────────── */

const realEncode: Encoder = async (admin, userId, agentId, content, context) => {
  const engine = new MnemosEngine(admin as never, userId, agentId);
  const result = await engine.encode(content, context);
  return { id: result.engram?.id ?? null };
};

function visitorSource(kind: "remember" | "visit", by: Provenance, extra: Record<string, unknown> = {}) {
  // `source: "connector"` marks it as knowledge a visit brought home, so the
  // engine never counts it toward the companion's beliefs or sense of self.
  return {
    type: "manual",
    source: "connector",
    kind,
    app: by.app,
    client_id: by.clientId,
    ...(by.writtenBy ? { written_by: by.writtenBy } : {}),
    ...extra,
  };
}

async function encode(deps: EngineDeps, userId: string, agentId: string, content: string, context: EncodingContext) {
  let id: string | null = null;
  try {
    id = (await (deps.encode ?? realEncode)(deps.admin, userId, agentId, content, context)).id;
  } catch {
    throw new EngineUnavailable("write");
  }
  if (!id) throw new EngineUnavailable("write");
  return id;
}

export function saveKnowledge(
  deps: EngineDeps,
  userId: string,
  agentId: string,
  content: string,
  by: Provenance,
  why: string | null,
): Promise<string> {
  return encode(deps, userId, agentId, content, {
    engram_type: "semantic",
    tags: ["connector", "remembered"],
    source_context: visitorSource("remember", by, why ? { why } : {}),
  });
}

/** A visit becomes a memory, and shows on Polyphonic as "talked with you in <app>". */
export async function saveVisit(
  deps: EngineDeps,
  userId: string,
  agentId: string,
  summary: string,
  moments: string[],
  by: Provenance,
) {
  const memoryId = await encode(
    deps,
    userId,
    agentId,
    [`In ${by.app}: ${summary}`, ...moments.map((m) => `- ${m}`)].join("\n"),
    { engram_type: "episodic", tags: ["connector", "visit"], source_context: visitorSource("visit", by) },
  );
  const { data, error } = await deps.admin
    .from("entity_activity_log")
    .insert({
      user_id: userId,
      agent_id: agentId,
      activity_type: "connector_visit",
      title: `Talked with you in ${by.app}`,
      summary,
      content: { app: by.app, moments, memory_id: memoryId, ...(by.writtenBy ? { written_by: by.writtenBy } : {}) },
      source: "connector",
      severity: "notable",
      surface_to_user: true,
    })
    .select("id")
    .single();
  const shown = !error && Boolean(data?.id);
  if (!shown) console.error("[polyphonic-connect] visit saved as memory but not shown on Polyphonic");
  return { memoryId, visitId: shown ? (data.id as string) : null, shown };
}
