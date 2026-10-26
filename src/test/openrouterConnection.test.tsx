import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterConnection } from '@/components/settings/OpenRouterConnection';
import type { OpenRouterSettingsClient, OpenRouterSnapshot } from '@/lib/openrouterSettings';

afterEach(cleanup);
function fixture(connected = false) {
  const state: OpenRouterSnapshot = { connected, preview: connected ? 'sk-or-…test' : null, model: 'moonshotai/kimi-k2.6' };
  const client: OpenRouterSettingsClient = {
    load: vi.fn(async () => ({ ...state })),
    connect: vi.fn(async () => { state.connected = true; state.preview = 'sk-or-…test'; }),
    saveKey: vi.fn(async () => { state.connected = true; state.preview = 'sk-or-…test'; }),
    disconnect: vi.fn(async () => { state.connected = false; }),
    setModel: vi.fn(async model => { state.model = model; }),
    createThread: vi.fn(async () => 'fixture-thread'),
  };
  return client;
}
describe('simple OpenRouter setup', () => {
  it('connects a new account without agent creation or a manual key', async () => {
    const client = fixture(), open = vi.fn();
    render(<OpenRouterConnection client={client} onConversation={open} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect OpenRouter' }));
    const start = await screen.findByRole('button', { name: 'Chat with Luca' });
    expect(client.saveKey).not.toHaveBeenCalled(); expect(client.createThread).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(client.createThread).toHaveBeenCalledWith('moonshotai/kimi-k2.6'));
    expect(open).toHaveBeenCalledWith('fixture-thread');
  });
  it('clears a pasted key before saving and never persists it in browser storage', async () => {
    const client = fixture(); let finish!: () => void;
    client.saveKey = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const stored = vi.spyOn(window.localStorage, 'setItem');
    render(<OpenRouterConnection client={client} onConversation={vi.fn()} />);
    await screen.findByRole('button', { name: 'Connect OpenRouter' });
    fireEvent.click(screen.getByText('Use an API key instead'));
    const input = screen.getByLabelText('OpenRouter API key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'fixture-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    expect(input).toHaveValue(''); expect(stored).not.toHaveBeenCalled();
    finish(); await screen.findByText('OpenRouter API key saved.'); stored.mockRestore();
  });
  it('keeps the saved model when a preference update fails', async () => {
    const client = fixture(true), saved = vi.fn();
    client.setModel = vi.fn().mockRejectedValue(new Error('Could not save this model.'));
    render(<OpenRouterConnection client={client} onConversation={vi.fn()} onModelSaved={saved} />);
    const select = await screen.findByLabelText('Default cloud model');
    fireEvent.change(select, { target: { value: 'openai/gpt-5.4' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this model.');
    expect(select).toHaveValue('moonshotai/kimi-k2.6'); expect(saved).not.toHaveBeenCalled();
  });
  it('aborts an old account flow and ignores its completion after the account changes', async () => {
    const first = fixture(), second = fixture(); let finish!: () => void; let signal!: AbortSignal;
    first.connect = vi.fn(s => { signal = s; return new Promise<void>(resolve => { finish = resolve; }); });
    const view = render(<OpenRouterConnection client={first} onConversation={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect OpenRouter' }));
    await screen.findByRole('button', { name: 'Cancel sign-in' });
    view.rerender(<OpenRouterConnection client={second} onConversation={vi.fn()} />);
    expect(signal.aborted).toBe(true); finish();
    await screen.findByRole('button', { name: 'Connect OpenRouter' });
    expect(screen.queryByRole('button', { name: 'Chat with Luca' })).not.toBeInTheDocument();
    expect(first.load).toHaveBeenCalledTimes(1); expect(second.saveKey).not.toHaveBeenCalled();
  });
});
