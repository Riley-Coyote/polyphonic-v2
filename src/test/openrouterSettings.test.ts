import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession } } }));
import { openRouterSettingsClient } from '@/lib/openrouterSettings';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const session = (id = owner, token = 'fixture-token') => ({ data: { session: { user: { id }, access_token: token } }, error: null });
beforeEach(() => { getSession.mockReset().mockResolvedValue(session()); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('OpenRouter existing vault client', () => {
  it('refuses to save a key after switching Polyphonic accounts', async () => {
    getSession.mockResolvedValue(session('other-user'));
    await expect(openRouterSettingsClient(owner).saveKey('sk-or-v1-fixture-test-key-123456')).rejects.toMatchObject({ code: 'account_changed' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a captured bearer for the existing encrypted RPC and never browser storage', async () => {
    const storage = vi.spyOn(window.localStorage, 'setItem');
    const client = openRouterSettingsClient(owner), key = 'sk-or-v1-fixture-test-key-123456';
    await client.saveKey(key);
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/rest\/v1\/rpc\/save_user_api_key$/);
    expect(request!.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    expect(JSON.parse(request!.body as string)).toEqual({ p_key: key });
    expect(storage).not.toHaveBeenCalled();
  });
  it('detects account changes during a write without exposing server response text', async () => {
    getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('other-user'));
    await expect(openRouterSettingsClient(owner).saveKey('sk-or-v1-fixture-test-key-123456')).rejects.toMatchObject({ code: 'account_changed' });
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
  });
  it('reads only preview and default model, scoped to the owner', async () => {
    vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('user_api_keys') ? [{ key_preview: 'sk-or-…test' }] : [{ default_model: 'test/model' }])));
    const state = await openRouterSettingsClient(owner).load();
    expect(state).toEqual({ connected: true, preview: 'sk-or-…test', model: 'test/model' });
    for (const [url] of vi.mocked(fetch).mock.calls) { expect(String(url)).toContain(`user_id=eq.${owner}`); expect(String(url)).not.toContain('encrypted_key'); }
  });
  it('saves a checked model preference and creates an explicit OpenRouter chat', async () => {
    const client = openRouterSettingsClient(owner);
    await client.setModel('test/model');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ user_id: owner, default_model: 'test/model' });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])));
    await client.createThread('test/model');
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(body).toMatchObject({ user_id: owner, agent_id: 'luca', selected_model: 'test/model', runtime_mode: 'classic' });
    expect(body).not.toHaveProperty('provider_connection_id');
  });
  it('sanitizes write failures and does not retry or switch connections', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('upstream-secret', { status: 500 }));
    await expect(openRouterSettingsClient(owner).saveKey('sk-or-v1-fixture-test-key-123456')).rejects.toMatchObject({ message: expect.not.stringContaining('secret') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
