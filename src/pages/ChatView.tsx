import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFirstMount } from '@/lib/useFirstMount';
import { useNavigate, useParams } from 'react-router-dom';
import { useThreadStore } from '@/stores/threadStore';
import { ChatTargetPicker, type ChatTarget } from '@/components/composer/ChatTargetPicker';
import { ObserverEyeChip } from '@/components/composer/ObserverEyeChip';
import ModesDropdown from '@/components/composer/ModesDropdown';
import DictationButton from '@/components/composer/DictationButton';
import Composer, { ObserverWell } from '@/components/composer/Composer';
import EffortControl from '@/components/composer/EffortControl';
import VoiceModeButton from '@/components/voice/VoiceModeButton';
import { LiveCallOverlay } from '@/components/voice/LiveCallOverlay';
import { speak, stopSpeaking } from '@/lib/voicePlayback';
import { useDictation } from '@/hooks/useDictation';
import { useAgentSettingsStore } from '@/stores/agentSettingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDrawerStore } from '@/stores/drawerStore';
import { useTokenGateStore } from '@/stores/tokenGateStore';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useLucaGuideStore } from '@/stores/lucaGuideStore';

import EchoField from '@/components/EchoField';
import ExpressiveField from '@/components/ExpressiveField';
import ConnectOpenRouter from '@/components/ConnectOpenRouter';
import RichBody from '@/components/rich/RichBody';
import AttachmentDropOverlay from '@/components/attachments/AttachmentDropOverlay';
import AttachmentChip from '@/components/attachments/AttachmentChip';
import AttachmentSourceControl from '@/components/attachments/AttachmentSourceControl';
import CouncilPanel from '@/components/messages/CouncilPanel';
import MessageItem from '@/components/messages/MessageItem';
import PermissionInline from '@/components/permissions/PermissionInline';
import WelcomeBackCard from '@/components/chat/WelcomeBackCard';
import LandingAmbient from '@/components/chat/LandingAmbient';
import AgentErroredCard from '@/components/states/AgentErroredCard';
import ArtifactChip, { StreamingArtifactChip } from '@/components/canvas/ArtifactChip';
import { useArtifactStore } from '@/stores/artifactStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAttachmentStore, type Attachment } from '@/stores/attachmentStore';
import type { Message, MessageAttachment as PersistedAttachment } from '@/stores/threadStore';
import SubAgentRow from '@/components/subagents/SubAgentRow';
import { useSubAgentStore } from '@/stores/subAgentStore';
import { useAgentConsultRealtime } from '@/hooks/useAgentConsultRealtime';
import AgentDialogueChip from '@/components/agents/AgentDialogueChip';
import AgentForgeCard from '@/components/agents/AgentForgeCard';
import { shapeForAgent, GENESIS_POOL } from '@/lib/genesisShapes';
import { useAgentConsultStore, selectByThread as selectConsultsByThread } from '@/stores/agentConsultStore';
import { supabase } from '@/integrations/supabase/client';
import { parseEdgeError, friendlyMessage } from '@/lib/edgeError';
import { insertMessageWithFreshSession, isMessagePersistenceAuthError } from '@/lib/messagePersistence';
import {
  clearLandingChatTransitionFlag,
  consumeLandingAutosendFlag,
  consumeLandingHiddenHandoffFlag,
  readLandingChatTransitionFlag,
  readLandingPrompt,
} from '@/lib/guestChat';
import { getForgeProposalMetadata } from '@/lib/agentForge';
import { resolveAccessTier, type ModelKeyStatus } from '@/lib/accessTier';
import { appendStreamingDelta } from '@/lib/streamingText';
import { extractStreamingArtifacts } from '@/lib/streamingArtifacts';
import {
  normalizeStreamComparableContent,
  shouldHideStreamingMirrorMessage,
} from '@/lib/streamingMirror';
import { looksLikeSimulationTurnRequest, withClientSimulationTurnDirective } from '@/lib/simulationTurnIntent';
import CanvasPane from '@/components/canvas/CanvasPane';
import {
  DEFAULT_CHAT_MODEL,
  defaultRuntimeForAgent,
  getChatModelCapabilities,
  getChatModelLabel,
  getChatModelReasoningEfforts,
  getReasoningEffortLabel,
  normalizeChatModelReasoningEffort,
  normalizeChatTargetPreference,
  normalizeThreadRuntimeMode,
  type ReasoningEffort,
} from '@/lib/chatRuntime';
import { clearHighlightCache } from '@/components/rich/highlightCache';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  getChatAttachmentAccept,
  isChatAttachmentSupported,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS,
} from '@/lib/chatAttachments';
import {
  bindChatAttachments,
  cancelChatAttachment,
  descriptorToLegacyAttachment,
  retryChatAttachment,
  uploadChatAttachment,
} from '@/lib/attachmentApi';
import { getStreamRevealAdvance, STREAM_SNAPSHOT_INTERVAL_MS } from '@/lib/chatPerformance';

/* ─── Smooth, rate-limited typewriter hook ───
 * Decouples reveal speed from network chunk delivery. Maintains a steady
 * cadence (~60 chars/sec) that ramps up gracefully if the buffer falls behind.
 */
/* ─── Smooth, rate-limited typewriter hook ───
 * Decouples reveal speed from network chunk delivery. Maintains a steady
 * cadence that ramps gracefully when the buffer falls behind, capped so
 * bursts don't dump. Skips setState when nothing advances so React doesn't
 * re-render the streaming bubble idly.
 */
function useSmoothTypewriter(target: string, active = true) {
  const [displayed, setDisplayed] = useState(active ? '' : target);
  const displayedRef = useRef(displayed);
  const targetRef = useRef(target);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const prevTargetRef = useRef('');
  // Exponential moving average of the gap, so cadence eases instead of
  // stair-stepping when bursts of tokens land.
  const gapEmaRef = useRef(0);

  useEffect(() => { targetRef.current = target; }, [target]);

  useEffect(() => {
    if (!active) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    // Detect a brand-new message (target no longer extends prior target):
    // reset the buffer and EMA so cadence doesn't start mid-curve.
    if (!target.startsWith(prevTargetRef.current) || prevTargetRef.current === '') {
      if (!target.startsWith(prevTargetRef.current)) {
        displayedRef.current = '';
        setDisplayed('');
        gapEmaRef.current = 0;
        lastTickRef.current = 0;
      }
    }
    prevTargetRef.current = target;

    const tick = (now: number) => {
      if (!lastTickRef.current) lastTickRef.current = now;
      const elapsed = Math.min(now - lastTickRef.current, 64); // clamp huge frames
      lastTickRef.current = now;

      const tgt = targetRef.current;
      const curLen = displayedRef.current.length;
      const gap = tgt.length - curLen;

      if (gap > 0) {
        // Smoothed gap with EMA so cadence rises and falls gracefully.
        // Tighter factor (0.92/0.08) absorbs token bursts over ~12 frames
        // instead of ~5, eliminating the visible accel/decel that made the
        // reveal feel token-by-token.
        gapEmaRef.current = gapEmaRef.current * 0.92 + gap * 0.08;
        const smoothedGap = gapEmaRef.current;

        const advance = getStreamRevealAdvance(elapsed, smoothedGap);
        const nextLen = Math.min(tgt.length, curLen + advance);
        if (nextLen !== curLen) {
          const next = tgt.slice(0, nextLen);
          displayedRef.current = next;
          setDisplayed(next);
        }
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Caught up — go idle. We re-arm via the effect when target grows.
        lastTickRef.current = 0;
        rafRef.current = 0;
      }
    };

    // Only start the loop if there's actually work to do; otherwise the
    // next target change re-runs this effect and starts it then.
    if (displayedRef.current.length < target.length) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      displayedRef.current = target;
      setDisplayed(target);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = 0;
    };
  }, [active, target]);

  return displayed;
}


/* ─── Smooth streaming text component ───
 * Holds the cursor through the typewriter catch-up phase, then fades it out
 * and signals onSettled so the parent can swap to the persisted message
 * without any visible flash.
 */
