import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isFirstRun } from "./lib/firstRun";
import { useLocation, useNavigate } from "react-router-dom";
import Rail from "./components/Rail";
// The Rail is the single left nav surface — it expands in place to reveal
// labels + per-section content (no separate Sidebar card). The old
// NavColumn + standalone Sidebar are removed; restorable at git tag
// `pre-rail-rewrite` if ever needed.
import MobileAppBar from "./components/mobile/MobileAppBar";
import MobileNavDrawer from "./components/mobile/MobileNavDrawer";
import CommandPalette from "./components/palette/CommandPalette";
import ImportProgressBanner from "./components/ImportProgressBanner";
import { useDrawerStore } from "./stores/drawerStore";
import { useNotificationStore } from "./stores/notificationStore";
import { useAgentScopeStore } from "./stores/agentScopeStore";
import { useTokenGateStore } from "./stores/tokenGateStore";
import { useInterfaceModeStore } from "./stores/interfaceModeStore";
import { useSidebarStore } from "./stores/sidebarStore";
import { shouldDefaultSidebarVisible } from "./lib/interfaceMode";
import { prefetchCoreSettingsRoutes, prefetchPrimaryNavRoutes } from "./lib/routePrefetch";
import { isAnonymousUser } from "./lib/accessTier";
import { readLandingChatTransitionFlag } from "./lib/guestChat";
import { Drawer, DrawerHeader, DrawerTitle, DrawerEscChip, DrawerCloseBtn, DrawerBody, DrawerSection } from "./components/ui/luca";
import NotificationsDrawer from "./components/drawers/NotificationsDrawer";
import ActivityTimelineDrawer from "./components/drawers/ActivityTimelineDrawer";
import MemoryDetailDrawer from "./components/drawers/MemoryDetailDrawer";
import ContinuityTraceDrawer from "./components/drawers/ContinuityTraceDrawer";
import ObserverDrawer from "./components/drawers/ObserverDrawer";
import AgentDialogueDrawer from "./components/drawers/AgentDialogueDrawer";
import SubAgentOverlay from "./components/subagents/SubAgentOverlay";
import UndoToast from "./components/subagents/UndoToast";
import { useSubagentRealtime } from "./hooks/useSubagentRealtime";
import ConnectionBanner from "./components/states/ConnectionBanner";
import PermissionModal from "./components/permissions/PermissionModal";
import LucaGuideOverlay from "./components/guide/LucaGuideOverlay";
import AgentCreationShimmer from "./components/agents/AgentCreationShimmer";
import { useIsMobile } from "./hooks/use-mobile";

const queryClient = new QueryClient();

