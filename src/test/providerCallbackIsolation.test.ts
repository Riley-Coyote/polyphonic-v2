import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/integrations/supabase/previewAuthStorage', () => ({ brokeredPreviewStorage: () => undefined }));
beforeEach(() => { vi.resetModules(); createClient.mockClear(); vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fixture-publishable'); });
afterEach(() => { history.replaceState(null, '', '/'); vi.unstubAllEnvs(); });
describe('provider OAuth and Polyphonic login separation', () => {
  it.each([
    '/auth/openrouter/callback?error=access_denied&state=fixture',
    '/auth/openrouter/callback?code=fixture-provider-code&state=fixture',
    '/auth/openrouter/callback/?code=fixture-provider-code',
  ])('leaves provider callback credentials to the provider flow: %s', async path => {
    history.replaceState(null, '', path);
    await import('@/integrations/supabase/client');
    expect(createClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ auth: expect.objectContaining({ detectSessionInUrl: false, persistSession: true, autoRefreshToken: true }) }));
  });
  it.each(['/auth/login?code=fixture-login-code', '/reset-password', '/chat'])('preserves normal Supabase login handling: %s', async path => {
    history.replaceState(null, '', path);
    await import('@/integrations/supabase/client');
    expect(createClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ auth: expect.objectContaining({ detectSessionInUrl: true }) }));
  });
});
