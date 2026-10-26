import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectOpenRouter, handleOpenRouterCallbackInPopup, isOpenRouterFlowPending } from '@/lib/openrouterAuth';

let popup: { location: { href: string }; closed: boolean; close: ReturnType<typeof vi.fn> };
const fixtureKey = 'sk-or-v1-fixture-not-a-real-key-123456789';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function authorization() { for (let i = 0; i < 100 && !popup.location.href.startsWith('https:'); i++) await tick(); return new URL(popup.location.href); }
function callback(state: string, overrides: Partial<MessageEventInit> = {}) {
  window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: popup as unknown as Window, data: { type: 'openrouter-auth-callback', state, code: 'fixture-single-use-code' }, ...overrides }));
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', undefined);
  popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  vi.spyOn(window, 'close').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: fixtureKey }), { status: 200 })));
  history.replaceState(null, '', '/');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('OpenRouter authorization boundaries', () => {
  it('opens synchronously, binds origin + source + state, and exchanges once using its own PKCE verifier', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const promise = connectOpenRouter();
    expect(window.open).toHaveBeenCalledWith('about:blank', expect.stringMatching(/^polyphonic-openrouter-/), expect.any(String));
    expect(isOpenRouterFlowPending()).toBe(true);
    const auth = await authorization(), state = auth.searchParams.get('state')!;
    expect(new URL(auth.searchParams.get('callback_url')!).searchParams.get('state')).toBe(state);
    callback(state, { origin: 'https://wrong.invalid' });
    callback(state, { source: null });
    callback('wrong-state');
    await tick(); expect(fetch).not.toHaveBeenCalled();
    callback(state);
    expect((await promise).key).toBe(fixtureKey);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys');
    const body = JSON.parse(options!.body as string);
    const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier)));
    const challenge = Buffer.from(digest).toString('base64url');
    expect(challenge).toBe(auth.searchParams.get('code_challenge'));
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(storage).not.toHaveBeenCalled(); expect(popup.close).toHaveBeenCalled(); expect(isOpenRouterFlowPending()).toBe(false);
  });
  it('cancels and cleans up without exchanging, then allows a new attempt', async () => {
    const controller = new AbortController(), promise = connectOpenRouter({ signal: controller.signal });
    const auth = await authorization();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    callback(auth.searchParams.get('state')!);
    expect(fetch).not.toHaveBeenCalled(); expect(isOpenRouterFlowPending()).toBe(false);
    const next = new AbortController(), second = connectOpenRouter({ signal: next.signal });
    next.abort(); await expect(second).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('checks the original Polyphonic account again before exchanging a code', async () => {
    const check = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('account changed'));
    const promise = connectOpenRouter({ beforeAuthorize: check });
    const auth = await authorization(); callback(auth.searchParams.get('state')!);
    await expect(promise).rejects.toThrow('account changed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not overwrite a pending flow or accept an external callback', async () => {
    await expect(connectOpenRouter({ callbackUrl: 'https://outside.invalid/callback' })).rejects.toMatchObject({ code: 'invalid_callback' });
    expect(window.open).not.toHaveBeenCalled();
    const controller = new AbortController(), promise = connectOpenRouter({ signal: controller.signal });
    await expect(connectOpenRouter()).rejects.toMatchObject({ code: 'flow_pending' });
    controller.abort(); await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('never reflects provider error bodies and never retries exchange', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('secret-code-and-key', { status: 400 }));
    const promise = connectOpenRouter(), auth = await authorization(); callback(auth.searchParams.get('state')!);
    await expect(promise).rejects.toMatchObject({ code: 'exchange_failed', message: expect.not.stringContaining('secret') });
    expect(fetch).toHaveBeenCalledTimes(1); expect(isOpenRouterFlowPending()).toBe(false);
  });
  it('recovers a COOP popup via an isolated same-origin channel without storage', async () => {
    const channels: { onmessage?: (event: { data: unknown }) => void; close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('BroadcastChannel', class { onmessage?: (event: { data: unknown }) => void; close = vi.fn(); constructor(public name: string) { channels.push(this); } });
    const promise = connectOpenRouter(), auth = await authorization(), state = auth.searchParams.get('state')!;
    const channel = channels[0];
    popup.closed = true;
    channel.onmessage!({ data: { type: 'openrouter-auth-callback', state, code: 'fixture-code' } });
    expect((await promise).key).toBe(fixtureKey); expect(channel.close).toHaveBeenCalled();
  });
  it('reports a blocked popup and missing callback code honestly, scrubbing credentials from the URL', async () => {
    vi.mocked(window.open).mockReturnValue(null);
    await expect(connectOpenRouter()).rejects.toMatchObject({ code: 'popup_blocked' });
    expect(isOpenRouterFlowPending()).toBe(false);
    history.replaceState(null, '', '/auth/openrouter/callback?state=' + 'a'.repeat(64) + '&error=denied&error_description=secret');
    const result = handleOpenRouterCallbackInPopup();
    expect(result.ok).toBe(false); expect(result.message).not.toContain('secret'); expect(location.search).toBe('');
    history.replaceState(null, '', '/auth/openrouter/callback');
    expect(handleOpenRouterCallbackInPopup().ok).toBe(false);
  });
});
