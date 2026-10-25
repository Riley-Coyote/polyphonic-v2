import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConnections } from '@/components/settings/ProviderConnections';
import type { ConnectionSnapshot, ProviderConnectionClient } from '@/lib/providerConnections';

afterEach(cleanup);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(available = false) {
  const snapshot: ConnectionSnapshot = { connections: [{ id, label: 'Personal Claude', provider: 'anthropic', status: 'connected', expires_at: null, created_at: '2026-10-24T00:00:00Z' }], capabilities: { anthropic: { available: true }, chatgpt: { available, reason: available ? null : 'approval_required' } } };
  const client: ProviderConnectionClient = {
    list: vi.fn().mockResolvedValue(snapshot), models: vi.fn().mockResolvedValue([{ id: 'fixture-model', name: 'Test model' }]),
    saveAnthropic: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
    startChatGPT: vi.fn().mockResolvedValue('https://example.invalid/start'), finishChatGPT: vi.fn().mockResolvedValue(undefined),
    createThread: vi.fn().mockResolvedValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  };
  return client;
}
describe('connected provider settings boundaries', () => {
  it('requires hosted approval and explicit model choice before starting chat', async () => {
    const client = fixture(), opened = vi.fn();
    render(<ProviderConnections client={client} onConversation={opened} />);
    expect(await screen.findByText('Awaiting OpenAI approval for hosted plan access.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Connect ChatGPT$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a model' }));
    const model = await screen.findByLabelText('Model');
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled();
    expect(client.createThread).not.toHaveBeenCalled();
    fireEvent.change(model, { target: { value: 'fixture-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await waitFor(() => expect(client.createThread).toHaveBeenCalledWith(id, 'fixture-model', 'luca'));
    expect(opened).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });
  it('clears the masked key immediately and never saves it in browser storage', async () => {
    const client = fixture(); let finish!: () => void;
    client.saveAnthropic = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const saved = vi.spyOn(window.localStorage, 'setItem');
    render(<ProviderConnections client={client} onConversation={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Personal Claude' });
    const input = screen.getByLabelText('Anthropic API key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'fixture-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Claude API' }));
    expect(input).toHaveValue('');
    expect(client.saveAnthropic).toHaveBeenCalledWith(expect.any(String), 'fixture-test-key', '');
    expect(saved).not.toHaveBeenCalled();
    finish(); await screen.findByText('Claude API connected. Choose a model to start a chat.');
    saved.mockRestore();
  });
  it('keeps provider failures visible without opening a chat or another provider', async () => {
    const client = fixture(true), opened = vi.fn();
    client.models = vi.fn().mockRejectedValue(new Error('This account needs available API credits.'));
    render(<ProviderConnections client={client} onConversation={opened} />);
    await screen.findByRole('heading', { name: 'Personal Claude' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a model' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account needs available API credits.');
    expect(client.createThread).not.toHaveBeenCalled(); expect(client.startChatGPT).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
});
