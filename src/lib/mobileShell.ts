export interface MobileSurfaceMeta {
  title: string;
  subtitle: string;
  contextAction: 'thread-detail' | 'activity';
}

export function getMobileSurfaceMeta(
  pathname: string,
  currentThreadTitle?: string | null,
): MobileSurfaceMeta {
  if (pathname.startsWith('/chat/')) {
    return {
      title: currentThreadTitle?.trim() || 'Current thread',
      subtitle: 'Luca · Opus 4.7',
      contextAction: 'thread-detail',
    };
  }

  if (pathname.startsWith('/chat')) {
    return { title: 'Polyphonic', subtitle: 'Luca · Opus 4.7', contextAction: 'activity' };
  }

  if (pathname.startsWith('/memory')) {
    return { title: 'Memory', subtitle: 'Mnemos substrate', contextAction: 'activity' };
  }

  if (pathname.startsWith('/mind')) {
    return { title: 'Mind', subtitle: 'Continuity and state', contextAction: 'activity' };
  }

  if (pathname.startsWith('/journal')) {
    return { title: 'Journal', subtitle: 'Reflections', contextAction: 'activity' };
  }

  if (pathname.startsWith('/import') || pathname.startsWith('/settings/portability')) {
    return { title: 'Import', subtitle: 'Memory intake', contextAction: 'activity' };
  }

  if (pathname.startsWith('/projects')) {
    return { title: 'Projects', subtitle: 'Workspace context', contextAction: 'activity' };
  }

  if (pathname.startsWith('/profile')) {
    return { title: 'Profile', subtitle: 'Psychological portrait', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/agents')) {
    return { title: 'Agents', subtitle: 'Create and tune agents', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/appearance')) {
    return { title: 'Appearance', subtitle: 'Interface mode and display', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/general')) {
    return { title: 'General', subtitle: 'Workspace defaults', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/models')) {
    return { title: 'Models', subtitle: 'AI connections', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/connected-apps')) {
    return { title: 'Connected apps', subtitle: 'Your companions in other apps', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/local-runtime')) {
    return { title: 'Local runtime', subtitle: 'Local agent bridge', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/voice')) {
    return { title: 'Voice & security', subtitle: 'Speech and safeguards', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/skills')) {
    return { title: 'Self-model', subtitle: 'Skills and capabilities', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/routines')) {
    return { title: 'Routines', subtitle: 'Schedules and follow-ups', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/account')) {
    return { title: 'Account', subtitle: 'Preferences and plan', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/help')) {
    return { title: 'Guide', subtitle: 'How Polyphonic works', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings/cron-health')) {
    return { title: 'Cron health', subtitle: 'Routine diagnostics', contextAction: 'activity' };
  }

  if (pathname.startsWith('/workspace')) {
    return { title: 'Workspace', subtitle: 'Artifacts and work', contextAction: 'activity' };
  }

  if (pathname.startsWith('/canvas')) {
    return { title: 'Canvas', subtitle: 'Artifact view', contextAction: 'activity' };
  }

  if (pathname.startsWith('/groups') || pathname.startsWith('/group')) {
    return { title: 'Groups', subtitle: 'Shared rooms', contextAction: 'activity' };
  }

  if (pathname.startsWith('/checkpoints')) {
    return { title: 'Checkpoints', subtitle: 'Saved states', contextAction: 'activity' };
  }

  if (pathname.startsWith('/settings')) {
    return { title: 'Settings', subtitle: 'Controls', contextAction: 'activity' };
  }

  return { title: 'Polyphonic', subtitle: 'Luca', contextAction: 'activity' };
}
