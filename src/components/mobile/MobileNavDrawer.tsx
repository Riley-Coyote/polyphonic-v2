import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Archive,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Folder,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useAgentScopeStore } from '@/stores/agentScopeStore';
import { useAuthStore } from '@/stores/authStore';
import { useDrawerStore } from '@/stores/drawerStore';
import { useInterfaceModeStore } from '@/stores/interfaceModeStore';
import { useMobileShellStore } from '@/stores/mobileShellStore';
import { useNotificationStore, selectPendingInitiationsCount } from '@/stores/notificationStore';
import { useThreadStore, type Thread } from '@/stores/threadStore';
import { useProjectStore, sortProjects, threadsForProject } from '@/stores/projectStore';
import { groupThreadsByDate, type ThreadGroup } from '@/lib/threadGrouping';
import { shouldShowStudioNavigation } from '@/lib/interfaceMode';

/* Three regions: a pinned header, a scrolling conversation list, a pinned
   footer. The drawer IS the conversation list — with many chats, anything
   parked under it is unreachable, so the account and the app's own surfaces
   sit in a footer that never scrolls away.

   Memory, Mind and Journal are the *agent's* pages, so they live inside the
   agent dropdown next to "Switch agent" rather than in a tile grid: which
   memory you are looking at depends on whose it is. */
const STUDIO_AGENT_PAGES = [
  { label: 'Memory', path: '/memory', icon: Archive },
  { label: 'Mind', path: '/mind', icon: Brain },
  { label: 'Journal', path: '/journal', icon: NotebookPen },
];

// Companion + guided mirror the desktop Rail's reduced surface set. Notebook
// points at /notebook directly so the URL, row label and page header agree.
const SIMPLE_AGENT_PAGES = [
  { label: 'Notebook', path: '/notebook', icon: NotebookPen },
  { label: 'Memory', path: '/memory', icon: Archive },
  { label: 'Agents', path: '/settings/agents', icon: Bot },
];

// One page of conversations. A phone list this long is already a scroll; the
// rest arrives on request rather than on open.
const THREAD_PAGE = 60;

function isActiveRoute(pathname: string, path: string): boolean {
  if (path === '/settings/agents') return pathname.startsWith('/settings/agents');
  if (path === '/settings') return pathname.startsWith('/settings');
  return pathname === path || pathname.startsWith(`${path}/`);
}

function filteredThreads(threads: Thread[], query: string): Thread[] {
  const q = query.trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((thread) => (thread.title || 'New conversation').toLowerCase().includes(q));
}

