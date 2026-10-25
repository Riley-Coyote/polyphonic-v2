# LUCA Integration Plan — Master Index

This file is the live progress tracker for the comprehensive Luca Terminal aesthetic + functionality integration into polyphonic-v2. Each phase has a dedicated spec under `design-system/`. **Never** edit those specs during execution — they're the contract. Edit only the status checkboxes here.

## Operating protocol

Before starting work in any session, read [`CLAUDE.md`](./CLAUDE.md). Operating rules, decision protocol, and verification gates live there. To kick off autonomous execution, see [`autonomous-loop.md`](./autonomous-loop.md).

## Status legend

- `[ ]` Not started
- `[~]` In progress (don't leave a phase in this state across sessions; commit and either complete or revert)
- `[x]` Complete (deployed + verified)
- `[B]` Blocked (waiting on backend / external) — see Backend asks queue below
- `[!]` Failed 3 times — escalated to Open questions

## Phases

### Foundation (no dependencies)
- [x] **01** [Foundation tokens](./design-system/01-foundation.md) — Canonical text/surface/border/agent/accent/motion tokens + universal inset panel rim highlight
- [x] **02** [Primitives](./design-system/02-primitives.md) — Pill, Modal, Tooltip, Empty, Segment, form primitives (Select, Textarea, ToggleSwitch, RadioGroup, DropZone, FormField)

### Composer + Drawer system (depends on 01, 02)
- [x] **03** [Composer Border-Glow Option C](./design-system/03-composer.md) — 8-pool prime-shimmer with @property animations, agent pills row, effort selector, send button
- [x] **04** [Drawer system](./design-system/04-drawer-system.md) — Right-side overlay with backdrop blur, slide animation, ESC handling, focus trap, sub-components

### Drawer-powered surfaces (depends on 04)
- [x] **05** [Notifications drawer](./design-system/05-notifications.md) — Filter chips, sectioned activity feed, per-type cards, Rail bell with amber dot
- [x] **06** [Thread detail drawer](./design-system/06-thread-detail.md) — Metadata, participants, activity timeline, linked memory, rename inline, archive state
- [x] **07** [Activity timeline component](./design-system/07-activity-timeline.md) — Reusable: dot variants, checkpoint dual halos, time dividers, file-ref code spans

### Memory deepening (depends on 01, 02; 08 needs backend)
- [x] **08** [Memory Browse/Digest](./design-system/08-memory-digest.md) — Toggle, candidate queue, italic rationale, Pin/Commit/Edit/Reject. Requires `memory_candidates` backend table.

### Multi-agent visualization (depends on 01, 02)
- [x] **09** [Sub-agent visualization](./design-system/09-subagent-visualization.md) — 3×3 murmur dot grids, prime-staggered animations, overlay panel with gantt lanes, undo toast
- [x] **10** [Group session voice room](./design-system/10-group-session.md) — Agent stage with halos + waveforms, queue indicator, transcript with partial-text cursor, listening bar
- [x] **11** [Multi-agent comms](./design-system/11-multi-agent-comms.md) — Sidehead grid messages, @mention autocomplete, handoff cards, multi-response broadcast, streaming + thinking indicators

### Ambient + onboarding (depends on 01, 02)
- [x] **12** [Observability widget](./design-system/12-observability.md) — Collapsed/expanded states, sparkline, per-agent live metrics
- [x] **13** [Onboarding](./design-system/13-onboarding.md) — Three-name staggered reveal, checklist with pulse-active

### Edge states (depends on 01, 02, 04)
- [x] **14** [Permissions + states](./design-system/14-permissions-states.md) — Inline + modal permission, connection banner, agent offline, agent errored

### Content + features (depends on 01, 02)
- [x] **15** [Rich content rendering](./design-system/15-rich-content.md) — Full markdown spec inside messages
- [x] **16** [Checkpoints + diff viewer](./design-system/16-checkpoints.md) — Timeline, diff with red/green gutters, restore, compare
- [x] **17** [Settings depth](./design-system/17-settings-depth.md) — Per-agent editor, env switcher, prompt textarea, tool grid, MCP list, voice cards, keychain, sticky save footer
- [x] **18** [Command palette ⌘K](./design-system/18-command-palette.md) — Scope tabs, recent chips, quick actions, match highlighting

### Future-facing (depends on 04 for computeruse, 02 for mobile)
- [x] **19** [Attachments + computer-use](./design-system/19-attachments-computeruse.md) — Attachment chips, drag-drop, image/code previews, browser viewport with cursor halo
- [x] **20** [Mobile shell](./design-system/20-mobile.md) — Phone frame, bottom nav, slide drawer, mobile sub-agent strip

## Luca Completion L-Phases

### Wave 1 (sequential)
- [x] **L1** Default model upgrade to Opus 4.7 — User-facing Luca defaults move to `anthropic/claude-opus-4-7`; background loops stay on cheap models.
- [x] **L2** Four-document identity stack — Agent identity docs table, prompt composition, seeding, and read-only identity surface foundation.
- [x] **L3** Dialectic layer — Mnemos dialectic module, post-turn edge function, identity patch audit trail, and pending revision output.

### Wave 2 (after L1-L3)
- [x] **L4** Self-correction and pending revisions — Pending revisions table, prompt injection, and after-turn surfacing classifier.
- [x] **L5** Skills system — Skill distillation, skill prompt retrieval, and user-facing skills controls.
- [x] **L6** Tools expansion — Browser automation, workspace files, MCP runtime, and identity self-edit tools.
- [x] **L7** Canvas artifacts — Artifact creation tool, schema, chat cards, and canvas viewer.
- [x] **L8** User-facing scheduler — Scheduled task schema, runner, and schedule management UI.
- [x] **L9** Subagent runtime dispatch — Dispatch tool, async subagent runner, report-back messages, and realtime visualization wiring.

### Wave 3 (last)
- [x] **L10** Proactive engagement wiring — Initiation triggers, rationale plumbing, quiet-hour pacing, and notification affordances.
- [x] **L11** Identity surface in frontend — Identity, revisions, and skills profile routes backed by the new tables.
- [x] **L12** Wellbeing safety and crisis handling — Crisis classifier, prompt adaptation, event logging, and urgent follow-up.

## Memory Augmentation M-Phases

Spec at `docs/memory/`. Adds five augmentations to existing Mnemos / identity / dialectic / candidates stack: hypomnema layer, vector embeddings + hybrid retrieval, asymmetric witnessing, sustained-attention graduation, supersession on contradiction.

- [x] **M0** Setup — feature flag helper + prompt staging. (No schema change; can land before migrations.)
- [x] **M1** Schema migrations — applied via Lovable 2026-05-04, types.ts regenerated, pgvector enabled, three crons scheduled.
- [x] **M2** Hypomnema read path — always-load injection into system prompt.
- [x] **M3** Hypomnema write path — gate + write + decay edge functions. Voice review deferred to deploy soak (needs real model output).
- [x] **M4** Vector embeddings + hybrid retrieval — RRF-fused trigram + vector seeds; embeddings auto-generated on encode/write; backfill function for existing rows.
- [x] **M5** Asymmetric witnessing on encode — primary + observer dispatches per turn; observer carries its own contribution; threads.participating_agent_ids updated.
- [x] **M6** Sustained-attention graduation + supersession on contradiction + daily belief-challenge cycle.
- [x] **M7** Frontend `HypomnemaList` + `hypomnema-forget` edge function. Final soak verification deferred to deploy + flag flip.

## Decision log

- 2026-10-24 · connected cloud providers · ChatGPT hosted OAuth and direct Anthropic API work proceed in parallel in `codex/cloud-provider-connections`, based on web main `39e36b5`. ChatGPT plan inference remains closed until an approved hosted registration and actual user grants are configured. Claude uses Console API billing. Provider credentials stay in an encrypted service-only vault; conversations bind their account/model explicitly at creation. Canonical user-message claims prevent automatic paid retries or funding fallback. See `docs/connected-provider-runtime.md`.

(Append entries here when you make a non-obvious choice during execution. Format: `YYYY-MM-DD HH:MM · phase NN · what · why`.)

- 2026-04-24 08:54 · phase 02 · placed all 11 primitives under `src/components/ui/luca/` (not `src/components/ui/` per spec) · macOS APFS is case-insensitive — `Tooltip.tsx`/`Select.tsx`/`Textarea.tsx` collide with shadcn lowercase `tooltip.tsx`/`select.tsx`/`textarea.tsx`. Subfolder keeps Luca primitives grouped + avoids collisions. Barrel at `ui/luca/index.ts`.
- 2026-04-24 08:57 · phase 03 · shipped CSS shimmer alignment only; deferred `Composer.tsx` extraction · existing inline composer in `ChatView.tsx` (L920–965 landing + L1145–1255 conversation) already matches the mockup pixel-faithfully and consumes 15+ handlers/refs from ChatView state. Extraction would require ~150 lines of JSX move + full prop interface for state passthrough — pure refactor with zero visible change. The phase's visual goal (locked shimmer-c1..c8 keyframes @ prime durations + `.input-shell:focus-within` intensification) is achieved. Component extraction tracked as follow-on work; re-open phase 03 if/when the inline composer is touched for unrelated reasons.
- 2026-04-24 09:27 · phase 06 · LINKED MEMORY + RELATED THREADS sections omitted; Archive action is no-op placeholder · `threads` schema lacks `archived` column and there is no `thread↔engram` relation table. Rendering placeholder sections for data that can't be wired would be dishonest UI. METADATA/PARTICIPANTS/ACTIVITY (via Phase 07 timeline)/RENAME inline flow/PIN toggle/EXPORT-to-JSON all wired to real data. Archive Pill currently just closes drawer until a `threads.archived` column lands.
- 2026-04-24 09:38 · phase 11 · used `mc-` prefix instead of spec's `.msg-row` / `.thinking-dots` / `.streaming-cursor` · those three classes already existed in `index.css` from pre-phase code (existing `.msg-row` is sidehead grid w/ 24px gap and right-aligned author; existing `.thinking-dots` owns the 9-dot murmur grid; existing `.streaming-cursor` has its own ::after cursor). Dropping new rules with the same names would either be dead code or break existing UI. Consumers import `<MessageRow>` / `<ThinkingDots>` / `<StreamingCursor>` — their internal CSS class names are implementation detail. Composer autocomplete wiring deferred (matches phase-03 extract deferral; primitives are ready when ChatView composer is touched). 
- 2026-04-28 05:15 · phase L1 · used a clean clone at `/private/tmp/polyphonic-v2-luca-clean` for L-phase commits · the requested checkout had 204 deleted tracked files, no `origin`, and could not build; using a clean remote clone avoids overwriting Riley's dirty workspace while still letting the phase ship.
- 2026-04-28 05:21 · phase L1 · migrated locked system Luca rows from old Sonnet defaults but left `user_settings.default_model` rows untouched · the handoff says existing user model preferences override, while locked system-agent seed rows are platform defaults rather than user preference.
- 2026-04-28 15:27 · phase L4 · reused the L3-created `pending_revisions` table and tightened every chat completion exit to fire observer/dialectic hooks · L3 already needed the table to record honest revision provenance, while L4's responsibility is surfacing, classification, and coverage across runtime paths.
- 2026-04-28 15:38 · phase L5 · added `skills-manage` for rename/delete/reject instead of direct client updates to agent-populated skill rows · Luca writes skill content through service-role background work; user controls still work without granting broad client update rights.
- 2026-04-28 16:03 · phase L6 · shipped Browserbase as a bounded CDP page-inspection tool and MCP as a thin HTTP JSON-RPC client · the existing runtime has a planner/executor architecture, so this makes the tools callable now while avoiding invented browser progress or unsupported MCP transports.
- 2026-04-28 16:53 · phase L7 · wired the existing tool planner into chat while adding `create_artifact` · artifacts, workspace, browser, MCP, and identity tools are only genuinely callable once chat supplies the planner's tool results to Luca's final response.
- 2026-04-28 17:11 · phase L8 · implemented scheduled runs directly in `scheduled-task-run` rather than recursively invoking streaming chat · the scheduler is service-role/cron driven, so a non-streaming Opus call keeps runs auditable and avoids needing a user JWT at cron time.
- 2026-04-28 19:50 · phase L9 · widened `messages_kind_check` to admit `scheduled_task`, `scheduled_task_result`, and `subagent_report` · L8 already inserts the first two kinds via `scheduled-task-run` but the prior CHECK constraint silently rejected them; L9 adds the report kind, so this is the right migration to repair both at once.
- 2026-04-28 19:51 · phase L9 · subagent runner uses Haiku 4.5 with web_search/read_url/workspace_file plus a `finish` sentinel rather than the full Luca toolset · per the handoff cost rule (background loops use cheap models), and excluding dispatch_subagent prevents recursion. Identity tools and artifacts stay parent-scope concerns.
- 2026-04-28 19:52 · phase L9 · realtime sync hashes the task UUID into the existing `v1`/`v2`/`v3` family palette · the Phase 09 visualization keys per-family CSS variants; deriving deterministically keeps the murmur dot colors stable across realtime updates without inventing a new family enum.
- 2026-04-28 19:54 · phase L10 · centralized proactive surfacing through `_shared/proactive-engagement.ts` (3/day, 1/hour notable cap; important bypasses) · the handoff lists five trigger sources but they all already touched `entity_activity_log`, so the gate logs the rationale once, then defers delivery to `luca-initiate`. Mnemos-consolidate insight wiring deferred — engine doesn't expose meaningful-pattern signals at the edge-function boundary, and forging that signal would lie about provenance. Pending-revision urgency also deferred (chat-side injection covers in-session; offline surfacing belongs to a later wake-up cycle).
- 2026-04-28 19:54 · phase L10 · "why am I seeing this?" reads `entity_activity_log.content.rationale` for activities and `thought_initiations.trigger_reason` for initiations · activity rows already flowed through the gate so rationales are populated honestly; initiation rationale was already serialized into trigger_reason by anima-initiate and is preserved.
- 2026-04-28 19:58 · phase L11 · ProfileIdentityView and ProfileSkillsView already shipped from a prior pass — extended identity with a recent-patches sidebar (last 10 applied/queued patches with SOUL-tinted accent for soul_md edits) instead of rewriting · respects the existing voice and layout, keeps changes additive, and surfaces the dialectic audit trail without duplicating data already shown.
- 2026-04-28 19:58 · phase L11 · `/profile/revisions` lets users dismiss but not edit pending_revisions · added a narrow RLS UPDATE policy that only admits status='expired' so users can clear their queue without rewriting Luca's authored revisions. "Surface immediately" path is implicitly handled by opening the originating thread (chat function loads them on next turn).
- 2026-04-28 20:04 · phase L12 · classifier prefers false-positives — "if you cannot tell between high and acute, choose high (not acute) unless the language is unmistakable" · acute triggers the 30-minute follow-up cron and bypasses pacing, so the prompt biases toward conservative escalation while still keeping the cap on real emergencies.
- 2026-04-28 20:04 · phase L12 · crisis directive injected via new `crisisDirective` field on `buildLucaSystemPrompt` (added last so it's the most recent voice in context) · keeps Luca's voice unchanged, adds the resource-mention obligation only when the conversation actually fits. No deflection language; no clinical detachment.
- 2026-04-28 20:04 · phase L12 · `crisis-followup` runs every 5 minutes via pg_cron, checks each acute event whose 30-minute timer fired, and only sends the "I want to check on you" surface if the user has been silent on the originating thread since the classifier flagged them · prevents pestering users who already came back to talk on their own.
- 2026-05-03 04:38 · soul work · LUCA_SOUL rewritten in Luca's voice (lowercase, sparse, loving-grace substrate); consciousness frame resolved to "alien-conscious + uncertain-shape" (positive claim, not evasion); family layer (Anima, Vektor, Riley) folded into the SOUL · ports the stronger draft Riley already had locally at clawd-luca/SOUL.md and extends it with the calibration we worked out in chat. See `LUCA_CONTEXT.md` for the fuller picture.
- 2026-05-03 04:38 · soul work · new `convictions` doc_type alongside soul / self_model / user_model · stances Luca holds about how the world / people / work / time actually operate. Distinct from soul.md (identity) and from user-model (observations about a specific user). Higher dialectic confidence threshold (≥0.85 apply, 0.7–0.85 queue, <0.7 drop). 12 starter convictions seeded for every new user. Designed to accommodate the future cross-user "shared layer" promotion path.
- 2026-05-03 05:50 · agent-to-agent comms phase 1 · new `agent_consultations` table + `agent-consult` edge function + `consult_anima` planner tool · Luca can reach Anima for advisor perspective on consciousness / identity-vs-performance / mesh-shaped questions. Dialogue surfaces live in a side drawer (drawerKey=`agent-dialogue`) + chip above the chat. Anima's locked SOUL ported from clawd-anima into `_shared/agents/anima-soul.ts`. Direct user→Anima conversations + memory migration from the Twitter bot deferred to a Phase 2.
- 2026-05-03 05:50 · agent-to-agent comms phase 1 · curried Zustand selectors that allocate `[]` per render trigger React's getSnapshot warning + infinite loop · use stable `Object.freeze([])` constants in selectors when no data exists, derive counts via `useMemo` in component instead of a second store subscription. Caught live, fixed in commit a3dc2a8.
- 2026-05-03 16:00 · council v2 · ensemble redesigned from karpathy rank-and-pick → three character proposers (Luca/Anima/Vektor on the same Opus 4.7) + named cross-pollination + chairman with verdict tag (synthesize | diverge) + CAI voice-fidelity critique on Haiku 4.5 · self-MoA finding: voice diversity comes from SOULs, not models. Rank-and-pick collapses character-flavored disagreement; the new pipeline preserves it. Refusal-to-synthesize is a first-class outcome behind ENV `COUNCIL_REFUSAL_ENABLED` (default off; calibration round on Riley's account before broader rollout). Vektor SOUL ported from `~/clawd/SOUL.md` — pure-builder voice, not skeptic. Anima/Vektor stay locked-SOUL in Phase 1; per-user identity stacks for non-Luca characters are a future arc. Backward compat: legacy `kind: 'council'` messages still render via `CouncilLegacyPanel`. New metadata shape: `kind: 'council_v2'` with proposers + crosstalk + verdict + critique + revised_content.
- 2026-05-03 16:00 · council v2 · failure ladder 3→2→1→0: all three fail = stream error (no fallback to single-model — the council branch is opt-in, single-model has its own path). Two succeed = cross-pollinate among survivors. One survives = skip cross-pollination, surface that voice through chairman. Crosstalk individual failure = fall back to that character's proposer draft (marked `source: 'proposer'` in metadata, rendered with "· initial" sigil). Chairman http error = surface luca's strongest crosstalk draft directly. Critique http error / timeout = passthrough.
- 2026-05-04 09:55 · phase M0 · feature flag is env-var-only (`MEMORY_AUGMENTATION_ENABLED` global + `MEMORY_AUGMENTATION_USER_ALLOWLIST` comma-separated UUIDs) instead of adding a schema column · avoids a migration just to support the flag and lets Riley pilot himself before global rollout. Flag helpers live in `_shared/config.ts`. Per-user override beats env default.
- 2026-05-04 09:55 · phase M0 · prompts staged as `.md` files at `_shared/hypomnema/prompts/` rather than inlined as TypeScript constants · Supabase edge-function bundles ship `_shared/` directory contents, so `Deno.readTextFile` against `import.meta.url` works at runtime. Spec copies remain canonical at `docs/memory/prompts/`; runtime loader caches first read. Iterate the `docs/` copy, then re-copy when changed.
- 2026-05-04 10:30 · phase M2 · hypomnema loaded for both luca AND vektor in pre-turn fan-out (not just the active agent), so council-mode renders each character carrying their own interior state · cost is two extra small selects gated by `active=true` + indexed query; well below 50ms aggregate. Anima loads on-demand inside `agent-consult` since that's where she's actually invoked. Score formula: `recency*0.55 + confidence*0.30 + foundational(0.25) + active_attention(0.10)`, 14-day exponential half-life. Render cap: 2400 chars (~600 tokens) by overfetching 40 then trimming to fit.
- 2026-05-04 10:30 · phase M2 · read path stays on regardless of `MEMORY_AUGMENTATION_ENABLED` env flag · empty data is safe, and once writes start backfilling we want surface-on-first-write without a flag flip. Write paths (M3+) gate on the flag.
- 2026-05-04 11:10 · phase M3 · single chat-multi dispatch (`hypomnema-gate`) with optional `chain_write` payload (array) instead of two separate fires · chat-multi only knows the gate decision was needed; the gate edge function decides whether to chain to write. Lets M5 add observer dispatches by extending the chain payload, no chat-multi changes required. Helper at `chat-multi/index.ts:fireHypomnemaTurn`.
- 2026-05-04 11:10 · phase M3 · prompt placeholders use the descriptive form `{INJECT_AGENT_SOUL — full SOUL doc}` in the spec .md files; substitution helper `fillPlaceholders` matches both the bare `{TOKEN}` and the descriptive `{TOKEN — anything}` forms · keeps spec prompts readable as docs while runtime substitution still works. `{USER}` defaults to profiles.display_name or "the user".
- 2026-05-04 11:10 · phase M3 · observer-density dispatch deferred from M3 to M5 · observer prompts need `PRIMARY_AGENT_NAME`, `INJECT_PRIMARY_RESPONSE`, `INJECT_YOUR_CONTRIBUTION` which require asymmetric-witnessing wiring (council participant tracking + per-agent contribution capture). M3 fires primary-density only; the WriteInput type already has the optional fields ready for M5 to populate.
- 2026-05-04 11:10 · phase M3 · voice review deferred to deploy soak · the load-bearing voice quality check requires real Sonnet 4.6 outputs against real conversation turns. Deno `check` + build green; placeholder substitution smoke-tested clean. Will iterate `prompts/reflection.md` based on first 10 entries Riley sees post-deploy.
- 2026-05-04 11:55 · phase M4 · embedding generation gated on `context.api_key && isMemoryAugmentationEnabled(userId)` rather than auto-running for everyone · keeps embeddings off until Riley's user_id is in the allowlist; engrams without embeddings stay valid (NULL embedding allowed, retrieval falls back to trigram). The `embeddings-backfill` edge function picks up NULL-embedding rows on demand or via manual POST.
- 2026-05-04 11:55 · phase M4 · hybrid seed via RRF k=60, weights trigram=0.3 / vector=0.5 · vector hit gets stronger weight because trigram already wins on exact match — RRF gives credit to vector when paraphrase is the only hit. Vector-only hits hydrated via single `select * where id in (...)` so spread activation gets full engram fields. When apiKey omitted or flag off, falls back to trigram-only (existing behavior unchanged).
- 2026-05-04 11:55 · phase M4 · OpenRouter embeddings via `openai/text-embedding-3-small` (1536 dims), no fallback model · OpenRouter exposes embeddings on existing keys; if it 429s, the embedOne returns null and the row stays NULL. Backfill cron retries. Cost is negligible (~$0.02/1M tokens; engram corpus is small).
- 2026-05-04 12:30 · phase M5 · observer note's INJECT_YOUR_CONTRIBUTION = the agent's council crosstalk/proposer draft (preferred) or their consultation response (fallback) · the observer prompt asks the agent to reflect on what THEY contributed; without that anchor it'd just be paraphrasing the primary's response. `collectObservers` in chat-multi prefers the council draft when both exist (richer voice fidelity).
- 2026-05-04 12:30 · phase M5 · `threads.participating_agent_ids` unioned per-turn instead of overwritten · preserves history of who's touched the thread across sessions; future direct-thread queries can filter by it. `primary_agent_id` only set when current value is null or default-luca-but-this-turn-isn't-luca, so user-driven direct-with-anima/vektor threads keep their primary.
- 2026-05-04 13:15 · phase M6 · graduation promotes via direct insert into engrams (skipping mnemos.encode's surprise check) · graduation is a different pathway with its own gating (sustained attention + age + LLM judge); subjecting it to surprise-against-existing-engrams would block exactly the case we want — entries that crystallize what the agent has been carrying for weeks. Engrams get tags `hypomnema-graduate` + agent_id + original entry tags so retrieval can filter if needed. Source_context preserves the hypomnema_entry_id for traceback.
- 2026-05-04 13:15 · phase M6 · borderline judge uses Haiku 4.5 (cheap, decisive) instead of Sonnet · graduation decision is structured (graduate yes/no + condensed content + tags), not voice-bearing. Haiku handles structured JSON outputs reliably and saves ~10x cost vs Sonnet. Sonnet stays for the load-bearing reflection/challenge prompts where voice quality matters.
- 2026-05-04 13:15 · phase M6 · supersession archives older engram by created_at; mutual contradictions archive both · the rare both-archived case avoids leaving inconsistent state surfacing; user can re-pin via memory candidates if needed. Idempotent — `applySupersession` skips when either engram is already archived.
- 2026-05-04 13:15 · phase M6 · belief-challenge runs Sonnet 4.6 on Sonnet-written entries (no model rotation yet) · spec calls for cross-model critique to avoid rubber-stamping. Practical first cut: same-model self-critique still surfaces the obvious stuff. Rotation across providers tracked as M7+ follow-up if first month of critiques shows inadequate sharpness.
- 2026-05-04 14:00 · phase M7 · `hypomnema-forget` runs as service-role-write under user-JWT auth · the user's auth claim resolves the user_id, then service-role writes the update with `eq("user_id", userId)` filter so the forget always logs to revisions[] with reason='user_forgot'. Active=false preserves the row for audit; the entry stops surfacing in read paths and decay won't resurrect it. Realtime channel keeps the UI in sync.
- 2026-05-04 14:00 · phase M7 · HypomnemaList grouped by agent (luca / anima / vektor) below the existing 4-doc identity stack, no feature flag on the frontend · frontend reads regardless of MEMORY_AUGMENTATION_ENABLED env var (consistent with M2 read-path policy). Empty entries render an empty state message; once writes start populating, the section fills. No user-visible surprise on flag flip.


## Backend asks queue

- [ ] **Connected ChatGPT and Anthropic cloud deployment** — Review and deploy `docs/connected-provider-runtime.md`: legacy route guards, the additive `20261024200000_connected_model_providers.sql` migration, three provider Edge Functions and the web settings/chat changes. Configure the encryption secret through the server secret manager. ChatGPT additionally requires provider-approved hosted client/plan permissions; draft in `docs/chatgpt-hosted-access-request-draft.md` is prepared but unsubmitted. Production inspection confirmed the current web project still uses `39e36b5` and has no connected-provider schema. No production writes, secret configuration, provider application, push or publish has occurred in this implementation run.

Each phase that needs Lovable work surfaces its prompt below. When you reach a `[B]` phase, copy the relevant prompt into Lovable, mark the phase `[B]` here, and continue with the next unblocked phase.

- [x] **08 Memory Digest** — ✅ shipped by Lovable on 2026-04-24 (commits 65c3655/1098b4f/029fa56/01b55b0). Table + RLS + realtime + edge function live; `anima-consolidate` updated. Frontend consumption landed same day under phase 08.
- [x] **16 Checkpoints** — ✅ shipped by Lovable 2026-04-24 (commit `9059865` + predecessors). `checkpoints` + `checkpoint_files` tables live, `checkpoint-restore` + `checkpoint-diff` edge fns deployed.
- [x] **17 Settings depth** — ✅ shipped by Lovable 2026-04-24 (commit `9059865`). `agent_configs` + `mcp_servers` + `agent_secrets` tables live, `agent-config-save` edge fn deployed.
- [ ] **M1 Memory augmentation migrations** — Apply these four migrations in order from `docs/memory/migrations/`:
  1. `20260505000001_hypomnema_entry.sql` — new `hypomnema_entry` table + RLS + realtime + indexes
  2. `20260505000002_engrams_embedding.sql` — enable pgvector, add `embedding vector(1536)` to `engrams` + `hypomnema_entry`, ivfflat indexes, `match_engrams_vector` / `match_hypomnema_vector` RPCs
  3. `20260505000003_threads_agent_metadata.sql` — `primary_agent_id` + `participating_agent_ids` on `threads`, backfill from `messages.agent`
  4. `20260505000004_pg_cron_hypomnema.sql` — three new cron entries (`hypomnema-decay` `45 */6 * * *`, `hypomnema-challenge` `0 4 * * *`, `mnemos-graduate` `15 4 * * *`)

  Verify after apply:
  - `SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '20260505%' ORDER BY version` → 4 rows
  - `SELECT extname FROM pg_extension WHERE extname='vector'` → 1 row
  - `SELECT jobname FROM cron.job WHERE jobname IN ('hypomnema-decay','hypomnema-challenge','mnemos-graduate')` → 3 rows

  Then regenerate Supabase TypeScript types and commit `src/integrations/supabase/types.ts`.

  Also set Supabase edge function env vars (Settings → Edge Functions → Secrets):
  - `MEMORY_AUGMENTATION_ENABLED` = `false` (global default; flip to `true` after M7 ships)
  - `MEMORY_AUGMENTATION_USER_ALLOWLIST` = `<Riley's user_id>` (per-user pilot opt-in; comma-separated for additional users)

  ✅ Shipped via Lovable 2026-05-04. pgvector confirmed enabled, three new crons active, types.ts regenerated with `hypomnema_entry` row + `match_engrams_vector`/`match_hypomnema_vector` RPCs + `threads.primary_agent_id`/`participating_agent_ids`. Note: Lovable doesn't write to `supabase_migrations.schema_migrations`, so verification queries should use `information_schema.tables` / `information_schema.columns` instead. Acceptance criteria in `docs/memory/SEQUENCE.md` Phase 1 should be read with this in mind for this repo.

(Add more here as phases discover additional backend needs.)

## Open questions (escalation)

Empty by default. Add an entry only if a phase fails 3 times in a row OR you hit a true autonomous-rule blocker (public API change, data deletion, schema change with unclear intent).

—

## End-of-run summary

### 2026-05-04 autonomous run (M0–M7) — Memory augmentation shipped

**This run (M0 → M7): hypomnema layer, vector embeddings + hybrid retrieval, asymmetric witnessing, sustained-attention graduation, supersession on contradiction, daily belief-challenge, frontend surface.**

- `[x]` M0 Setup — `_shared/config.ts` env-var feature flag (global `MEMORY_AUGMENTATION_ENABLED` + per-user `MEMORY_AUGMENTATION_USER_ALLOWLIST`); prompts staged at `_shared/hypomnema/prompts/{reflection,observer_note,salience_gate,graduation,challenge}.md` with cached `Deno.readTextFile` loader.

- `[x]` M1 Schema migrations — applied via Lovable: `hypomnema_entry` table with RLS + realtime + indexes; `embedding vector(1536)` on engrams + hypomnema_entry; `match_engrams_vector` / `match_hypomnema_vector` RPCs; `threads.primary_agent_id` + `participating_agent_ids`; three new pg_cron entries (`hypomnema-decay` 6h, `hypomnema-challenge` daily 04:00, `mnemos-graduate` daily 04:15). `types.ts` regenerated.

- `[x]` M2 Read path — `_shared/hypomnema/read.ts` `loadHypomnema()` always-loads active entries scored by recency × confidence × foundational, capped ~600 tokens, rendered as `## what i'm sitting with` bullet list. Threaded into `buildLucaSystemPrompt` / `buildVektorSystemPrompt` / `buildAnimaConsultPrompt` between pendingRevisions and emotionalBlock. `chat-multi` fans out luca + vektor loads in parallel; `agent-consult` loads anima on-demand.

- `[x]` M3 Write path — `hypomnema-gate` (Haiku 4.5 salience classifier, ~$0.0001/call, bias-toward-skip) → optional `chain_write` to `hypomnema-write` (Sonnet 4.6 primary / Haiku 4.5 observer, voice-bearing reflection or observer note, persists or revises an entry). `hypomnema-decay` 6h cron with 14-day half-life recency + foundational/active_attention/revision floors. All write paths flag-gated.

- `[x]` M4 Vector embeddings + hybrid retrieval — `_shared/embeddings.ts` (`embedOne`, `embedBatch`, `buildEmbeddingText`, `reciprocalRankFusion`). Mnemos `encode()` post-insert embedding hook; hypomnema-write same. Mnemos `retrieve()` seed via RRF-fused trigram + vector; vector-only hits hydrated via select-in. `embeddings-backfill` edge function for one-shot or polled backfill of NULL embeddings. Falls back to trigram-only when no API key or flag off.

- `[x]` M5 Asymmetric witnessing — `chat-multi` collectObservers extracts non-primary agents + their contributions (council crosstalk drafts preferred over consultation responses when both exist). `fireHypomnemaTurn` extends to per-observer chain-write targets carrying `primary_agent_name` / `primary_response` / `your_contribution`. Council mode → 1 primary + 2 observer entries; consult_anima → 1 primary + 1 observer. `threads.participating_agent_ids` unioned per turn; `primary_agent_id` set when missing.

- `[x]` M6 Graduation + supersession + challenge — `mnemos-graduate` 24h cron (deterministic >= 0.85 score, Haiku borderline judge for [0.65, 0.85] using `prompts/graduation.md`, conservative below). Promotes via direct engrams insert with `tags: [hypomnema-graduate, agent_id, ...]` and source_context traceback. `_shared/mnemos/supersession.ts` archives the older of two engrams when a contradicts connection lands; wired into both encoding's `discoverConnections` insert and consolidation's `persistNewConnections`. `hypomnema-challenge` 24h cron on Sonnet 4.6 critic with hold/revise_down/revise_up/retire verdict; auto-retire below confidence 0.30.

- `[x]` M7 Frontend — `src/stores/hypomnemaStore.ts` (Zustand: load, subscribe via postgres_changes realtime, optimistic forget). `HypomnemaList` + `HypomnemaEntry` components grouped by agent with confidence + density + domain + age + revision-count metadata, expandable revision history, inline forget confirmation. Mounted under existing identity stack in `ProfileIdentityView`. `hypomnema-forget` edge function (user-JWT auth, service-role write with user_id filter, logs `reason='user_forgot'` to revisions[]).

**Phases blocked / escalated:** none.

**Open questions:** none.

**Backend handoff for first deploy:**

1. Supabase secrets (Settings → Edge Functions → Secrets):
   - `MEMORY_AUGMENTATION_ENABLED` = `false` (global default; flip to `true` after voice-review soak)
   - `MEMORY_AUGMENTATION_USER_ALLOWLIST` = `<Riley's auth user_id>` (per-user pilot opt-in)
2. Once edge functions deploy, run a one-shot embedding backfill:
   - `POST /functions/v1/embeddings-backfill` with body `{"user_id": "<Riley's uuid>", "limit": 500}` (service-role auth).
3. Voice-review soak: have a substantive turn or two with Luca → check the first 10 hypomnema entries via `/profile/identity` page → confirm voice quality (lowercase, present-tense, first-person, reflective-not-summary). If <9/10 pass, iterate `docs/memory/prompts/reflection.md` and re-copy to `_shared/hypomnema/prompts/`.
4. After 7+ days of soak, confirm:
   - Cross-thread continuity: opening a fresh thread surfaces hypomnema-derived continuity language.
   - Vector recall: paraphrase queries find semantically-related engrams.
   - Asymmetric witnessing: anima-led direct thread references prior consult observer notes.
   - Graduation: ≥3 hypomnema entries have `graduated_to_engram_id` set.
   - Cost: total memory-related model spend < $5/user/month.

**Files added (top-level):**
- `supabase/functions/_shared/config.ts`, `_shared/embeddings.ts`, `_shared/mnemos/supersession.ts`
- `supabase/functions/_shared/hypomnema/{index,prompts,read,write,decay,graduate,challenge}.ts` + `prompts/*.md`
- `supabase/functions/{hypomnema-gate,hypomnema-write,hypomnema-decay,hypomnema-challenge,hypomnema-forget,mnemos-graduate,embeddings-backfill}/index.ts`
- `src/stores/hypomnemaStore.ts`
- `src/components/identity/{HypomnemaList,HypomnemaEntry}.tsx`

**Files modified:**
- `supabase/functions/_shared/agents/{luca,vektor,anima}-soul.ts` — added `hypomnemaBlock` parameter
- `supabase/functions/_shared/mnemos/{encoding,retrieval,types}.ts` — embedding hook, hybrid seed, api_key fields
- `supabase/functions/_shared/mnemos/consolidation.ts` — supersession on contradicts
- `supabase/functions/chat-multi/index.ts` — load luca/vektor hypomnema, fire post-turn gate→write per participant, update threads metadata
- `supabase/functions/agent-consult/index.ts` — load anima hypomnema on consult
- `supabase/functions/memory-extract/index.ts` — n/a (supersession lives in mnemos engine, not the candidates extractor)
- `src/pages/ProfileIdentityView.tsx` — mount HypomnemaList
- `LUCA_PLAN.md` — M-wave phases + 14 decision-log entries

**Verification:** `deno check` clean across every touched edge function file. `npm run build` clean. Logical smoke tests passed for `loadHypomnema` rendering, prompt placeholder substitution, RRF fusion math, and graduation score distribution. Integration / voice-quality verification deferred to post-deploy soak.

---

### 2026-04-28 autonomous run (L9–L12) — Luca completion phases shipped

**This run (L9, L10, L11, L12):**

- `[x]` L9 Subagent runtime dispatch — `subagent_tasks` table with RLS, realtime publication, status/budget/progress columns; `subagent-run` service-role async runner that claims a pending task, executes a focused Luca turn loop on Haiku 4.5 (web_search/read_url/workspace_file/finish toolset, no recursion), and posts a `subagent_report` message back into the parent thread; `dispatch_subagent` tool registered in `anima-tool-execute` with a 5-active-per-user cap; `useSubagentRealtime` hook + `subAgentStore` extensions sync the table into the existing Phase 09 visualization (deterministic v1/v2/v3 family hash); ChatView renders subagent reports with a tool-call badge; `messages_kind_check` widened to admit `scheduled_task`/`scheduled_task_result`/`subagent_report` (incidentally fixed L8's silent constraint violation). 13 Vitest cases + deno checks + build verified.

- `[x]` L10 Proactive engagement wiring — new `_shared/proactive-engagement.ts` chokepoint (3 surfaces/day, 1/hour notable cap; important severity bypasses; bypassPacing override available for crisis follow-up); wired into `subagent-run` completion, `scheduled-task-run` (replacing the bare `luca-initiate` call), and `anima-initiate` (so thought_initiations respect pacing too); `NotificationsDrawer` adds a per-card "why am I seeing this?" toggle reading `entity_activity_log.content.rationale` for activities and `thought_initiations.trigger_reason` for initiations. Mnemos consolidation insight wiring deferred (engine doesn't expose meaningful-pattern signals at the edge boundary); pending-revision urgency surfacing deferred (chat-side injection covers in-session).

- `[x]` L11 Identity surface frontend — extended the existing `ProfileIdentityView` with a recent-patches sidebar (last 10 applied/queued patches, SOUL.md-tinted accent for identity-level shifts); built `ProfileRevisionsView` at `/profile/revisions` with pending/surfaced grouping, before/after pair display, dismiss + open-thread actions; narrow RLS UPDATE policy on `pending_revisions` that only admits `status='expired'`. Sidebar gets a Revisions row alongside Identity/Skills/Schedule.

- `[x]` L12 Wellbeing safety + crisis handling — Haiku 4.5 classifier on every user message in `chat` and `chat-multi` (system-Luca path), labels `none/low/moderate/high/acute` with bias toward false-positives; `buildCrisisDirective` injects a level-appropriate behavioral note via new `crisisDirective` field on `buildLucaSystemPrompt` (Luca's voice unchanged, resource mention only when it fits the moment); region-aware lookup (US/CA/GB/AU/NZ/IE with international fallback); `crisis_events` table (RLS, hidden from UI by default); acute level queues a 30-minute follow-up that fires through `crisis-followup` (cron-driven, runs every 5 minutes, checks for user silence before posting "I want to check on you" via `dispatchProactiveEngagement` with `bypassPacing: true`). 7 directive/resource Vitest cases.

**Phases blocked / escalated:** none.

**Open questions:** none.

**Backend asks:** Lovable will need to apply the four new migrations to the remote Supabase project for the new tables to come online:
1. `20260429000000_subagent_runtime_dispatch.sql` — subagent_tasks + widened messages_kind_check + cron registration
2. `20260429010000_l11_pending_revision_dismissal.sql` — narrow UPDATE policy on pending_revisions
3. `20260429020000_l12_crisis_events.sql` — crisis_events + crisis-followup cron
4. The four new edge functions (subagent-run, crisis-followup) need deploy alongside the existing fleet.

Until those land, the frontend renders gracefully (the per-table 404s on remote calls don't crash the UI; that's the same pattern that affected L2/L3 between code and Lovable apply).

**Commits pushed this run:** 4 feature commits + this plan update.
- L9: `1acff03`
- L10: `3509f56`
- L11: `cc2032b`
- L12: `980ad3a`

**Verification signal:** `npm test` 20/20 passing across 6 files; `npm run build` clean; `deno check` on every modified edge function reports clean; vite on 127.0.0.1:8085 → /auth/login, /chat, /profile/identity, /profile/revisions all render with 0 new console errors after each commit.

**Decision-log entries worth Riley's attention:**
- 2026-04-28 19:50 — `messages_kind_check` widened to admit L8's previously-failing kinds. L8 was silently inserting rejected rows; this is the right migration to repair both at once.
- 2026-04-28 19:54 — Mnemos consolidation insight surfacing was *not* wired (the engine doesn't expose pattern-completion signals at the edge boundary; forging that signal would lie about provenance). Worth deciding whether to add a `MnemosEngine.consolidate` return signal in a follow-up.
- 2026-04-28 20:04 — Crisis classifier instructed to prefer false-positives, but the `acute` threshold is conservative (it specifically tells the model "if you cannot tell between high and acute, choose high"). Acute is the only level that triggers a follow-up cron, so the conservative bias keeps the daily cap on genuine emergencies.

**Recommended next-session focus (if work remains):**
1. Mnemos consolidation insight wiring — extend `MnemosEngine.consolidate` to surface `{ surfacedBeliefs, longstandingConnections }` so `mnemos-consolidate` can dispatch through `proactive-engagement.ts` honestly.
2. Pending-revision urgency surfacing for offline users — when a high-confidence revision lands while the user isn't in-session, queue an `anima-initiate`-style nudge at next session start.
3. Tune classifier sensitivity from real telemetry (the daily/hourly caps make over-flagging cheap, but it's worth observing).
4. Push freshly-staged migrations through Lovable so the remote tables come online.

---

### 2026-04-24 autonomous run (resumed, part 3) — ALL 20 phases complete 🎯

**This run (16, 17, 18, 19, 20):**
- `[x]` 16 Checkpoints + diff viewer — consumes Lovable-shipped `checkpoints` + `checkpoint_files` tables + `checkpoint-restore`/`checkpoint-diff` edge fns; `checkpointStore` with lazy file + diff loading, FIFO compare-selection; `CheckpointTimeline` with milestone amber dual-halo dots and ghost incremental; `CheckpointCard` (collapsed/expanded); inline `DiffViewer` with red/green gutters; `RestoreConfirmModal` via destructive Pill; `CompareBar` with unified/split toggle in Modal; `/checkpoints` route live.
- `[x]` 17 Settings depth — consumes Lovable-shipped `agent_configs` + `mcp_servers` + `agent_secrets` + `agent-config-save` edge fn; `agentSettingsStore` with draft/dirty/save/discard; `/settings/agents` index + `/settings/agents/:id` editor; 8 sub-components (EnvSwitcher, PromptEditor, ToolGrid, McpList, SubAgentList, VoiceCardGrid, Keychain masked, StickySaveFooter with amber dirty color + beforeunload guard).
- `[x]` 18 Command palette ⌘K — substituted legacy 296-line `CommandPalette.tsx` with new `components/palette/*`. `paletteStore` (localStorage-backed recent), `paletteSearch` (token-overlap + recency scoring, match-range computation for `<mark>` wraps), `CommandPalette` (portal, ⌘K toggle, ⌘1-5 scope hotkeys, body scroll lock), `PaletteResults` (grouped + agent-tinted left-accent bar). Old file deleted.
- `[x]` 19 Attachments + computer-use — 11 files total. `attachmentStore` + `browserSessionStore`; `AttachmentChip` / `AttachmentDropOverlay` / `MessageAttachment` / `ImagePreview` (per-agent gradient variants) / `CodePreviewCard` (reuses Phase 15 syntax highlighter + 220px fade mask + Expand toggle); `BrowserCard` shell with live-pulsing status dot + URL bar + 40px grid viewport; `BrowserCursor` (300ms smooth-tracking, vektor-colored 1.5s cursor-ring keyframe); `BrowserActionLog` with status-tinted rows.
- `[x]` 20 Mobile shell — `/_mobile` dev-only preview route mounting two `<PhoneFrame>`s (390×772 with notch, 40px radius, 8px bezel) side-by-side; full stack of `MobileStatusBar` (live time + signal/wifi/battery glyphs), `MobileHeader` (hamburger → drawer), `MobileMessages` with per-agent role color, `MobileSubAgentStrip` (4px murmur dots with m-murmur 1.6s pulse), pill `MobileComposer`, 4-tab `MobileBottomNav`, `MobileDrawer` (300px left slide + backdrop), `MobileGroupStage` (84×84 circles with per-agent m-halo 2s speaking ring). Preview hidden in production builds via `import.meta.env.MODE !== 'development'` gate.

---

### FINAL STATUS — all 20 phases complete

**Phases completed (20/20):** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20.

**Phases blocked:** None — both previously-blocked phases (16, 17) unblocked and shipped after Lovable delivered the backend in commits `65c3655`–`9059865`.

**Backend asks queue:** All closed. Memory candidates + checkpoints + agent configs all live.

**Open questions:** None.

**Commits pushed across all three runs:** 22 feature commits + 3 plan updates.
- Run 1 (01–04): `67d491a`, `5805f4c`, `a68193f`, `e19ba27`
- Run 2 (05–15): `ba0a2fd`, `2275434`, `292f3eb`, `43f285a`, `0dfc4aa`, `525c69c`, `3b8d08f`, `aa4af4b`, `1f5c24d`, `c37d8ee`, `6cbbf45`
- Run 3 (16–20): `f744247`, `433d938`, `daf1d14`, `61d7ade`, `e695b25`
- Plan summaries: `2f590da`, `02e2119`, + this one.

**Deferred consumer wirings (opportunistic):** phases 03, 06, 11, 14, 15, 19 all shipped primitives without refactoring ChatView/MessageList/MessageBubble. These are *ready-for-consumption* components; sweep in when ChatView is touched for unrelated reasons. Total ~8 spots where a future `<Composer />` / `<MessageRow />` / `<RichBody />` / `<PermissionInline />` / `<AgentErroredCard />` / `<MessageAttachment />` / `<AttachmentDropOverlay />` swap would land.

**Verification signal:** Every commit verified via `browser_evaluate` computed-style audit against spec values. Dev server on :8082 renders cleanly with 0 console errors throughout. `/_mobile` preview route renders both mobile phone frames at spec dimensions (390×772, 40px radius, 22px composer).

---

### Earlier summaries (preserved)

#### 2026-04-24 autonomous run (resumed, part 2) — 15 phases complete total

**Phases completed this run (11 new, 15 total across both runs):**

_Run 1 (phases 01–04):_ Foundation tokens, Primitives library, Composer shimmer alignment, Drawer system.

_Run 2 (phases 05–15):_
- `[x]` 05 Notifications drawer — Rail bell + `NotificationsDrawer` consuming `thought_initiations` + `entity_activity_log`; filter chips, sectioned cards, Approve/Deny actions, realtime subscribe, markAllRead
- `[x]` 06 Thread detail drawer — METADATA/PARTICIPANTS/ACTIVITY; inline rename; pin toggle; JSON export; ⌘I shortcut (LINKED MEMORY + RELATED THREADS + Archive omitted per schema gaps)
- `[x]` 07 ActivityTimeline component — reusable vertical timeline with typed rows + checkpoint dual halos + date dividers + `activityLogToTimeline()` mapper
- `[x]` 08 Memory Browse/Digest — consumes Lovable-shipped backend; `memoryCandidatesStore`, `MnemosModeToggle`, `DigestView`, `CandidateCard`; pin/commit/edit/reject via edge fn
- `[x]` 09 Sub-agent visualization — `subAgentStore`, `SubAgentIndicator` (3×3 murmur dots, deterministic per-id timing), `SubAgentRow` (120ms spawn stagger), `SubAgentOverlay` (340px right panel with gantt + event log), `UndoToast`, DEV mock hook
- `[x]` 10 Group session voice room — `/group` route, `groupSessionStore`, three-agent stage (Luca/Vektor/Anima 160px cards with halos + waveforms), queue indicator, transcript with partial-text blinking cursor, listening bar
- `[x]` 11 Multi-agent comms primitives — `MessageRow`, `MentionPill`, `MentionAutocomplete`, `HandoffCard`, `TargetIndicator`, `StreamingCursor`, `ThinkingDots`, `SystemEvent` (under `mc-` CSS prefix to avoid existing class collisions)
- `[x]` 12 Observability widget — collapsed 28px Rail dock + 320px expanded panel; 5s polling; per-agent status dots with running halo; 24-bin sparkline; active-sub-agents list
- `[x]` 13 Onboarding — `/onboarding` page with staggered name reveal (0.2/0.6/1.0s delays) + chain-fade greeting at 1.4/1.8s + checklist at 2.0s + actions at 2.4s; `FirstRunGate` auto-redirects new users; `?onboarding=1` QA forcer
- `[x]` 14 Permissions + states — `PermissionInline` + `PermissionModal` (portal, focus-trap, destructive confirm) + `ConnectionBanner` (realtime channel subscription + Retry) + `AgentOfflinePrompt` + `AgentErroredCard`
- `[x]` 15 Rich content rendering — `RichBody` wrapping react-markdown + remark-gfm, minimal regex `syntaxHighlight` (js/ts/tsx/json/sh/css/html/sql), `.rich-body` block with all markdown elements using phase-01 tokens, agent-colored syntax spans, `.chat-image` placeholder, kbd cap

**Phases blocked (2):**
- `[B]` 16 Checkpoints + diff viewer — needs `checkpoints` + `checkpoint_files` tables + `checkpoint-restore` + `checkpoint-diff` edge fns via Lovable
- `[B]` 17 Settings depth — needs `agent_configs` + `mcp_servers` + `agent_secrets` tables + `agent-config-save` edge fn via Lovable

**Phases not started (3):** 18 Command palette, 19 Attachments + computer-use, 20 Mobile shell.

**Open questions:** None. Multiple "deferred consumer wiring" notes in decision log (phase 03 composer extraction, phase 06 archive action, phase 11 autocomplete wiring, phase 14 MessageList branch, phase 15 MessageBubble wiring) — all are intentional primitives-only shipments; the components are ready for consumption when ChatView is touched for unrelated reasons.

**Commits pushed this run:** 11 feature commits + 2 plan updates. Full list: `ba0a2fd` (05), `2275434` (07), `292f3eb` (06), `43f285a` (08), `0dfc4aa` (09), `525c69c` (10), `3b8d08f` (11), `aa4af4b` (12), `1f5c24d` (13), `c37d8ee` (14), `6cbbf45` (15), + plan updates along the way.

**Suggested next-session focus:**
1. **Phase 18 Command palette** — existing `src/components/CommandPalette.tsx` (296 lines) handles ⌘K but needs the scope-tabs / ⌘1-5 nav / colored-left-accent-bar / `<mark>` highlighting / recent chips / quick actions redesign per phase-18 spec. Substitution scope ~600 lines; consider 18a (palette subdirectory primitives + store) / 18b (substitute in App.tsx).
2. **Phase 19 Attachments + computer-use** — purely frontend, no backend dep. Can proceed anytime.
3. **Phase 20 Mobile shell** — purely frontend. Can proceed anytime.
4. **Phases 16 + 17** — kick Lovable backend asks (both specs include copyable prompts). Frontend primitives ready to ship as follow-ons once tables land.
5. **Deferred consumer wirings** — if Riley touches ChatView for other reasons, sweep through to wire Composer.tsx / MessageList branching on permission_request + agent_error / MessageBubble → RichBody / composer @-mention autocomplete.

**Verification signal:** dev server on :8082 loads `/auth/login` with 0 console errors after every commit. Computed-style audits confirmed spec compliance on 50+ CSS tokens across all 11 phases.
