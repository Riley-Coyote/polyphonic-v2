import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('OpenRouter Agent SDK runtime gate', () => {
  it('keeps the SDK path Luca-only, feature-gated, and before the legacy tool planner', () => {
    const source = readRepoFile('supabase/functions/chat-multi/index.ts');

    const gateIndex = source.indexOf('if (agentRuntimeActive && !onboardingHandoff && !forceForgeRequest && !likelyGeneratedMediaRequest && agentIsSystemLuca && backend.allowTools && sdkRuntimeRequested && isOpenRouterAgentRuntimeEnabled(userId))');
    const legacyPlannerIndex = source.indexOf('const toolPlannerResult = shouldRunLegacyToolPlanner');

    expect(source).toContain('../_shared/agent-runtime/openrouter-agent.ts');
    expect(source).toContain('openRouterAgentSdkStream({');
    expect(source).toContain('idempotencyKey,');
    expect(source).toContain('agent_mode: agentMode');
    expect(source).toContain('const sdkRuntimeRequested');
    expect(source).toContain('const shouldRunLegacyToolPlanner');
    expect(source).toContain('const onboardingHandoff');
    expect(source).toContain('? await runToolPlanner(');
    expect(source).toContain('sourceMessageId');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(legacyPlannerIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(legacyPlannerIndex);

    // Existing chat remains the fallback whenever the flag is off or the agent is not Luca.
    expect(source).toContain('singleModelStream(');
    expect(source).toContain('const useEnsemble = agentRuntimeActive && backend.allowEnsemble && multiModelEnabled && agentIsSystemLuca;');
  });

  it('uses the SDK as a thin web-safe inner loop instead of a local-machine runtime', () => {
    const source = readRepoFile('supabase/functions/_shared/agent-runtime/openrouter-agent.ts');

    expect(source).toContain('npm:@openrouter/agent@0.5.0');
    expect(source).toContain('OPENROUTER_AGENT_SDK_ENABLED');
    expect(source).toContain('OPENROUTER_AGENT_SDK_USER_ALLOWLIST');
    expect(source).toContain('stepCountIs(');
    expect(source).toContain('maxCost(');

    expect(source).toContain('name: "memory_read"');
    expect(source).toContain('name: "web_search"');
    expect(source).toContain('name: "read_url"');
    expect(source).toContain('name: "browse"');
    expect(source).toContain('name: "forge_agent"');
    expect(source).toContain('callMcpTool(registration');
    expect(source).toContain('invokeEdgeJson(options, "anima-browser"');
    expect(source).toContain('Browserbase browser');

    expect(source).toContain('agent_tool_result');
    expect(source).toContain('thread_id: options.threadId');
    expect(source).toContain('queueContinuityTurnWrites');
    expect(source).toContain('recordIdempotentResponse');
    expect(source).toContain('options.idempotencyKey');
    expect(source).toContain('the current agent');
    expect(source).not.toContain("Read Luca's current Polyphonic continuity packet");

    expect(source).not.toContain('workspace_file');
    expect(source).not.toContain('local filesystem');
    expect(source).not.toContain('terminal');
  });

  it('tells the model that tools only run when it emits the function call', () => {
    const source = readRepoFile('supabase/functions/_shared/agent-runtime/openrouter-agent.ts');

    expect(source).toContain('a tool runs ONLY when you emit a function call for it');
    expect(source).toContain('Never report a dispatch, consultation, edit, search, or file change as done');
    expect(source).toContain('${baseInstructions}${toolHonestyNote}');
  });

  it('keeps Luca as one full agent runtime from the unified chat target picker', () => {
    const source = readRepoFile('src/pages/ChatView.tsx');
    const modesDropdown = readRepoFile('src/components/composer/ModesDropdown.tsx');
    const targetPicker = readRepoFile('src/components/composer/ChatTargetPicker.tsx');

    expect(source).toContain("pendingTargetKind === 'model' ? 'classic' : defaultRuntimeForAgent(activeAgentId)");
    expect(source).toContain("agent_mode: requestRuntimeMode === 'agent' ? 'agent' : 'chat'");
    expect(source).toContain('runtime_mode: requestRuntimeMode');
    expect(source).toContain('model: requestModel');
    expect(source).toContain("persistChatTarget({ kind: 'agent', id })");
    expect(source).toContain("persistChatTarget({ kind: 'model', id: modelId })");
    expect(source).toContain("persistChatTarget({ kind: 'agent', id: 'luca' })");
    expect(source).toContain('agentSettingsLoadedForUser');
    expect(source).toContain('<ChatTargetPicker');
    expect(targetPicker).toContain("sectionHeader('Agents')");
    expect(source).toContain('<ModesDropdown');
    expect(source).not.toContain('agentModeArmed');
    expect(source).not.toContain('setAgentModeArmed');
    expect(source).not.toContain('agentModeArmed={agentModeArmed}');
    expect(source).not.toContain('onToggleAgentMode={() => setAgentModeArmed');
    expect(modesDropdown).not.toContain('Agent runtime');
    expect(modesDropdown).toContain('Ensemble');
    expect(source).not.toContain('Message Luca (agent)');
  });

  it('surfaces agent runtime tool events and parses SSE blocks robustly', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    const runtime = readRepoFile('supabase/functions/_shared/agent-runtime/openrouter-agent.ts');

    expect(chatView).toContain("data.type === 'agent_runtime'");
    expect(chatView).toContain("data.type === 'tool_progress'");
    expect(chatView).toContain("data.type === 'tool_start'");
    expect(chatView).toContain("data.type === 'tool_result'");
    expect(chatView).toContain('agentTraceLine(data)');
    expect(chatView).toContain('let sseBuffer');
    expect(chatView).toContain('sseBuffer.split(/\\r?\\n\\r?\\n/)');

    expect(runtime).toContain('const agentTrace: string[] = []');
    expect(runtime).toContain('formatToolResultTrace');
    expect(runtime).toContain('thinking_content: persistedThinking');
  });

  it('guards assistant persistence against delayed duplicate replay', () => {
    const chatMulti = readRepoFile('supabase/functions/chat-multi/index.ts');
    const legacyChat = readRepoFile('supabase/functions/chat/index.ts');
    const runtime = readRepoFile('supabase/functions/_shared/agent-runtime/openrouter-agent.ts');

    for (const source of [chatMulti, legacyChat, runtime]) {
      expect(source).toContain('ASSISTANT_DUPLICATE_WINDOW_MS = 240_000');
      expect(source).toContain('findRecentDuplicateAssistantMessage');
      expect(source).toContain('skipped duplicate assistant insert');
    }

    expect(chatMulti).toContain('return { id: duplicateMessageId, duplicate: true }');
    expect(chatMulti).toContain('backend.allowMemoryWrites && !fallbackSavedMessage.duplicate');
    expect(chatMulti).toContain('backend.allowMemoryWrites && !synthesizedSavedMessage.duplicate');
    expect(chatMulti).toContain('options.enableContinuityWrites !== false && !assistantWasDuplicate');
    expect(legacyChat).toContain('backend.allowMemoryWrites && !assistantWasDuplicate');
    expect(runtime).toContain('if (!assistantWasDuplicate)');
  });
});