export default function MobileNavDrawer() {
  const open = useMobileShellStore((s) => s.drawerOpen);
  const close = useMobileShellStore((s) => s.closeDrawer);
  const drawerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const threads = useThreadStore((s) => s.threads);
  const currentThreadId = useThreadStore((s) => s.currentThreadId);
  const loadThreads = useThreadStore((s) => s.loadThreads);
  const createThread = useThreadStore((s) => s.createThread);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const openContextDrawer = useDrawerStore((s) => s.open);
  const closeContextDrawer = useDrawerStore((s) => s.close);
  const pendingCount = useNotificationStore(selectPendingInitiationsCount);
  const activeAgentId = useAgentScopeStore((s) => s.activeAgentId);
  const availableAgents = useAgentScopeStore((s) => s.availableAgents);
  const setActiveAgent = useAgentScopeStore((s) => s.setActiveAgent);
  const interfaceMode = useInterfaceModeStore((s) => s.mode);
  const [query, setQuery] = useState('');
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [switchAgentOpen, setSwitchAgentOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(THREAD_PAGE);
  const activeAgentName = useMemo(
    () => availableAgents.find((agent) => agent.id === activeAgentId)?.name ?? 'Luca',
    [activeAgentId, availableAgents],
  );
  const agentPages = shouldShowStudioNavigation(interfaceMode) ? STUDIO_AGENT_PAGES : SIMPLE_AGENT_PAGES;

  useEffect(() => {
    if (!open) return;
    void loadThreads();
    void loadProjects();
  }, [loadProjects, loadThreads, open]);

  useEffect(() => {
    close();
  }, [close, location.pathname]);

  // The dropdown is a state of an open drawer, not something that survives it.
  useEffect(() => {
    if (open) return;
    setAgentMenuOpen(false);
    setSwitchAgentOpen(false);
  }, [open]);

  // A new search is a new list — page back to the first 60 rows.
  useEffect(() => { setVisibleCount(THREAD_PAGE); }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleEscape = useCallback(() => {
    // Esc closes the dropdown first, the drawer second.
    if (agentMenuOpen) {
      setAgentMenuOpen(false);
      setSwitchAgentOpen(false);
      return;
    }
    close();
  }, [agentMenuOpen, close]);
  useDialogFocus({
    active: open,
    containerRef: drawerRef,
    initialFocusRef: searchRef,
    onEscape: handleEscape,
  });

  const visible = useMemo(() => filteredThreads(threads, query), [query, threads]);

  // Projects own their threads, exactly as the desktop sidebar has it: a
  // thread inside a project appears under its project and nowhere else.
  const projectGroups = useMemo(() => {
    const eligible = projects.filter((p) => !p.archived);
    return sortProjects(eligible)
      .map((project) => ({ project, threads: threadsForProject(visible, project.id) }))
      .filter((entry) => entry.threads.length > 0);
  }, [projects, visible]);

  const dateGroups: ThreadGroup[] = useMemo(
    () => groupThreadsByDate(visible.filter((t) => !t.project_id)),
    [visible],
  );

  // The page budget is spent across the whole list, project rows first, so
  // "Show older" always reveals the next 60 rows wherever they fall.
  const totalRows =
    projectGroups.reduce((n, entry) => n + entry.threads.length, 0) +
    dateGroups.reduce((n, group) => n + group.threads.length, 0);
  const hasMore = totalRows > visibleCount;
  // The projects page has no other door on a phone, so its header stands even
  // with nothing under it — except while searching, where an empty group head
  // would be a lie about the results.
  const showProjectsHead = projectGroups.length > 0 || !query.trim();

  const take = (rows: Thread[], spent: number): Thread[] =>
    rows.slice(0, Math.max(0, visibleCount - spent));

  const go = (path: string) => {
    navigate(path);
    close();
  };

  const handleNewChat = async () => {
    if (!user) return;
    const id = await createThread(user.id);
    navigate(`/chat/${id}`);
    close();
  };

  const handleOpenActivity = () => {
    closeContextDrawer();
    openContextDrawer('notifications');
    close();
  };

  // Choosing an agent re-points the pages above it; the dropdown stays open so
  // the row label can be seen to change and Memory is one tap away.
  const handleSelectAgentScope = (id: string) => {
    if (!id) return;
    if (id !== activeAgentId) setActiveAgent(id);
  };

  const handleSignOut = async () => {
    await signOut();
    close();
    navigate('/', { replace: true });
  };

  const renderThreadRow = (thread: Thread) => (
    <button
      key={thread.id}
      type="button"
      className="mobile-thread-row"
      data-active={thread.id === currentThreadId ? 'true' : undefined}
      aria-current={thread.id === currentThreadId ? 'page' : undefined}
      onClick={() => go(`/chat/${thread.id}`)}
    >
      <span className="mobile-thread-title">{thread.title || 'New conversation'}</span>
    </button>
  );

  let spent = 0;

  return (
    <>
      <div
        className="mobile-nav-backdrop"
        data-open={open ? 'true' : undefined}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className="mobile-nav-drawer"
        data-open={open ? 'true' : undefined}
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-hidden={!open}
        aria-label="Mobile navigation"
        tabIndex={-1}
      >
        <div className="mobile-nav-top">
          <div className="mobile-nav-brand">
            <Sparkles size={18} strokeWidth={1.7} />
            <span>Polyphonic</span>
          </div>
          <button type="button" className="mobile-nav-icon-btn" onClick={close} aria-label="Close navigation menu">
            <X size={20} strokeWidth={1.7} />
          </button>
        </div>

        <label className="mobile-nav-search">
          <Search size={17} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </label>

        <div className="mobile-nav-scroll">
          {/* The active agent is context, not a feature. One dot, one name, one
              chevron — and behind the chevron, the pages that belong to it. */}
          <section className="mobile-agent-scope" aria-label="Agent scope">
            <button
              type="button"
              className="mobile-agent-row"
              onClick={() => {
                setAgentMenuOpen((value) => {
                  if (value) setSwitchAgentOpen(false);
                  return !value;
                });
              }}
              aria-expanded={agentMenuOpen}
            >
              <span className="mobile-agent-row-dot" aria-hidden="true" />
              <span className="mobile-agent-row-name">{activeAgentName}</span>
              <ChevronDown
                className="mobile-agent-row-chevron"
                size={12}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{ transform: agentMenuOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            <div className="mobile-nav-agent-menu" data-open={agentMenuOpen ? 'true' : undefined}>
              <div className="mobile-nav-agent-menu-clip">
                <div className="mobile-nav-agent-menu-inner">
                  {agentPages.map(({ label, path, icon: Icon }) => (
                    <button
                      key={path}
                      type="button"
                      className="mobile-nav-agent-page"
                      data-active={isActiveRoute(location.pathname, path) ? 'true' : undefined}
                      onClick={() => go(path)}
                      aria-current={isActiveRoute(location.pathname, path) ? 'page' : undefined}
                    >
                      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}

                  <div className="mobile-nav-agent-rule" aria-hidden="true" />

                  <button
                    type="button"
                    className="mobile-nav-agent-switch"
                    onClick={() => setSwitchAgentOpen((value) => !value)}
                    aria-expanded={switchAgentOpen}
                  >
                    <span>Switch agent</span>
                    <ChevronRight
                      className="mobile-nav-agent-switch-chevron"
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      style={{ transform: switchAgentOpen ? 'rotate(90deg)' : 'none' }}
                    />
                  </button>

                  {switchAgentOpen && (
                    <div className="mobile-agent-scope-list" role="listbox" aria-label="Choose active agent">
                      {availableAgents.map((agent) => {
                        const active = agent.id === activeAgentId;
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            className="mobile-agent-scope-option"
                            data-active={active ? 'true' : undefined}
                            onClick={() => handleSelectAgentScope(agent.id)}
                            role="option"
                            aria-selected={active}
                          >
                            <span className="mobile-agent-scope-option-dot" aria-hidden="true" />
                            <span>{agent.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <button type="button" className="mobile-nav-primary" onClick={handleNewChat}>
            <Plus size={18} strokeWidth={1.8} />
            <span>New chat</span>
          </button>

          <div className="mobile-nav-threads">
            {totalRows === 0 && (
              <div className="mobile-nav-empty">
                {query.trim() ? 'No matching conversations.' : 'No conversations yet.'}
              </div>
            )}

            {showProjectsHead && (
              <div className="mobile-nav-projects-head">
                <Folder size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>Projects</span>
                <button
                  type="button"
                  className="mobile-nav-projects-all"
                  onClick={() => go('/projects')}
                  aria-label="All projects"
                >
                  <span>All</span>
                  <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            )}

            {projectGroups.map(({ project, threads: projectThreads }) => {
              const rows = take(projectThreads, spent);
              spent += rows.length;
              if (rows.length === 0) return null;
              const isCollapsed = !!collapsedProjects[project.id];
              return (
                <div key={project.id} className="mobile-nav-group">
                  <button
                    type="button"
                    className="mobile-nav-group-head"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedProjects((prev) => ({ ...prev, [project.id]: !prev[project.id] }))
                    }
                  >
                    <span>{project.name}</span>
                    <ChevronRight
                      className="mobile-nav-group-chevron"
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)' }}
                    />
                  </button>
                  {!isCollapsed && rows.map(renderThreadRow)}
                </div>
              );
            })}

            {dateGroups.map((group) => {
              const rows = take(group.threads, spent);
              spent += rows.length;
              if (rows.length === 0) return null;
              return (
                <div key={group.key} className="mobile-nav-group">
                  <div className="mobile-nav-group-label">{group.label}</div>
                  {rows.map(renderThreadRow)}
                </div>
              );
            })}

            {hasMore && (
              <button
                type="button"
                className="mobile-nav-more"
                onClick={() => setVisibleCount((n) => n + THREAD_PAGE)}
              >
                Show older
              </button>
            )}
          </div>
        </div>

        {/* The footer is pinned: with two hundred conversations above it, an
            account row that scrolls is an account row you cannot reach. */}
        <div className="mobile-nav-footer">
          <div className="mobile-nav-footer-account">
            <button
              type="button"
              className="mobile-nav-footer-identity"
              data-active={isActiveRoute(location.pathname, '/profile') ? 'true' : undefined}
              onClick={() => go('/profile')}
              aria-current={isActiveRoute(location.pathname, '/profile') ? 'page' : undefined}
            >
              <User size={18} strokeWidth={1.7} aria-hidden="true" />
              <span className="mobile-nav-footer-email">{user?.email || 'Account'}</span>
            </button>
            <button type="button" className="mobile-nav-footer-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          <div className="mobile-nav-footer-actions">
            <button
              type="button"
              className="mobile-nav-footer-btn"
              onClick={handleOpenActivity}
              aria-label="Activity"
            >
              <Activity size={18} strokeWidth={1.7} aria-hidden="true" />
              {pendingCount > 0 && <span className="mobile-nav-count">{pendingCount}</span>}
            </button>
            <button
              type="button"
              className="mobile-nav-footer-btn"
              data-active={isActiveRoute(location.pathname, '/settings') ? 'true' : undefined}
              onClick={() => go('/settings')}
              aria-label="Settings"
              aria-current={isActiveRoute(location.pathname, '/settings') ? 'page' : undefined}
            >
              <Settings size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
