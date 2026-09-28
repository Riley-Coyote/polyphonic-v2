type RouteLoader = () => Promise<unknown>;

const prefetched = new Map<string, Promise<unknown>>();

const routeLoaders: Record<string, RouteLoader> = {
  '/chat': () => import('@/pages/ChatView'),
  '/groups': () => import('@/pages/GroupsView'),
  '/memory': () => import('@/pages/MemoryView'),
  '/research': () => import('@/pages/ResearchView'),
  '/mind': () => import('@/pages/MindView'),
  '/journal': () => import('@/pages/JournalView'),
  '/import': () => import('@/pages/ImportView'),
  '/projects': () => import('@/pages/ProjectsView'),
  '/profile': () => import('@/pages/ProfileView'),
  '/settings/agents': () => import('@/pages/settings/AgentsList'),
  '/settings/general': () => import('@/pages/settings/GeneralSettings'),
  '/settings/models': () => import('@/pages/settings/ModelsSettings'),
  '/settings/appearance': () => import('@/pages/settings/AppearanceSettings'),
  '/settings/skills': () => import('@/pages/ProfileSkillsView'),
  '/settings/routines': () => import('@/pages/ProfileScheduleView'),
  '/settings/voice': () => import('@/pages/settings/VoiceSettings'),
  '/settings/local-runtime': () => import('@/pages/settings/LocalRuntimeSettings'),
  '/settings/connected-apps': () => import('@/pages/settings/ConnectedAppsSettings'),
  '/settings/portability': () => import('@/pages/ImportView'),
  '/settings/account': () => import('@/pages/settings/AccountSettings'),
  '/settings/help': () => import('@/pages/settings/HelpGuide'),
};

const coreSettingsPaths = [
  '/settings/agents',
  '/settings/general',
  '/settings/models',
  '/settings/appearance',
  '/settings/skills',
  '/settings/routines',
  '/settings/local-runtime',
  '/settings/portability',
  '/settings/account',
  '/settings/help',
];

function normalizedPath(path: string): string | null {
  if (path.startsWith('/chat/')) return '/chat';
  if (path.startsWith('/groups/')) return '/groups';
  if (path.startsWith('/projects/')) return '/projects';
  if (path.startsWith('/settings/agents/')) return '/settings/agents';
  const match = Object.keys(routeLoaders)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
  return match ?? null;
}

function scheduleIdle(task: () => void) {
  if (typeof window === 'undefined') return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(task, { timeout: 1000 });
    return;
  }
  w.setTimeout(task, 80);
}

export function prefetchRoute(path: string) {
  if (typeof window === 'undefined') return;
  const key = normalizedPath(path);
  if (!key || prefetched.has(key)) return;
  const loader = routeLoaders[key];
  if (!loader) return;

  const request = loader().catch((error) => {
    prefetched.delete(key);
    if (import.meta.env.DEV) {
      console.warn(`[route-prefetch] ${key}`, error);
    }
  });
  prefetched.set(key, request);
}

export function prefetchCoreSettingsRoutes() {
  scheduleIdle(() => {
    for (const path of coreSettingsPaths) {
      prefetchRoute(path);
    }
  });
}

// Keep eager shell prefetch light. Heavy diagnostic routes still warm on
// hover/focus, but should not be parsed during the first companion/chat session.
const lightPrimaryNavPaths = [
  '/chat',
  '/groups',
  '/research',
  '/journal',
  '/settings/agents',
];

const heavyPrimaryNavPaths = [
  '/memory',
  '/mind',
  '/projects',
  '/profile',
];

function isConstrainedClient() {
  if (typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return window.matchMedia('(max-width: 767px)').matches || Boolean(nav.connection?.saveData);
}

export function prefetchPrimaryNavRoutes(options: { includeHeavy?: boolean } = {}) {
  scheduleIdle(() => {
    const paths = options.includeHeavy && !isConstrainedClient()
      ? [...lightPrimaryNavPaths, ...heavyPrimaryNavPaths]
      : lightPrimaryNavPaths;
    for (const path of paths) {
      prefetchRoute(path);
    }
  });
}

export const navigationAuditRoutes = {
  rail: ['/chat', '/groups', '/memory', '/research', '/mind', '/journal', '/import', '/projects', '/profile', '/settings/help', '/settings/agents'],
  settings: coreSettingsPaths,
};
