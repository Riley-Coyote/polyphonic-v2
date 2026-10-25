import { Activity, Info, Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChatTargetPicker, type ChatTarget } from '@/components/composer/ChatTargetPicker';
import { DEFAULT_CHAT_MODEL, getChatModelLabel, normalizeChatTargetPreference, normalizeThreadRuntimeMode } from '@/lib/chatRuntime';
import { getMobileSurfaceMeta } from '@/lib/mobileShell';
import { useAuthStore } from '@/stores/authStore';
import { useDrawerStore } from '@/stores/drawerStore';
import { useAgentScopeStore } from '@/stores/agentScopeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMobileShellStore } from '@/stores/mobileShellStore';
import { useNotificationStore, selectPendingInitiationsCount } from '@/stores/notificationStore';
import { useThreadStore } from '@/stores/threadStore';
import { useInterfaceModeStore } from '@/stores/interfaceModeStore';
import { shouldShowStudioNavigation } from '@/lib/interfaceMode';
import { isConnectedChat } from '@/lib/connectedChat';

function threadIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/chat/')) return null;
  const id = pathname.split('/')[2];
  return id || null;
}

function isAgentScopedSurface(pathname: string): boolean {
  return (
    pathname.startsWith('/chat') ||
    pathname.startsWith('/journal') ||
    pathname.startsWith('/memory') ||
    pathname.startsWith('/mind') ||
    pathname.startsWith('/profile/identity') ||
    pathname.startsWith('/profile/skills') ||
    pathname.startsWith('/profile/schedule')
  );
}

