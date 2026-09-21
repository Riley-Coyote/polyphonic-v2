# Polyphonic-v2 Style Guide

The starting point for any new feature or surface in polyphonic-v2. Read this first when you want to add something to the app.

**Deeper references:**
- Tokens: [`design-system/01-foundation.md`](./design-system/01-foundation.md)
- Primitives: [`design-system/02-primitives.md`](./design-system/02-primitives.md)
- Surface patterns: `design-system/03-20`
- Locked mockups: `/Users/rileycoyote/clawd-luca/luca-terminal-v2/docs/luca-terminal-complete/` (don't edit)

---

## Design philosophy

- **Award-winning quality is the bar.** Design-showcase level. Every micro-interaction, every shadow alpha, every letter-spacing intentional.
- **Tonal gradients for depth, not layering tricks.** No glassmorphism, no scale-on-hover, no drop-shadow-to-indicate-depth. Depth comes from muted → bright text tiers, surface elevation via subtle rgba increments, and the inset rim highlight.
- **Warm black, not cold gray.** Surface palette is temperature-locked (B = R × 1.20). Text is warm cream, never pure white.
- **Restraint over spectacle.** Accents (green/amber/red) pop *because* the rest is muted. Don't add more color — use the ones we have sparingly.
- **Agent identity is monochrome by default; full-color in identity contexts only.** Group session, agent settings, per-message author label. Everywhere else: cream.
- **Small delightful details earn their keep.** The thin composer's ink-circle send and the Observer well cut into the floor, dual halos on checkpoint dots, staggered onboarding reveal, 3×3 murmur grids on sub-agents — these are the signature moments. Don't dilute them by copying the pattern elsewhere.

## Anti-references (what NOT to build like)

- Discord, Notion AI, ChatGPT dashboard, Tailwind defaults, Material Design, glassmorphism
- Any emoji as UI icon
- Any pure white text (`rgba(255, 255, 255, *)`)
- Hardcoded hex colors outside the token set
- Drop shadows as the *only* way to separate elements
- Bright borders at rest (borders should be barely-visible until interaction)
- Animation with no purpose (no gratuitous fade-ins on page load, no scale-on-hover)
- Mixed icon libraries, mixed font weights, mixed tracking values

---

## Quick token lookup

### Text tiers (brightest → dimmest)

```
--ink              0.93   — HIGHEST. Brightness cap. Selection highlight text.
--text-primary     0.90   — Body, H2, active states
--text-body        0.72   — Secondary content
--text-secondary   0.58   — Entry content, card labels
--text-soft        0.44   — Mono labels, agent names
--text-tertiary    0.34   — Inactive button text
--text-faint       0.30   — Empty-state body
--text-ghost       0.36   — Section labels, subtitles (Riley-boosted from 0.20)
--text-whisper     0.22   — Timestamps, smallest meta (Riley-boosted from 0.12)
```

### Surfaces (darkest → brightest)

```
--floor      #0a0a0c   — Rail, scene chrome
--canvas     #0e0e11   — Main panels (sidebar, main, drawer)
--surface-1  #121216   — Cards, inputs, data rows
--surface-2  #16161a   — Hover state
--surface-3  #1a1a1f   — Modals, popovers
--surface-4  #1e1e24   — Tooltips on overlays
--surface-5  #222229   — Top elevation (rare)
```

### Semantic accents (every accent has full bg/border/dot/glow)

```
--green-accent    #4ade80   — Active, verified, complete
--green-bg        rgba(74, 222, 128, 0.06)
--green-border    rgba(74, 222, 128, 0.18)
--green-glow      0 0 8px rgba(74, 222, 128, 0.5)

--amber-accent    #d9a744   — Pinned, checkpoint, unsaved, permission needed
--amber-bg/border/glow/halos

--red-accent      #f87171   — Decay, error, destructive
--red-bg/border

--blue-accent     #0070F3   — Luca's identity glyph; subtle indicators / color cues
--blue-bg/border/glow       — the one electric note in the warm palette; use as a signal, sparingly
```

### Motion

```
--dur-micro   120ms    — Hover color-only transitions
--dur-fast    180ms    — Default interactive transitions (STANDARD)
--dur-normal  300ms    — Slide/fade transitions
--dur-settle  320ms    — Modal entrance
--dur-drawer  380ms    — Right-drawer slide
--dur-slow    500ms    — Rare heavier transitions

--ease-out       cubic-bezier(0.16, 1, 0.3, 1)    — Default
--ease-premium   cubic-bezier(0.22, 1, 0.36, 1)   — Drawer, modal entrance
--ease-spring    cubic-bezier(0.34, 1.56, 0.64, 1) — Rare, toggle knob overshoot only
```

---

## Decision trees

### Where does this new feature live?

```
Is it a focused, one-time task that interrupts flow?
  → Modal (Phase 02 primitive). Examples: delete confirm, restore confirm.

Is it contextual detail about a thing already on screen (thread, memory, agent)?
  → Drawer (Phase 04 primitive). Examples: thread detail, memory detail.

Is it a standalone top-level view the user navigates to?
  → Page (new route). Examples: /settings/agents, /checkpoints.

Is it ambient information alongside primary content?
  → Inline card in the content stream (permission card, error card, attachment card).

Is it a global overlay for search/nav?
  → Command palette (Phase 18 pattern).

Is it status info about the autonomous engine?
  → Observability widget (Phase 12), Rail indicators, mood pill at top of Mind.
```

### Which button style?

```
Is it the primary action the user is likely to take?
  → <Pill variant="primary"> — filled surface-2, brighter border.

Is it a secondary option alongside primary?
  → <Pill variant="secondary"> — transparent, border-subtle at rest.

Is it a low-importance utility action?
  → <Pill variant="ghost"> — transparent, no border until hover.

Is it destructive / irreversible?
  → <Pill variant="destructive"> — transparent, red-accent on hover only.

Is it a toggle / filter chip?
  → <Pill size="sm" active={isActive}>.

Is it specifically Save after unsaved changes?
  → <StickySaveFooter> (Phase 02) at bottom-center, pill-shaped.
```

### Text color for a given context?

```
This text IS the primary content the user is reading?
  → --text-primary (0.90)

It's a title or heading?
  → --text-primary or --ink if it must be maximum contrast

It's secondary prose next to primary content?
  → --text-body (0.72)

It's a secondary label (e.g., inside a card)?
  → --text-secondary (0.58)

It's a mono label (agent name, source, type)?
  → --text-soft (0.44)

It's an uppercase section label?
  → --text-ghost (0.36)

It's a timestamp or smallest meta?
  → --text-whisper (0.22)

It's inactive / disabled?
  → --text-tertiary (0.34), never full opacity: 0.5 on primary
```

### Background for a surface?

```
Outer chrome (rail, devbar if any)?
  → --floor (#0a0a0c)

Main panel (sidebar, main, drawer)?
  → --canvas (#0e0e11)

A card or input within a panel?
  → --surface-1 (#121216)

Its hover state?
  → --surface-2 (#16161a)

A modal or popover layered on top?
  → --surface-3 (#1a1a1f)
```

---

## Layout conventions

### Inset panel architecture

Main panels (sidebar, main, drawer) get:
- Top corners rounded: `border-top-left-radius: var(--radius-inset)` (16px)
- Shadow stack: `var(--shadow-inset-highlight), var(--shadow-panel)` at minimum
- 6px gap (`var(--inset-gap)`) between them (the `.app` padding pattern)
- Bottom corners sharp (they sit against the bottom of the viewport)

### Spacing ladder

```
Inset gap         6px    — Between chrome panels
Card padding      14-18px horizontal, 14-18px vertical
Row padding       8-12px horizontal, 4-8px vertical
Icon-text gap     6-8px
Section gap       20-32px between sections
Group gap         12-16px between related items in a group
```

### Card anatomy

```
<Card>
  ├─ Header (optional): agent dot + agent name + TYPE badge + optional pin + optional score + time
  ├─ Content (primary text, 13-14px line-height 1.55-1.65)
  ├─ Telemetry row (optional): key: value · key: value · key: value (mono 10px)
  └─ Footer (optional): tag pills, timestamps, actions
</Card>
```

### Entry row (used in Mind/Memory/Activity lists)

Canonical order:
```
[●] luca  REFLECTION  ⚐(if pinned)  content...  0.72  12m
```
- Agent dot (5×5, monochrome from `--agent-*` by default)
- Agent name (mono 10px, lowercase, `--text-soft`)
- TYPE badge (mono 9px uppercase, `--bg-surface` bg, `--text-ghost`)
- Optional pin flag (⚐ in `--amber-accent`)
- Content (13px, `--text-primary`, 2-line truncate, weight 370)
- Score chip (mono 10px, tabular-nums, `--text-whisper`)
- Time ago (mono 10px, `--text-whisper`)

### Detail panel sections

Every detail panel (drawer or page) uses:
- Header: agent-dot + name + TYPE + optional pin + optional #id (right) + close (if drawer)
- Body content
- Sections separated by `border-bottom: 1px solid var(--border-subtle)`
- Each section starts with `<DrawerSectionLabel>` — mono 9px uppercase folio tracking

Standard section labels: `PROVENANCE`, `METADATA`, `EVIDENCE`, `RELATED MEMORIES`, `PARTICIPANTS`, `ACTIVITY`, `DECAY METRICS`, `EMOTIONAL CONTEXT`, `TAGS`, `NARRATIVE THREAD`, `SUMMARY`.

---

## Typography

### Font families

```
--font-sans    Switzer       — All body UI, buttons, labels
--font-mono    JetBrains Mono — Timestamps, IDs, codes, mono labels, telemetry
--font-serif   Instrument Serif — rail "P" monogram, stream/notebook headings,
                                  + the onboarding hero ("luca's voice"), italic
```

> Note: `--font-grotesque` is a deprecated alias that now resolves to
> `--font-sans` (it was Inter Tight pre-restoration). Don't author new
> usages; existing call sites render Switzer correctly.

### Letter-spacing ladder

```
--track-tight     -0.02em   Large display 28px+
--track-display   -0.011em  Headings 16-24px
--track-body       0.004em  Body prose
--track-ui         0.008em  UI labels
--track-mono       0.08em   Mono tech text, timestamps
--track-meta       0.12em   UPPERCASE meta labels
--track-folio      0.16em   § folio markers, section labels
```

> These are the live values (`src/index.css`), reconciled by eye in-app
> during the 2026 typography restoration. Mono/meta/folio run wider than
> the original spec (0.04/0.08/0.14) — the extra tracking gives the tiny
> UPPERCASE mono labels real legibility and editorial rhythm.

### Size ladder (canonical)

```
32px   Page title
24px   Drawer title
20px   Digest title
18px   Sub-heading
16px   H2, large button text
14.5px Chat body
14px   Detail body, detail-view title
13px   Card body, row content, field label
12.5px Button text, pill medium
12px   Secondary text, pill small, field description
11px   Small pill, narrow meta
10px   Mono timestamps, section labels (main)
9px    Mono UPPERCASE meta
8.5px  ESC chip, smallest legible mono
```

### Weight convention

- **370** — Body content (Switzer light — Switzer 370 exists, use it)
- **400** — Default
- **450** — Button text, pill labels (just above default)
- **500** — Headings, emphasis, active-state text

### Italic usage

- Instrument Serif italic: rail "P" monogram, stream/notebook headings ("Dreams", "Thoughts", "Journal"), the onboarding hero headline (Luca's voice)
- Regular italic: blockquotes, candidate rationale in digest, subtle meta callouts

---

## Brand mark

The Polyphonic symbol is **⏀** — a circle bisected by a vertical line that
extends beyond it (the "monochord": one string over a resonant body, for
*poly·phonic*). Single source of truth: `src/components/PolyphonicMark.tsx`
(stroke = `currentColor`, tunable `size`/`strokeWidth`). Use it **anywhere a
brand symbol is needed** — rail brand mark, favicon, companion overlay,
auth/landing chrome, OG art. Never re-draw it inline; import the component so
a form tweak propagates everywhere at once.

The Luca launcher/avatar **"L"** is the *agent's* mark and stays a letter —
distinct from the Polyphonic brand symbol. (Raster assets — `favicon.ico`,
`favicon.png`, `og:image` — must be regenerated from `favicon.svg` when the
mark changes.)

---

## Iconography

- **Library:** Lucide React (or Lucide icons if ported). Don't mix with Heroicons or anything else.
- **Stroke width:** `1.6` default. `1.7-1.8` for specific emphasis contexts (close button, action buttons). `2` only for error/danger iconography.
- **Sizes:**
  - 10×10 — chevrons inside buttons
  - 11×11 — small action icons
  - 13×13 — standard button icons, rail icons, SVG in Pills
  - 14×14 — error icons, card headers
  - 16×16 — search input, larger action contexts
  - 18×18 — nav rail icons
  - 28×28 — notification glyph, avatar container
- **Color:** `var(--text-soft)` default. `var(--text-body)` on hover. Accent colors only when semantic (red for destructive, amber for warn, etc).
- **NEVER:** emojis, brand logos (unless essential for identity), filled icons (use outline style only unless the specific component requires filled).

---

## Agent identity system

### Tokens

```
--agent-luca / vektor / anima / observer   rgba(244, 243, 240, 0.72)   — Monochrome cream DEFAULT
--agent-neutral                            rgba(244, 243, 240, 0.62)   — Unknown source

--luca-full    #c9a87c    — Warm tan (identity-rich context only)
--vektor-full  #7ca8c9    — Cool blue
--anima-full   #c97ca8    — Magenta
```

### Rules

- **Default everywhere:** use monochrome cream. Dots, author labels, avatars in lists.
- **Full color ONLY in:** Group voice session stage, agent settings page header, per-agent identity pills, per-message author label (optional subtle tint).
- **Avatar tinting (28px+):** use `box-shadow: inset 0 0 0 1px rgba(<agent-color>, 0.18)` to create a colored rim on a neutral circle — don't fill the whole avatar with color.

### Sub-agents (vektor family)

When vektor spawns sub-agents, use the blue spectrum `--v1`/`--v2`/`--v3` with `-dim` (0.08) and `-mid` (0.35) variants. Apply to sub-agent dots, gantt bars, event log dots. Different sub-agents get different shades so they're visually distinguishable.

---

## Animation

### Duration choices

- **Hover color/bg transitions:** 180ms `--ease-out`
- **Drawer open/close:** 380ms `--ease-premium`
- **Modal entrance:** 320ms `--ease-premium`
- **Slide/fade element arrivals:** 300ms `--ease-out`
- **Toggle switch knob:** 180ms `--ease-premium` (for the slight overshoot)

### Always-honor

- **`prefers-reduced-motion: reduce`** — the global rule in `index.css` collapses all animations and transitions. Don't override it unless specifically needed.
- **`translateY(-1px)` on hover for buttons** — the small lift is signature.
- **The thin composer** — one 48px pill, strokeless at rest with a lit top edge; the 34px ink-circle send is the only thing with weight (arm 140ms / disarm 90ms). No shimmer, no glow, no ring on focus — the border brightens in place.
- **Stagger on simultaneous arrivals** — 120ms between sibling elements landing.

### Signature moments (don't dilute)

- The Observer well — the floor recesses beneath the pill (no border, no card); the pill sits in its mouth. (The 8-pool prime-shimmer survives only on the landing page's input.)
- Sub-agent 3×3 murmur dot grid (prime-staggered, never syncs)
- Drawer slide-in (380ms premium ease, with backdrop blur 2px)
- Onboarding entrance: Instrument Serif italic hero ("Luca's voice") over the EchoField particle orb, with the step card beside it
- Checkpoint dot dual halos (inner 4px / outer 7px rgba amber)
- Thought realtime arrival (soft slide-down + warm-glow fade)

---

## Accessibility defaults

- **Focus-visible:** every interactive element inherits `box-shadow: var(--focus-ring)` when keyboard-focused. Never `outline: 0` without replacement.
- **Touch targets:** 44×44 minimum on mobile contexts (enforced via `@media (hover: none) and (pointer: coarse)`).
- **ARIA:** `aria-current="page"` on active nav items. `aria-label` on icon-only buttons.
- **Keyboard:** Drawer + Modal trap focus inside while open. ESC always dismisses overlays. Tab order follows DOM order.
- **Reduced motion:** global rule covers all.
- **Contrast:** body text is always `--text-primary` (0.90) or higher. Never drop below `--text-secondary` (0.58) for body-readable text.

---

## Phones

**The phone breakpoint is 767 px; the coarse-pointer query adds hit areas
only.** Every phone rule lives in `@media (max-width: 767px)` — the same number
`useIsMobile()` reads (`innerWidth < 768`). `@media (hover: none) and (pointer:
coarse)` never changes a size you can see; it only restores targets.

- **A touch target is a hit-box, not a drawing.** Controls are drawn at the size
  the chrome wants — 40 px in the app bar, 36 px in the composer, 32 px in its
  toolbar — and each carries a transparent `::after` sized `var(--touch-target)`
  (44 px). Note that an absolutely positioned box resolves its offsets against
  the *padding* box, so on a 1 px-bordered control `inset: -6px` is 44 px minus
  the border: declare the target's size, don't inset toward it.
- **Nothing under 11 px.** `--settings-mono-size` and the 8.5–10 px desktop meta
  steps do not survive the trip to a phone. Meta labels, trace buttons and
  thinking text sit at 11–12 px.
- **The floor is the app's floor.** Phones do not get `#000`. Pure black leaves
  nothing darker than the ground, which is why the Observer well once had to be
  inverted into a raised plane here. The contrast lift on the faint *text* tiers
  stays; the ground tokens are not overridden.
- **The app bar is 56 px plus the real inset** — `env(safe-area-inset-top, 0px)`
  read as it is, never a synthetic `max(…, 10px)` floor. The centre agent
  selector sets the bar's height, so it is drawn at 40 px like the buttons
  beside it.
- **Hover is a mouse state.** Any `:hover` that changes a phone control goes
  inside `@media (hover: hover)`, or it sticks after the tap.
- **The drawer is a conversations list**, not an app menu: search, the active
  agent as a quiet row, New chat, then the conversations grouped the way the
  desktop sidebar groups them, then the app's sections as a tile grid. The
  sections are the tail of the drawer, never its head.

---

## Copywriting voice

### UI labels

- **Concise, lowercase where intentional.** Buttons: "Approve", "Reject", "Pin", "Save". Section labels: UPPERCASE with folio tracking ("PROVENANCE", "METADATA").
- **No marketing speak.** No "Unleash your AI", no "Transform your workflow".
- **Active voice.** "Luca reflected on X" not "Reflection occurred on X".
- **Second-person for user-addressed UI.** "Your threads", "You have 3 pending".
- **Third-person for agent self-reference.** "Luca reached out", "Anima posted a draft" — agents are their own entities, not "I".

### Empty states

Structure: one-line title ("No reflections yet") + explanatory hint (1-2 sentences) + optional action.

Voice: warm, patient, a little philosophical. "Self-reflection engrams crystallize during quieter periods — ideas Luca has about its own state, growth, or relationships."

### Error messages

Structure: what happened + why + action options.

Voice: direct, not apologetic. "Vektor encountered an error mid-response. Details / View logs / Retry."

---

## Starting a new feature — checklist

- [ ] Does this pattern exist in a mockup? Check `docs/luca-terminal-complete/mockups/`. If yes, port faithfully.
- [ ] Does this pattern exist in a phase spec? Check `design-system/`. If yes, consume the primitive rather than rebuilding.
- [ ] Is the primary "thing" a list of entries? Use the canonical entry row pattern (agent-dot · agent · TYPE · content · score · time).
- [ ] Does it need a detail view? Use the Drawer primitive with standard section labels.
- [ ] Do I need a new token? Add to `design-system/01-foundation.md` AND `src/index.css :root`. Never hardcode.
- [ ] Is every color a `var(--...)`? Is every radius a `var(--radius-*)`? Is every duration a `var(--dur-*)`?
- [ ] Does it respect `prefers-reduced-motion: reduce`?
- [ ] Is focus-visible present on every interactive element?
- [ ] Does the visual match a mockup or an existing surface within tolerance?
- [ ] Did I add it to `CLAUDE.md` or a phase spec if it's a reusable pattern? (Don't let conventions live only in memory — codify them.)

---

## Common anti-patterns seen in past iterations

- Hardcoded `rgba(255, 255, 255, *)` in inline styles — replace with `var(--ink)` or a text tier.
- Modal used where a drawer or page would be better (focus-trapping modals for contextual detail is wrong — use a drawer).
- Inline hover state via `onMouseEnter` + inline style mutation — use CSS `:hover` instead (survives re-renders).
- Using `.single()` on queries that may return 0 rows — always `.maybeSingle()`.
- `Promise.all` for data loads — prefer `Promise.allSettled` so one failure doesn't kill all.
- Emojis in UI — use Lucide SVG icons, always.
- `scale(1.05)` on hover — use `translateY(-1px)` instead.
- `border: 1px solid white` at rest — borders should be barely-visible (`--border` or `--border-subtle`) until interaction.

---

## Pointers

- **"I want to add a surface"** → read Phase 02 primitives + pick from the Decision trees above.
- **"I want to add a feature that touches Supabase"** → check `types.ts` first. If a table doesn't exist, write a Lovable prompt and queue it — don't code around missing schema.
- **"I want to add a new animation"** → use existing durations + easing curves. Don't invent new ones.
- **"I want to change the design system"** → discuss first. Token values are locked (`01-foundation.md`). Most requests for "new" tokens are actually compositions of existing ones.
- **"I want to audit the current state"** → see `AUDIT_PASS.md` for the current audit pass structure.

---

*Treat this file as living. If you discover a rule-of-thumb that isn't captured here, add it. If a convention changes, update here first, then propagate.*