const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const OpenRouterCallback = lazy(() => import("./pages/OpenRouterCallback"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const TrustPage = lazy(() => import("./pages/TrustPage"));
const CreditsPage = lazy(() => import("./pages/CreditsPage"));
const ChatView = lazy(() => import("./pages/ChatView"));
const ThreadDetailDrawer = lazy(() => import("./components/drawers/ThreadDetailDrawer"));
const MemoryView = lazy(() => import("./pages/MemoryView"));
const ResearchView = lazy(() => import("./pages/ResearchView"));
const MindView = lazy(() => import("./pages/MindView"));
const JournalView = lazy(() => import("./pages/JournalView"));
const ImportView = lazy(() => import("./pages/ImportView"));
const ProjectsView = lazy(() => import("./pages/ProjectsView"));
const ProfileView = lazy(() => import("./pages/ProfileView"));
const ProfileIdentityView = lazy(() => import("./pages/ProfileIdentityView"));
const ProfileSkillsView = lazy(() => import("./pages/ProfileSkillsView"));
const ProfileRevisionsView = lazy(() => import("./pages/ProfileRevisionsView"));
const ProfileScheduleView = lazy(() => import("./pages/ProfileScheduleView"));
const GroupsView = lazy(() => import("./pages/GroupsView"));
const CheckpointsView = lazy(() => import("./pages/CheckpointsView"));
const WorkspaceView = lazy(() => import("./pages/WorkspaceView"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const MobilePreview = lazy(() => import("./pages/MobilePreview"));
const MobileLivePreview = lazy(() => import("./pages/MobileLivePreview"));
const StyleGallery = lazy(() => import("./pages/StyleGallery"));
const ComposerGallery = lazy(() => import("./pages/ComposerGallery"));
/* DEV-only composer state harness. The guard is on the `lazy()` itself, not
   only on the route: `import.meta.env.DEV` is statically replaced with
   `false` in a production build, so the dynamic import is folded away and
   no harness chunk is emitted at all. */
const ComposerHarness = import.meta.env.DEV
  ? lazy(() => import("./dev/ComposerHarness"))
  : null;
/* DEV-only mobile drawer + app bar harness. Same guard, same reason: the
   drawer's conversation list needs ~70 seeded threads to be looked at. */
const MobileNavHarness = import.meta.env.DEV
  ? lazy(() => import("./dev/MobileNavHarness"))
  : null;
const PublicProfileView = lazy(() => import("./pages/PublicProfileView"));
const AgentsList = lazy(() => import("./pages/settings/AgentsList"));
const AgentDetail = lazy(() => import("./pages/settings/AgentDetail"));
const SettingsPlaceholder = lazy(() => import("./pages/settings/SettingsPlaceholder"));
const GeneralSettings = lazy(() => import("./pages/settings/GeneralSettings"));
const ModelsSettings = lazy(() => import("./pages/settings/ModelsSettings"));
const AppearanceSettings = lazy(() => import("./pages/settings/AppearanceSettings"));
const VoiceSettings = lazy(() => import("./pages/settings/VoiceSettings"));
const AccountSettings = lazy(() => import("./pages/settings/AccountSettings"));
const LocalRuntimeSettings = lazy(() => import("./pages/settings/LocalRuntimeSettings"));
const PublicProfileSettings = lazy(() => import("./pages/settings/PublicProfileSettings"));
const CronHealthSettings = lazy(() => import("./pages/settings/CronHealthSettings"));
const HelpGuide = lazy(() => import("./pages/settings/HelpGuide"));
const CanvasPanel = lazy(() => import("./components/canvas/CanvasPanel"));
const AccessGatePage = lazy(() => import("./pages/AccessGatePage"));

function AuthInit({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  useEffect(() => {
    const unsub = initialize();
    return unsub;
  }, [initialize]);
  return <>{children}</>;
}

function FirstRunGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  // First-run is a once-per-session, per-user decision — NOT a per-navigation
  // one. The previous version reset a `checked` flag at the top of an effect
  // keyed on location.pathname, so every click blanked the whole app to a
  // black "Loading..." screen while isFirstRun re-queried the DB. We instead
  // remember the user id we've already cleared and never re-gate after that.
  const clearedUserRef = useRef<string | null>(null);
  const [checking, setChecking] = useState(false);

  const isPublicRoute =
    location.pathname.startsWith('/auth/')
    || location.pathname === '/reset-password'
    || location.pathname === '/privacy'
    || location.pathname === '/terms'
    || location.pathname.startsWith('/u/')
    || location.pathname.startsWith('/@')
    || location.pathname.startsWith('/_mockups');

  const exemptFromGate =
    isPublicRoute
    || !user
    || (user && isAnonymousUser(user))
    || location.pathname === '/onboarding';

  useEffect(() => {
    if (exemptFromGate || !user) return;
    // Force re-entry via ?onboarding=1 (for QA)
    if (location.search.includes('onboarding=1')) {
      navigate('/onboarding', { replace: true });
      return;
    }
    // Already determined this user is past first-run — do not re-check or
    // gate on subsequent navigations. This is what keeps section-to-section
    // clicks from flashing the loading screen.
    if (clearedUserRef.current === user.id) return;

    let cancelled = false;
    setChecking(true);
    // One-shot retry on isFirstRun failure — a single transient network
    // blip would otherwise risk throwing the user back to onboarding even
    // after they've completed it. Tara hit a related case (2026-05-10).
    const check = async () => {
      try {
        return await isFirstRun(user.id);
      } catch (err) {
        if (cancelled) return false;
        console.warn('[FirstRunGate] isFirstRun first attempt failed, retrying once', err);
        await new Promise((r) => setTimeout(r, 400));
        try {
          return await isFirstRun(user.id);
        } catch (err2) {
          console.warn('[FirstRunGate] isFirstRun retry failed, defaulting to NOT first-run', err2);
          return false;
        }
      }
    };
    check().then((first) => {
      if (cancelled) return;
      if (first) {
        navigate('/onboarding', { replace: true });
        return;
      }
      clearedUserRef.current = user.id;
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, location.pathname, location.search, navigate, exemptFromGate]);

  // Gate only while the *initial* check for this user is in flight. Once the
  // user is cleared, navigations never re-trigger this.
  const needsGate =
    !exemptFromGate
    && !!user
    && clearedUserRef.current !== user.id
    && checking;

  if (needsGate) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-tertiary)' }}
      >
        Loading...
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children, skipTokenGate: _skipTokenGate = false }: { children: React.ReactNode; skipTokenGate?: boolean }) {
  const { user, loading } = useAuthStore();
  const location = useLocation();
  if (loading) return <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-deep)', color: 'var(--text-tertiary)' }}>Loading...</div>;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />;
  }
  void _skipTokenGate;
  return <>{children}</>;
}

function RouteFallback() {
  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ background: 'var(--bg-deep)', color: 'var(--text-tertiary)' }}
      aria-label="Loading page"
    >
      Loading...
    </div>
  );
}