export default function MobileAppBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const routeThreadId = threadIdFromPath(location.pathname);
  const threads = useThreadStore((s) => s.threads);
  const currentThreadId = useThreadStore((s) => s.currentThreadId);
  const messages = useThreadStore((s) => s.messages);
  const loadThreads = useThreadStore((s) => s.loadThreads);
  const createThread = useThreadStore((s) => s.createThread);
  const updateThreadAgent = useThreadStore((s) => s.updateThreadAgent);
  const updateThreadSelectedModel = useThreadStore((s) => s.updateThreadSelectedModel);
  const openMobileNav = useMobileShellStore((s) => s.openDrawer);
  const openContextDrawer = useDrawerStore((s) => s.open);
  const closeContextDrawer = useDrawerStore((s) => s.close);
  const pendingCount = useNotificationStore(selectPendingInitiationsCount);
  const interfaceMode = useInterfaceModeStore((s) => s.mode);
  const activeAgentId = useAgentScopeStore((s) => s.activeAgentId);
  const setActiveAgent = useAgentScopeStore((s) => s.setActiveAgent);
  const availableAgents = useAgentScopeStore((s) => s.availableAgents);
  const landingAgentId = useSettingsStore((s) => s.landing_agent_id) || 'luca';
  const defaultModel = useSettingsStore((s) => s.default_model);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const setLastChatTarget = useSettingsStore((s) => s.setLastChatTarget);
  const lastTargetKind = useSettingsStore((s) => s.last_chat_target_kind);
  const lastTargetId = useSettingsStore((s) => s.last_chat_target_id);

  useEffect(() => {
    if (threads.length === 0) void loadThreads();
  }, [loadThreads, threads.length]);

  const threadTitle = useMemo(
    () => threads.find((t) => t.id === routeThreadId)?.title ?? null,
    [routeThreadId, threads],
  );
  const currentThread = useMemo(
    () => threads.find((t) => t.id === (routeThreadId || currentThreadId)),
    [currentThreadId, routeThreadId, threads],
  );

  const baseMeta = getMobileSurfaceMeta(location.pathname, threadTitle);
  const studioNavigation = shouldShowStudioNavigation(interfaceMode);
  const meta = !studioNavigation && location.pathname.startsWith('/journal')
    ? { ...baseMeta, title: 'Notebook', subtitle: 'Inner life and creations' }
    : !studioNavigation && location.pathname.startsWith('/projects')
      ? { ...baseMeta, title: 'Create', subtitle: 'Artifacts and work' }
      : baseMeta;
  const isChatSurface = location.pathname.startsWith('/chat');
  const threadMetadataPending = isChatSurface && !!routeThreadId && !currentThread;
  const connectedChatActive = isChatSurface && isConnectedChat(currentThread);
  const targetLocked = connectedChatActive || threadMetadataPending;
  const lastTarget = normalizeChatTargetPreference(lastTargetKind, lastTargetId || landingAgentId, defaultModel || DEFAULT_CHAT_MODEL);
  const pendingModelTarget = isChatSurface && !currentThread && lastTarget.kind === 'model';
  const runtimeAgentId = isChatSurface
    ? (currentThread?.agent_id || (pendingModelTarget ? 'luca' : lastTarget.id))
    : activeAgentId;
  const threadRuntimeMode = currentThread
    ? normalizeThreadRuntimeMode(currentThread.runtime_mode, 'agent')
    : (pendingModelTarget ? 'classic' : 'agent');
  const selectedChatModel = currentThread?.selected_model || (pendingModelTarget ? lastTarget.id : defaultModel) || DEFAULT_CHAT_MODEL;
  const classicChatActive = isChatSurface && threadRuntimeMode === 'classic';
  const activeAgentName = availableAgents.find((agent) => agent.id === runtimeAgentId)?.name || 'Luca';
  const activeThreadId = routeThreadId || currentThreadId;
  const activeChatTarget: ChatTarget = classicChatActive
    ? { kind: 'model', id: selectedChatModel }
    : { kind: 'agent', id: runtimeAgentId };
  const title = threadMetadataPending ? 'Loading conversation…' : isChatSurface ? (classicChatActive ? getChatModelLabel(selectedChatModel) : activeAgentName) : meta.title;
  const subtitle = connectedChatActive ? `${selectedChatModel} · connected account` : isChatSurface ? (threadTitle || 'new chat') : meta.subtitle;
  const showAgentPicker = !!user && !targetLocked && isAgentScopedSurface(location.pathname);

  const handleAgentChange = useCallback(async (id: string) => {
    if (targetLocked) return;
    if (!id) return;
    const selectingLucaAgent = id === 'luca';
    if (id === runtimeAgentId && (!selectingLucaAgent || !classicChatActive)) return;
    setActiveAgent(id);
    void setLastChatTarget({ kind: 'agent', id });

    if (!user || !isChatSurface) return;

    if (!activeThreadId) {
      // Bare /chat landing: switch the hero's target in place by persisting the
      // last chat target. Do NOT spawn a blank thread + navigate:
      // that sets a route threadId, which flips the empty-state off and leaves a
      // black screen with only the composer (no particle field).
      return;
    }

    if (messages.length === 0) {
      await updateThreadAgent(activeThreadId, id);
      return;
    }

    const nextThreadId = await createThread(user.id, id);
    navigate(`/chat/${nextThreadId}`);
  }, [
    activeThreadId,
    targetLocked,
    classicChatActive,
    createThread,
    isChatSurface,
    messages.length,
    navigate,
    runtimeAgentId,
    setActiveAgent,
    setLastChatTarget,
    updateThreadAgent,
    user,
  ]);

  const handleModelChange = useCallback(async (modelId: string) => {
    if (targetLocked) return;
    if (!modelId) return;
    if (modelId === selectedChatModel && classicChatActive) return;
    void updateSetting('default_model', modelId);
    void setLastChatTarget({ kind: 'model', id: modelId });
    setActiveAgent('luca');
    if (!user || !isChatSurface) return;
    if (!activeThreadId) {
      return;
    }
    if (messages.length === 0) {
      await updateThreadSelectedModel(activeThreadId, modelId);
      return;
    }
    const nextThreadId = await createThread(user.id, 'luca', null, {
      runtimeMode: 'classic',
      selectedModel: modelId,
    });
    navigate(`/chat/${nextThreadId}`);
  }, [
    activeThreadId,
    targetLocked,
    classicChatActive,
    createThread,
    isChatSurface,
    messages.length,
    navigate,
    selectedChatModel,
    setActiveAgent,
    setLastChatTarget,
    updateSetting,
    updateThreadSelectedModel,
    user,
  ]);

  const openMenu = () => {
    closeContextDrawer();
    openMobileNav();
  };

  const openContext = () => {
    if (meta.contextAction === 'thread-detail' && routeThreadId) {
      openContextDrawer('thread-detail', { threadId: routeThreadId });
      return;
    }
    openContextDrawer('notifications');
  };

  return (
    <header className="mobile-app-bar" data-surface={isChatSurface ? 'chat' : undefined}>
      <button
        type="button"
        className="mobile-bar-button"
        onClick={openMenu}
        aria-label="Open navigation menu"
      >
        <Menu size={22} strokeWidth={1.8} />
      </button>

      <div className="mobile-bar-title" aria-live="polite">
        {showAgentPicker ? (
          <div className="mobile-bar-agent-stack">
            <div className="mobile-bar-agent-picker">
              <ChatTargetPicker
                activeTarget={activeChatTarget}
                onSelectAgent={(id) => { void handleAgentChange(id); }}
                onSelectModel={(id) => { void handleModelChange(id); }}
                variant="header"
              />
            </div>
            {!isChatSurface && (
              <div className="mobile-bar-agent-surface">{meta.title}</div>
            )}
          </div>
        ) : (
          <div className="mobile-bar-title-main">{title}</div>
        )}
        <div className="mobile-bar-title-sub" style={connectedChatActive ? { display: 'block', marginTop: 3 } : undefined}>{subtitle}</div>
      </div>

      <button
        type="button"
        className="mobile-bar-button"
        data-pending={pendingCount > 0 && meta.contextAction !== 'thread-detail' ? 'true' : undefined}
        onClick={openContext}
        aria-label={meta.contextAction === 'thread-detail' ? 'Open thread details' : `Open activity${pendingCount > 0 ? `, ${pendingCount} pending` : ''}`}
      >
        {meta.contextAction === 'thread-detail' ? <Info size={21} strokeWidth={1.7} /> : <Activity size={21} strokeWidth={1.7} />}
        {pendingCount > 0 && meta.contextAction !== 'thread-detail' && <span className="mobile-bar-dot" aria-hidden="true" />}
      </button>
    </header>
  );
}
