import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerConnectionClient } from './providerConnections';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));

const user = '22222222-2222-4222-8222-222222222222';
const connection = '33333333-3333-4333-8333-333333333333';
const fixtureKey = 'sk-ant-api03-FIXTURE-NOT-A-REAL-KEY';

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: user }, access_token: 'fixture-session' } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function reply(status: number, code: string) {
  // An upstream error must never be shown verbatim, even if it echoes a credential.
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error: `Unsafe detail ${fixtureKey}` }), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
}

describe('provider connection error guidance', () => {
  it.each([
    ['provider_api_key_invalid', 'sk-ant-api… or sk-ant-usr…'],
    ['provider_workspace_invalid', 'workspace ID beginning wrkspc_'],
    ['provider_workspace_required', 'Claude Console Settings → Workspaces'],
  ])('gives field guidance for %s without echoing a credential', async (code, guidance) => {
    const fetcher = reply(400, code);
    vi.stubGlobal('fetch', fetcher);
    const error = await providerConnectionClient(user).saveAnthropic(connection, fixtureKey, '').catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(guidance);
    expect(error.message).not.toContain('server configuration');
    expect(error.message).not.toContain(fixtureKey);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('handles a legacy input-validation 400 without calling it a server setup failure', async () => {
    vi.stubGlobal('fetch', reply(400, 'provider_configuration_required'));
    await expect(providerConnectionClient(user).saveAnthropic(connection, fixtureKey, ''))
      .rejects.toThrow('Check the Claude API key and workspace ID.');
  });

  it('retains server setup guidance for a real configuration 503', async () => {
    vi.stubGlobal('fetch', reply(503, 'provider_configuration_required'));
    await expect(providerConnectionClient(user).list()).rejects.toThrow('needs server configuration');
  });

  it('never exposes unrecognized error bodies or silently retries a save', async () => {
    const fetcher = reply(400, 'unknown_server_code');
    vi.stubGlobal('fetch', fetcher);
    const error = await providerConnectionClient(user).saveAnthropic(connection, fixtureKey, '').catch(e => e);
    expect(error.message).toBe('Could not update this provider connection. Please try again.');
    expect(error.message).not.toContain(fixtureKey);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not send credentials if the signed-in account has changed', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: connection }, access_token: 'fixture-other-session' } }, error: null });
    await expect(providerConnectionClient(user).saveAnthropic(connection, fixtureKey, '')).rejects.toThrow('Sign in again');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards a personal Console key and workspace unchanged only to the provider connection endpoint', async () => {
    const personalKey = 'sk-ant-usr01-FIXTURE-NOT-A-REAL-KEY';
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await providerConnectionClient(user).saveAnthropic(connection, personalKey, 'wrkspc_fixture');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-connections`);
    expect(JSON.parse(request.body)).toEqual({ action: 'save_anthropic', connection_id: connection, api_key: personalKey, workspace_id: 'wrkspc_fixture' });
  });
});
