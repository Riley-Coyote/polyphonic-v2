import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { describeRedirect, isKnownApp, KNOWN_APP_SITES } from '@/lib/connector';
import { isKnownAppHost, KNOWN_APP_HOSTS } from '../../supabase/functions/_shared/connector/tools';

// Only Claude, ChatGPT, Claude Code and Codex may connect. /oauth/consent refuses every
// other return address (so no other app gets a token), and the connector re-checks the
// address each grant recorded on every call.

describe('which apps may connect', () => {
  it('accepts the sign-in return addresses of Claude, ChatGPT, Claude Code and Codex', () => {
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chat.openai.com/aip/callback',
      'http://localhost:3118/callback',
      'http://127.0.0.1:1455/auth/callback',
      'http://[::1]:8080/callback',
    ]) {
      expect(isKnownApp(uri), uri).toBe(true);
    }
  });

  it('refuses everything else, including lookalikes', () => {
    for (const uri of [
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai.evil.example/callback',
      'https://evilclaude.ai/callback',
      'https://www.claude.ai/callback',
      'https://evil.example/?next=https://claude.ai',
      'https://localhost.evil.example/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'vscode://mcp/callback',
      'javascript:alert(1)',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(isKnownApp(uri), String(uri)).toBe(false);
    }
  });

  it('records a known app the way the connector expects to read it back', () => {
    for (const uri of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:1455/auth/callback']) {
      expect(isKnownAppHost(describeRedirect(uri).host), uri).toBe(true);
    }
    expect(isKnownAppHost(describeRedirect('cursor://anysphere.cursor-mcp/oauth/callback').host)).toBe(false);
    expect(isKnownAppHost(describeRedirect('https://evil.example/cb').host)).toBe(false);
  });

  it('keeps the page and the connector on the same list', () => {
    expect([...KNOWN_APP_HOSTS].sort()).toEqual([...KNOWN_APP_SITES, 'this computer'].sort());
  });
});