function PanelRouteFallback() {
  return (
    <div
      className="route-panel-fallback flex-1 min-h-0 min-w-0"
      aria-label="Loading section"
      role="status"
    >
      <div className="route-panel-fallback__line" />
      <div className="route-panel-fallback__line route-panel-fallback__line--short" />
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadNotifications = useNotificationStore((s) => s.load);
  const subscribeNotifications = useNotificationStore((s) => s.subscribe);
  const loadAgentScopes = useAgentScopeStore((s) => s.load);
  const tokenGateStatus = useTokenGateStore((s) => s.status);
  const hydrateTokenGate = useTokenGateStore((s) => s.hydrate);
  const interfaceMode = useInterfaceModeStore((s) => s.mode);
  const setSidebarVisible = useSidebarStore((s) => s.setVisible);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      // Load settings first so the adopted landing agent is known, then seed
      // the cross-surface agent scope (Memory / Mind / Journal) from it — so
      // those surfaces default to the same agent the chat hero shows instead
      // of falling back to Luca. Deterministic: no render race.
      await loadSettings(user.id);
      if (cancelled) return;
      const settings = useSettingsStore.getState();
      const scopedAgent = settings.last_chat_target_kind === 'agent'
        ? settings.last_chat_target_id
        : settings.landing_agent_id;
      await loadAgentScopes(user.id, scopedAgent);
    })();
    return () => { cancelled = true; };
  }, [user, loadSettings, loadAgentScopes]);

  useEffect(() => {
    if (user && tokenGateStatus === 'unknown') {
      void hydrateTokenGate();
    }
  }, [user, tokenGateStatus, hydrateTokenGate]);

  useEffect(() => {
    if (!user) return;
    loadNotifications(user.id);
    const unsub = subscribeNotifications(user.id);
    return unsub;
  }, [user, loadNotifications, subscribeNotifications]);

  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      prefetchCoreSettingsRoutes();
    }
  }, [location.pathname]);

  useEffect(() => {
    setSidebarVisible(shouldDefaultSidebarVisible(interfaceMode));
  }, [interfaceMode, setSidebarVisible]);

  // Warm only lightweight primary chunks on idle. Heavy diagnostic surfaces
  // stay hover/on-demand so the first companion/chat session stays fast.
  useEffect(() => {
    prefetchPrimaryNavRoutes();
  }, []);

  useSubagentRealtime();

  return (
    <div
      className="app-shell h-screen flex overflow-hidden"
      data-mobile={isMobile ? 'true' : undefined}
      data-interface-mode={interfaceMode}
      style={{ background: 'var(--floor)' }}
    >
      {isMobile ? <MobileAppBar /> : <Rail />}
      <div
        className="app-main flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{
          background: 'var(--canvas)',
          border: isMobile ? 'none' : '1px solid var(--border-faint)',
          borderRadius: isMobile ? 0 : 'var(--radius-inset)',
          boxShadow: isMobile ? 'none' : 'var(--shadow-panel), var(--shadow-inset-highlight)',
        }}
      >
        <ConnectionBanner />
        <ImportProgressBanner />
        <Suspense fallback={<PanelRouteFallback />}>
          {/* No key here on purpose. A key tied to the pathname forced the
              entire route subtree to unmount/remount on every navigation —
              replaying routeStageIn (opacity + 5px slide) and the view's own
              viewFadeIn, which read as a full-page reload. Without it, the
              stage persists; React swaps only the inner view (different
              component → mounts with its gentle viewFadeIn; same component
              with new params, e.g. chat threads or profile sub-pages →
              reconciles in place, no remount). Stores are stale-while-
              revalidate, so content never blanks during the swap. */}
          <div className="route-transition-stage flex-1 min-h-0 min-w-0 flex flex-col">
            {children}
          </div>
        </Suspense>
      </div>
      {isMobile && <MobileNavDrawer />}
      <CommandPalette />
      <DrawerRouter />
      <SubAgentOverlay />
      <UndoToast />
      <PermissionModal />
      <LucaGuideOverlay />
      <AgentCreationShimmer />
    </div>
  );
}

