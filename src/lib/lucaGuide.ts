import type { DrawerKey } from '@/stores/drawerStore';
import { isInterfaceMode, type InterfaceMode } from '@/lib/interfaceMode';

export type LucaGuideActionType = 'navigate' | 'highlight' | 'scroll_to' | 'open_drawer' | 'set_interface_mode';

export interface LucaGuideAction {
  type: LucaGuideActionType;
  target: string;
  label?: string;
}

export interface LucaGuideMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  actions?: LucaGuideAction[];
}

export interface LucaGuideTarget {
  id: string;
  label: string;
  description: string;
}

export interface LucaGuideContext {
  path: string;
  search: string;
  pageTitle: string;
  routeFamily: string;
  summary: string;
  activeAgentId: string;
  activeAgentName: string;
  interfaceMode: InterfaceMode;
  interfaceModeSummary: string;
  interfaceModeInstruction: string;
  currentThreadId: string | null;
  availableTargets: LucaGuideTarget[];
}

export const GUIDE_NAV_TARGETS: LucaGuideTarget[] = [
  { id: '/chat', label: 'Chat', description: 'Open the main conversation surface.' },
  { id: '/settings/agents', label: 'Agents', description: 'Open the custom-agent list and editor.' },
  { id: '/settings/models', label: 'Models', description: 'Open model and OpenRouter key setup.' },
  { id: '/settings/appearance', label: 'Appearance', description: 'Open interface mode, density, and display controls.' },
  { id: '/settings/general', label: 'General', description: 'Open general workspace preferences.' },
  { id: '/settings/voice', label: 'Voice', description: 'Open voice and security controls.' },
  { id: '/settings/local-runtime', label: 'Local runtime', description: 'Open local runtime and machine-side setup.' },
  { id: '/settings/connected-apps', label: 'Connected apps', description: 'Open the apps that can reach your companions, and the connector address.' },
  { id: '/settings/portability', label: 'Import & export', description: 'Open data import, export, and portability controls.' },
  { id: '/settings/account', label: 'Account', description: 'Open account and preference controls.' },
  { id: '/settings/skills', label: 'Self-model', description: 'Open skill and self-model controls.' },
  { id: '/settings/routines', label: 'Routines', description: 'Open routine and schedule controls.' },
  { id: '/settings/cron-health', label: 'Cron health', description: 'Open background routine health.' },
  { id: '/journal', label: 'Journal', description: 'Open the unified notebook feed.' },
  { id: '/memory', label: 'Memory', description: 'Open the memory and substrate browser.' },
  { id: '/mind', label: 'Mind', description: 'Open the advanced inner-life diagnostic section.' },
  { id: '/profile', label: 'Profile', description: 'Open the psychological profile.' },
  { id: '/import', label: 'Import', description: 'Open conversation import.' },
  { id: '/settings/help', label: 'Guide', description: 'Open the app guide.' },
];

export const GUIDE_DRAWER_TARGETS: LucaGuideTarget[] = [
  { id: 'notifications', label: 'Activity', description: 'Open the activity drawer.' },
  { id: 'activity-timeline', label: 'Activity timeline', description: 'Open the activity timeline drawer.' },
];

const GLOBAL_HIGHLIGHT_TARGETS: LucaGuideTarget[] = [
  { id: 'rail-chat', label: 'Chat rail button', description: 'The left rail shortcut for Chat.' },
  { id: 'rail-memory', label: 'Memory rail button', description: 'The left rail shortcut for Memory.' },
  { id: 'rail-mind', label: 'Mind rail button', description: 'The left rail shortcut for Mind.' },
  { id: 'rail-journal', label: 'Journal rail button', description: 'The left rail shortcut for Journal.' },
  { id: 'rail-agents', label: 'Agents rail button', description: 'The left rail shortcut for custom agents in Companion and Guided modes.' },
  { id: 'rail-profile', label: 'Profile rail button', description: 'The left rail shortcut for Profile.' },
  { id: 'rail-help', label: 'Help rail button', description: 'The persistent guide button near Settings.' },
  { id: 'rail-settings', label: 'Settings rail button', description: 'The left rail shortcut for Settings.' },
  { id: 'luca-guide-launcher', label: 'Polyphonic Guide button', description: 'The floating app helper for questions about Polyphonic.' },
];

const HELP_TARGETS: LucaGuideTarget[] = [
  { id: 'help-profile-section', label: 'Psychological profile guide', description: 'The help section that explains how Profile informs user understanding.' },
  { id: 'help-agents-section', label: 'Agent guide', description: 'The help section about Luca, custom agents, and Observer.' },
  { id: 'help-memory-section', label: 'Memory guide', description: 'The help section about Journal, Memory, and Mind.' },
];

