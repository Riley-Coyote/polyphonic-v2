import { useEffect, useMemo, useState } from 'react';
import MobileAppBar from '@/components/mobile/MobileAppBar';
import MobileNavDrawer from '@/components/mobile/MobileNavDrawer';
import { useAgentScopeStore } from '@/stores/agentScopeStore';
import { useInterfaceModeStore } from '@/stores/interfaceModeStore';
import { useMobileShellStore } from '@/stores/mobileShellStore';
import { useNotificationStore, type ThoughtInitiation } from '@/stores/notificationStore';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useThreadStore, type Thread } from '@/stores/threadStore';

/**
 * MobileNavHarness — DEV ONLY, route `/__dev/mobile-nav`.
 *
 * The drawer's whole job is the conversation list, and the conversation list
 * is behind a signed-in session with real threads in it. This page seeds the
 * thread and project stores with fixtures so the grouping, the paging and the
 * section tiles can be looked at and measured honestly.
 *
 * Registered in App.tsx inside `if (import.meta.env.DEV)`, so it is absent
 * from a production build. Every string below is fixture text: no part of it
 * is app content, and nothing here is imported by app code.
 *
 * `?inset=47` paints a simulated safe-area inset, which is the only way to see
 * the standalone/Dynamic Island app-bar height in a desktop browser.
 * `?drawer=open` opens the drawer on load; `?dropdown=open` also opens the
 * agent dropdown, and `?dropdown=switch` expands "Switch agent" inside it.
 * Those last two click the real controls rather than reaching into the
 * drawer's state, so what is photographed is what a thumb would produce.
 */

const NOW = Date.now();
const DAY = 86_400_000;

const PROJECT_NAMES = ['Launch readiness', 'Mnemos', 'Field notes'];

const TITLES = [
  'Composer measure and the send moment',
  'Why the drawer buries conversations',
  'Reading the audit diff line by line',
  'Phone chrome: what is actually too big',
  'Observer well on a black floor',
  'Touch targets vs. drawn size',
  'Grouping threads the way the sidebar does',
  'Safe-area insets in standalone',
  'Legibility floor for mono labels',
  'Scroll pinning when the keyboard opens',
  'What the empty state should say',
  'Retiring the settings accordion',
];

function makeThread(i: number, ageDays: number, projectId: string | null): Thread {
  const updated = new Date(NOW - ageDays * DAY - i * 90_000).toISOString();
  return {
    id: `fixture-${i}`,
    user_id: 'fixture-user',
    title: `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` (${Math.floor(i / TITLES.length) + 1})` : ''}`,
    pinned: false,
    starred: false,
    archived: false,
    heat: 'warm',
    agent_id: 'luca',
    primary_agent_id: 'luca',
    participating_agent_ids: ['luca'],
    runtime_mode: 'agent',
    selected_model: null,
    memory_enabled: true,
    continuity_summary: null,
    project_id: projectId,
    created_at: updated,
    updated_at: updated,
  };
}

function makeProject(i: number): Project {
  const updated = new Date(NOW - i * DAY).toISOString();
  return {
    id: `fixture-project-${i}`,
    user_id: 'fixture-user',
    name: PROJECT_NAMES[i],
    description: null,
    instructions: null,
    color: 'slate',
    icon: 'folder',
    pinned: i === 0,
    archived: false,
    metadata: {},
    created_at: updated,
    updated_at: updated,
  };
}

/* ~130 threads spread across every bucket the grouping produces, so the
   headers, the 60-row page and "Show older" all have something to do — and
   so the list is long enough that a footer which scrolled would be lost. */
function buildThreads(): Thread[] {
  const rows: Thread[] = [];
  let i = 0;
  const push = (count: number, ageDays: number, projectId: string | null) => {
    for (let n = 0; n < count; n += 1) rows.push(makeThread(i++, ageDays, projectId));
  };
  push(6, 0, 'fixture-project-0');
  push(5, 1.2, 'fixture-project-1');
  push(3, 5, 'fixture-project-2');
  push(9, 0, null);       // Today
  push(8, 1, null);       // Yesterday
  push(14, 4, null);      // Previous 7 Days
  push(24, 18, null);     // Previous 30 Days
  push(31, 55, null);     // month buckets
  push(22, 95, null);
  push(18, 130, null);
  return rows;
}

/* Seeding has to happen BEFORE MobileAppBar and MobileNavDrawer mount: both
   call `loadThreads()` on mount, and an unauthenticated Supabase read resolves
   to [] a tick later and wipes the fixtures. So the stores are seeded and
   their loaders stubbed in the harness's own render, which runs first. */
