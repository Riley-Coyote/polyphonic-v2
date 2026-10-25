import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiresOpenRouterKey } from '@/lib/connectedChat';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('OpenRouter onboarding and free guide boundary', () => {
  it('routes create/migration onboarding through OpenRouter before Luca handoff', () => {
    const onboarding = readRepoFile('src/pages/Onboarding.tsx');

    expect(onboarding).toContain("type Step = 'intent' | 'comfort' | 'expectations' | 'connect' | 'handoff'");
    expect(onboarding).toContain("intent === 'create_new' || intent === 'bring_existing'");
    expect(onboarding).toContain('Connect OpenRouter before Luca begins.');
    expect(onboarding).toContain("navigate('/chat?guide=1'");
    expect(onboarding).toContain('look around with Guide');
  });

  it('keeps unbound chat behind OpenRouter while separately connected threads use their own account', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    const chatMulti = readRepoFile('supabase/functions/chat-multi/index.ts');
    const legacyChat = readRepoFile('supabase/functions/chat/index.ts');
    const guardian = readRepoFile('supabase/functions/chat-guardian/index.ts');

    expect(chatView).toContain('requiresOpenRouterKey(currentThread, modelKeyStatus)');
    for (const status of ['checking', 'missing', 'unknown'] as const) {
      expect(requiresOpenRouterKey(undefined, status)).toBe(true);
      expect(requiresOpenRouterKey({ id: 'legacy', provider_connection_id: null }, status)).toBe(true);
      expect(requiresOpenRouterKey({ id: 'bound', provider_connection_id: 'connected-account' }, status)).toBe(false);
    }
    expect(requiresOpenRouterKey(undefined, 'present')).toBe(false);
    expect(chatView).toContain('Ask Polyphonic Guide');
    expect(chatView).toContain("navigate(threadId ? `/chat/${threadId}?guide=1` : '/chat?guide=1'");
    expect(chatMulti).toContain('The free Polyphonic Guide can answer app/setup questions without a key.');
    expect(chatMulti).toContain('new MissingApiKeyError(message)');
    expect(legacyChat).toContain('The free Polyphonic Guide can answer app/setup questions without a key.');
    expect(guardian).toContain('Connect OpenRouter before using Observer.');
    expect(guardian).toContain('new MissingApiKeyError');
  });

  it('keeps public landing and companion import on the guide/key path before Luca', () => {
    const landing = readRepoFile('src/pages/LandingPage.tsx');
    const importView = readRepoFile('src/pages/ImportView.tsx');

    expect(landing).toContain("navigate('/chat?guide=1')");
    expect(landing).toContain('ensureGuideSession');
    expect(landing).not.toContain('startGuestChat(trimmed)');
    expect(importView).toContain('Connect OpenRouter before migration.');
    expect(importView).toContain('if (!modelKeyConnected) return;');
  });

  it('requires OpenRouter for Forge and removes the platform-key exception', () => {
    const toolExecute = readRepoFile('supabase/functions/anima-tool-execute/index.ts');
    const forge = readRepoFile('supabase/functions/agent-forge/index.ts');

    expect(toolExecute).toContain('Tool planning and Forge both require BYOK now');
    expect(toolExecute).not.toContain('if (!openrouterKey && forceForgeOnly)');
    expect(forge).toContain('ensureUserOpenRouterKey');
    expect(forge).toContain('requires_openrouter');
    expect(forge).toContain('Connect OpenRouter before creating or updating agents.');
  });
});