export function routeInfo(path: string): Pick<LucaGuideContext, 'pageTitle' | 'routeFamily' | 'summary'> {
  if (path.startsWith('/settings/models')) {
    return {
      pageTitle: 'Models',
      routeFamily: 'settings',
      summary: 'OpenRouter key and default model setup.',
    };
  }
  if (path.startsWith('/settings/agents')) {
    return {
      pageTitle: 'Agents',
      routeFamily: 'settings',
      summary: 'Create, edit, and inspect Luca or custom-agent configuration.',
    };
  }
  if (path.startsWith('/settings/appearance')) {
    return {
      pageTitle: 'Appearance',
      routeFamily: 'settings',
      summary: 'Interface mode, density, typography, and persistent surface visibility.',
    };
  }
  if (path.startsWith('/settings/general')) {
    return {
      pageTitle: 'General',
      routeFamily: 'settings',
      summary: 'General workspace preferences and defaults.',
    };
  }
  if (path.startsWith('/settings/help')) {
    return {
      pageTitle: 'Guide',
      routeFamily: 'settings',
      summary: 'The app guide explaining setup, agents, profile, memory, and troubleshooting.',
    };
  }
  if (path.startsWith('/settings/voice')) {
    return {
      pageTitle: 'Voice & security',
      routeFamily: 'settings',
      summary: 'Voice connection, speech behavior, and security preferences.',
    };
  }
  if (path.startsWith('/settings/connected-apps')) {
    return {
      pageTitle: 'Connected apps',
      routeFamily: 'settings',
      summary: 'Apps like Claude and ChatGPT that can reach your companions, and the address to connect new ones.',
    };
  }
  if (path.startsWith('/settings/local-runtime')) {
    return {
      pageTitle: 'Local runtime',
      routeFamily: 'settings',
      summary: 'Local runtime configuration and machine-side setup.',
    };
  }
  if (path.startsWith('/settings/account')) {
    return {
      pageTitle: 'Account',
      routeFamily: 'settings',
      summary: 'Account details and user preferences.',
    };
  }
  if (path.startsWith('/settings/skills')) {
    return {
      pageTitle: 'Self-model',
      routeFamily: 'settings',
      summary: 'Skills, self-model controls, and agent capability settings.',
    };
  }
  if (path.startsWith('/settings/routines')) {
    return {
      pageTitle: 'Routines',
      routeFamily: 'settings',
      summary: 'Schedules, routines, and autonomous follow-up controls.',
    };
  }
  if (path.startsWith('/settings/cron-health')) {
    return {
      pageTitle: 'Cron health',
      routeFamily: 'settings',
      summary: 'Background routine health and scheduled-task diagnostics.',
    };
  }
  if (path.startsWith('/settings')) {
    return {
      pageTitle: 'Settings',
      routeFamily: 'settings',
      summary: 'System settings and account controls.',
    };
  }
  if (path.startsWith('/chat')) {
    return {
      pageTitle: 'Chat',
      routeFamily: 'chat',
      summary: 'The main conversation surface with agent selector, composer, and Observer alcove.',
    };
  }
  if (path.startsWith('/journal')) {
    return {
      pageTitle: 'Journal',
      routeFamily: 'journal',
      summary: 'The unified notebook feed for agent journal, thoughts, reflections, beliefs, and activity.',
    };
  }
  if (path.startsWith('/memory')) {
    return {
      pageTitle: 'Memory',
      routeFamily: 'memory',
      summary: 'The substrate browser for memories, engrams, beliefs, imports, and memory settings.',
    };
  }
  if (path.startsWith('/mind')) {
    return {
      pageTitle: 'Mind',
      routeFamily: 'mind',
      summary: 'The advanced diagnostic section for inner-life streams.',
    };
  }
  if (path.startsWith('/profile')) {
    return {
      pageTitle: 'Profile',
      routeFamily: 'profile',
      summary: 'The psychological profile and user-understanding dashboard.',
    };
  }
  if (path.startsWith('/import') || path.startsWith('/settings/portability')) {
    return {
      pageTitle: 'Import & export',
      routeFamily: 'import',
      summary: 'Conversation import, profile generation, and data portability.',
    };
  }
  if (path.startsWith('/projects')) {
    return {
      pageTitle: 'Projects',
      routeFamily: 'projects',
      summary: 'Project workspaces for organizing threads and context.',
    };
  }
  return {
    pageTitle: 'Polyphonic',
    routeFamily: 'app',
    summary: 'A protected Polyphonic app surface.',
  };
}

export function targetsForPath(path: string): LucaGuideTarget[] {
  const pageTargets = path.startsWith('/settings/help') ? HELP_TARGETS : [];
  return [...GLOBAL_HIGHLIGHT_TARGETS, ...pageTargets];
}

const ALLOWED_NAV_PATHS = new Set(GUIDE_NAV_TARGETS.map((target) => target.id));
const ALLOWED_DRAWERS = new Set<Exclude<DrawerKey, null>>([
  'notifications',
  'activity-timeline',
]);

export function sanitizeGuideAction(action: LucaGuideAction): LucaGuideAction | null {
  if (!action || typeof action.type !== 'string' || typeof action.target !== 'string') return null;
  const target = action.target.trim();
  if (!target) return null;
  if (action.type === 'navigate') {
    if (!ALLOWED_NAV_PATHS.has(target)) return null;
    return { ...action, target };
  }
  if (action.type === 'open_drawer') {
    if (!ALLOWED_DRAWERS.has(target as Exclude<DrawerKey, null>)) return null;
    return { ...action, target };
  }
  if (action.type === 'set_interface_mode') {
    if (!isInterfaceMode(target)) return null;
    return { ...action, target };
  }
  if (action.type === 'highlight' || action.type === 'scroll_to') {
    return { ...action, target };
  }
  return null;
}