function DrawerRouter() {
  const active = useDrawerStore((s) => s.active);
  const close = useDrawerStore((s) => s.close);
  const isMobile = useIsMobile();
  const open = active !== null;

  const label =
    active === 'notifications' ? 'Activity'
    : active === 'activity-timeline' ? 'Activity timeline'
    : active === 'thread-detail' ? 'Thread detail'
    : active === 'memory-detail' ? 'Memory detail'
    : active === 'continuity-trace' ? 'Continuity Trace'
    : active === 'agent-inspector' ? 'Agent inspector'
    : active === 'agent-dialogue' ? 'Agent dialogue'
    : active === 'observer' ? 'Observer'
    : '';

  // Memory detail floats over the page (no backdrop blur) so the graph
  // behind it remains visible. All other drawers keep the backdrop.
  const showBackdrop = active !== 'memory-detail' || isMobile;
  const drawerWidth = active === 'memory-detail' && !isMobile ? 320 : active === 'continuity-trace' && !isMobile ? 460 : undefined;

  return (
    <Drawer open={open} onClose={close} ariaLabel={label || 'Drawer'} showBackdrop={showBackdrop} width={drawerWidth}>
      {active === 'notifications' && <NotificationsDrawer />}
      {active === 'activity-timeline' && <ActivityTimelineDrawer />}
      {active === 'thread-detail' && (
        <Suspense fallback={<DrawerBody><div className="drawer-loading">Loading thread details…</div></DrawerBody>}>
          <ThreadDetailDrawer />
        </Suspense>
      )}
      {active === 'memory-detail' && <MemoryDetailDrawer />}
      {active === 'continuity-trace' && <ContinuityTraceDrawer />}
      {active === 'observer' && <ObserverDrawer />}
      {active === 'agent-dialogue' && <AgentDialogueDrawer />}
      {active !== null
        && active !== 'notifications'
        && active !== 'activity-timeline'
        && active !== 'thread-detail'
        && active !== 'memory-detail'
        && active !== 'continuity-trace'
        && active !== 'observer'
        && active !== 'agent-dialogue' && (
        <>
          <DrawerHeader>
            <DrawerTitle>{label}</DrawerTitle>
            <DrawerEscChip />
            <DrawerCloseBtn onClick={close} />
          </DrawerHeader>
          <DrawerBody>
            <DrawerSection>
              <p style={{ color: 'var(--text-ghost)', fontSize: 13, lineHeight: 1.6 }}>
                Content arrives in a later phase.
              </p>
            </DrawerSection>
          </DrawerBody>
        </>
      )}
    </Drawer>
  );
}

