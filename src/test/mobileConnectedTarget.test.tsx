import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  path: '/chat/fixture-thread', currentThreadId: 'fixture-thread',
  threads: [] as Array<{ id: string; title: string; agent_id: string; runtime_mode: string; selected_model: string; provider_connection_id: string | null }>,
  messages: [] as Array<{ id: string }>,
  navigate: vi.fn(), loadThreads: vi.fn(), createThread: vi.fn().mockResolvedValue('new-legacy-thread'),
  updateThreadAgent: vi.fn(), updateThreadSelectedModel: vi.fn(),
  setActiveAgent: vi.fn(), updateSetting: vi.fn(), setLastChatTarget: vi.fn(), open: vi.fn(), close: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: fixture.path }), useNavigate: () => fixture.navigate }));
vi.mock('@/components/composer/ChatTargetPicker', () => ({ ChatTargetPicker: ({ onSelectModel }: { onSelectModel: (id: string) => void }) =>
  <button onClick={() => onSelectModel('openrouter/fixture-model')}>Choose chat target</button> }));
vi.mock('@/stores/threadStore', () => ({ useThreadStore: (select: (value: unknown) => unknown) => select({
  threads: fixture.threads, currentThreadId: fixture.currentThreadId, messages: fixture.messages,
  loadThreads: fixture.loadThreads, createThread: fixture.createThread,
  updateThreadAgent: fixture.updateThreadAgent, updateThreadSelectedModel: fixture.updateThreadSelectedModel,
}) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (value: unknown) => unknown) => select({ user: { id: 'fixture-user' } }) }));
vi.mock('@/stores/drawerStore', () => ({ useDrawerStore: (select: (value: unknown) => unknown) => select({ open: fixture.open, close: fixture.close }) }));
vi.mock('@/stores/mobileShellStore', () => ({ useMobileShellStore: (select: (value: unknown) => unknown) => select({ openDrawer: fixture.open }) }));
vi.mock('@/stores/notificationStore', () => ({ useNotificationStore: () => 0, selectPendingInitiationsCount: () => 0 }));
vi.mock('@/stores/interfaceModeStore', () => ({ useInterfaceModeStore: (select: (value: unknown) => unknown) => select({ mode: 'studio' }) }));
vi.mock('@/stores/agentScopeStore', () => ({ useAgentScopeStore: (select: (value: unknown) => unknown) => select({
  activeAgentId: 'luca', setActiveAgent: fixture.setActiveAgent, availableAgents: [{ id: 'luca', name: 'Luca' }],
}) }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: (value: unknown) => unknown) => select({
  landing_agent_id: null, default_model: 'moonshotai/kimi-k2.6', updateSetting: fixture.updateSetting,
  setLastChatTarget: fixture.setLastChatTarget, last_chat_target_kind: 'agent', last_chat_target_id: 'luca',
}) }));

import MobileAppBar from '@/components/mobile/MobileAppBar';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.path = '/chat/fixture-thread';
  fixture.currentThreadId = 'fixture-thread';
  fixture.messages = [];
  fixture.threads = [{ id: 'fixture-thread', title: 'Fixture conversation', agent_id: 'luca', runtime_mode: 'agent',
    selected_model: 'claude-native-fixture', provider_connection_id: 'fixture-connected-account' }];
});
afterEach(cleanup);

describe('mobile connected chat routing boundary', () => {
  it('shows a static resident/model identity and no raw target control for a provider-bound conversation', () => {
    render(<MobileAppBar />);
    expect(screen.queryByRole('button', { name: 'Choose chat target' })).not.toBeInTheDocument();
    expect(screen.getByText('Luca')).toBeInTheDocument();
    expect(screen.getByText('claude-native-fixture · connected account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open thread details' })).toBeInTheDocument();
    expect(fixture.createThread).not.toHaveBeenCalled();
    expect(fixture.updateThreadSelectedModel).not.toHaveBeenCalled();
  });

  it('cannot expose a stale previous thread target while the route thread metadata is loading', () => {
    fixture.currentThreadId = 'old-thread';
    fixture.threads = [{ ...fixture.threads[0], id: 'old-thread', provider_connection_id: null }];
    render(<MobileAppBar />);
    expect(screen.queryByRole('button', { name: 'Choose chat target' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading conversation…')).toBeInTheDocument();
    expect(fixture.updateThreadAgent).not.toHaveBeenCalled();
    expect(fixture.updateThreadSelectedModel).not.toHaveBeenCalled();
  });

  it('keeps the original model target behavior for an empty unbound conversation', async () => {
    fixture.threads[0].provider_connection_id = null;
    render(<MobileAppBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose chat target' }));
    await waitFor(() => expect(fixture.updateThreadSelectedModel).toHaveBeenCalledWith('fixture-thread', 'openrouter/fixture-model'));
    expect(fixture.createThread).not.toHaveBeenCalled();
  });

  it('keeps agent-scoped navigation available outside the connected chat surface', () => {
    fixture.path = '/memory';
    render(<MobileAppBar />);
    expect(screen.getByRole('button', { name: 'Choose chat target' })).toBeInTheDocument();
  });
});