function StreamingText({
  content,
  isStreaming,
  className,
  style,
  onSettled,
}: {
  content: string;
  isStreaming: boolean;
  className?: string;
  style?: React.CSSProperties;
  onSettled?: () => void;
}) {
  const displayed = useSmoothTypewriter(content, true);
  const settled = !isStreaming && displayed.length === content.length && content.length > 0;
  const [cursorFading, setCursorFading] = useState(false);
  const settledFiredRef = useRef(false);

  // When settled, fade cursor then notify parent
  useEffect(() => {
    if (!settled) {
      setCursorFading(false);
      settledFiredRef.current = false;
      return;
    }
    setCursorFading(true);
    const t = setTimeout(() => {
      if (!settledFiredRef.current) {
        settledFiredRef.current = true;
        onSettled?.();
      }
    }, 240);
    return () => clearTimeout(t);
  }, [settled, onSettled]);

  // Throttle markdown reparse: re-render the tree only when the displayed
  // text grew by ≥8 chars, crossed a markdown boundary (newline / fence /
  // list marker), or finished settling. Cuts reparse cost dramatically on
  // long replies and keeps the typewriter at 60fps.
  const lastTreeLenRef = useRef(0);
  const treeSourceLen = useMemo(() => {
    const prev = lastTreeLenRef.current;
    const cur = displayed.length;
    if (cur === 0) { lastTreeLenRef.current = 0; return 0; }
    if (settled || !isStreaming) { lastTreeLenRef.current = cur; return cur; }
    // 4-char threshold (was 8) keeps the markdown tree fresher during
    // quiet stretches between bursts — feels more continuous.
    if (cur - prev >= 4) { lastTreeLenRef.current = cur; return cur; }
    const tail = displayed.slice(prev);
    if (/[\n`*_>#-]/.test(tail)) { lastTreeLenRef.current = cur; return cur; }
    return prev;
  }, [displayed, settled, isStreaming]);

  const tree = useMemo(
    () => <RichBody source={displayed.slice(0, treeSourceLen)} streaming suppressArtifactFences />,
    [displayed, treeSourceLen]
  );

  return (
    <div className={className} style={style}>
      {tree}
      <span className={`streaming-cursor-inline${cursorFading ? ' fading' : ''}`} />
    </div>
  );
}

/* ─── Static message renderer (delegates to RichBody for unified styling) ─── */
function MessageContent({ content }: { content: string }) {
  return <RichBody source={content} />;
}

/* ─── Live artifacts extracted from the in-progress stream ───
   Memoized + isolated so the per-render scan only re-runs when the stream
   content (or thread/user) actually changes — not on every unrelated ChatView
   re-render (input keystrokes, scroll, focus, drag state, etc.). */
const StreamingArtifacts = React.memo(function StreamingArtifacts({
  content,
  threadId,
  userId,
}: {
  content: string;
  threadId: string;
  userId: string;
}) {
  const artifacts = useMemo(
    () => extractStreamingArtifacts(content, { threadId, userId }),
    [content, threadId, userId],
  );
  return (
    <>
      {artifacts.map((art) => (
        <StreamingArtifactChip key={art.id} artifact={art} />
      ))}
    </>
  );
});

function getAgentDisplayName(agentId: string | null | undefined, names: Map<string, string>) {
  if (!agentId) return 'Luca';
  const fromStore = names.get(agentId);
  if (fromStore) return fromStore;
  if (agentId === 'guardian' || agentId === 'observer') return 'Observer';
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
}

function LucaOnlyPill({
  label = 'luca',
  title = 'Talking to Luca',
}: {
  label?: string;
  title?: string;
}) {
  return (
    <button type="button" className="agent-pill targeted luca-only-pill" title={title} aria-label={title}>
      {label}
    </button>
  );
}

/* ─── Thinking Block (4-state: waiting → streaming → settling → complete) ─── */
type ThinkingState = 'waiting' | 'streaming' | 'settling' | 'complete';

function peekContent(text: string): string {
  const lines = text.split('\n').filter(Boolean);
  return lines.slice(-2).join('\n');
}

function thinkingLabel(state: ThinkingState): string {
  switch (state) {
    case 'waiting': return 'thinking\u2026';
    case 'streaming': return 'reasoning\u2026';
    case 'settling': return 'settling\u2026';
    case 'complete': return 'thought';
  }
}

function compactTraceValue(value: unknown, max = 180): string {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function humanToolName(tool: unknown): string {
  return String(tool || 'tool').replace(/_/g, ' ');
}

function agentTraceLine(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const tool = humanToolName(data.tool);
  if (data.type === 'agent_runtime') {
    return data.status === 'starting' ? 'Preparing Luca.' : `Luca ${data.status || 'updated'}.`;
  }
  if (data.type === 'tool_progress') {
    return typeof data.text === 'string' ? data.text : `${tool} is running.`;
  }
  if (data.type === 'tool_start') {
    if (data.tool === 'memory_read') return 'Checking continuity and memory context.';
    if (data.tool === 'web_search' || data.tool === 'read_url') return null;
    return `Using ${tool}.`;
  }
  if (data.type === 'tool_result') {
    const output = compactTraceValue(data.output);
    return output ? `${tool} finished: ${output}` : `${tool} finished.`;
  }
  return null;
}

function ThinkingBlock({
  content,
  state,
  duration,
  customLabel,
}: {
  content: string;
  state: ThinkingState;
  duration?: number;
  /** Overrides the state-derived label. Used to fold the council phase
   *  indicator (voices / deliberating / reviewing / speaking) into this
   *  same beautiful element instead of a separate 3-dot widget. */
  customLabel?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = state === 'waiting' || state === 'streaming' || state === 'settling';

  const peek = useMemo(() => peekContent(content), [content]);

  if (!content && state === 'complete') return null;

  const dataState = state;

  return (
    <div className={`thinking-block${expanded ? ' expanded' : ''}`} data-state={dataState}>
      {/* Header */}
      <div
        className="thinking-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {/* 3x3 Murmur Dot Grid — prime-derived timing per dot */}
        <div className="thinking-dots" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => <span key={i} className="td" />)}
        </div>

        {/* Shimmer label */}
        <span className="thinking-label">{customLabel || thinkingLabel(state)}</span>

        {/* Duration timer */}
        {duration != null && duration > 0 && (
          <span className="thinking-timer">{Math.round(duration)}s</span>
        )}

        {/* Token estimate (complete only) */}
        {state === 'complete' && content && (
          <span className="thinking-timer">{Math.ceil(content.length / 4)} tokens</span>
        )}

        {/* Chevron */}
        <span className="thinking-chevron" aria-hidden="true">›</span>
      </div>

      {/* Peek window — visible during streaming/settling, hidden when expanded */}
      {content && (
        <div className="thinking-peek">
          <div className="thinking-peek-inner">{peek}</div>
        </div>
      )}

      {/* Full body — revealed when expanded */}
      <div className="thinking-body">
        <div className="thinking-body-content">
          <div className="thinking-body-text">
            {content}
            {isActive && <span className="streaming-cursor-inline" />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Multi-model helpers ─── */
function isMultiModelThinking(thinkingContent: string): boolean {
  try {
    const parsed = JSON.parse(thinkingContent);
    return parsed?.type === 'multi_model' && Array.isArray(parsed?.variants);
  } catch { return false; }
}

function parseMultiModelVariants(thinkingContent: string): Array<{ model: string; content: string }> {
  try {
    const parsed = JSON.parse(thinkingContent);
    if (parsed?.type === 'multi_model' && Array.isArray(parsed?.variants)) {
      return parsed.variants;
    }
  } catch {
    // Thinking content can be legacy plain text.
  }
  return [];
}

/* ─── Live activity context strip ───
 * Renders SubAgentRow + AgentDialogueChip when either has live state for
 * the active thread. Otherwise returns null so the conversation starts
 * flush against the natural top of the message column. */
function ContextStrip() {
  const subAgents = useSubAgentStore((s) => s.agents);
  const currentThreadId = useThreadStore((s) => s.currentThreadId);
  const consults = useAgentConsultStore(selectConsultsByThread(currentThreadId));
  const hasSubAgents = useMemo(
    () => !!currentThreadId && Object.values(subAgents).some((a) => a.parentAgent === 'luca' && a.threadId === currentThreadId),
    [subAgents, currentThreadId],
  );
  if (!hasSubAgents && consults.length === 0) return null;
  return (
    <div
      style={{
        marginBottom: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <SubAgentRow parentAgent="luca" threadId={currentThreadId} />
      <AgentDialogueChip />
    </div>
  );
}

/* ─── Animated row wrapper ───
 * Plays the entry animation only on the row's first mount, so re-renders
 * triggered by streaming tokens (or any list reflow) don't re-pop existing
 * rows. CSS handles the actual keyframes via the [data-fresh] selector.
 */
function FreshMsgRow({ children, className = 'msg-row', style }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fresh = useFirstMount();
  return (
    <div className={className} data-fresh={fresh ? 'true' : undefined} style={style}>
      {children}
    </div>
  );
}

/* ─── Main ChatView ─── */

/**
 * Does this browser auto-size a textarea from its content? Cached once: the
 * answer cannot change for the life of the page, and the composer asks on
 * every keystroke.
 */
let fieldSizingSupport: boolean | null = null;
function supportsFieldSizing(): boolean {
  if (fieldSizingSupport === null) {
    fieldSizingSupport =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('field-sizing', 'content');
  }
  return fieldSizingSupport;
}

type FirstTurnHandoff = {
  id: string;
  text: string;
  agentLabel: string;
  attachmentCount: number;
  startedAt: string;
};

type ChatRetryTarget = {
  runtimeMode: 'classic' | 'agent';
  modelId: string;
  agentId: string;
  targetLabel: string;
  reasoningEffort: ReasoningEffort;
};

type SendMessageOptions = {
  text?: string;
  attachments?: PersistedAttachment[];
  hiddenHandoff?: boolean;
  target?: ChatRetryTarget;
};

export default function ChatView() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const setSidebarVisible = useSidebarStore((s) => s.setVisible);
  const sidebarVisible = useSidebarStore((s) => s.visible);

  const [landingThreadEnter] = useState(() => readLandingChatTransitionFlag());

  // iOS Safari keyboard handling: with `interactive-widget=resizes-content`
  // in the viewport meta + `100dvh` on the shell, the layout reflows
  // automatically when the keyboard opens. We just nudge the scroller
  // back to the bottom on resize so the latest message stays visible.
  React.useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const scroller = document.querySelector('.chat-scroll-area') as HTMLElement | null;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    vv.addEventListener('resize', onResize);
    return () => { vv.removeEventListener('resize', onResize); };
  }, [isMobile]);

  React.useLayoutEffect(() => {
    if (landingThreadEnter && !isMobile) {
      setSidebarVisible(false);
    }
    if (!landingThreadEnter) return;
    const timeout = window.setTimeout(() => clearLandingChatTransitionFlag(), 900);
    return () => window.clearTimeout(timeout);
  }, [landingThreadEnter, isMobile, setSidebarVisible]);

  // Reactive viewport-aware sphere size for mobile. Scales with both width
  // and height so the field always has a comfortable margin and never
  // collides with the app bar / wordmark / composer.
  const [mobileFieldSize, setMobileFieldSize] = React.useState(() => {
    if (typeof window === 'undefined') return 320;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return Math.max(220, Math.min(460, Math.min(w * 0.88, h * 0.48)));
  });
  React.useEffect(() => {
    if (!isMobile) return;
    const recompute = () => {
      const vv = window.visualViewport;
      const w = vv?.width ?? window.innerWidth;
      const h = vv?.height ?? window.innerHeight;
      setMobileFieldSize(Math.round(Math.max(220, Math.min(460, Math.min(w * 0.88, h * 0.48)))));
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.visualViewport?.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
      window.visualViewport?.removeEventListener('resize', recompute);
    };
  }, [isMobile]);

  const user = useAuthStore((s) => s.user);
  const tokenGateStatus = useTokenGateStore((s) => s.status);
  // Narrow selectors — the parent renders the *list shell* and the
  // streaming bubble. Individual messages are handled by <MessageItem>,
  // which subscribes to its own row. This split is what makes per-token
  // streaming stop re-rendering the whole thread.
  const messages = useThreadStore((s) => s.messages);
  const currentThreadId = useThreadStore((s) => s.currentThreadId);
  const isStreaming = useThreadStore((s) => s.isStreaming);
  const streamingContent = useThreadStore((s) => s.streamingContent);
  const streamingThinking = useThreadStore((s) => s.streamingThinking);
  const threads = useThreadStore((s) => s.threads);
  const loadMessages = useThreadStore((s) => s.loadMessages);
  const loadOlderMessages = useThreadStore((s) => s.loadOlderMessages);
  const hasOlderMessages = useThreadStore((s) => s.hasOlderMessages);
  const loadingOlderMessages = useThreadStore((s) => s.loadingOlderMessages);
  const subscribeMessages = useThreadStore((s) => s.subscribeMessages);
  const setCurrentThread = useThreadStore((s) => s.setCurrentThread);
  const createThread = useThreadStore((s) => s.createThread);
  const addMessage = useThreadStore((s) => s.addMessage);
  const patchMessage = useThreadStore((s) => s.patchMessage);
  const setStreaming = useThreadStore((s) => s.setStreaming);
  const setStreamingContent = useThreadStore((s) => s.setStreamingContent);
  const setStreamingThinking = useThreadStore((s) => s.setStreamingThinking);
  const loadThreads = useThreadStore((s) => s.loadThreads);
  const updateThreadAgent = useThreadStore((s) => s.updateThreadAgent);
  const updateThreadSelectedModel = useThreadStore((s) => s.updateThreadSelectedModel);
  const setGuideOpen = useLucaGuideStore((s) => s.setOpen);
  const loadArtifacts = useArtifactStore((s) => s.loadForThread);
  const addLocalArtifacts = useArtifactStore((s) => s.addLocalArtifacts);
  const artifactsByThread = useArtifactStore((s) => s.byThread);
  const canvasWidth = useCanvasStore((s) => s.width);
  const canvasIsOpen = useCanvasStore((s) => s.isOpen);
  const canvasFullscreen = useCanvasStore((s) => s.fullscreen);
  const openCanvas = useCanvasStore((s) => s.open);
  const markCanvasSeen = useCanvasStore((s) => s.markSeen);
  // Set true right before reloading artifacts after a finished turn, so the
  // canvas auto-opens for a freshly-created artifact (but not on thread revisit).
  const justStreamedRef = useRef(false);
  const threadArtifacts = useMemo(
    () => currentThreadId ? (artifactsByThread[currentThreadId] || []) : [],
    [artifactsByThread, currentThreadId],
  );
  const agents = useAgentSettingsStore((s) => s.agents);
  const agentsLoading = useAgentSettingsStore((s) => s.loading);
  const loadAgentSettings = useAgentSettingsStore((s) => s.load);
  const currentThread = threads.find((t) => t.id === currentThreadId);
  const showThinking = useSettingsStore((s) => s.show_thinking);
  const showTimestamps = useSettingsStore((s) => s.show_timestamps);
  const defaultModel = useSettingsStore((s) => s.default_model);
  const defaultEffort = useSettingsStore((s) => s.reasoning_effort);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const setLastChatTarget = useSettingsStore((s) => s.setLastChatTarget);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const persistedLastTargetKind = useSettingsStore((s) => s.last_chat_target_kind);
  const persistedLastTargetId = useSettingsStore((s) => s.last_chat_target_id);
  const initialTarget = normalizeChatTargetPreference(
    useSettingsStore.getState().last_chat_target_kind,
    useSettingsStore.getState().last_chat_target_id || useSettingsStore.getState().landing_agent_id,
    useSettingsStore.getState().default_model || DEFAULT_CHAT_MODEL,
  );
  const [pendingTargetKind, setPendingTargetKind] = useState<'agent' | 'model'>(initialTarget.kind);
  const [pendingAgentId, setPendingAgentId] = useState<string>(() => {
    if (initialTarget.kind !== 'agent') return 'luca';
    if (initialTarget.id === 'luca') return 'luca';
    const knownAgents = useAgentSettingsStore.getState().agents;
    return knownAgents.some((a) => a.id === initialTarget.id) ? initialTarget.id : 'luca';
  });
  const [pendingChatModelId, setPendingChatModelId] = useState(() => (
    initialTarget.kind === 'model' ? initialTarget.id : useSettingsStore.getState().default_model || DEFAULT_CHAT_MODEL
  ));
  const [agentSettingsLoadedForUser, setAgentSettingsLoadedForUser] = useState<string | null>(null);
  const activeAgentId = currentThread?.agent_id || pendingAgentId;

  const persistChatTarget = useCallback((target: ChatTarget) => {
    void setLastChatTarget(target);
  }, [setLastChatTarget]);
  // NOTE: ensemble is intentionally NOT read from settings here. The composer
  // toggle (⌘E / shift-click) is the sole source of truth so the visual state
  // always matches reality. The Settings page's `multi_model_enabled` row is
  // preserved for future use but does not auto-arm the composer.

  const [landingHiddenHandoff] = useState(() => consumeLandingHiddenHandoffFlag());
  const [landingInitialPrompt] = useState(() => readLandingPrompt());
  const hiddenLandingPromptRef = useRef(landingHiddenHandoff ? landingInitialPrompt : '');
  const [input, setInput] = useState(() => landingHiddenHandoff ? '' : landingInitialPrompt);
  const [forgeBusyById, setForgeBusyById] = useState<Record<string, boolean>>({});
  const [forgeErrorById, setForgeErrorById] = useState<Record<string, string | null>>({});
  const [landingAutosend] = useState(() => consumeLandingAutosendFlag());
  const [focused, setFocused] = useState(false);
  const [firstTurnHandoff, setFirstTurnHandoff] = useState<FirstTurnHandoff | null>(null);
  const [composerSending, setComposerSending] = useState(false);
  const [liveCallOpen, setLiveCallOpen] = useState(false);
  const lastSpokenIdRef = useRef<string | null>(null);
  const [alcoveOpen, setAlcoveOpen] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>(defaultEffort || 'medium');
  // Ensemble skill: armed = next message only; locked = persistent until toggled off
  const [ensembleArmed, setEnsembleArmed] = useState(false);
  const [ensembleLocked, setEnsembleLocked] = useState(false);
  const rawEnsembleActive = ensembleArmed || ensembleLocked;
  const [modelKeyStatus, setModelKeyStatus] = useState<ModelKeyStatus>('checking');
  const accessTier = useMemo(
    () => resolveAccessTier({ user, modelKeyStatus, gateStatus: tokenGateStatus }),
    [user, modelKeyStatus, tokenGateStatus],
  );
  const byokEnabled = accessTier === 'byok';
  const ensembleActive = byokEnabled && rawEnsembleActive;
  const threadRuntimeMode = currentThread
    ? normalizeThreadRuntimeMode(currentThread.runtime_mode, 'agent')
    : (pendingTargetKind === 'model' ? 'classic' : defaultRuntimeForAgent(activeAgentId));
  const selectedChatModel = currentThread?.selected_model || pendingChatModelId || defaultModel || DEFAULT_CHAT_MODEL;
  const supportedReasoningEfforts = useMemo(
    () => getChatModelReasoningEfforts(selectedChatModel),
    [selectedChatModel],
  );
  const effectiveThinkingEffort = normalizeChatModelReasoningEffort(selectedChatModel, thinkingEffort);
  const reasoningEffortFixed = supportedReasoningEfforts.length === 1;
  const classicChatActive = threadRuntimeMode === 'classic';
  const activeModelCapabilities = useMemo(
    () => classicChatActive ? getChatModelCapabilities(selectedChatModel) : null,
    [classicChatActive, selectedChatModel],
  );
  const activeAttachmentAccept = useMemo(
    () => getChatAttachmentAccept(activeModelCapabilities?.inputModalities),
    [activeModelCapabilities],
  );
  const effectiveRuntimeMode = classicChatActive ? 'classic' : 'agent';
  const activeMessageAgent = classicChatActive ? null : activeAgentId;
  const memoryEnabled = currentThread?.memory_enabled !== false;

  // Dictation — Web Speech API → composer textarea. Final segments append
  // to `input` with a separating space. ExpressiveField listens for
  // `dictationListening` to flip into 'listening' state. The mic button
  // toggles via toggleDictation below.
  const {
    isListening: dictationListening,
    supported: dictationSupported,
    start: startDictation,
    stop: stopDictation,
  } = useDictation({
    onResult: (text, isFinal) => {
      if (!isFinal) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      setInput((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${trimmed}` : trimmed));
    },
  });
  const toggleDictation = useCallback(() => {
    if (dictationListening) stopDictation();
    else startDictation();
  }, [dictationListening, startDictation, stopDictation]);

  // Allow inline UI (e.g. ImageCard "Edit with prompt") to prefill the
  // composer and optionally auto-send. Listens for window event dispatched
  // from MediaLightbox/ImageCard.
  const sendMessageRef = useRef<((opts?: SendMessageOptions) => void) | null>(null);
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const text: string = detail.text || '';
      if (!text) return;
      setInput(text);
      if (detail.autoSend) {
        setTimeout(() => { void sendMessageRef.current?.({ text }); }, 30);
      }
    };
    window.addEventListener('luca:prefill-composer', onPrefill as EventListener);
    return () => window.removeEventListener('luca:prefill-composer', onPrefill as EventListener);
  }, []);
  // Observer enclave state. DB rows keep the legacy agent tag "guardian".
  const [guardianMessages, setGuardianMessages] = useState<Array<{ role: string; content: string; created_at?: string }>>([]);
  const [guardianStreaming, setGuardianStreaming] = useState(false);
  const [guardianStreamingContent, setGuardianStreamingContent] = useState('');
  const guardianScrollRef = useRef<HTMLDivElement>(null);
  const [streamingVariants, setStreamingVariants] = useState<Array<{ model: string; content: string; thinking?: string | null }>>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  // Council (LLM-Council pattern) streaming state. Captures peer-rank judge output
  // and aggregate ordering as Stage 2 events arrive over SSE (legacy 'council' shape).
  type RankingEntry = { judge_model: string; raw_text: string; parsed_ranking: string[] };
  type AggregateEntry = { model: string; avg_rank: number; rankings_count: number };
  const [streamingRankings, setStreamingRankings] = useState<RankingEntry[]>([]);
  const [streamingAggregate, setStreamingAggregate] = useState<AggregateEntry[]>([]);
  // Council v2 streaming state — three character proposers + cross-pollination
  // + chairman verdict + critique. Final message hydrates these into
  // msg.metadata kind='council_v2'.
  type CouncilV2Character = 'luca' | 'anima' | 'vektor';
  type CouncilV2Proposer = { character: CouncilV2Character; content: string; thinking?: string | null };
  type CouncilV2Crosstalk = { character: CouncilV2Character; content: string; source?: string };
  type CouncilV2Critique = { voice_drift_detected: boolean; confidence: number; critique: string; suggested_revision: string | null };
  const [streamingProposers, setStreamingProposers] = useState<CouncilV2Proposer[]>([]);
  const [streamingCrosstalk, setStreamingCrosstalk] = useState<CouncilV2Crosstalk[]>([]);
  const [streamingVerdict, setStreamingVerdict] = useState<'synthesize' | 'diverge' | null>(null);
  const [streamingCritique, setStreamingCritique] = useState<CouncilV2Critique | null>(null);
  const [streamingRevised, setStreamingRevised] = useState<string | null>(null);
  type CouncilPhase = 'idle' | 'voices' | 'deliberating' | 'speaking' | 'critiquing';
  const [councilPhase, setCouncilPhase] = useState<CouncilPhase>('idle');
  // Alive-feeling features
  const [welcomeBack, setWelcomeBack] = useState<{ type: 'journal' | 'thought' | 'initiation'; content: string } | null>(null);
  const [dynamicPlaceholder, setDynamicPlaceholder] = useState('Message Luca...');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeClientTurnIdRef = useRef<string | null>(null);
  const cancelRequestedTurnIdRef = useRef<string | null>(null);
  const activeSendTargetRef = useRef<ChatRetryTarget | null>(null);
  const guardianAbortRef = useRef<AbortController | null>(null);
  const inputCaptureRef = useRef('');
  const sendInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadBatchIdRef = useRef(crypto.randomUUID());
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const landingHandoffStartedAtRef = useRef(new Date().toISOString());
  const pendingAttachments = useAttachmentStore((s) => s.pending);
  const addAttachments = useAttachmentStore((s) => s.add);
  const removeAttachment = useAttachmentStore((s) => s.remove);
  const clearAttachments = useAttachmentStore((s) => s.clear);
  const setAttachmentStatus = useAttachmentStore((s) => s.setStatus);
  const retryAttachmentInStore = useAttachmentStore((s) => s.retry);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentSendBlocked = pendingAttachments.some((attachment) => attachment.status !== 'ready');
  // Real Luca/custom-agent chat requires the user's OpenRouter key. The free
  // platform model is reserved for the Polyphonic Guide, not agent continuity.
  const modelKeyMissing = modelKeyStatus !== 'present';
  const showFreeTierUpsell = modelKeyMissing;

  useEffect(() => {
    if (currentThread?.selected_model) {
      setPendingChatModelId(currentThread.selected_model);
      return;
    }
    if (!currentThread && defaultModel) {
      setPendingChatModelId(defaultModel);
    }
  }, [currentThread?.id, currentThread?.selected_model, currentThread, defaultModel]);

  const openPolyphonicGuide = useCallback(() => {
    setGuideOpen(true);
    navigate(threadId ? `/chat/${threadId}?guide=1` : '/chat?guide=1', { replace: true });
  }, [navigate, setGuideOpen, threadId]);

  useEffect(() => {
    // Access tier isn't known until the model-key probe resolves. Wait until
    // it settles before disarming BYOK-only composer extras.
    if (modelKeyStatus === 'checking') return;
    if (byokEnabled) return;
    if (ensembleArmed) setEnsembleArmed(false);
    if (ensembleLocked) setEnsembleLocked(false);
  }, [modelKeyStatus, byokEnabled, ensembleArmed, ensembleLocked]);

  useEffect(() => {
    if (!user?.id) {
      setAgentSettingsLoadedForUser(null);
      return;
    }
    let canceled = false;
    setAgentSettingsLoadedForUser(null);
    void loadAgentSettings(user.id).finally(() => {
      if (!canceled) setAgentSettingsLoadedForUser(user.id);
    });
    return () => { canceled = true; };
  }, [user?.id, loadAgentSettings]);

  // Keep bare /chat in lockstep with the last chat target. Scoped to the empty
  // landing only: existing thread routes always win from their persisted row.
  useEffect(() => {
    if (threadId || currentThreadId) return; // empty landing only
    if (!settingsLoaded) return;
    const target = normalizeChatTargetPreference(persistedLastTargetKind, persistedLastTargetId, defaultModel || DEFAULT_CHAT_MODEL);
    if (target.kind === 'model') {
      setPendingTargetKind('model');
      setPendingAgentId('luca');
      setPendingChatModelId(target.id);
      return;
    }

    const wantsCustom = target.id !== 'luca';
    if (wantsCustom && (agentsLoading || agentSettingsLoadedForUser !== user?.id)) return;
    const persistedAgentStillExists = wantsCustom && agents.some((a) => a.id === target.id);
    const agentId = persistedAgentStillExists ? target.id : 'luca';
    if (wantsCustom && !persistedAgentStillExists) {
      persistChatTarget({ kind: 'agent', id: 'luca' });
    }
    setPendingTargetKind('agent');
    setPendingAgentId((prev) => (prev === agentId ? prev : agentId));
  }, [settingsLoaded, persistedLastTargetKind, persistedLastTargetId, defaultModel, threadId, currentThreadId, agents, agentsLoading, agentSettingsLoadedForUser, user?.id, persistChatTarget]);

  useEffect(() => {
    if (!user) {
      setModelKeyStatus('unknown');
      return;
    }

    let canceled = false;
    setModelKeyStatus('checking');
    (async () => {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data, error } = await supabase
          .from('user_api_keys')
          .select('key_preview')
          .maybeSingle();
        if (canceled) return;
        if (error) {
          setModelKeyStatus('unknown');
          return;
        }
        setModelKeyStatus(data?.key_preview ? 'present' : 'missing');
      } catch {
        if (!canceled) setModelKeyStatus('unknown');
      }
    })();

    return () => { canceled = true; };
  }, [user?.id]);

  // Skip the route-mount viewFadeIn animation when this mount is the result
  // of a fresh-thread send (sessionStorage flag set by sendMessage just before
  // navigate). Prevents the layered fade-out/fade-in jumpiness when the user
  // sends the very first message in a brand-new thread.
  const [skipMountFade] = useState(() => {
    try {
      const flag = sessionStorage.getItem('luca:freshSendNav');
      if (flag) {
        sessionStorage.removeItem('luca:freshSendNav');
        return true;
      }
    } catch { /* */ }
    return false;
  });

  // Lingering streaming snapshot — keeps the streaming bubble mounted
  // after isStreaming flips to false, until BOTH (a) the typewriter has
  // caught up AND (b) the canonical assistant message has landed in
  // messages[]. This closes the timing gap that produced the settle flicker
  // (where the bubble unmounted before the canonical row was visible).
  const [lingeringStream, setLingeringStream] = useState<string | null>(null);
  const typewriterSettledRef = useRef(false);
  const completedStreamMessageIdRef = useRef<string | null>(null);
  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents]
  );
  const currentAgentLabel = getAgentDisplayName(activeAgentId, agentNameById);
  const currentResponderLabel = classicChatActive ? getChatModelLabel(selectedChatModel) : currentAgentLabel;
  // Empty-thread hero identity — a custom agent shows its own deterministic
  // signature shape + name; Luca keeps the default sphere/echo/torus +
  // "polyphonic" wordmark.
  const isCustomAgent = !!activeAgentId && activeAgentId !== 'luca';
  const heroShape = isCustomAgent
    ? shapeForAgent(activeAgentId, GENESIS_POOL)
    : (ensembleActive ? 10 : 0);
  const heroLabel = isCustomAgent ? currentAgentLabel : 'polyphonic';
  const readonlyAgentPillLabel = activeAgentId === 'luca' ? 'luca' : currentAgentLabel.toLowerCase();
  const readonlyAgentPillTitle = activeAgentId === 'luca'
    ? 'Talking to Luca'
    : `${currentAgentLabel} is selected. Custom agents require your own OpenRouter key to reply.`;
  const handleAgentChange = useCallback(async (id: string) => {
    if (!id) return;
    if (id === activeAgentId && !classicChatActive) return;
    setPendingTargetKind('agent');
    setPendingAgentId(id);
    persistChatTarget({ kind: 'agent', id });
    setEnsembleArmed(false);
    setEnsembleLocked(false);

    if (!currentThreadId) return;

    if (messages.length === 0) {
      await updateThreadAgent(currentThreadId, id);
      return;
    }

    if (!user) return;
    try {
      const nextThreadId = await createThread(user.id, id);
      navigate(`/chat/${nextThreadId}`);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Could not switch agents');
    }
  }, [
    activeAgentId,
    classicChatActive,
    persistChatTarget,
    currentThreadId,
    messages.length,
    user,
    updateThreadAgent,
    createThread,
    navigate,
  ]);
  const handleModelChange = useCallback(async (modelId: string) => {
    if (!modelId) return;
    if (modelId === selectedChatModel && classicChatActive) return;
    setPendingTargetKind('model');
    setPendingChatModelId(modelId);
    setPendingAgentId('luca');
    persistChatTarget({ kind: 'model', id: modelId });
    void updateSetting('default_model', modelId);
    setEnsembleArmed(false);
    setEnsembleLocked(false);

    if (!currentThreadId) return;
    try {
      if (messages.length === 0) {
        await updateThreadSelectedModel(currentThreadId, modelId);
        return;
      }
      if (!user) return;
      const nextThreadId = await createThread(user.id, 'luca', null, {
        runtimeMode: 'classic',
        selectedModel: modelId,
      });
      navigate(`/chat/${nextThreadId}`);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Could not switch models');
    }
  }, [
    activeAgentId,
    classicChatActive,
    currentThreadId,
    messages.length,
    navigate,
    persistChatTarget,
    selectedChatModel,
    user,
    createThread,
    updateSetting,
    updateThreadSelectedModel,
  ]);
  const activeChatTarget: ChatTarget = classicChatActive
    ? { kind: 'model', id: selectedChatModel }
    : { kind: 'agent', id: activeAgentId };
  const renderHeaderAgentSelector = () => (
    byokEnabled ? (
      <ChatTargetPicker
        activeTarget={activeChatTarget}
        onSelectAgent={(id) => { void handleAgentChange(id); }}
        onSelectModel={(id) => { void handleModelChange(id); }}
        variant="header"
      />
    ) : (
      <LucaOnlyPill label={readonlyAgentPillLabel} title={readonlyAgentPillTitle} />
    )
  );
  useEffect(() => {
    if (messages.length > 0 && firstTurnHandoff) {
      setFirstTurnHandoff(null);
    }
  }, [firstTurnHandoff, messages.length]);

  useEffect(() => {
    if (streamingContent) {
      setLingeringStream(streamingContent);
      typewriterSettledRef.current = false;
    }
  }, [isStreaming, streamingContent]);

  // Clear lingeringStream only when (a) typewriter has settled AND (b) a
  // recent canonical assistant message exists in messages[]. The canonical
  // message is what the dedupe filter currently hides; once we clear
  // lingeringStream, the dedupe condition flips false and the canonical
  // row pops in seamlessly.
  useEffect(() => {
    if (!lingeringStream || typewriterSettledRef.current === false) return;
    const activeStreamNorm = normalizeStreamComparableContent(lingeringStream);
    const completedStreamMessageId = completedStreamMessageIdRef.current;
    const recentAssistant = [...messages].reverse().find((m, offset) =>
      shouldHideStreamingMirrorMessage({
        message: m,
        isLast: offset === 0,
        isStreaming: false,
        lingeringStream,
        activeStreamNorm,
        activeMessageAgent,
        completedStreamMessageId,
      })
    );
    if (recentAssistant) {
      setLingeringStream(null);
    }
  }, [lingeringStream, messages, activeMessageAgent]);

  // Hard safety net independent of the typewriter callback. If the settle
  // signal is missed, do not leave a dim streaming shell beside the saved row.
  useEffect(() => {
    if (!lingeringStream || isStreaming) return;
    const timeout = setTimeout(() => {
      setLingeringStream(null);
    }, 2500);
    return () => clearTimeout(timeout);
  }, [lingeringStream, isStreaming]);

  // Auto-speak finished assistant messages via ElevenLabs TTS when the user
  // has enabled "Auto-speak replies" in Voice settings. Triggers once per
  // message id, after streaming settles, and only for the active agent's
  // latest assistant turn so we don't replay historical messages on load.
  const voiceAutospeak = useSettingsStore((s) => s.voice_autospeak);
  const defaultVoiceId = useSettingsStore((s) => s.default_voice_id);
  useEffect(() => {
    if (!voiceAutospeak || isStreaming) return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || !last.content?.trim()) return;
    if (lastSpokenIdRef.current === last.id) return;
    // Skip messages older than 30s (page load, history scroll) to avoid replaying.
    const ageMs = Date.now() - new Date(last.created_at).getTime();
    if (ageMs > 30_000) { lastSpokenIdRef.current = last.id; return; }
    lastSpokenIdRef.current = last.id;
    // Strip markdown fences / inline formatting for cleaner speech.
    const spoken = last.content
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_#>~]/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
    if (spoken) void speak(spoken, defaultVoiceId).catch((e) => console.error('autospeak failed', e));
  }, [messages, isStreaming, voiceAutospeak, defaultVoiceId]);

  // Stop any in-flight speech when leaving the chat view.
  useEffect(() => () => { stopSpeaking(); }, []);


  // User-scroll-aware auto-scroll. We follow the bottom of the stream as
  // long as the user is "pinned" there; the moment they scroll up, we stop
  // following and surface the scroll-to-bottom pill. Pinning resumes when
  // they scroll back to within `pinThreshold` of the bottom.
  const userPinnedRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const lastScrollAtRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pinThreshold = 96;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distance < pinThreshold;
      userPinnedRef.current = pinned;
      setShowScrollDown(!pinned && (isStreaming || messages.length > 0));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isStreaming, messages.length]);

  const scrollRafRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!userPinnedRef.current) return;
    if (isStreaming || streamingContent) {
      // Coalesce stream-driven scrolls into one per frame; instant scroll
      // (no smooth easing) so it tracks the typewriter without compounding.
      if (scrollRafRef.current) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        if (!userPinnedRef.current) return;
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [messages, streamingContent, streamingThinking, isStreaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    userPinnedRef.current = true;
    setShowScrollDown(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  const loadEarlierMessages = useCallback(async () => {
    if (!currentThreadId || loadingOlderMessages) return;
    const scroller = scrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    await loadOlderMessages(currentThreadId);
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = previousTop + (node.scrollHeight - previousHeight);
    });
  }, [currentThreadId, loadOlderMessages, loadingOlderMessages]);

  // Reload-mid-stream recovery — persist in-progress streamed content to
  // localStorage so a refresh during streaming surfaces the partial reply
  // as a recovered assistant message instead of vanishing.
  const STREAM_KEY = currentThreadId ? `luca:stream:${currentThreadId}` : null;
  useEffect(() => {
    if (!STREAM_KEY) return;
    if (!isStreaming) {
      try { localStorage.removeItem(STREAM_KEY); } catch { /* */ }
      return;
    }

    const persistSnapshot = () => {
      const stream = useThreadStore.getState();
      if (!stream.streamingContent) return;
      try {
        localStorage.setItem(STREAM_KEY, JSON.stringify({
          content: stream.streamingContent,
          thinking: stream.streamingThinking,
          agent: activeMessageAgent,
          updated_at: Date.now(),
        }));
      } catch { /* quota */ }
    };

    persistSnapshot();
    const interval = window.setInterval(persistSnapshot, STREAM_SNAPSHOT_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      persistSnapshot();
    };
  }, [STREAM_KEY, isStreaming, activeMessageAgent]);

  // On thread mount: if there's a stale in-progress snapshot from a prior
  // session, recover it as an assistant message tagged metadata.recovered.
  useEffect(() => {
    if (!currentThreadId || !user) return;
    const key = `luca:stream:${currentThreadId}`;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { /* */ }
    if (!raw) return;
    try {
      const snap = JSON.parse(raw);
      if (!snap?.content) { localStorage.removeItem(key); return; }
      // Only recover if it's >5s old (otherwise our own active stream wrote it)
      if (Date.now() - (snap.updated_at || 0) < 5000) return;
      // Avoid duplicate recovery if a matching message exists
      const exists = messages.some((m) => m.role === 'assistant' && m.content === snap.content);
      if (exists) { localStorage.removeItem(key); return; }
      addMessage({
        thread_id: currentThreadId, user_id: user.id, role: 'assistant',
        content: snap.content,
        model: null, agent: snap.agent ?? activeMessageAgent,
        thinking_content: snap.thinking || null,
        tokens_used: null, bookmarked: false,
        metadata: { recovered: true } as any,
      } as any);
      localStorage.removeItem(key);
    } catch { try { localStorage.removeItem(key); } catch { /* */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId, user?.id]);


  // Load guardian messages when alcove opens or thread changes.
  // Skip while streaming so we don't clobber an in-flight reply with stale DB state.
  useEffect(() => {
    if (!alcoveOpen || !currentThreadId || guardianStreaming) return;
    let cancelled = false;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data } = await supabase
        .from('messages')
        .select('role, content, agent, created_at')
        .eq('thread_id', currentThreadId)
        .eq('agent', 'guardian')
        .order('created_at', { ascending: true });
      if (cancelled || !data) return;
      setGuardianMessages(data as Array<{ role: string; content: string; created_at?: string }>);
    })();
    return () => { cancelled = true; };
  }, [alcoveOpen, currentThreadId, guardianStreaming]);

  // Auto-scroll guardian messages
  useEffect(() => {
    if (guardianScrollRef.current) {
      guardianScrollRef.current.scrollTop = guardianScrollRef.current.scrollHeight;
    }
  }, [guardianMessages, guardianStreamingContent]);

  useEffect(() => {
    if (!threadId) return;
    // Wipe the per-block syntax-highlight cache so a long session doesn't
    // accumulate completed snippets across every thread the user opens.
    clearHighlightCache();
    // Reset scroll-pin so a new thread auto-scrolls to bottom.
    userPinnedRef.current = true;
    setShowScrollDown(false);
    setCurrentThread(threadId);
    loadMessages(threadId);
    loadArtifacts(threadId);
    const unsub = subscribeMessages(threadId);
    return unsub;
  }, [threadId, loadMessages, loadArtifacts, setCurrentThread, subscribeMessages]);

  // Auto-open the canvas when a NEW artifact is created in this thread after a
  // finished turn — like Claude/ChatGPT. Existing artifacts are seeded as "seen"
  // on thread open without popping, so revisiting a thread never re-opens.
  // Kinds that render inline in the message (svg, simulation) never trigger
  // canvas auto-open — the user gets them right in the transcript and can
  // still click "Open in canvas" to escalate.
  useEffect(() => {
    const tid = currentThreadId;
    if (!tid) return;
    const list = artifactsByThread[tid] || [];
    if (list.length === 0) return;
    const hadNew = markCanvasSeen(tid, list.map((a) => a.id));
    const wasStreamed = justStreamedRef.current;
    justStreamedRef.current = false;
    if (hadNew && wasStreamed) {
      const newest = list.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
      if (newest.kind === 'svg' || newest.kind === 'simulation') return;
      openCanvas(newest.id);
    }
  }, [artifactsByThread, currentThreadId, markCanvasSeen, openCanvas]);

  // Live agent-to-agent consultations (Luca → Anima for now).
  useAgentConsultRealtime(threadId);

  // Welcome back awareness + dynamic placeholder
  useEffect(() => {
    if (!user) return;
    if (classicChatActive) {
      setWelcomeBack(null);
      setDynamicPlaceholder(`Message ${getChatModelLabel(selectedChatModel)}...`);
      return;
    }
    // Guard against the agent flipping mid-flight (e.g. landing seeds luca →
    // the user's adopted agent): a superseded run must not win the last write
    // and leave a stale "<other agent> wants to tell you something…".
    let canceled = false;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      if (canceled) return;

      // Highest priority: explicit thought initiation queued for the user
      const { data: initiations } = await supabase
        .from('thought_initiations')
        .select('message, created_at, content_integrity_status, content_hidden_at')
        .eq('user_id', user.id)
        .eq('agent_id', activeAgentId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);
      if (canceled) return;

      const visibleInitiations = initiations?.filter(
        (item) => !item.content_hidden_at && item.content_integrity_status !== 'rejected',
      ) ?? [];
      if (visibleInitiations.length > 0) {
        setWelcomeBack({ type: 'initiation', content: visibleInitiations[0].message });
        setDynamicPlaceholder("What's on your mind?");
        return;
      }

      // Next: any unseen surfaced activity from autonomous loops (the new pulse/heartbeat).
      const { data: profile } = await supabase
        .from('profiles')
        .select('last_seen_activity_at')
        .eq('user_id', user.id)
        .maybeSingle();
      const seenIso = profile?.last_seen_activity_at ?? new Date(0).toISOString();
      const { data: surfaced } = await supabase
        .from('entity_activity_log')
        .select('title, summary, severity, created_at, content_integrity_status, content_hidden_at')
        .eq('user_id', user.id)
        .eq('agent_id', activeAgentId)
        .eq('surface_to_user', true)
        .in('severity', ['notable', 'important'])
        .gt('created_at', seenIso)
        .order('created_at', { ascending: false })
        .limit(1);
      if (canceled) return;
      const visibleSurfaced = surfaced?.filter(
        (item) => !item.content_hidden_at && item.content_integrity_status !== 'rejected',
      ) ?? [];
      if (visibleSurfaced.length > 0) {
        const a = visibleSurfaced[0] as { title: string | null; summary: string | null; severity: string };
        setWelcomeBack({
          type: 'thought',
          content: a.summary || a.title || 'something happened while you were away',
        });
        setDynamicPlaceholder(a.title || 'while you were away...');
        return;
      }

      // Check time since this agent's last thread activity.
      const { data: lastThread } = await supabase
        .from('threads')
        .select('updated_at')
        .eq('user_id', user.id)
        .or(`agent_id.eq.${activeAgentId},primary_agent_id.eq.${activeAgentId}`)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (canceled) return;

      const lastTime = lastThread?.[0]?.updated_at ? new Date(lastThread[0].updated_at).getTime() : 0;
      const gapHours = (Date.now() - lastTime) / 3_600_000;

      if (gapHours > 2) {
        // Check for recent journal entries or dreams
        const { data: recentJournal } = await supabase
          .from('journal_entries')
          .select('content, mood, created_at, content_integrity_status, content_hidden_at')
          .eq('user_id', user.id)
          .eq('agent_id', activeAgentId)
          .gt('created_at', new Date(lastTime).toISOString())
          .order('created_at', { ascending: false })
          .limit(1);
        if (canceled) return;

        const visibleRecentJournal = recentJournal?.filter((entry) => !entry.content_hidden_at && entry.content_integrity_status !== 'rejected') ?? [];
        if (visibleRecentJournal.length > 0) {
          const entry = visibleRecentJournal[0];
          const snippet = entry.content.slice(0, 150) + (entry.content.length > 150 ? '...' : '');
          const isDream = entry.mood === 'dreaming';
          setWelcomeBack({
            type: isDream ? 'thought' : 'journal',
            content: snippet,
          });
          setDynamicPlaceholder(isDream ? `${currentAgentLabel} dreamed about something...` : `${currentAgentLabel} has been reflecting...`);
          return;
        }

        // Check for recent autonomous thoughts
        const { data: recentThought } = await supabase
          .from('thought_stream')
          .select('content, created_at, content_integrity_status, content_hidden_at')
          .eq('user_id', user.id)
          .eq('agent_id', activeAgentId)
          .gt('created_at', new Date(lastTime).toISOString())
          .order('salience', { ascending: false })
          .limit(1);
        if (canceled) return;

        const visibleRecentThought = recentThought?.filter((thought) => !thought.content_hidden_at && thought.content_integrity_status !== 'rejected') ?? [];
        if (visibleRecentThought.length > 0) {
          const thought = visibleRecentThought[0].content;
          setWelcomeBack({ type: 'thought', content: thought.slice(0, 150) + (thought.length > 150 ? '…' : '') });
          setDynamicPlaceholder(`${currentAgentLabel} has been thinking...`);
          return;
        }
      }

      // Time-of-day placeholder
      const hour = new Date().getHours();
      if (hour >= 23 || hour < 5) {
        setDynamicPlaceholder('still here...');
      } else {
        setDynamicPlaceholder(`Message ${currentAgentLabel}...`);
      }
    })();
    return () => { canceled = true; };
  }, [user, activeAgentId, currentAgentLabel, classicChatActive, selectedChatModel]);

  const handleTextareaInput = () => {
    // `field-sizing: content` does this natively and keeps the height off the
    // keystroke hot path. Where it exists we must NOT also write an inline
    // height, or the two fight over the same property. Everywhere else the
    // original measure-and-clamp runs, with the single 240px clamp the CSS
    // also declares (--cmp-max-height).
    if (supportsFieldSizing()) return;
    const ta = textareaRef.current;
    if (!ta) return;
    // Measure target height without thrashing layout twice if it hasn't
    // changed. We only touch `style.height` when the new measurement
    // differs from the current one.
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, 240) + 'px';
    if (ta.style.height !== next) ta.style.height = next;
  };

  const startAttachmentUpload = useCallback((attachment: Attachment) => {
    if (!attachment.file) return;
    const controller = new AbortController();
    setAttachmentStatus(attachment.id, 'uploading', { progress: 1, abortController: controller, error: undefined });
    void uploadChatAttachment(attachment.file, {}, {
      batchId: uploadBatchIdRef.current,
      signal: controller.signal,
      onState: ({ status, progress, descriptor }) => {
        setAttachmentStatus(attachment.id, status, {
          progress,
          descriptor,
          kind: descriptor?.kind,
          url: descriptor?.preview?.url,
          error: descriptor?.error,
          abortController: controller,
        });
      },
    }).then((descriptor) => {
      setAttachmentStatus(attachment.id, 'ready', {
        progress: 100,
        descriptor,
        kind: descriptor.kind,
        url: descriptor.preview?.url,
        abortController: undefined,
      });
    }).catch((uploadError) => {
      if (uploadError instanceof DOMException && uploadError.name === 'AbortError') return;
      setAttachmentStatus(attachment.id, 'failed', {
        progress: undefined,
        error: uploadError instanceof Error ? uploadError.message : 'Upload failed',
        abortController: undefined,
      });
    });
  }, [setAttachmentStatus]);

  const queueAttachmentFiles = useCallback((filesLike: FileList | File[] | null | undefined) => {
    const files = Array.from(filesLike || []);
    if (files.length === 0) return;

    const remaining = Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachments.length);
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      if (accepted.length >= remaining) {
        rejected.push(`${file.name}: attachment limit reached`);
        continue;
      }
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name}: max 100 MB`);
        continue;
      }
      if (file.size < 1) {
        rejected.push(`${file.name}: empty file`);
        continue;
      }
      if (!isChatAttachmentSupported(file, activeModelCapabilities?.inputModalities)) {
        rejected.push(`${file.name}: not supported by ${getChatModelLabel(selectedChatModel)}`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) {
      const queued = addAttachments(accepted);
      queued.forEach(startAttachmentUpload);
    }
    setAttachmentError(rejected.length > 0 ? rejected.slice(0, 2).join(' · ') : null);
  }, [activeModelCapabilities, addAttachments, pendingAttachments.length, selectedChatModel, startAttachmentUpload]);

  const openAttachmentFilePicker = useCallback(() => {
    setAttachmentMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const openPhotoPicker = useCallback(() => {
    setAttachmentMenuOpen(false);
    photoInputRef.current?.click();
  }, []);

  const openCameraPicker = useCallback(() => {
    setAttachmentMenuOpen(false);
    cameraInputRef.current?.click();
  }, []);

  useEffect(() => {
    if (alcoveOpen && attachmentMenuOpen) setAttachmentMenuOpen(false);
  }, [alcoveOpen, attachmentMenuOpen]);

  const handleComposerPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    queueAttachmentFiles(images);
  }, [queueAttachmentFiles]);

  const uploadPendingAttachments = useCallback(async (threadForUpload: string): Promise<PersistedAttachment[]> => {
    if (pendingAttachments.length === 0) return [];
    const descriptors = pendingAttachments.map((attachment) => attachment.descriptor);
    if (descriptors.some((descriptor) => !descriptor || descriptor.status !== 'ready')) {
      throw new Error('Wait for every attachment to finish processing, or retry the failed file.');
    }
    const bound = await bindChatAttachments(
      descriptors.map((descriptor) => descriptor!.id),
      { threadId: threadForUpload },
    );
    return bound.map((descriptor) => descriptorToLegacyAttachment(descriptor) as PersistedAttachment);
  }, [pendingAttachments]);

  const removePendingAttachment = useCallback((attachment: Attachment) => {
    attachment.abortController?.abort();
    const attachmentId = attachment.descriptor?.id;
    removeAttachment(attachment.id);
    if (attachmentId) void cancelChatAttachment(attachmentId).catch(() => undefined);
  }, [removeAttachment]);

  const retryPendingAttachment = useCallback((attachment: Attachment) => {
    if (attachment.descriptor?.id && attachment.status === 'failed') {
      setAttachmentStatus(attachment.id, 'quarantined', { progress: 72, error: undefined });
      void retryChatAttachment(attachment.descriptor.id, { file: attachment.file }).then((descriptor) => {
        setAttachmentStatus(attachment.id, 'ready', { descriptor, progress: 100, error: undefined, url: descriptor.preview?.url });
      }).catch((retryError) => {
        setAttachmentStatus(attachment.id, 'failed', { error: retryError instanceof Error ? retryError.message : 'Retry failed' });
      });
      return;
    }
    retryAttachmentInStore(attachment.id);
    startAttachmentUpload({ ...attachment, status: 'pending', descriptor: undefined, error: undefined });
  }, [retryAttachmentInStore, setAttachmentStatus, startAttachmentUpload]);

  const renderPendingAttachments = () => {
    if (pendingAttachments.length === 0 && !attachmentError) return null;
    return (
      <>
        {pendingAttachments.length > 0 && (
          <div className="att-chips-row">
            {pendingAttachments.map((attachment: Attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removePendingAttachment(attachment)}
                onRetry={() => retryPendingAttachment(attachment)}
              />
            ))}
          </div>
        )}
        {attachmentError && <div className="att-error">{attachmentError}</div>}
      </>
    );
  };

  const renderModelKeyNotice = () => {
    if (!showFreeTierUpsell) return null;
    return (
      <div
        className="composer-key-warning composer-key-warning--compact"
        role="status"
      >
        <span>
          {modelKeyStatus === 'checking'
            ? 'Checking your OpenRouter connection…'
            : 'Connect OpenRouter to chat with Luca, build agents, migrate companions, or use agent memory. You can still ask the Polyphonic Guide about the app.'}
        </span>
        <div>
          <ConnectOpenRouter
            variant="ghost"
            label="Connect OpenRouter"
            onConnected={() => setModelKeyStatus('present')}
          />
          <button
            type="button"
            onClick={() => navigate('/settings/models')}
          >
            Paste existing key
          </button>
          <button
            type="button"
            onClick={openPolyphonicGuide}
          >
            Ask Polyphonic Guide
          </button>
        </div>
      </div>
    );
  };

  const renderGuestStatusChip = () => {
    return null;
  };

  /* The Observer well. The chrome lives in `<ObserverWell>` (composer/
     Composer.tsx) so this surface and the DEV harness render the same
     markup; only the turns are ours. */
  const observerStatus = guardianStreaming
    ? (guardianStreamingContent ? 'replying\u2026' : 'thinking\u2026')
    : 'observing your conversation';

  const renderObserverWell = () => (
    <ObserverWell
      open={alcoveOpen}
      streaming={guardianStreaming}
      status={observerStatus}
      onClose={() => setAlcoveOpen(false)}
      scrollRef={guardianScrollRef}
    >
      {guardianMessages.length === 0 && !guardianStreaming && (
        <div className="cmp-well-msg observer">observing your conversation. ask me anything about what you and Luca have been discussing.</div>
      )}
      {guardianMessages.map((msg, i) => (
        <div key={i} className={`cmp-well-msg ${msg.role === 'user' ? 'user' : 'observer'}`}>{msg.content}</div>
      ))}
      {guardianStreaming && guardianStreamingContent && (
        <div className="cmp-well-msg observer">{guardianStreamingContent}<span className="streaming-cursor-inline" /></div>
      )}
      {guardianStreaming && !guardianStreamingContent && (
        <div className="cmp-well-msg observer cmp-well-dots">
          {[0, 1, 2].map(i => <span key={i} />)}
        </div>
      )}
    </ObserverWell>
  );

  const resolvePermissionMessage = useCallback(async (
    msg: Message,
    status: 'approved' | 'denied',
    remember = false,
  ) => {
    if (!user) return;
    const currentMeta = ((msg.metadata as Record<string, unknown> | null) || {});
    const nextMeta = {
      ...currentMeta,
      permission_status: status,
      permission_remember: remember,
      permission_resolved_at: new Date().toISOString(),
      permission_error: null,
    };
    patchMessage(msg.id, { metadata: nextMeta });

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { error } = await supabase
        .from('messages')
        .update({ metadata: nextMeta })
        .eq('id', msg.id)
        .eq('user_id', user.id);
      if (error) throw error;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not record permission response';
      patchMessage(msg.id, {
        metadata: {
          ...currentMeta,
          permission_status: 'pending',
          permission_error: message,
        },
      });
    }
  }, [patchMessage, user]);

  const commitForgeProposal = useCallback(async (msg: Message) => {
    if (!user) return;
    const proposal = getForgeProposalMetadata(msg);
    if (!proposal || proposal.forge_status !== 'pending') return;

    setForgeBusyById((state) => ({ ...state, [msg.id]: true }));
    setForgeErrorById((state) => ({ ...state, [msg.id]: null }));
    patchMessage(msg.id, {
      metadata: {
        ...((msg.metadata as Record<string, unknown> | null) || {}),
        forge_status: 'committing',
      },
    });

    const { data, error } = await supabase.functions.invoke('agent-forge', {
      body: { action: 'commit', proposal_message_id: msg.id },
    });

    setForgeBusyById((state) => ({ ...state, [msg.id]: false }));

    if (error || !data?.ok) {
      const message = error?.message || data?.error || 'Could not save this agent.';
      setForgeErrorById((state) => ({ ...state, [msg.id]: message }));
      patchMessage(msg.id, {
        metadata: {
          ...((msg.metadata as Record<string, unknown> | null) || {}),
          forge_status: 'pending',
          error: message,
        },
      });
      return;
    }

    const nextMetadata = (data?.proposal?.metadata as Record<string, unknown> | undefined) || {
      ...((msg.metadata as Record<string, unknown> | null) || {}),
      forge_status: 'approved',
      created_agent_id: data.created_agent_id || data.agent?.id || proposal.target_agent_id || null,
    };
    patchMessage(msg.id, { metadata: nextMetadata });
    await loadAgentSettings(user.id);
    await loadThreads();
  }, [loadAgentSettings, loadThreads, patchMessage, user]);

  const cancelForgeProposal = useCallback(async (msg: Message) => {
    if (!user) return;
    const proposal = getForgeProposalMetadata(msg);
    if (!proposal || proposal.forge_status !== 'pending') return;

    setForgeBusyById((state) => ({ ...state, [msg.id]: true }));
    setForgeErrorById((state) => ({ ...state, [msg.id]: null }));

    const { data, error } = await supabase.functions.invoke('agent-forge', {
      body: { action: 'cancel', proposal_message_id: msg.id },
    });

    setForgeBusyById((state) => ({ ...state, [msg.id]: false }));

    if (error || !data?.ok) {
      const message = error?.message || data?.error || 'Could not cancel this proposal.';
      setForgeErrorById((state) => ({ ...state, [msg.id]: message }));
      return;
    }

    const nextMetadata = (data?.proposal?.metadata as Record<string, unknown> | undefined) || {
      ...((msg.metadata as Record<string, unknown> | null) || {}),
      forge_status: 'canceled',
    };
    patchMessage(msg.id, { metadata: nextMetadata });
  }, [patchMessage, user]);

  const reviseForgeProposal = useCallback((msg: Message) => {
    const proposal = getForgeProposalMetadata(msg);
    if (!proposal) return;
    const target = proposal.target_agent_id ? ` Target agent id: ${proposal.target_agent_id}.` : '';
    setInput(
      `Revise the previous Forge proposal for ${proposal.blueprint.name} (proposal id: ${msg.id}).${target} Keep the full Open Clause shape and every part I don't explicitly change — diff against the prior blueprint, don't start from scratch. Change: `,
    );
  }, []);


  const switchToForgedAgent = useCallback((agentId: string) => {
    // Land the new agent on its own fresh empty hero — the blank landing that
    // shows the agent's signature shape + name (genesis "say hello" resolves
    // here). The bare /chat landing only renders when there's no route thread
    // AND no loaded messages, and activeAgentId falls back to pendingAgentId
    // only once currentThread is gone — so clear the (Luca forge) thread
    // context first, otherwise the stale thread keeps Luca's shape and its
    // message list hides the hero. Also persist this as the user's default
    // landing. The first message will create a thread under this agent.
    setPendingTargetKind('agent');
    setPendingAgentId(agentId);
    persistChatTarget({ kind: 'agent', id: agentId });
    useThreadStore.setState({ currentThreadId: null, messages: [] });
    navigate('/chat');
  }, [navigate, persistChatTarget]);

  const sendGuardianMessage = useCallback(async () => {
    if (!input.trim() || !user || guardianStreaming || modelKeyMissing) return;

    const messageText = input.trim();
    let tid = currentThreadId;
    if (!tid) {
      tid = await createThread(user.id, pendingTargetKind === 'agent' ? pendingAgentId : 'luca', null, { runtimeMode: 'agent' });
      navigate(`/chat/${tid}`, { replace: true });
    }

    // Add user message to guardian conversation
    setGuardianMessages((prev) => [...prev, { role: 'user', content: messageText }]);

    // Save user message to DB — tag it as `guardian` so it stays in the
    // observer alcove and never appears in the main chat thread.
    try {
      await insertMessageWithFreshSession({
        thread_id: tid,
        user_id: user.id,
        role: 'user',
        content: messageText,
        agent: 'guardian',
      });
    } catch (err) {
      setGuardianMessages((prev) => [...prev, {
        role: 'assistant',
        content: err instanceof Error ? `Could not save that observer note: ${err.message}` : 'Could not save that observer note.',
      }]);
      return;
    }

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Stream Observer response
    setGuardianStreaming(true);
    setGuardianStreamingContent('');

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const session = (await supabase.auth.getSession()).data.session;
      const controller = new AbortController();
      guardianAbortRef.current = controller;
      const resp = await fetch(`${supabaseUrl}/functions/v1/chat-guardian`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ thread_id: tid, message: messageText }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await parseEdgeError(resp.clone()).catch(() => ({ message: `Request failed (${resp.status})` } as any));
        const isMissingKey = /api key/i.test(err.message || '') || err.code === 'unauthorized';
        const friendly = isMissingKey
          ? 'No model API key configured. Open Settings -> Models to add your OpenRouter key.'
          : friendlyMessage(err);
        setGuardianMessages((prev) => [...prev, { role: 'assistant', content: friendly }]);
        return;
      }

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let committed = false;

      const commitFinal = (content: string) => {
        if (committed || !content) return;
        committed = true;
        // Atomically swap streaming buffer → committed message to avoid
        // a frame where both the streaming bubble and the final message
        // are visible (which looked like a duplicate).
        setGuardianMessages((prev) => [...prev, { role: 'assistant', content }]);
        setGuardianStreamingContent('');
        setGuardianStreaming(false);
      };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload.startsWith(':')) continue;
            try {
              const data = JSON.parse(payload);
              if (data.type === 'content') {
                fullContent += data.text;
                setGuardianStreamingContent(fullContent);
              } else if (data.type === 'error') {
                committed = true;
                setGuardianMessages((prev) => [...prev, { role: 'assistant', content: data.text || 'Observer encountered an error.' }]);
                setGuardianStreamingContent('');
                fullContent = '';
              } else if (data.type === 'done') {
                commitFinal(fullContent);
              }
            } catch (e) {
              // Skip non-JSON lines (heartbeats, etc)
            }
          }
        }
      }

      // Fallback: stream ended without a `done` event
      commitFinal(fullContent);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setGuardianMessages((prev) => [...prev, { role: 'assistant', content: 'Connection lost. Please try again.' }]);
      }
    } finally {
      setGuardianStreaming(false);
      setGuardianStreamingContent('');
      guardianAbortRef.current = null;
      loadThreads();
    }
  }, [input, user, currentThreadId, guardianStreaming, modelKeyMissing, createThread, pendingTargetKind, pendingAgentId, navigate, loadThreads]);

  const sendMessage = useCallback(async (options?: SendMessageOptions) => {
    const sourceText = typeof options?.text === 'string' ? options.text : input;
    const replayAttachments = options?.attachments ?? null;
    const hiddenHandoff = options?.hiddenHandoff === true;
    if (modelKeyMissing) return;
    if ((!sourceText.trim() && pendingAttachments.length === 0 && !replayAttachments?.length) || !user || isStreaming || firstTurnHandoff) return;
    if (!replayAttachments && attachmentSendBlocked) {
      setAttachmentError('Wait for every attachment to finish processing, or retry the failed file.');
      return;
    }
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const clientTurnId = crypto.randomUUID();
    activeClientTurnIdRef.current = clientTurnId;
    cancelRequestedTurnIdRef.current = null;
    const messageText = sourceText.trim() || 'Attached files.';
    const requestRuntimeMode = options?.target?.runtimeMode ?? effectiveRuntimeMode;
    const requestModel = options?.target?.modelId ?? selectedChatModel;
    const requestAgentId = options?.target?.agentId ?? activeAgentId;
    const requestMessageAgent = requestRuntimeMode === 'classic' ? null : requestAgentId;
    const requestReasoningEffort = normalizeChatModelReasoningEffort(
      requestModel,
      options?.target?.reasoningEffort ?? thinkingEffort,
    );
    const requestResponderLabel = options?.target?.targetLabel
      ?? (requestRuntimeMode === 'classic' ? getChatModelLabel(requestModel) : getAgentDisplayName(requestAgentId, agentNameById));
    const retryTarget: ChatRetryTarget = {
      runtimeMode: requestRuntimeMode,
      modelId: requestModel,
      agentId: requestAgentId,
      targetLabel: requestResponderLabel,
      reasoningEffort: requestReasoningEffort,
    };
    activeSendTargetRef.current = retryTarget;
    const targetMetadata = {
      target_kind: requestRuntimeMode === 'classic' ? 'model' : 'agent',
      target_id: requestRuntimeMode === 'classic' ? requestModel : requestAgentId,
      target_label: requestResponderLabel,
      reasoning_effort: requestReasoningEffort,
      retry_target: retryTarget,
      retry_text: messageText,
    };

    // Dismiss welcome back on first message
    if (welcomeBack) setWelcomeBack(null);

    inputCaptureRef.current = messageText;
    persistChatTarget(requestRuntimeMode === 'classic'
      ? { kind: 'model', id: requestModel }
      : { kind: 'agent', id: requestAgentId });
    const isFirstTurn = !hiddenHandoff && !currentThreadId && messages.length === 0 && !options?.text;

    /* ── THE SEND MOMENT ──────────────────────────────────────────────
       Everything the eye needs happens here, before the first `await`:
       your message is on screen, the box is empty, and the reply
       placeholder is mounted. The database round trip that follows is
       bookkeeping — it must never be something you wait to see.

       The optimistic row carries a client-side id and is inserted under
       that SAME id, so there is no swap: threadStore.addMessage returns
       early on a duplicate id, and mergeRealtimeMessage keeps the row
       already present. Failure keeps the row and marks it; it never
       erases what you wrote. */
    const optimisticThreadId = currentThreadId;
    const optimisticId = crypto.randomUUID();
    const useOptimisticRow = !hiddenHandoff && !isFirstTurn && !!optimisticThreadId;
    const shouldClearComposer = hiddenHandoff || !options?.text || options.text === input;
    const clearComposer = () => {
      setInput('');
      clearAttachments();
      uploadBatchIdRef.current = crypto.randomUUID();
      setAttachmentError(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };
    const markOptimisticRowFailed = (detail: string) => {
      if (!useOptimisticRow) return;
      patchMessage(optimisticId, {
        metadata: {
          client_turn_id: clientTurnId,
          idempotency_key: `chat:${optimisticThreadId}:${clientTurnId}`,
          access_tier: accessTier,
          send_failed: true,
          send_error: detail,
        },
      } as Partial<Message>);
    };

    setComposerSending(true);

    if (isFirstTurn) {
      setFirstTurnHandoff({
        id: crypto.randomUUID(),
        text: messageText,
        agentLabel: requestResponderLabel,
        attachmentCount: pendingAttachments.length + (replayAttachments?.length ?? 0),
        startedAt: new Date().toISOString(),
      });
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } else if (useOptimisticRow) {
      addMessage({
        id: optimisticId,
        thread_id: optimisticThreadId!,
        user_id: user.id,
        role: 'user',
        content: messageText,
        model: null,
        agent: null,
        thinking_content: null,
        tokens_used: null,
        bookmarked: false,
        attachment_ids: [],
        attachments: replayAttachments ?? null,
        metadata: {
          client_turn_id: clientTurnId,
          idempotency_key: `chat:${optimisticThreadId}:${clientTurnId}`,
          access_tier: accessTier,
        },
      } as any);
      if (shouldClearComposer) clearComposer();
    }

    // Mount the reply placeholder in the same tick, so the most anxious
    // window — did it hear me? — is never the silent one.
    if (!hiddenHandoff) {
      completedStreamMessageIdRef.current = null;
      setStreaming(true);
      setStreamingContent('');
      setStreamingThinking('');
      setStreamingVariants([]);
      setIsSynthesizing(false);
    }

    let tid = currentThreadId;
    let createdThread = false;
    if (!tid) {
      try {
        tid = await createThread(user.id, requestAgentId, null, {
          runtimeMode: requestRuntimeMode,
          selectedModel: requestRuntimeMode === 'classic' ? requestModel : null,
        });
        createdThread = true;
      } catch (err) {
        sendInFlightRef.current = false;
        activeClientTurnIdRef.current = null;
        activeSendTargetRef.current = null;
        setFirstTurnHandoff(null);
        setComposerSending(false);
        setStreaming(false);
        if (isFirstTurn && !options?.text) setInput(sourceText);
        setAttachmentError(err instanceof Error ? err.message : 'Could not start a new conversation');
        return;
      }
    }

    let uploadedAttachments: PersistedAttachment[] = replayAttachments ?? [];
    try {
      if (!replayAttachments) {
        uploadedAttachments = await uploadPendingAttachments(tid);
      }
    } catch (err) {
      sendInFlightRef.current = false;
      activeClientTurnIdRef.current = null;
      activeSendTargetRef.current = null;
      setFirstTurnHandoff(null);
      setComposerSending(false);
      setStreaming(false);
      // The row is already on screen — mark it rather than deleting what the
      // person wrote (MESSAGING_FEEL_AUDIT P4: failures must not self-erase).
      markOptimisticRowFailed(err instanceof Error ? err.message : 'Attachment upload failed');
      if (isFirstTurn && !options?.text) setInput(sourceText);
      setAttachmentError(err instanceof Error ? err.message : 'Attachment upload failed');
      return;
    }

    let persistedUserMessage: Message | null = null;
    const uploadedAttachmentIds = uploadedAttachments
      .map((attachment) => attachment.descriptor?.id || (attachment.meta?.attachment_id as string | undefined))
      .filter((id): id is string => Boolean(id));
    const persistChatError = async (
      content: string,
      metadata: Record<string, unknown>,
    ) => {
      const id = crypto.randomUUID();
      const row = {
        id,
        thread_id: tid!,
        user_id: user.id,
        role: 'assistant',
        content,
        model: requestRuntimeMode === 'classic' ? requestModel : null,
        agent: requestMessageAgent,
        thinking_content: null,
        tokens_used: null,
        bookmarked: false,
        kind: 'agent_error' as const,
        metadata: {
          agent: requestMessageAgent,
          ...targetMetadata,
          retry_attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
          client_turn_id: clientTurnId,
          ...metadata,
        },
      };
      addMessage(row as any);
      try {
        await insertMessageWithFreshSession(row as any);
      } catch (persistError) {
        console.warn('persist chat error failed', persistError);
      }
    };
    if (!hiddenHandoff) {
      try {
        const inserted = await insertMessageWithFreshSession({
          // Same id the optimistic row already carries, so the persisted row
          // IS that row — addMessage returns early on a duplicate id and
          // realtime keeps the one already present. No swap, no flicker.
          ...(useOptimisticRow ? { id: optimisticId } : {}),
          thread_id: tid,
          user_id: user.id,
          role: 'user',
          content: messageText,
          attachment_ids: uploadedAttachmentIds,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments as any : null,
          metadata: {
            client_turn_id: clientTurnId,
            idempotency_key: `chat:${tid}:${clientTurnId}`,
            access_tier: accessTier,
          },
        } as any);
        persistedUserMessage = inserted as unknown as Message;
      } catch (insertUserError) {
        sendInFlightRef.current = false;
        activeClientTurnIdRef.current = null;
        activeSendTargetRef.current = null;
        setFirstTurnHandoff(null);
        setComposerSending(false);
        setStreaming(false);
        if (isFirstTurn && !options?.text) setInput(sourceText);
        const detail = insertUserError instanceof Error ? insertUserError.message : String(insertUserError);
        // The row stays where it is, marked — the retry card below carries
        // `retry_text`, so nothing the person wrote is ever lost. The composer
        // is NOT refilled: a half-restored box is worse than an honest failure.
        markOptimisticRowFailed(detail);
        const authExpired = isMessagePersistenceAuthError(insertUserError);
        addMessage({
          thread_id: tid, user_id: user.id, role: 'assistant',
          content: authExpired ? 'Could not save your message. Please sign in again, then retry.' : 'Could not save your message. Please try again.',
          model: requestRuntimeMode === 'classic' ? requestModel : null, agent: requestMessageAgent, thinking_content: null, tokens_used: null, bookmarked: false,
          kind: 'agent_error',
          metadata: {
            agent: requestMessageAgent,
            ...targetMetadata,
            message: authExpired ? 'Could not save your message. Sign in again, then retry.' : 'Could not save your message.',
            detail,
            retry_text: messageText,
            retry_attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
            auth_expired: authExpired,
          },
        } as any);
        return;
      }

      if (useOptimisticRow) {
        // The row is already on screen under this id; only the attachment
        // payload the upload produced is new.
        patchMessage(optimisticId, {
          attachment_ids: uploadedAttachmentIds,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
        } as Partial<Message>);
      } else {
        addMessage({
          ...persistedUserMessage!,
          attachment_ids: uploadedAttachmentIds,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
        } as Message);
      }
    }
    setFirstTurnHandoff(null);
    setComposerSending(false);

    if (!useOptimisticRow && shouldClearComposer) {
      clearComposer();
    }

    if (createdThread) {
      // Signal to the next mount that this is a continuation of an in-flight
      // send, not a fresh navigation — skip the route-level viewFadeIn so the
      // first message animates seamlessly with the rest of the message list.
      try { sessionStorage.setItem('luca:freshSendNav', '1'); } catch { /* */ }
      navigate(`/chat/${tid}`, { replace: true });
    }

    // Stream response. The placeholder already mounted in the send moment
    // above; this only covers the hidden-handoff path, which has no composer.
    if (hiddenHandoff) {
      completedStreamMessageIdRef.current = null;
      setStreaming(true);
      setStreamingContent('');
      setStreamingThinking('');
      setStreamingVariants([]);
      setIsSynthesizing(false);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let fullContent = '';

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const session = (await supabase.auth.getSession()).data.session;
      const edgeMessageText =
        requestAgentId === 'luca' && requestRuntimeMode === 'agent' && looksLikeSimulationTurnRequest(messageText)
          ? withClientSimulationTurnDirective(messageText)
          : messageText;
      const resp = await fetch(`${supabaseUrl}/functions/v1/chat-multi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Idempotency-Key': `chat:${tid}:${clientTurnId}`,
        },
          body: JSON.stringify({
            thread_id: tid,
            message: edgeMessageText,
            source_message_id: persistedUserMessage?.id,
            client_turn_id: clientTurnId,
            attachment_ids: uploadedAttachmentIds,
            attachments: uploadedAttachments,
            model: requestModel,
            runtime_mode: requestRuntimeMode,
            memory_enabled: memoryEnabled,
            reasoning_effort: requestReasoningEffort,
            ensemble: byokEnabled && ensembleActive,
            agent_mode: requestRuntimeMode === 'agent' ? 'agent' : 'chat',
            client_context: {
              route: window.location.pathname,
              view: 'chat',
              thread_id: tid,
              active_agent_id: requestAgentId,
              active_agent_name: requestRuntimeMode === 'classic' ? requestResponderLabel : currentAgentLabel,
              selected_model: requestModel,
              runtime_mode: requestRuntimeMode,
              access_tier: accessTier,
              composer_surface: hiddenHandoff ? 'hidden_onboarding_handoff' : landingAutosend ? 'landing_handoff' : 'chat',
              onboarding_handoff: hiddenHandoff,
              sidebar_visible: sidebarVisible,
            observer_alcove_open: alcoveOpen,
          },
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await parseEdgeError(resp.clone()).catch(() => ({ message: `Request failed (${resp.status})` } as any));
        const friendly = friendlyMessage(err);
        const isMissingKey = /api key/i.test(err.message || '') || err.code === 'unauthorized';
        const message = isMissingKey
          ? 'No model API key configured.'
          : friendly;
        const detail = [
          err.code ? `code: ${err.code}` : null,
          err.requestId ? `request_id: ${err.requestId}` : null,
          `status: ${resp.status}`,
        ].filter(Boolean).join('  •  ');
        await persistChatError(
          isMissingKey
            ? `${message}\n\n[Open Settings → Models](/settings/models) to add your OpenRouter key.`
            : message,
          {
            message,
            detail,
            provider_status: resp.status,
            code: err.code,
            request_id: err.requestId,
          },
        );
        return;
      }

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let fullThinking = '';
      const collectedVariants: Array<{ model: string; content: string; thinking?: string | null }> = [];
      const collectedRankings: RankingEntry[] = [];
      let collectedAggregate: AggregateEntry[] = [];
      let collectedLabelToModel: Record<string, string> = {};
      // Council v2 trace assembly (parallel to legacy collected*).
      const collectedProposers: CouncilV2Proposer[] = [];
      const collectedCrosstalk: CouncilV2Crosstalk[] = [];
      let collectedVerdict: 'synthesize' | 'diverge' | null = null;
      let collectedCritique: CouncilV2Critique | null = null;
      let collectedRevised: string | null = null;
      let agentTraceStarted = false;

      const appendAgentTrace = (line: string | null) => {
        if (!line) return;
        const prefix = agentTraceStarted ? '' : '— Agent activity —\n';
        agentTraceStarted = true;
        fullThinking += `${fullThinking ? '\n' : ''}${prefix}${line}`;
        setStreamingThinking(fullThinking);
      };

      const handleSseBlock = (block: string) => {
        const payload = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!payload || payload === '[DONE]') return;
        try {
          const data = JSON.parse(payload);
          if (
            data.type === 'agent_runtime' ||
            data.type === 'tool_progress' ||
            data.type === 'tool_start' ||
            data.type === 'tool_result'
          ) {
            appendAgentTrace(agentTraceLine(data));
          }
          if (data.type === 'variant') {
                // Council v2 keys variants by character; legacy by model.
                if (data.character) {
                  collectedProposers.push({
                    character: data.character as CouncilV2Character,
                    content: data.text,
                    thinking: data.thinking || null,
                  });
                  setStreamingProposers([...collectedProposers]);
                  // Surface this proposer's reasoning in the peek window so
                  // the user sees actual content flowing during the council
                  // pre-content stages, not just a phase label.
                  if (data.thinking) {
                    const label = (data.character as string).charAt(0).toUpperCase() + (data.character as string).slice(1);
                    fullThinking += (fullThinking ? '\n\n' : '') + `— ${label} —\n${data.thinking}`;
                    setStreamingThinking(fullThinking);
                  }
                } else {
                  collectedVariants.push({ model: data.model, content: data.text, thinking: data.thinking || null });
                  setStreamingVariants([...collectedVariants]);
                }
                if (councilPhase === 'idle') setCouncilPhase('voices');
              } else if (data.type === 'proposer_thinking') {
                // Council v2 emits this when a proposer's reasoning lands
                // (separate from the variant's content). Pipe into the same
                // peek-window stream so the reasoning hub stays alive across
                // the whole council pipeline.
                if (data.text && data.character) {
                  const label = (data.character as string).charAt(0).toUpperCase() + (data.character as string).slice(1);
                  fullThinking += (fullThinking ? '\n\n' : '') + `— ${label} —\n${data.text}`;
                  setStreamingThinking(fullThinking);
                }
              } else if (data.type === 'crosstalk') {
                collectedCrosstalk.push({
                  character: data.character as CouncilV2Character,
                  content: data.text,
                  source: 'crosstalk',
                });
                setStreamingCrosstalk([...collectedCrosstalk]);
                setCouncilPhase('deliberating');
                // Briefly surface the cross-pollinated draft in the peek
                // window too (truncated) so the deliberation reads as
                // actually moving through phases.
                if (data.text) {
                  const label = (data.character as string).charAt(0).toUpperCase() + (data.character as string).slice(1);
                  const snippet = String(data.text).slice(0, 320);
                  fullThinking += (fullThinking ? '\n\n' : '') + `— ${label} (revised) —\n${snippet}${String(data.text).length > 320 ? '…' : ''}`;
                  setStreamingThinking(fullThinking);
                }
              } else if (data.type === 'crosstalk_starting') {
                setCouncilPhase('deliberating');
              } else if (data.type === 'crosstalk_done' || data.type === 'crosstalk_skipped') {
                /* phase will advance on chairman_starting */
              } else if (data.type === 'crosstalk_error') {
                /* surfaced in metadata.crosstalk via the source='proposer' fallback */
              } else if (data.type === 'verdict') {
                collectedVerdict = data.verdict;
                setStreamingVerdict(data.verdict);
              } else if (data.type === 'critique_starting') {
                setCouncilPhase('critiquing');
              } else if (data.type === 'critique') {
                collectedCritique = {
                  voice_drift_detected: !!data.voice_drift_detected,
                  confidence: typeof data.confidence === 'number' ? data.confidence : 0,
                  critique: data.critique || '',
                  suggested_revision: data.suggested_revision ?? null,
                };
                setStreamingCritique(collectedCritique);
              } else if (data.type === 'revised_content') {
                collectedRevised = data.text;
                setStreamingRevised(data.text);
                // Replace the streaming content with the revised version so
                // the user sees the polished pass.
                fullContent = data.text;
                setStreamingContent(fullContent);
              } else if (data.type === 'ranking_starting') {
                setCouncilPhase('deliberating');
              } else if (data.type === 'ranking') {
                collectedRankings.push({
                  judge_model: data.judge_model,
                  raw_text: data.raw_text,
                  parsed_ranking: data.parsed_ranking,
                });
                setStreamingRankings([...collectedRankings]);
              } else if (data.type === 'aggregate_ranking') {
                collectedAggregate = data.ordering as AggregateEntry[];
                setStreamingAggregate(collectedAggregate);
                if (data.label_to_model) collectedLabelToModel = data.label_to_model;
              } else if (data.type === 'chairman_starting' || data.type === 'synthesizing') {
                setCouncilPhase('speaking');
                setIsSynthesizing(true);
              } else if (data.type === 'content') {
                fullContent += data.text;
                setStreamingContent(fullContent);
              } else if (data.type === 'thinking') {
                // In council mode, fullThinking already carries proposer +
                // crosstalk segments with character headers. Insert a
                // Chairman header on the first chairman thinking chunk so
                // the trail stays readable when expanded after stream ends.
                const isCouncilTrail = collectedProposers.length > 0 && /— [A-Z]/.test(fullThinking);
                const needsChairmanHeader = isCouncilTrail && !fullThinking.includes('— Chairman —');
                if (needsChairmanHeader) {
                  fullThinking += (fullThinking ? '\n\n' : '') + '— Chairman —\n' + String(data.text || '').trimStart();
                } else {
                  fullThinking = appendStreamingDelta(fullThinking, data.text);
                }
                setStreamingThinking(fullThinking);
              } else if (data.type === 'done') {
                if (typeof data.message_id === 'string') {
                  completedStreamMessageIdRef.current = data.message_id;
                }
                if (data.duplicate) {
                  if (tid) {
                    void loadMessages(tid);
                    void loadThreads();
                    void loadArtifacts(tid);
                  }
                  return;
                }
                // Hydrate council trace into message metadata. Prefer council_v2
                // shape when the new pipeline ran; fall back to legacy 'council'
                // for backward compat with any pre-v2 traffic.
                let councilMetadata: any = null;
                if (collectedProposers.length > 0) {
                  councilMetadata = {
                    kind: 'council_v2',
                    proposers: collectedProposers,
                    crosstalk: collectedCrosstalk,
                    verdict: collectedVerdict ?? 'synthesize',
                    critique: collectedCritique,
                    revised_content: collectedRevised,
                  };
                } else if (collectedVariants.length > 0) {
                  councilMetadata = {
                    kind: 'council',
                    variants: collectedVariants,
                    rankings: collectedRankings,
                    aggregate: collectedAggregate,
                    label_to_model: collectedLabelToModel,
                  };
                }
                const assistantMessageId = typeof data.message_id === 'string' ? data.message_id : crypto.randomUUID();
                completedStreamMessageIdRef.current = assistantMessageId;
                addMessage({
                  id: assistantMessageId,
                  thread_id: tid!, user_id: user.id, role: 'assistant',
                  content: fullContent, model: data.model || requestModel, agent: requestMessageAgent,
                  thinking_content: fullThinking || null,
                  tokens_used: data.tokens_used || null,
                  bookmarked: false,
                  attachments: Array.isArray(data.attachments) ? data.attachments : null,
                  // Store variants as extra metadata on the message object (legacy convenience)
                  ...(collectedVariants.length > 0 ? { variants: collectedVariants } : {}),
                  metadata: {
                    ...(councilMetadata || {}),
                    ...targetMetadata,
                    request_id: data.request_id || null,
                    provider_status: 'completed',
                    local_stream_stub: true,
                  },
                } as any);
                const localSimulationArtifacts = extractStreamingArtifacts(fullContent, { threadId: tid!, userId: user.id })
                  .filter((artifact) => artifact.kind === 'simulation')
                  .map((artifact) => ({
                    ...artifact,
                    id: artifact.id.replace(/^stream-/, `local-${assistantMessageId}-`),
                    source_message_id: assistantMessageId,
                    created_at: new Date().toISOString(),
                  }));
                if (localSimulationArtifacts.length > 0) {
                  addLocalArtifacts(tid!, localSimulationArtifacts);
                }
                justStreamedRef.current = true;
                if (tid) loadArtifacts(tid);
              } else if (data.type === 'error') {
                void persistChatError(
                  data.text || 'The model stream failed mid-response.',
                  {
                    message: data.text || 'Stream error',
                    detail: data.detail || null,
                    provider_status: data.status || null,
                    code: data.code || 'upstream_error',
                    request_id: data.request_id || null,
                    partial_content: fullContent || null,
                  },
                );
              }
        } catch {
          // The stream may already have ended or the fallback row may fail locally.
        }
      };

      if (reader) {
        let sseBuffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const blocks = sseBuffer.split(/\r?\n\r?\n/);
          sseBuffer = blocks.pop() ?? '';
          blocks.forEach(handleSseBlock);
        }
        const tail = `${sseBuffer}${decoder.decode()}`;
        if (tail.trim()) handleSseBlock(tail);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        await persistChatError('Connection lost while streaming.', {
          message: 'Connection lost while streaming.',
          detail: String(e?.message || e),
          provider_status: 'connection_lost',
          code: 'connection_lost',
          partial_content: fullContent || null,
        });
      }
    } finally {
      setStreaming(false);
      setStreamingContent('');
      setStreamingThinking('');
      setStreamingVariants([]);
      setStreamingRankings([]);
      setStreamingAggregate([]);
      setStreamingProposers([]);
      setStreamingCrosstalk([]);
      setStreamingVerdict(null);
      setStreamingCritique(null);
      setStreamingRevised(null);
      setCouncilPhase('idle');
      setIsSynthesizing(false);
      abortRef.current = null;
      sendInFlightRef.current = false;
      activeClientTurnIdRef.current = null;
      activeSendTargetRef.current = null;
      loadThreads();
    }
  }, [input, modelKeyMissing, pendingAttachments.length, attachmentSendBlocked, user, currentThreadId, messages.length, isStreaming, firstTurnHandoff, currentResponderLabel, createThread, navigate, thinkingEffort, ensembleActive, effectiveRuntimeMode, selectedChatModel, memoryEnabled, byokEnabled, accessTier, activeAgentId, agentNameById, persistChatTarget, landingAutosend, sidebarVisible, alcoveOpen, loadMessages, loadArtifacts, addLocalArtifacts, uploadPendingAttachments, addMessage, patchMessage, clearAttachments, loadThreads]);
  // Keep the prefill listener pointed at the latest sendMessage closure.
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const landingAutosendConsumedRef = useRef(false);
  useEffect(() => {
    if (!landingAutosend || landingAutosendConsumedRef.current) return;
    if (!user || isStreaming || firstTurnHandoff) return;
    if (threadId && currentThreadId !== threadId) return;
    const text = (landingHiddenHandoff ? hiddenLandingPromptRef.current : input).trim();
    if (!text) return;
    landingAutosendConsumedRef.current = true;
    window.setTimeout(() => {
      void sendMessageRef.current?.({ text, hiddenHandoff: landingHiddenHandoff });
    }, 80);
  }, [landingAutosend, landingHiddenHandoff, user?.id, isStreaming, firstTurnHandoff, threadId, currentThreadId, input]);

  // Auto-disarm one-shot ensemble after a successful send (locked stays on).
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && ensembleArmed) {
      setEnsembleArmed(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, ensembleArmed]);

  useEffect(() => {
    if (classicChatActive && alcoveOpen) {
      setAlcoveOpen(false);
    }
  }, [classicChatActive, alcoveOpen]);

  // ⌘E / Ctrl+E toggles ensemble arm
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (!byokEnabled) return;
        if (e.shiftKey) {
          setEnsembleLocked((v) => !v);
        } else {
          setEnsembleArmed((v) => !v);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [byokEnabled]);

  // ⌘J / Ctrl+J opens the Observer enclave.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAlcoveOpen((v) => !v);
        setFocused(true);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleEnsemble = (e: React.MouseEvent) => {
    if (!byokEnabled) return;
    if (e.shiftKey) {
      setEnsembleLocked((v) => !v);
      setEnsembleArmed(false);
    } else {
      if (ensembleLocked) {
        setEnsembleLocked(false);
        setEnsembleArmed(false);
      } else {
        setEnsembleArmed((v) => !v);
      }
    }
  };

  const stopStreaming = useCallback(async () => {
    if (guardianStreaming) {
      guardianAbortRef.current?.abort();
      setGuardianStreaming(false);
      setGuardianStreamingContent('');
      return;
    }

    abortRef.current?.abort();
    // Persist partial content so cancellation survives reload.
    const partial = streamingContent;
    const partialThinking = streamingThinking;
    if (currentThreadId && user && (partial || partialThinking || activeClientTurnIdRef.current)) {
      const clientTurnId = activeClientTurnIdRef.current;
      if (clientTurnId && cancelRequestedTurnIdRef.current === clientTurnId) return;
      cancelRequestedTurnIdRef.current = clientTurnId;
      const md = {
        canceled: true,
        canceled_at: new Date().toISOString(),
        ...(clientTurnId ? { client_turn_id: clientTurnId } : {}),
        ...(activeSendTargetRef.current ? {
          target_kind: activeSendTargetRef.current.runtimeMode === 'classic' ? 'model' : 'agent',
          target_id: activeSendTargetRef.current.runtimeMode === 'classic'
            ? activeSendTargetRef.current.modelId
            : activeSendTargetRef.current.agentId,
          target_label: activeSendTargetRef.current.targetLabel,
          reasoning_effort: activeSendTargetRef.current.reasoningEffort,
        } : {}),
      };
      const canceledModel = activeSendTargetRef.current?.runtimeMode === 'classic'
        ? activeSendTargetRef.current.modelId
        : null;
      const canceledAgent = activeSendTargetRef.current?.runtimeMode === 'classic'
        ? null
        : activeSendTargetRef.current?.agentId ?? activeMessageAgent;
      addMessage({
        thread_id: currentThreadId, user_id: user.id, role: 'assistant',
        content: partial || '_(canceled before any content)_',
        model: canceledModel, agent: canceledAgent,
        thinking_content: partialThinking || null,
        tokens_used: null, bookmarked: false,
        metadata: { ...md, local_stream_stub: true } as any,
      } as any);
      try {
        await insertMessageWithFreshSession({
          thread_id: currentThreadId, user_id: user.id, role: 'assistant',
          content: partial || '_(canceled before any content)_',
          model: canceledModel,
          agent: canceledAgent,
          thinking_content: partialThinking || null,
          metadata: md as any,
        });
      } catch (e) { console.warn('persist canceled stream failed', e); }
    }
  }, [guardianStreaming, streamingContent, streamingThinking, currentThreadId, user, activeMessageAgent, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME guard. While an input method is composing, Enter commits the
    // candidate — it is not a send. Without this a Japanese/Chinese/Korean
    // writer cannot finish a word without firing the message. `keyCode 229`
    // covers the browsers that do not set `isComposing`.
    const native = e.nativeEvent as KeyboardEvent;
    if (native?.isComposing || native?.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Stop dictation cleanly when the message goes out so the next
      // recognition session starts fresh.
      if (dictationListening) stopDictation();
      if (alcoveOpen) sendGuardianMessage();
      else sendMessage();
    }
    if (e.key === 'Escape' && alcoveOpen) setAlcoveOpen(false);
    if (e.key === 'Escape' && dictationListening) stopDictation();
  };

  const threadTitle = useMemo(() => {
    return useThreadStore.getState().threads.find(t => t.id === currentThreadId)?.title;
  }, [currentThreadId, messages]);

  // Drag-and-drop overlay. File drops queue into the same pending attachment
  // path as the paperclip control.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('dragend', resetDragState);
    window.addEventListener('drop', resetDragState);
    window.addEventListener('blur', resetDragState);
    return () => {
      window.removeEventListener('dragend', resetDragState);
      window.removeEventListener('drop', resetDragState);
      window.removeEventListener('blur', resetDragState);
    };
  }, [resetDragState]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    resetDragState();
    queueAttachmentFiles(e.dataTransfer?.files);
  }, [queueAttachmentFiles, resetDragState]);

  const landingAutosendPreviewText =
    !landingHiddenHandoff && landingAutosend && messages.length === 0 && !isStreaming ? input.trim() : '';
  const displayFirstTurnHandoff: FirstTurnHandoff | null = firstTurnHandoff ?? (
    landingAutosendPreviewText
      ? {
            id: 'landing-autosend-preview',
            text: landingAutosendPreviewText,
            agentLabel: currentResponderLabel,
            attachmentCount: 0,
          startedAt: landingHandoffStartedAtRef.current,
        }
      : null
  );
  const isFirstTurnHandoff = !!displayFirstTurnHandoff && messages.length === 0 && !isStreaming;
  const landingHandoffPending = landingThreadEnter && messages.length === 0 && !isStreaming;
  const isEmpty = !threadId && messages.length === 0 && !isStreaming && !displayFirstTurnHandoff && !landingHandoffPending;
  /* The send affordance arms only with content, and only when nothing blocks
     the send. It is the exact inverse of the old button's `disabled`, kept in
     one place now that two call sites render the same circle. */
  const composerStreaming = isStreaming || guardianStreaming;
  const composerSendArmed = !composerStreaming && (
    alcoveOpen
      ? (!modelKeyMissing && !!input.trim())
      : (!displayFirstTurnHandoff
        && !modelKeyMissing
        && !attachmentSendBlocked
        && (!!input.trim() || pendingAttachments.length > 0))
  );
  const composerSendLabel = composerStreaming
    ? 'Stop response'
    : attachmentSendBlocked
      ? 'Files are still processing'
      : alcoveOpen
        ? 'Send observer message'
        : 'Send message';
  const composerCollapsed =
    isMobile && !focused && !input.trim() && pendingAttachments.length === 0 && !attachmentMenuOpen;
  const handleComposerSend = () => {
    if (dictationListening) stopDictation();
    if (alcoveOpen) {
      void sendGuardianMessage();
    } else {
      void sendMessage();
    }
  };
  const handleComposerFocusChange = (next: boolean) => {
    if (next) setFocused(true);
    else if (!alcoveOpen) setFocused(false);
  };
  const activeStreamBody = streamingContent || lingeringStream || '';
  const activeStreamNorm = normalizeStreamComparableContent(activeStreamBody);

  return isEmpty ? (
      /* ═══ LANDING STATE — centered, minimal, alive ═══ */
      <div
        className="chat-view chat-view--empty flex flex-col flex-1 min-h-0 overflow-hidden"
        style={{ animation: skipMountFade ? undefined : 'viewFadeIn var(--dur-normal) var(--ease-out) both', position: 'relative' }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="chat-agent-selector-corner">
          {renderHeaderAgentSelector()}
        </div>
        <div
          className="chat-empty-center flex-1 flex flex-col items-center"
          style={{
            // Mobile: sphere centered in the full open area, wordmark
            // centered in the lower half (between sphere center and
            // composer top). Desktop: keep tightened group layout.
            justifyContent: isMobile ? 'flex-end' : 'center',
            paddingTop: isMobile ? 0 : '5vh',
            paddingBottom: isMobile ? 34 : '5vh',
            gap: isMobile ? 0 : 22,
          }}
        >
          {isMobile ? (
            <div
              className="chat-empty-hero"
              style={{
                position: 'relative',
                flex: 1,
                width: '100%',
                animation: 'viewFadeIn 0.8s var(--ease-out) both',
              }}
            >
              {/* Sphere optically centered in the upper open area */}
              <div style={{ position: 'absolute', top: '44%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                <ExpressiveField
                  size={mobileFieldSize}
                  state={(dictationListening || focused) ? 'listening' : isStreaming ? 'thinking' : 'idle'}
                  shape={heroShape}
                />
              </div>
              {/* Wordmark optically balanced between sphere and composer.
                  For an adopted agent: its name leads, "polyphonic" rests
                  beneath as the quiet brand signature. */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: '82%',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                whiteSpace: 'nowrap',
              }}>
                <h1 style={{
                  fontSize: 24,
                  fontWeight: 280,
                  letterSpacing: '0.06em',
                  color: 'var(--text-tertiary)',
                  opacity: 0.78,
                  fontFamily: 'var(--font-sans)',
                  textTransform: 'lowercase',
                  margin: 0,
                }}>
                  {heroLabel}
                </h1>
                {isCustomAgent && <div className="hero-brandmark hero-brandmark--mobile">polyphonic</div>}
              </div>
            </div>
          ) : (
            <div className="chat-empty-hero" style={{ textAlign: 'center', animation: 'viewFadeIn 0.8s var(--ease-out) both', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
              <ExpressiveField
                size={440}
                state={dictationListening ? 'listening' : isStreaming ? 'thinking' : 'idle'}
                shape={heroShape}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <h1 style={{
                  fontSize: 38,
                  fontWeight: 280,
                  letterSpacing: '0.16em',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-sans)',
                  textTransform: 'lowercase',
                  margin: 0,
                }}>
                  {heroLabel}
                </h1>
                {isCustomAgent && <div className="hero-brandmark">polyphonic</div>}
              </div>
            </div>
          )}

          {/* Composer — sits with the hero as one welcome group. The
              composer owns its own measure (--thread-measure), so this
              wrapper only carries the entrance and the stretch. */}
          <div className="chat-empty-composer" style={{ animation: 'viewFadeIn 0.6s var(--ease-out) 0.2s both', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
            <Composer
              value={input}
              onChange={(next) => { setInput(next); handleTextareaInput(); }}
              onSend={handleComposerSend}
              onStop={() => { void stopStreaming(); }}
              streaming={composerStreaming}
              sending={composerSending}
              armed={composerSendArmed}
              disabled={modelKeyMissing}
              disabledReason={attachmentSendBlocked ? 'Wait for files to finish processing' : undefined}
              ariaLabel={alcoveOpen ? 'Ask Observer' : classicChatActive ? `Message ${getChatModelLabel(selectedChatModel)}` : 'Message Luca'}
              sendLabel={composerSendLabel}
              placeholder={alcoveOpen ? 'Ask the Observer...' : modelKeyMissing ? 'Add a model key to start chatting…' : ensembleActive ? 'Message Luca (ensemble)\u2026' : dynamicPlaceholder}
              textareaRef={textareaRef}
              onKeyDown={handleKeyDown}
              onPaste={handleComposerPaste}
              onFocusChange={handleComposerFocusChange}
              collapsed={composerCollapsed}
              onBarMouseDown={(e) => { if (isMobile) e.preventDefault(); }}
              leading={!alcoveOpen ? (
                <AttachmentSourceControl
                  open={attachmentMenuOpen}
                  onOpenChange={setAttachmentMenuOpen}
                  onFiles={openAttachmentFilePicker}
                  onPhotos={openPhotoPicker}
                  onCamera={openCameraPicker}
                />
              ) : null}
              well={!classicChatActive ? renderObserverWell() : null}
              wellOpen={alcoveOpen}
              above={(
                <>
                  {!alcoveOpen && renderModelKeyNotice()}
                  {!alcoveOpen && renderPendingAttachments()}
                </>
              )}
              barLeft={(
                <div className="agent-pills">
                  {!isMobile && renderGuestStatusChip()}
                  {!isMobile && !classicChatActive && (
                    <ObserverEyeChip
                      threadId={currentThreadId}
                      open={alcoveOpen}
                      onToggle={() => setAlcoveOpen((v) => !v)}
                    />
                  )}
                  {!alcoveOpen && byokEnabled && activeAgentId === 'luca' && (
                    <>
                      <div className="pill-sep" />
                      <ModesDropdown
                        ensembleArmed={ensembleArmed}
                        ensembleLocked={ensembleLocked}
                        onToggleEnsemble={toggleEnsemble}
                        isMobile={isMobile}
                      />
                    </>
                  )}
                </div>
              )}
              barRight={(
                <div className="composer-actions">
                  {!isMobile && (
                    <EffortControl
                      value={effectiveThinkingEffort}
                      options={supportedReasoningEfforts}
                      onChange={(next) => { if (next !== 'max') setThinkingEffort(next); }}
                      disabled={reasoningEffortFixed}
                      disabledTitle={`${getChatModelLabel(selectedChatModel)} currently requires ${getReasoningEffortLabel(effectiveThinkingEffort)} reasoning`}
                    />
                  )}
                  <DictationButton
                    isListening={dictationListening}
                    supported={dictationSupported}
                    disabled={modelKeyMissing || isStreaming || guardianStreaming}
                    onClick={toggleDictation}
                  />
                  {!isMobile && (
                    <VoiceModeButton
                      disabled={modelKeyMissing || isStreaming || guardianStreaming}
                      onStartLiveCall={() => setLiveCallOpen(true)}
                    />
                  )}
                </div>
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={activeAttachmentAccept}
                aria-label="Attachment file picker"
                className="chat-file-input"
                onChange={(e) => {
                  resetDragState();
                  queueAttachmentFiles(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/*"
                aria-label="Photo library picker"
                className="chat-file-input"
                onChange={(event) => {
                  queueAttachmentFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Camera picker"
                className="chat-file-input"
                onChange={(event) => {
                  queueAttachmentFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
            </Composer>
          </div>

          {/* Quiet landing footer — a daily wisdom quote (with its author) on
              one line, above the local date/time/weather readout. Desktop only:
              mobile keeps the landing chat-first, with nothing below the composer. */}
          {!isMobile && (
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', maxWidth: 720, width: '100%' }}>
              <LandingAmbient agentId={activeAgentId} />
            </div>
          )}
        </div>
        <AttachmentDropOverlay visible={isDragging} />
      </div>
    ) : (
    /* ═══ CONVERSATION STATE — normal chat layout ═══ */
    <div
      className={`chat-view flex flex-col flex-1 min-h-0 overflow-hidden${isFirstTurnHandoff ? ' chat-view--handoff' : ''}${landingThreadEnter ? ' chat-view--landing-enter' : ''}`}
      style={{ animation: (skipMountFade || landingThreadEnter) ? undefined : 'viewFadeIn var(--dur-normal) var(--ease-out) both', position: 'relative', ['--canvas-w' as any]: `${canvasWidth}px` }}
      data-canvas-open={canvasIsOpen ? 'true' : undefined}
      data-canvas-fullscreen={canvasFullscreen ? 'true' : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CanvasPane />
      {/* Header — participant dot + title + subtle meta */}
      <div className="chat-header flex items-center flex-shrink-0">
        <div className="chat-header-left">
          {renderHeaderAgentSelector()}
          <span className="chat-header-thread-dot" aria-hidden="true" />
          <span className="chat-header-title">
            {threadTitle || 'New conversation'}
          </span>
        </div>
        <span className="chat-header-meta">
          {classicChatActive
            ? `${getChatModelLabel(selectedChatModel)} · classic`
            : activeAgentId === 'luca'
            ? (byokEnabled ? 'luca · opus-4.7' : 'luca · kimi-k2.6')
            : `${currentAgentLabel.toLowerCase()} · custom agent`}
        </span>
        <ThreadInfoButton />
      </div>
      <div className="chat-agent-selector-mobile">
        {renderHeaderAgentSelector()}
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto chat-scroll-area"
        style={{
          opacity: alcoveOpen ? 0.35 : 1,
          transition: 'opacity 400ms var(--ease-out)',
        }}
      >
        <div className="chat-message-column">

          {hasOlderMessages && (
            <div className="chat-history-loader">
              <button
                type="button"
                onClick={() => { void loadEarlierMessages(); }}
                disabled={loadingOlderMessages}
                aria-busy={loadingOlderMessages || undefined}
              >
                {loadingOlderMessages ? 'Loading earlier messages…' : 'Load earlier messages'}
              </button>
            </div>
          )}

          {/* Live activity context strip — only renders when there's actually
              live activity to surface (sub-agents working, or agent-to-agent
              consultations in this thread). Empty by default so threads start
              with the conversation flush against the natural top, not a
              16px gap of nothing. */}
          <ContextStrip />

          {displayFirstTurnHandoff && messages.length === 0 && (
            <FreshMsgRow
              className="msg-row first-turn-handoff-row"
              style={{ animation: 'msgEnter var(--dur-settle) var(--ease-premium) both' }}
            >
              <div className="msg-sidehead">
                {showTimestamps && (
                  <div className="msg-time">
                    {new Date(displayFirstTurnHandoff.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </div>
                )}
                <div className="msg-author user">You</div>
              </div>
              <div className="msg-body first-turn-handoff-body">
                <RichBody source={displayFirstTurnHandoff.text} />
                {displayFirstTurnHandoff.attachmentCount > 0 && (
                  <div className="first-turn-attachment-note">
                    {displayFirstTurnHandoff.attachmentCount} attachment{displayFirstTurnHandoff.attachmentCount === 1 ? '' : 's'} preparing
                  </div>
                )}
                <div className="first-turn-status" role="status">
                  <span aria-hidden="true" />
                  Opening the conversation with {displayFirstTurnHandoff.agentLabel}
                </div>
              </div>
            </FreshMsgRow>
          )}


          {/* Message list — while a streaming bubble is settling, hide the freshly-persisted
              assistant message that mirrors it, to avoid a duplicate flash. */}
          {messages.map((msg, i) => {
            // Hide a fresh persisted assistant message while the streaming
            // bubble is still mounted. The canonical row can land before
            // the typewriter clears, and its position may race with other
            // local rows, so content/local-stub matching closes that gap.
            const shouldHideStreamingMirror =
              shouldHideStreamingMirrorMessage({
                message: msg,
                isLast: i === messages.length - 1,
                isStreaming,
                lingeringStream,
                activeStreamNorm,
                activeMessageAgent,
                completedStreamMessageId: completedStreamMessageIdRef.current,
              });
            if (shouldHideStreamingMirror) return null;

            const forgeProposal = getForgeProposalMetadata(msg);
            if (forgeProposal) {
              return (
                <div key={msg.id} className="msg-row" style={{ animation: `msgEnter var(--dur-settle) var(--ease-premium) both`, animationDelay: `${Math.min(Math.max(i - Math.max(0, messages.length - 6), 0) * 30, 90)}ms` }}>
                  <div className="msg-sidehead">
                    {showTimestamps && (
                      <div className="msg-time">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </div>
                    )}
                    <div className="msg-author">
                      {getAgentDisplayName(msg.agent, agentNameById)}
                    </div>
                  </div>
                  <div className="msg-body">
                    <AgentForgeCard
                      proposal={forgeProposal}
                      busy={!!forgeBusyById[msg.id]}
                      error={forgeErrorById[msg.id]}
                      onCommit={() => { void commitForgeProposal(msg); }}
                      onCancel={() => { void cancelForgeProposal(msg); }}
                      onRevise={() => reviseForgeProposal(msg)}
                      onSwitch={(agentId) => { void switchToForgedAgent(agentId); }}
                      onOpenSettings={(agentId) => navigate(`/settings/agents/${agentId}`)}
                    />
                  </div>
                </div>
              );
            }

            // B.2 — permission_request branch: render inline card instead of msg-row
            if (msg.kind === 'permission_request') {
              const md = (msg.metadata as any) || {};
              const agent = (md.agent || msg.agent || 'luca') as 'luca' | 'vektor' | 'anima';
              return (
                <div key={msg.id} className="msg-row" style={{ animation: `msgEnter var(--dur-settle) var(--ease-premium) both`, animationDelay: `${Math.min(Math.max(i - Math.max(0, messages.length - 6), 0) * 30, 90)}ms` }}>
                  <div className="msg-sidehead">
                    {showTimestamps && (
                      <div className="msg-time">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </div>
                    )}
                    <div className="msg-author">
                      {getAgentDisplayName(agent, agentNameById)}
                    </div>
                  </div>
                  <div className="msg-body">
                    <PermissionInline
                      agent={agent}
                      title={md.title || 'Permission needed'}
                      body={md.body || msg.content}
                      details={md.details}
                      status={(md.permission_status as 'pending' | 'approved' | 'denied' | undefined) || 'pending'}
                      error={typeof md.permission_error === 'string' ? md.permission_error : undefined}
                      onApprove={(remember) => { void resolvePermissionMessage(msg, 'approved', remember); }}
                      onDeny={() => { void resolvePermissionMessage(msg, 'denied'); }}
                    />
                  </div>
                </div>
              );
            }

            // B.3 — agent_error branch: render errored card with divider above
            if (msg.kind === 'agent_error') {
              const md = ((msg.metadata as Record<string, unknown> | null) || {});
              const errorStatus = typeof md.error_status === 'string' ? md.error_status : null;
              if (errorStatus === 'dismissed' || errorStatus === 'retried') return null;
              const agent = typeof md.agent === 'string' ? md.agent : (msg.agent || 'luca');
              const responderLabel = typeof md.target_label === 'string'
                ? md.target_label
                : msg.model
                  ? getChatModelLabel(msg.model)
                  : getAgentDisplayName(agent, agentNameById);
              const resolveErrorCard = (status: 'dismissed' | 'retried') => {
                const nextMeta = {
                  ...md,
                  error_status: status,
                  error_resolved_at: new Date().toISOString(),
                };
                patchMessage(msg.id, { metadata: nextMeta });
                if (user?.id) {
                  supabase
                    .from('messages')
                    .update({ metadata: nextMeta })
                    .eq('id', msg.id)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.warn('[chat] failed to resolve error card', error);
                    });
                }
              };
              return (
                <div key={msg.id} className="msg-row" style={{ animation: `msgEnter var(--dur-settle) var(--ease-premium) both`, animationDelay: `${Math.min(Math.max(i - Math.max(0, messages.length - 6), 0) * 30, 90)}ms` }}>
                  <div className="msg-sidehead">
                    {showTimestamps && (
                      <div className="msg-time">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </div>
                    )}
                    <div className="msg-author">
                      {responderLabel}
                    </div>
                  </div>
                  <div className="msg-body">
                    <AgentErroredCard
                      responderLabel={responderLabel}
                      message={typeof md.message === 'string' ? md.message : msg.content}
                      detail={typeof md.detail === 'string' ? md.detail : undefined}
                      occurredAt={msg.created_at}
                      onRetry={() => {
                        resolveErrorCard('retried');
                        const retryText = typeof md.retry_text === 'string' ? md.retry_text : null;
                        const retryAttachments = Array.isArray(md.retry_attachments)
                          ? md.retry_attachments as PersistedAttachment[]
                          : undefined;
                        const rawTarget = md.retry_target && typeof md.retry_target === 'object'
                          ? md.retry_target as Record<string, unknown>
                          : null;
                        const retryTarget = rawTarget &&
                          (rawTarget.runtimeMode === 'classic' || rawTarget.runtimeMode === 'agent') &&
                          typeof rawTarget.modelId === 'string' &&
                          typeof rawTarget.agentId === 'string' &&
                          typeof rawTarget.targetLabel === 'string'
                          ? {
                              runtimeMode: rawTarget.runtimeMode,
                              modelId: rawTarget.modelId,
                              agentId: rawTarget.agentId,
                              targetLabel: rawTarget.targetLabel,
                              reasoningEffort: normalizeChatModelReasoningEffort(
                                rawTarget.modelId,
                                typeof rawTarget.reasoningEffort === 'string' ? rawTarget.reasoningEffort : null,
                              ),
                            } as ChatRetryTarget
                          : undefined;
                        if (retryText || (retryAttachments && retryAttachments.length > 0)) {
                          void sendMessage({
                            text: retryText ?? '',
                            attachments: retryAttachments,
                            target: retryTarget,
                          });
                          return;
                        }
                        // Re-send the most recent user message before this error
                        const idx = messages.findIndex((m) => m.id === msg.id);
                        const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
                        if (prevUser) {
                          void sendMessage({
                            text: prevUser.content,
                            attachments: (prevUser.attachments || []) as PersistedAttachment[],
                            target: retryTarget,
                          });
                        }
                      }}
                      onViewLogs={() => {
                        const rid = (msg.metadata as any)?.request_id;
                        if (rid) navigator.clipboard?.writeText(rid).catch(() => {});
                      }}
                      onDismiss={() => resolveErrorCard('dismissed')}
                    />
                  </div>
                </div>
              );
            }

            // L9 — subagent_report branch: badge + RichBody, no streaming
            if (msg.kind === 'subagent_report') {
              const md = (msg.metadata as any) || {};
              const toolCalls = typeof md.tool_calls_used === 'number' ? md.tool_calls_used : null;
              return (
                <div key={msg.id} className="msg-row" style={{ animation: `msgEnter var(--dur-settle) var(--ease-premium) both`, animationDelay: `${Math.min(Math.max(i - Math.max(0, messages.length - 6), 0) * 30, 90)}ms` }}>
                  <div className="msg-sidehead">
                    {showTimestamps && (
                      <div className="msg-time">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </div>
                    )}
                    <div className="msg-author">
                      {getAgentDisplayName(msg.agent, agentNameById)}
                    </div>
                  </div>
                  <div className="msg-body">
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid var(--border-faint)',
                        background: 'var(--surface-raised)',
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: 'var(--track-mono)',
                        textTransform: 'uppercase',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-tertiary)' }} aria-hidden="true" />
                      Subagent report
                      {toolCalls != null && <span>· {toolCalls} tool calls</span>}
                    </div>
                    <RichBody source={msg.content} />
                  </div>
                </div>
              );
            }

            // Regular message — delegated to memoized <MessageItem>, which
            // subscribes to its own row in the store. The parent's per-token
            // streamingContent updates do not re-render existing items.
            const next = messages[i + 1];
            return (
              <MessageItem
                key={msg.id}
                messageId={msg.id}
                nextCreatedAt={next ? next.created_at : null}
                isLast={i === messages.length - 1}
              />
            );
          })}

          {/* Orphan artifacts created before any message (rare) — render at top-equivalent fallback */}
          {threadArtifacts
            .filter((artifact) => {
              if (artifact.source_message_id) return false;
              if (messages.length === 0) return true;
              const firstT = new Date(messages[0].created_at).getTime();
              return new Date(artifact.created_at).getTime() < firstT;
            })
            .map((artifact) => (
              <div key={artifact.id} className="msg-row" style={{ animation: 'msgEnter var(--dur-settle) var(--ease-premium) both' }}>
                <div className="msg-sidehead">
                  <div className="msg-author">Luca</div>
                </div>
                <div className="msg-body">
                  <ArtifactChip artifact={artifact} />
                </div>
              </div>
            ))}


          {/* Streaming message — stays mounted until typewriter settles, even after isStreaming flips */}
          {(isStreaming || lingeringStream) && (
            <div className="msg-row" style={{ animation: 'msgEnter var(--dur-settle) var(--ease-premium) both' }}>
              <div className="msg-sidehead">
                <div className="msg-time">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
                <div className="msg-author">{currentResponderLabel}</div>
              </div>

              <div className="msg-body">

              {/* Thinking block — single element across the full streaming
                  lifecycle, for both single-model and council mode.
                  Transitions through states (waiting → streaming → settling)
                  with a label that reflects what's happening.
                  Council mode folds the phase indicator (voices / deliberating
                  / reviewing / speaking) into this same beautiful element
                  via the customLabel prop, instead of a separate widget below.
                  Always mounted during streaming so the dots animate even when
                  no reasoning text is flowing yet — reasoning content arrives
                  through the peek window when it lands. */}
              {isStreaming && showThinking && (() => {
                const isCouncilActive =
                  councilPhase !== 'idle' ||
                  streamingProposers.length > 0 ||
                  streamingCrosstalk.length > 0 ||
                  streamingVariants.length > 0;

                // Council-aware label takes precedence when council is running.
                // Single-model uses the default state-derived label.
                let councilLabel: string | null = null;
                if (isCouncilActive) {
                  if (councilPhase === 'speaking' || streamingContent) {
                    councilLabel = 'speaking…';
                  } else if (councilPhase === 'critiquing') {
                    councilLabel = 'reviewing…';
                  } else if (councilPhase === 'deliberating') {
                    councilLabel = 'deliberating…';
                  } else if (councilPhase === 'voices' || streamingProposers.length > 0) {
                    const n = streamingProposers.length || streamingVariants.length;
                    councilLabel = n > 0 ? `${n}/3 voices…` : 'voices weighing in…';
                  } else {
                    councilLabel = 'thinking…';
                  }
                }

                // Always show during council; gate single-mode on the existing
                // "has reasoning or pre-content" rule so we don't show dots
                // forever for models that emit no reasoning tokens.
                const showInSingleMode = !streamingContent || streamingThinking;
                if (!isCouncilActive && !showInSingleMode) return null;

                const state: ThinkingState =
                  streamingContent && streamingThinking ? 'settling'
                  : streamingThinking ? 'streaming'
                  : 'waiting';

                return (
                  <ThinkingBlock
                    content={streamingThinking || ''}
                    state={state}
                    customLabel={councilLabel}
                  />
                );
              })()}

              {/* Streaming content with typewriter — keep rendering through the catch-up phase.
                  Color uses --text-body (matching .msg-body persisted color) to avoid the
                  bright-white flash when stream completes and the persisted message takes over. */}
              {(streamingContent || lingeringStream) && (
                <StreamingText
                  content={streamingContent || lingeringStream || ''}
                  isStreaming={isStreaming}
                  style={{ fontSize: '14.5px', lineHeight: 1.65, color: 'var(--text-body)' }}
                  onSettled={() => {
                    // Mark typewriter settled — the lingering effect above
                    // clears lingeringStream once a canonical assistant
                    // message also exists. Don't clear here directly to
                    // avoid the flicker race.
                    typewriterSettledRef.current = true;
                    setLingeringStream((v) => v); // trigger effect re-run
                  }}
                />
              )}
              {/* Live artifacts extracted from in-progress stream */}
              {(streamingContent || lingeringStream) && currentThreadId && user && (
                <StreamingArtifacts
                  content={streamingContent || lingeringStream || ''}
                  threadId={currentThreadId}
                  userId={user.id}
                />
              )}
              </div>
            </div>
          )}

        </div>

        {/* Bottom spacer for smooth scrolling */}
        <div style={{ height: 24 }} />
      </div>

      {/* Floating scroll-to-bottom pill — appears only when the user has
          scrolled away from the live edge of the conversation. */}
      {showScrollDown && (
        <button
          type="button"
          className="scroll-to-bottom-pill"
          onClick={scrollToBottom}
          aria-label="Scroll to latest"
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6l4 4 4-4" />
          </svg>
        </button>
      )}

      {/* Input zone */}
      <div className="input-zone">
        <Composer
          value={input}
          onChange={(next) => { setInput(next); handleTextareaInput(); }}
          onSend={handleComposerSend}
          onStop={() => { void stopStreaming(); }}
          streaming={composerStreaming}
          sending={composerSending}
          armed={composerSendArmed}
          disabled={modelKeyMissing}
          disabledReason={attachmentSendBlocked ? 'Wait for files to finish processing' : undefined}
          ariaLabel={alcoveOpen ? 'Ask Observer' : classicChatActive ? `Message ${getChatModelLabel(selectedChatModel)}` : 'Message Luca'}
          sendLabel={composerSendLabel}
          placeholder={alcoveOpen ? (modelKeyMissing ? 'Add a model key to ask Observer…' : 'Ask the Observer...') : modelKeyMissing ? 'Add a model key to continue…' : ensembleActive ? 'Message Luca (ensemble)\u2026' : dynamicPlaceholder}
          textareaRef={textareaRef}
          onKeyDown={handleKeyDown}
          onPaste={handleComposerPaste}
          onFocusChange={handleComposerFocusChange}
          collapsed={composerCollapsed}
          onBarMouseDown={(e) => { if (isMobile) e.preventDefault(); }}
          leading={!alcoveOpen ? (
            <AttachmentSourceControl
              open={attachmentMenuOpen}
              onOpenChange={setAttachmentMenuOpen}
              onFiles={openAttachmentFilePicker}
              onPhotos={openPhotoPicker}
              onCamera={openCameraPicker}
            />
          ) : null}
          well={!classicChatActive ? renderObserverWell() : null}
          wellOpen={alcoveOpen}
          above={(
            <>
              {!alcoveOpen && renderModelKeyNotice()}
              {!alcoveOpen && renderPendingAttachments()}
            </>
          )}
          barLeft={(
            <div className="agent-pills">
              {!isMobile && renderGuestStatusChip()}
              {!isMobile && !classicChatActive && (
                <ObserverEyeChip
                  threadId={currentThreadId}
                  open={alcoveOpen}
                  onToggle={() => setAlcoveOpen((v) => !v)}
                />
              )}
              {!alcoveOpen && byokEnabled && activeAgentId === 'luca' && (
                <>
                  <div className="pill-sep" />
                  <ModesDropdown
                    ensembleArmed={ensembleArmed}
                    ensembleLocked={ensembleLocked}
                    onToggleEnsemble={toggleEnsemble}
                    isMobile={isMobile}
                  />
                </>
              )}
            </div>
          )}
          barRight={(
            <div className="composer-actions">
              {!isMobile && (
                <EffortControl
                  value={effectiveThinkingEffort}
                  options={supportedReasoningEfforts}
                  onChange={(next) => { if (next !== 'max') setThinkingEffort(next); }}
                  disabled={reasoningEffortFixed}
                  disabledTitle={`${getChatModelLabel(selectedChatModel)} currently requires ${getReasoningEffortLabel(effectiveThinkingEffort)} reasoning`}
                />
              )}
              <DictationButton
                isListening={dictationListening}
                supported={dictationSupported}
                disabled={modelKeyMissing || isStreaming || guardianStreaming}
                onClick={toggleDictation}
              />
              {!isMobile && (
                <VoiceModeButton
                  disabled={modelKeyMissing || isStreaming || guardianStreaming}
                  onStartLiveCall={() => setLiveCallOpen(true)}
                />
              )}
            </div>
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={activeAttachmentAccept}
            aria-label="Attachment file picker"
            className="chat-file-input"
            onChange={(e) => {
              resetDragState();
              queueAttachmentFiles(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*"
            aria-label="Photo library picker"
            className="chat-file-input"
            onChange={(event) => {
              queueAttachmentFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Camera picker"
            className="chat-file-input"
            onChange={(event) => {
              queueAttachmentFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
        </Composer>
      </div>
      <AttachmentDropOverlay visible={isDragging} />
      <LiveCallOverlay
        open={liveCallOpen}
        onClose={() => setLiveCallOpen(false)}
      />
    </div>
  );
}

/* ═══ Thread info trigger (opens thread-detail drawer, ⌘I shortcut) ═══ */
function ThreadInfoButton() {
  const currentThreadId = useThreadStore((s) => s.currentThreadId);
  const openDrawer = useDrawerStore((s) => s.open);

  useEffect(() => {
    if (!currentThreadId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        openDrawer('thread-detail', { threadId: currentThreadId });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [currentThreadId, openDrawer]);

  if (!currentThreadId) return null;
  return (
    <button
      type="button"
      className="thread-info-btn"
      onClick={() => openDrawer('thread-detail', { threadId: currentThreadId })}
      title="Thread details (⌘I)"
      aria-label="Open thread details"
    >
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={7} cy={7} r={5.5} />
        <path d="M7 6.5v3.5" />
        <circle cx={7} cy={4.4} r={0.6} fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