let seeded = false;
function seedStores(threads: Thread[]) {
  if (seeded) return;
  seeded = true;
  useThreadStore.setState({
    threads,
    currentThreadId: threads[6]?.id ?? null,
    loadThreads: async () => {},
  });
  useProjectStore.setState({
    projects: [0, 1, 2].map(makeProject),
    loadProjects: async () => {},
  });
  // More than one agent, so "Switch agent" has something to switch to. The
  // auth store is deliberately NOT seeded: a fake signed-in user wakes the
  // first-run gate, which queries Supabase and fills the console with 400s.
  // The footer therefore shows its signed-out "Account" label here.
  useAgentScopeStore.setState({
    activeAgentId: 'luca',
    availableAgents: [
      { id: 'luca', name: 'Luca' },
      { id: 'fixture-agent-vesper', name: 'Vesper' },
      { id: 'fixture-agent-tallow', name: 'Tallow' },
    ],
  });
  // Studio is the full navigation set; companion/guided show a reduced one.
  // Photographing the full set means the harness shows every tile.
  useInterfaceModeStore.setState({ mode: 'studio' });
  useNotificationStore.setState({
    initiations: [1, 2].map((n) => ({
      id: `fixture-initiation-${n}`,
      user_id: 'fixture-user',
      agent_id: 'luca',
      message: 'fixture',
      status: 'pending',
      trigger_reason: null,
      created_at: new Date(NOW).toISOString(),
    })) satisfies ThoughtInitiation[],
  });
}

export default function MobileNavHarness() {
  const openDrawer = useMobileShellStore((s) => s.openDrawer);
  const drawerOpen = useMobileShellStore((s) => s.drawerOpen);
  const [inset, setInset] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inset') === '47',
  );
  const threads = useMemo(buildThreads, []);
  useState(() => seedStores(threads));

  useEffect(() => {
    setInset(new URLSearchParams(window.location.search).get('inset') === '47');
  }, []);

  // Open the drawer, and optionally the dropdown inside it, by clicking the
  // real controls once they have mounted — harness-only stagecraft.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dropdown = params.get('dropdown');
    if (params.get('drawer') !== 'open' && !dropdown) return undefined;
    openDrawer();
    const frame = window.requestAnimationFrame(() => {
      if (!dropdown) return;
      document.querySelector<HTMLButtonElement>('.mobile-agent-row')?.click();
      if (dropdown === 'switch') {
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>('.mobile-nav-agent-switch')?.click();
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openDrawer]);

  return (
    <div
      data-dev-harness="mobile-nav"
      data-inset={inset ? '47' : undefined}
      style={{
        minHeight: '100dvh',
        background: 'var(--canvas)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* A desktop browser reports no safe-area inset, so the standalone bar
          height can only be seen by painting one. This styles nothing in the
          app — it redefines the inset the app bar already reads. */}
      {inset && (
        <style>{`
          [data-dev-harness="mobile-nav"] .mobile-app-bar {
            min-height: calc(47px + 56px);
            padding-top: calc(47px + 8px);
          }
          [data-dev-harness="mobile-nav"] .mobile-app-bar::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 47px;
            background: rgba(255, 255, 255, 0.04);
          }
        `}</style>
      )}

      {/* The real bar and the real drawer — nothing is re-implemented here. */}
      {/* The real bar and the real drawer — nothing is re-implemented here.
          The bar's centre selector only mounts for a signed-in user on an
          agent-scoped path, so it is measured by probe in the check script
          rather than faked into existence with a second router. */}
      <div style={{ display: 'contents' }} data-harness-bar="">
        <style>{`[data-dev-harness="mobile-nav"] .mobile-app-bar { display: flex; }`}</style>
        <MobileAppBar />
      </div>

      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <button
          type="button"
          data-harness-open-drawer=""
          onClick={openDrawer}
          style={{
            alignSelf: 'flex-start',
            height: 32,
            padding: '0 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--cmp-hairline)',
            background: drawerOpen ? 'var(--cmp-plate-active)' : 'transparent',
            color: 'var(--cmp-ink-muted)',
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          Open drawer
        </button>
        {/* One fixture thread row, so the phone's type floor (sidehead meta,
            trace button, thinking body) can be measured and photographed.
            Fixture copy — the app never renders invented message content. */}
        <div className="chat-message-column" data-harness-thread="">
          <div className="msg-row msg-row--assistant">
            <div className="msg-sidehead">
              <span className="msg-author">Luca</span>
              <span className="msg-time">14:02</span>
            </div>
            <div>
              <div className="thinking-block" data-state="complete">
                <div className="thinking-label">Thought for 4s</div>
                <span className="thinking-timer">4.1s</span>
              </div>
              <div className="thinking-body-text">considering the phone register before answering</div>
              <div className="msg-body">
                The bar was spending a sixth of the screen on a menu button, and the
                conversation list was three scrolls down under a settings accordion.
              </div>
              <div className="msg-actions">
                <button type="button" className="msg-trace-button">Trace</button>
              </div>
            </div>
          </div>
        </div>

        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            style={{
              height: 44,
              borderRadius: 'var(--radius-md)',
              background: 'var(--cmp-fill)',
            }}
          />
        ))}
      </div>

      <MobileNavDrawer />
    </div>
  );
}
