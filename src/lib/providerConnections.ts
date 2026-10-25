import { supabase } from '@/integrations/supabase/client';

export interface ModelConnection { id: string; provider: 'anthropic' | 'chatgpt'; label: string; status: 'connected' | 'identity_only' | 'needs_reconnect' | 'disabled'; expires_at: string | null; created_at: string }
export interface ConnectedModel { id: string; name: string }
export interface ConnectionSnapshot { connections: ModelConnection[]; capabilities: { anthropic: { available: boolean }; chatgpt: { available: boolean; reason: string | null } } }
export interface ProviderConnectionClient {
  list(): Promise<ConnectionSnapshot>;
  saveAnthropic(id: string, key: string, workspace: string): Promise<void>;
  models(id: string): Promise<ConnectedModel[]>;
  startChatGPT(id: string): Promise<string>;
  finishChatGPT(ticket: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  createThread(id: string, model: string, agent: string): Promise<string>;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const messages: Record<string, string> = {
  provider_auth_required: 'Sign in again or reconnect this provider account.',
  provider_access_pending: 'ChatGPT connection is awaiting OpenAI access approval for Polyphonic.',
  provider_configuration_required: 'This provider connection needs server configuration.',
  provider_api_key_invalid: 'Enter the full Anthropic Console secret key (sk-ant-api… or sk-ant-usr…), not its name or ID.',
  provider_workspace_invalid: 'Enter the workspace ID beginning wrkspc_, not another API key.',
  provider_workspace_required: 'This Claude key needs a workspace ID. Find it in Claude Console Settings → Workspaces.',
  provider_permission_required: 'This connection has not authorized the requested model usage.',
  provider_credits_required: 'This account needs available API credits.',
  provider_rate_limited: 'This provider’s usage limit has been reached.',
  provider_interrupted: 'The request was interrupted. Refresh history before sending again.',
};
export function providerSettingsError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load provider settings. Please try again.';
}
/** Provider credentials never enter browser storage; each operation captures a session for this account only. */
export function providerConnectionClient(user: string): ProviderConnectionClient {
  async function request(body: Record<string, unknown>) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== user) throw new Error(messages.provider_auth_required);
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-connections`, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body),
    });
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('Cloud provider connections are not available on this server yet.'); }
    if (!response.ok) {
      const code = object(value) && typeof value.code === 'string' ? value.code : null;
      // Older deployments used this code for both invalid input (400) and server setup (503).
      if (response.status === 400 && code === 'provider_configuration_required') {
        throw new Error('Check the Claude API key and workspace ID. Use the secret key value; if a workspace is required, enter its wrkspc_ ID.');
      }
      throw new Error(code && messages[code] || (response.status === 404
        ? 'Cloud provider connections are not available on this server yet.'
        : 'Could not update this provider connection. Please try again.'));
    }
    if (!object(value)) throw new Error('The server returned an unreadable provider response.');
    return value;
  }
  return {
    async list() {
      const value = await request({ action: 'list' });
      if (!Array.isArray(value.connections) || !object(value.capabilities) || !object(value.capabilities.chatgpt) || !object(value.capabilities.anthropic) ||
        value.connections.some(c => !object(c) || typeof c.id !== 'string' || !['anthropic', 'chatgpt'].includes(String(c.provider)) || typeof c.label !== 'string' || !['connected', 'identity_only', 'needs_reconnect', 'disabled'].includes(String(c.status)))) throw new Error('The server returned unreadable provider settings.');
      return value as unknown as ConnectionSnapshot;
    },
    async saveAnthropic(id, key, workspace) { await request({ action: 'save_anthropic', connection_id: id, api_key: key, workspace_id: workspace }); },
    async models(id) {
      const value = await request({ action: 'models', connection_id: id });
      if (!Array.isArray(value.models) || value.models.some(m => !object(m) || typeof m.id !== 'string' || typeof m.name !== 'string')) throw new Error('Could not read the available models.');
      return value.models as unknown as ConnectedModel[];
    },
    async startChatGPT(id) {
      const value = await request({ action: 'chatgpt_start', connection_id: id });
      if (typeof value.authorization_url !== 'string') throw new Error('Could not start ChatGPT sign-in.');
      const url = new URL(value.authorization_url), base = new URL(import.meta.env.VITE_SUPABASE_URL);
      if (url.origin !== base.origin || url.pathname !== '/functions/v1/provider-oauth/start') throw new Error('Could not verify the ChatGPT sign-in URL.');
      return url.href;
    },
    async finishChatGPT(ticket) { await request({ action: 'chatgpt_finish', ticket }); },
    async disconnect(id) { await request({ action: 'disconnect', connection_id: id }); },
    async createThread(id, model, agent) {
      const value = await request({ action: 'create_thread', connection_id: id, model, agent_id: agent });
      if (typeof value.thread_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.thread_id)) throw new Error('Could not create the conversation.');
      return value.thread_id;
    },
  };
}
