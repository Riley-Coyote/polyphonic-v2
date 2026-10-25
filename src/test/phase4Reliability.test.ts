import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Phase 4 reliability guardrails', () => {
  it('enforces daily chat quota in the primary chat-multi runtime before model calls', () => {
    const source = readRepoFile('supabase/functions/chat-multi/index.ts');
    const backend = readRepoFile('supabase/functions/_shared/model-backend.ts');
    const quotaCheckIndex = source.indexOf('await checkAndIncrement(userId, backend.quotaScope, backend.quotaLimit)');
    const backendResolverIndex = source.indexOf('backend = await resolveChatBackend');
    const firstModelCallIndex = source.indexOf('https://openrouter.ai/api/v1/chat/completions');

    expect(source).toContain('import { checkAndIncrement } from "../_shared/dailyQuota.ts";');
    expect(source).toContain('resolveChatBackend');
    expect(backend).toContain('guest-chat-message');
    expect(backend).toContain('free-chat-message');
    expect(backend).toContain('byok-chat-message');
    expect(quotaCheckIndex).toBeGreaterThan(-1);
    expect(backendResolverIndex).toBeGreaterThan(-1);
    expect(firstModelCallIndex).toBeGreaterThan(-1);
    expect(backendResolverIndex).toBeLessThan(quotaCheckIndex);
    expect(quotaCheckIndex).toBeLessThan(firstModelCallIndex);
    expect(source).toContain('new AppError("quota_exceeded"');
  });

  it('requires an exact service-role bearer for mnemos digest service mode', () => {
    const source = readRepoFile('supabase/functions/mnemos-digest-build/index.ts');
    expect(source).toContain('authHeader === `Bearer ${serviceRoleKey}`');
    expect(source).not.toContain('authHeader.includes');
  });

  it('records health for scheduled-task and crisis follow-up cron runners', () => {
    for (const file of [
      'supabase/functions/scheduled-task-run/index.ts',
      'supabase/functions/crisis-followup/index.ts',
    ]) {
      const source = readRepoFile(file);
      expect(source).toContain('import { trackCronJob } from "../_shared/cronHealth.ts";');
      expect(source).toMatch(/return await trackCronJob\("[a-z-]+", async \(\) => \{/);
    }
  });

  it('does not leave config-implicit edge functions without a source auth marker', () => {
    const config = readRepoFile('supabase/config.toml');
    const configured = new Set(
      [...config.matchAll(/^\s*\[functions\.([^\]]+)\]\s*\n\s*verify_jwt\s*=\s*\w+/gm)].map((m) => m[1]),
    );
    const functionsRoot = join(process.cwd(), 'supabase/functions');
    const implicitFunctions = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .filter((name) => !configured.has(name))
      .sort();

    const missingAuthMarkers = implicitFunctions.filter((name) => {
      const indexPath = join(functionsRoot, name, 'index.ts');
      if (!existsSync(indexPath)) return true;
      const source = readFileSync(indexPath, 'utf8');
      return !(
        source.includes('authenticateUser(req)') ||
        source.includes('requireAuth(req)') ||
        source.includes('auth.getUser') ||
        source.includes('auth.getClaims') ||
        source.includes('.getUser(') ||
        source.includes('requireServiceRole(req') ||
        source.includes('auth !== `Bearer ${serviceRole}`') ||
        source.includes('authHeader !== `Bearer ${serviceRoleKey}`') ||
        source.includes('authenticateDeviceToken(') ||
        source.includes('verifyWebhookRequest(') ||
        source.includes("claims?.role !== 'service_role'")
      );
    });

    expect(missingAuthMarkers).toEqual([]);
  });

  it('keeps user-visible edge functions on structured error envelopes', () => {
    const jsonFunctions = [
      'supabase/functions/chat/index.ts',
      'supabase/functions/chat-multi/index.ts',
      'supabase/functions/chat-guardian/index.ts',
      'supabase/functions/observer-chat/index.ts',
      'supabase/functions/profile-chat/index.ts',
    ];

    for (const file of jsonFunctions) {
      const source = readRepoFile(file);
      expect(source, file).toContain('../_shared/errors.ts');
      expect(source, file).toContain('newRequestId()');
      expect(source, file).toContain('errorResponse(');
      expect(source, file).not.toMatch(/JSON\.stringify\(\{\s*error:\s*"Internal error"/);
    }

    for (const file of [
      'supabase/functions/chat/index.ts',
      'supabase/functions/chat-multi/index.ts',
      'supabase/functions/chat-guardian/index.ts',
    ]) {
      const source = readRepoFile(file);
      expect(source, file).toContain('request_id: requestId');
      expect(source, file).toContain('code: "upstream_');
    }
  });

  it('does not persist placeholder empty assistant responses from chat-multi', () => {
    const source = readRepoFile('supabase/functions/chat-multi/index.ts');
    const legacySource = readRepoFile('supabase/functions/chat/index.ts');

    expect(source).toContain('provider stream ended with no content; retrying non-streaming once');
    expect(source).toContain('error: "empty_response"');
    expect(source).toContain('function buildSimpleOpeningReasoningParams()');
    expect(source).toContain('effort: "none"');
    expect(source).toContain('exclude: true');
    expect(source).toContain('if (agentIsSystemLuca && !simpleOpeningTurn)');
    expect(source).toContain('maxTokens: simpleOpeningTurn && singleModel !== "moonshotai/kimi-k3"');
    expect(source).toContain(': getModelDefaultMaxOutputTokens(singleModel)');
    expect(source).not.toContain('content: fullContent || "(empty)"');
    expect(source).not.toContain('synthesizedContent || "(empty)"');
    expect(legacySource).toContain('error: "empty_response"');
    expect(legacySource).not.toContain('content: fullContent || "(empty response)"');
  });

  it('keeps custom agents scoped to their own identity and BYOK runtime', () => {
    const source = readRepoFile('supabase/functions/chat-multi/index.ts');
    const legacySource = readRepoFile('supabase/functions/chat/index.ts');
    const identitySource = readRepoFile('supabase/functions/_shared/agents/luca-identity.ts');
    const customPrompt = readRepoFile('supabase/functions/_shared/agents/custom-agent-prompt.ts');

    expect(source).toContain('buildCustomAgentSystemPrompt');
    expect(source).toContain('.select("*")');
    expect(source).toContain('.eq("user_id", userId)');
    expect(source).toContain('(thread as Record<string, unknown>).provider_connection_id');
    expect(source).toContain('This conversation uses a connected provider.');
    expect(source).toContain('const agentId = resolveThreadAgentId(thread)');
    expect(source).toContain('backend.keySource !== "user"');
    expect(source).toContain('Custom agents require your own OpenRouter key');
    expect(source).not.toContain('backend.keySource === "platform" ? "luca" : threadAgentId');
    expect(source).toContain('includeIdentity: !classicRuntime');
    expect(source).toContain('includeFunctionalMemory: quietMemoryEnabled && backend.billingTier !== "guest"');
    expect(source).toContain('includeMnemos: quietMemoryEnabled && backend.billingTier !== "guest"');
    expect(source).toContain('identityDocs: continuity.identityDocs');
    expect(source).toContain('agent: agentId');

    expect(legacySource).toContain('.select("*")');
    expect(legacySource).toContain('.eq("user_id", userId)');
    expect(legacySource).toContain('(thread as Record<string, unknown>).provider_connection_id');
    expect(legacySource).toContain('const agentId = resolveThreadAgentId(thread)');
    expect(legacySource).toContain('agentId,');
    expect(legacySource).toContain('includeFunctionalMemory: backend.billingTier !== "guest"');
    expect(legacySource).toContain('includeMnemos: backend.billingTier !== "guest"');
    expect(legacySource).toContain('buildCustomAgentSystemPrompt');
    expect(legacySource).toContain('agent: agentId');

    expect(identitySource).toContain('export async function loadAgentIdentity');
    expect(identitySource).toContain('if (agentId !== "luca")');
    expect(identitySource).toContain('return loadAgentIdentity(supabase, userId, agentId)');

    expect(customPrompt).toContain('You speak as yourself, in your own voice');
    expect(customPrompt).not.toContain('LUCA_SOUL');
  });

  it('keeps agent threads isolated instead of silently mutating them or blending prior voices', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    const kernel = readRepoFile('supabase/functions/_shared/continuity/kernel.ts');

    expect(chatView).not.toContain("if (currentThreadId) updateThreadAgent(currentThreadId, 'luca')");
    expect(chatView).toContain("pendingTargetKind === 'model' ? 'classic' : defaultRuntimeForAgent(activeAgentId)");
    expect(chatView).toContain("persistChatTarget({ kind: 'agent', id })");
    expect(chatView).toContain('const handleAgentChange = useCallback');
    expect(chatView).toContain('if (messages.length === 0)');
    expect(chatView).toContain('const nextThreadId = await createThread(user.id, id)');
    expect(chatView).toContain('navigate(`/chat/${nextThreadId}`)');

    expect(kernel).toContain('.select("id, role, content, agent, created_at, kind, metadata, model, thinking_content, attachments, attachment_ids")');
    expect(kernel).toContain('normalizeThreadHistoryForAgent');
    expect(kernel).toContain('Context from another agent (${messageAgent}), not your own prior reply');
    expect(kernel).toContain('const messageAgent = msg.agent || "luca"');
  });

  it('keeps launch-sensitive database helpers and profile uploads hardened', () => {
    const source = readRepoFile('supabase/migrations/20260505235900_harden_launch_auth_and_profile_storage.sql');

    expect(source).toContain('REVOKE EXECUTE ON FUNCTION public.invoke_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;');
    expect(source).toContain('GRANT EXECUTE ON FUNCTION public.invoke_edge_function(text, jsonb) TO service_role;');
    expect(source).toContain('REVOKE EXECUTE ON FUNCTION public.get_app_config(text) FROM PUBLIC, anon, authenticated;');
    expect(source).toContain('GRANT EXECUTE ON FUNCTION public.get_app_config(text) TO service_role;');
    expect(source).toContain('DROP POLICY IF EXISTS "profile-uploads public read" ON storage.objects;');
    expect(source).toContain('CREATE POLICY "profile-uploads owner read"');
    expect(source).toContain('CREATE POLICY "profile-uploads published profile asset read"');
    expect(source).toContain("auth.uid()::text = (storage.foldername(name))[1]");
    expect(source).toContain("i.item_type = 'upload'");
    expect(source).not.toContain("USING (bucket_id = 'profile-uploads');");
  });
});