function RootRedirect() {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-deep)', color: 'var(--text-tertiary)' }}>Loading...</div>;
  const landingChatTransition = readLandingChatTransitionFlag();
  // Authenticated users go straight to chat. Unauthenticated visitors land
  // on the public landing surface (composer + auth states), not the bare
  // login form.
  return user && !landingChatTransition ? <Navigate to="/chat" replace /> : <LandingPage initialMode="idle" />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthInit>
          <FirstRunGate>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/auth/login" element={<LandingPage initialMode="signin" />} />
                <Route path="/auth/signup" element={<LandingPage initialMode="signup" />} />
                <Route path="/auth/legacy-login" element={<LoginPage />} />
                <Route path="/auth/legacy-signup" element={<SignupPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/auth/openrouter/callback" element={<OpenRouterCallback />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/trust" element={<TrustPage />} />
                <Route path="/credits" element={<CreditsPage />} />
                {/* Public profile (no app shell, no auth required) */}
                <Route path="/u/:handle" element={<PublicProfileView mode="view" />} />
                <Route path="/u/:handle/edit" element={<ProtectedRoute><PublicProfileView mode="edit" /></ProtectedRoute>} />
                {/* Legacy/pretty @-prefixed URLs: redirect to /u/:handle since React Router v6 has issues parsing the @ prefix attached to a param. */}
                <Route path="/@:handle" element={<PublicProfileView mode="view" />} />
                <Route path="/@:handle/edit" element={<ProtectedRoute><PublicProfileView mode="edit" /></ProtectedRoute>} />
                <Route path="/settings/public-profile" element={<ProtectedRoute><AppShell><PublicProfileSettings /></AppShell></ProtectedRoute>} />
                <Route path="/chat" element={<ProtectedRoute skipTokenGate><AppShell><ChatView /></AppShell></ProtectedRoute>} />
                <Route path="/chat/:threadId" element={<ProtectedRoute skipTokenGate><AppShell><ChatView /></AppShell></ProtectedRoute>} />
                <Route path="/memory" element={<ProtectedRoute><AppShell><MemoryView /></AppShell></ProtectedRoute>} />
                <Route path="/research" element={<ProtectedRoute><AppShell><ResearchView /></AppShell></ProtectedRoute>} />
                <Route path="/mind" element={<ProtectedRoute><AppShell><MindView /></AppShell></ProtectedRoute>} />
                <Route path="/journal" element={<ProtectedRoute><AppShell><JournalView /></AppShell></ProtectedRoute>} />
                <Route path="/import" element={<ProtectedRoute><AppShell><ImportView /></AppShell></ProtectedRoute>} />
                <Route path="/projects" element={<ProtectedRoute><AppShell><ProjectsView /></AppShell></ProtectedRoute>} />
                <Route path="/projects/:projectId" element={<ProtectedRoute><AppShell><ProjectsView /></AppShell></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><AppShell><ProfileView /></AppShell></ProtectedRoute>} />
                <Route path="/profile/identity" element={<ProtectedRoute><AppShell><ProfileIdentityView /></AppShell></ProtectedRoute>} />
                <Route path="/profile/skills" element={<ProtectedRoute><AppShell><ProfileSkillsView /></AppShell></ProtectedRoute>} />
                <Route path="/profile/revisions" element={<ProtectedRoute><AppShell><ProfileRevisionsView /></AppShell></ProtectedRoute>} />
                <Route path="/profile/schedule" element={<ProtectedRoute><AppShell><ProfileScheduleView /></AppShell></ProtectedRoute>} />
                <Route path="/groups" element={<ProtectedRoute><AppShell><GroupsView /></AppShell></ProtectedRoute>} />
                <Route path="/groups/:roomId" element={<ProtectedRoute><AppShell><GroupsView /></AppShell></ProtectedRoute>} />
                <Route path="/group" element={<Navigate to="/groups" replace />} />
                <Route path="/checkpoints" element={<ProtectedRoute><AppShell><CheckpointsView /></AppShell></ProtectedRoute>} />
                <Route path="/workspace" element={<ProtectedRoute><AppShell><WorkspaceView /></AppShell></ProtectedRoute>} />
                <Route path="/canvas/:artifactId" element={<ProtectedRoute><AppShell><CanvasPanel /></AppShell></ProtectedRoute>} />
                <Route path="/settings" element={<Navigate to="/settings/agents" replace />} />
                <Route path="/settings/agents" element={<ProtectedRoute><AppShell><AgentsList /></AppShell></ProtectedRoute>} />
                <Route path="/settings/agents/:id" element={<ProtectedRoute><AppShell><AgentDetail /></AppShell></ProtectedRoute>} />
                <Route path="/settings/general" element={<ProtectedRoute><AppShell><GeneralSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/models" element={<ProtectedRoute skipTokenGate><AppShell><ModelsSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/appearance" element={<ProtectedRoute><AppShell><AppearanceSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/skills" element={<ProtectedRoute><AppShell><ProfileSkillsView /></AppShell></ProtectedRoute>} />
                <Route path="/settings/routines" element={<ProtectedRoute><AppShell><ProfileScheduleView /></AppShell></ProtectedRoute>} />
                <Route path="/settings/voice" element={<ProtectedRoute><AppShell><VoiceSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/local-runtime" element={<ProtectedRoute><AppShell><LocalRuntimeSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/portability" element={<ProtectedRoute><AppShell><ImportView /></AppShell></ProtectedRoute>} />
                <Route path="/settings/account" element={<ProtectedRoute skipTokenGate><AppShell><AccountSettings /></AppShell></ProtectedRoute>} />
                <Route path="/settings/help" element={<ProtectedRoute skipTokenGate><AppShell><HelpGuide /></AppShell></ProtectedRoute>} />
                <Route path="/settings/cron-health" element={<ProtectedRoute><AppShell><CronHealthSettings /></AppShell></ProtectedRoute>} />
                <Route path="/onboarding" element={<ProtectedRoute skipTokenGate><Onboarding /></ProtectedRoute>} />
                <Route path="/access" element={<ProtectedRoute skipTokenGate><AccessGatePage /></ProtectedRoute>} />
                <Route path="/_mobile" element={<MobilePreview />} />
                <Route path="/_mobile-live" element={<MobileLivePreview />} />
                <Route path="/_mockups/styles" element={<StyleGallery />} />
                <Route path="/_mockups/composer" element={<ComposerGallery />} />
                {import.meta.env.DEV && ComposerHarness && (
                  <Route path="/__dev/composer" element={<ComposerHarness />} />
                )}
                {import.meta.env.DEV && MobileNavHarness && (
                  <Route path="/__dev/mobile-nav" element={<MobileNavHarness />} />
                )}
                <Route path="/dashboard" element={<Navigate to="/mind" replace />} />
                {/* /notebook is the simplified vocabulary for /journal —
                    same view, same data, label adapts to the route. */}
                <Route path="/notebook" element={<ProtectedRoute><AppShell><JournalView /></AppShell></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </FirstRunGate>
        </AuthInit>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
