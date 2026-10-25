import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import {
  defaultRuntimeForAgent,
  normalizeThreadRuntimeMode,
  type ThreadRuntimeMode,
} from '@/lib/chatRuntime';
import type { AttachmentDescriptor } from '@/types/attachments';

export interface Thread {
  id: string;
  user_id: string;
  title: string | null;
  pinned: boolean;
  starred: boolean;
  archived: boolean;
  heat: string;
  agent_id: string;
  primary_agent_id: string;
  participating_agent_ids: string[];
  runtime_mode?: ThreadRuntimeMode | null;
  selected_model?: string | null;
  provider_connection_id?: string | null;
  memory_enabled?: boolean | null;
  continuity_summary?: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageAttachment {
  type: 'image' | 'file' | 'code';
  url: string;
  meta?: Record<string, unknown>;
  descriptor?: AttachmentDescriptor;
}

export interface Message {
  id: string;
  thread_id: string;
  user_id: string;
  role: string;
  content: string;
  model: string | null;
  agent: string | null;
  thinking_content: string | null;
  tokens_used: number | null;
  bookmarked: boolean;
  created_at: string;
  kind?: 'permission_request' | 'agent_forge_proposal' | 'agent_error' | 'text' | 'scheduled_task' | 'scheduled_task_result' | 'subagent_report' | null;
  metadata?: Record<string, unknown> | null;
  attachments?: MessageAttachment[] | null;
  attachment_ids?: string[] | null;
}

export interface CreateThreadOptions {
  runtimeMode?: ThreadRuntimeMode;
  selectedModel?: string | null;
  memoryEnabled?: boolean;
}

interface ThreadState {
  threads: Thread[];
  currentThreadId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  loadThreads: () => Promise<void>;
  setCurrentThread: (id: string | null) => void;
  loadMessages: (threadId: string) => Promise<void>;
  loadOlderMessages: (threadId: string) => Promise<void>;
  subscribeMessages: (threadId: string) => () => void;
  createThread: (userId: string, agentId?: string, projectId?: string | null, options?: CreateThreadOptions) => Promise<string>;
  addMessage: (msg: Omit<Message, 'id' | 'created_at'> & Partial<Pick<Message, 'id' | 'created_at'>>) => void;
  patchMessage: (id: string, patch: Partial<Message>) => void;
  setStreaming: (s: boolean) => void;
  setStreamingContent: (c: string) => void;
  setStreamingThinking: (t: string) => void;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  updateThreadPinned: (threadId: string, pinned: boolean) => Promise<void>;
  updateThreadStarred: (threadId: string, starred: boolean) => Promise<void>;
  updateThreadArchived: (threadId: string, archived: boolean) => Promise<void>;
  updateThreadAgent: (threadId: string, agentId: string) => Promise<void>;
  updateThreadSelectedModel: (threadId: string, modelId: string | null) => Promise<void>;
  updateThreadProject: (threadId: string, projectId: string | null) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

const normContent = (s: string) => (s || '').trim().replace(/\s+/g, ' ');
// Window for matching a fresh DB row against an in-memory message with
// identical normalized content. Widened from 30s to 4 minutes after Tara
// reported (2026-05-12) a duplicate assistant message arriving 2 minutes
// after the original — outside the previous 30s/60s windows. The new window
// covers backend refetch / realtime replay paths that re-emit the same
// canonical content under a different row id.
const CONTENT_DEDUPE_WINDOW_MS = 240_000;
// Window for matching a fresh DB row against a local optimistic stream stub
// where the content may have drifted (Council revision). Widened in tandem.
const STREAM_STUB_DEDUPE_WINDOW_MS = 240_000;
export const MESSAGE_PAGE_SIZE = 80;
let activeMessageLoadRequest = 0;

const isLocalStreamStub = (message: Pick<Message, 'metadata'>) =>
  message.metadata?.local_stream_stub === true;
const isConnectedProviderMessage = (message: Pick<Message, 'metadata'>) =>
  typeof message.metadata?.provider_connection_id === 'string';

const messageTime = (message: Pick<Message, 'created_at'>) => {
  const parsed = new Date(message.created_at).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const dedupeThreadsById = (threads: Thread[]): Thread[] => {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (!thread?.id || seen.has(thread.id)) return false;
    seen.add(thread.id);
    return true;
  });
};

export const dedupeMessagesForDisplay = (messages: Message[]): Message[] => {
  const seenIds = new Set<string>();
  const out: Message[] = [];

  for (const row of messages) {
    if (!row?.id || seenIds.has(row.id)) continue;
    seenIds.add(row.id);

    const rowTime = messageTime(row);
    const duplicateIndex = out.findIndex((existing) => {
      if (isConnectedProviderMessage(existing) || isConnectedProviderMessage(row)) return false;
      if (existing.role !== row.role) return false;
      if ((existing.agent ?? null) !== (row.agent ?? null)) return false;
      if ((existing.kind ?? null) !== (row.kind ?? null)) return false;
      if (normContent(existing.content) !== normContent(row.content)) return false;

      const age = Math.abs(rowTime - messageTime(existing));
      return row.role === 'assistant' && age <= CONTENT_DEDUPE_WINDOW_MS;
    });

    if (duplicateIndex >= 0) continue;
    out.push(row);
  }

  return out;
};

export const normalizeMessagePage = (
  newestFirstRows: Message[],
  pageSize = MESSAGE_PAGE_SIZE,
): { messages: Message[]; hasOlder: boolean } => ({
  messages: dedupeMessagesForDisplay(newestFirstRows.slice(0, pageSize).reverse()),
  hasOlder: newestFirstRows.length > pageSize,
});

export const mergeRealtimeMessage = (existing: Message[], row: Message): Message[] => {
  if (!row?.id) return existing;

  const sameIdIndex = existing.findIndex((m) => m.id === row.id);
  if (sameIdIndex >= 0) {
    if (isLocalStreamStub(existing[sameIdIndex])) {
      const next = existing.slice();
      next[sameIdIndex] = row;
      return next;
    }
    return existing;
  }

  const rowTime = new Date(row.created_at).getTime();
  const stubIndex = existing.findIndex((m) => {
    if (isConnectedProviderMessage(m) || isConnectedProviderMessage(row)) return false;
    if (m.id === row.id) return false;
    if (m.role !== row.role) return false;
    if ((m.agent ?? null) !== (row.agent ?? null)) return false;
    const stubTime = new Date(m.created_at).getTime();
    const age = Math.abs(rowTime - stubTime);
    if (normContent(m.content) === normContent(row.content)) {
      return age <= CONTENT_DEDUPE_WINDOW_MS;
    }
    return m.role === 'assistant' && isLocalStreamStub(m) && age <= STREAM_STUB_DEDUPE_WINDOW_MS;
  });

  if (stubIndex >= 0) {
    const next = existing.slice();
    next[stubIndex] = row;
    return next;
  }

  return [...existing, row];
};

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  streamingThinking: '',
  hasOlderMessages: false,
  loadingOlderMessages: false,

  loadThreads: async () => {
    const { data } = await supabase
      .from('threads')
      .select('*')
      .eq('archived', false)
      .order('updated_at', { ascending: false });
    if (data) set({ threads: dedupeThreadsById(data as Thread[]) });
  },

  setCurrentThread: (id) => set((state) => (
    state.currentThreadId === id
      ? { currentThreadId: id }
      : {
          currentThreadId: id,
          messages: [],
          hasOlderMessages: false,
          loadingOlderMessages: false,
        }
  )),

  loadMessages: async (threadId) => {
    const requestId = ++activeMessageLoadRequest;
    set({ loadingOlderMessages: false });
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .or('agent.is.null,and(agent.neq.guardian,agent.neq.observer)')
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE_SIZE + 1);
    if (!data || requestId !== activeMessageLoadRequest || get().currentThreadId !== threadId) return;
    const page = normalizeMessagePage(data as Message[]);
    set({ messages: page.messages, hasOlderMessages: page.hasOlder });
  },

  loadOlderMessages: async (threadId) => {
    const state = get();
    if (state.loadingOlderMessages || !state.hasOlderMessages) return;
    const oldest = state.messages[0];
    if (!oldest) return;

    set({ loadingOlderMessages: true });
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .or('agent.is.null,and(agent.neq.guardian,agent.neq.observer)')
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE + 1);
      if (!data || get().currentThreadId !== threadId) return;
      const page = normalizeMessagePage(data as Message[]);
      set((current) => ({
        messages: dedupeMessagesForDisplay([...page.messages, ...current.messages]),
        hasOlderMessages: page.hasOlder,
      }));
    } finally {
      if (get().currentThreadId === threadId) set({ loadingOlderMessages: false });
    }
  },

  // Realtime subscribe for inserts on the current thread. Catches messages
  // produced by background processes (subagent reports, scheduled-task
  // results, future tool-led inserts) without forcing a thread reload.
  //
  // Three de-dupe paths:
  //   1. Same-id row already in state → drop (re-emit safety).
  //   2. Existing message with the same role + agent + normalized content
  //      within CONTENT_DEDUPE_WINDOW_MS (4 min) → replace with the new row.
  //      Covers the Tara-reported case (2026-05-12) where a duplicate
  //      assistant message arrived 2 minutes after the original under a
  //      different uuid (likely realtime replay or scheduled-task refetch
  //      re-emitting the same canonical content). Same canonical content
  //      under any window age is treated as one message.
  //   3. A local optimistic stream stub with the same role + agent in the
  //      stub window → replace with the canonical DB row. For stream stubs
  //      only, content may differ because Council critique can revise the
  //      persisted body after the client buffered the first body.
  subscribeMessages: (threadId) => {
    const channel = supabase
      .channel(`thread-messages-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as Message;
          if (!row?.id) return;
          if (row.agent === 'guardian' || row.agent === 'observer') return;
          const existing = get().messages;
          const next = mergeRealtimeMessage(existing, row);
          if (next !== existing) set({ messages: next });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  createThread: async (userId, agentId = 'luca', projectId = null, options = {}) => {
    const selectedModel = options.selectedModel ?? null;
    const runtimeFallback = selectedModel ? 'classic' : defaultRuntimeForAgent(agentId);
    const runtimeMode = normalizeThreadRuntimeMode(options.runtimeMode, runtimeFallback);
    const insertPayload: {
      user_id: string;
      agent_id: string;
      primary_agent_id: string;
      participating_agent_ids: string[];
      runtime_mode: ThreadRuntimeMode;
      selected_model?: string | null;
      memory_enabled: boolean;
      project_id?: string;
    } = {
      user_id: userId,
      agent_id: agentId,
      primary_agent_id: agentId,
      participating_agent_ids: [agentId],
      runtime_mode: runtimeMode,
      memory_enabled: options.memoryEnabled ?? true,
    };
    if (selectedModel) insertPayload.selected_model = selectedModel;
    if (projectId) {
      insertPayload.project_id = projectId;
    }

    const { data, error } = await supabase
      .from('threads')
      .insert(insertPayload)
      .select()
      .single();
    if (error) {
      console.error('[threadStore] Failed to create thread', error);
      throw new Error(`Failed to create thread: ${error.message || 'Unknown Supabase error'}`);
    }
    if (data) {
      const thread = data as Thread;
      set((s) => ({
        threads: dedupeThreadsById([thread, ...s.threads]),
        currentThreadId: thread.id,
        messages: [],
        hasOlderMessages: false,
        loadingOlderMessages: false,
      }));
      return thread.id;
    }
    throw new Error('Failed to create thread: Supabase returned no thread');
  },

  addMessage: (msg) => {
    const now = Date.now();
    const existing = get().messages;
    const incomingNorm = normContent(msg.content);
    if (msg.id && existing.some((m) => m.id === msg.id)) return;

    // If realtime already delivered the canonical row for this same reply,
    // skip the local stub. Normal messages require a normalized content match;
    // local stream stubs may use role/agent/recency only because persisted
    // Council content can be revised after the buffered stream completes.
    const realtimeAlreadyHere = existing.some((m) => {
      if (isConnectedProviderMessage(m) || isConnectedProviderMessage(msg)) return false;
      if (m.role !== msg.role) return false;
      if ((m.agent ?? null) !== (msg.agent ?? null)) return false;
      const mTime = new Date(m.created_at).getTime();
      const age = Math.abs(now - mTime);
      if (normContent(m.content) === incomingNorm) {
        return age <= CONTENT_DEDUPE_WINDOW_MS;
      }
      return msg.role === 'assistant' && isLocalStreamStub(msg) && age <= STREAM_STUB_DEDUPE_WINDOW_MS;
    });
    if (realtimeAlreadyHere) return;

    const message: Message = {
      ...msg,
      id: msg.id ?? crypto.randomUUID(),
      created_at: msg.created_at ?? new Date().toISOString(),
    };
    set({ messages: [...existing, message] });
  },

  patchMessage: (id, patch) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  },

  setStreaming: (s) => set({ isStreaming: s }),
  setStreamingContent: (c) => set({ streamingContent: c }),
  setStreamingThinking: (t) => set({ streamingThinking: t }),

  updateThreadTitle: async (threadId, title) => {
    await supabase.from('threads').update({ title }).eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, title } : t)),
    }));
  },

  updateThreadPinned: async (threadId, pinned) => {
    await supabase.from('threads').update({ pinned }).eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, pinned } : t)),
    }));
  },

  updateThreadAgent: async (threadId, agentId) => {
    if (get().threads.find((thread) => thread.id === threadId)?.provider_connection_id != null) {
      throw new Error('Start a new connected conversation to choose another resident.');
    }
    await supabase
      .from('threads')
      .update({
        agent_id: agentId,
        primary_agent_id: agentId,
        participating_agent_ids: [agentId],
        runtime_mode: 'agent',
        selected_model: null,
      })
      .eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (
        t.id === threadId
          ? { ...t, agent_id: agentId, primary_agent_id: agentId, participating_agent_ids: [agentId], runtime_mode: 'agent', selected_model: null }
          : t
      )),
    }));
  },

  updateThreadSelectedModel: async (threadId, modelId) => {
    if (get().threads.find((thread) => thread.id === threadId)?.provider_connection_id != null) {
      throw new Error('Start a new connected conversation to choose another model.');
    }
    await supabase
      .from('threads')
      .update({
        agent_id: 'luca',
        primary_agent_id: 'luca',
        participating_agent_ids: ['luca'],
        selected_model: modelId,
        runtime_mode: 'classic',
      })
      .eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (
        t.id === threadId
          ? {
              ...t,
              agent_id: 'luca',
              primary_agent_id: 'luca',
              participating_agent_ids: ['luca'],
              selected_model: modelId,
              runtime_mode: 'classic',
            }
          : t
      )),
    }));
  },

  updateThreadProject: async (threadId, projectId) => {
    await supabase.from('threads').update({ project_id: projectId }).eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, project_id: projectId } : t)),
    }));
  },

  updateThreadStarred: async (threadId, starred) => {
    await supabase.from('threads').update({ starred }).eq('id', threadId);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, starred } : t)),
    }));
  },

  updateThreadArchived: async (threadId, archived) => {
    await supabase.from('threads').update({ archived }).eq('id', threadId);
    set((s) => ({
      threads: archived
        ? s.threads.filter((t) => t.id !== threadId)
        : s.threads.map((t) => (t.id === threadId ? { ...t, archived } : t)),
      currentThreadId: archived && s.currentThreadId === threadId ? null : s.currentThreadId,
    }));
  },

  deleteThread: async (threadId) => {
    await supabase.from('threads').delete().eq('id', threadId);
    set((s) => ({
      threads: s.threads.filter((t) => t.id !== threadId),
      currentThreadId: s.currentThreadId === threadId ? null : s.currentThreadId,
      messages: s.currentThreadId === threadId ? [] : s.messages,
    }));
  },
}));
