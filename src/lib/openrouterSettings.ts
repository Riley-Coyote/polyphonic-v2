import { supabase } from '@/integrations/supabase/client';
import { connectOpenRouter, OpenRouterAuthError } from './openrouterAuth';
import { DEFAULT_CHAT_MODEL } from './chatRuntime';

export interface OpenRouterModel { id: string; name: string }
export interface OpenRouterSnapshot { connected: boolean; preview: string | null; model: string; models?: OpenRouterModel[]; catalogError?: boolean }
export interface OpenRouterSettingsClient {
  load(): Promise<OpenRouterSnapshot>;
  connect(signal: AbortSignal, onSaving?: () => void): Promise<void>;
  saveKey(key: string, signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  setModel(model: string): Promise<void>;
  createThread(model: string): Promise<string>;
}
export const openRouterError = (error: unknown) => error instanceof OpenRouterAuthError ? error.message : 'Could not update OpenRouter. Check your connection and try again.';
const failure = (code: string, message: string) => new OpenRouterAuthError(code, message);

// Availability is public and independent of the user's account or credits.
let catalogCache: { expires: number; models: OpenRouterModel[] } | undefined;
async function publicModels(): Promise<OpenRouterModel[] | null> {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.models;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) return null;
    const value = await response.json();
    if (!Array.isArray(value?.data)) return null;
    const models = value.data.filter((m: { id?: unknown; name?: unknown }) => typeof m?.id === 'string' && m.id.length <= 200 && typeof m.name === 'string' && m.name.length <= 200).map((m: OpenRouterModel) => ({ id: m.id, name: m.name }));
    if (!models.length) return null;
    catalogCache = { expires: Date.now() + 5 * 60 * 1000, models };
    return models;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

/** Each request captures this account's bearer token. A later account switch can
 * never save the first person's key into the second person's vault. */
export function openRouterSettingsClient(userId: string): OpenRouterSettingsClient {
  async function session() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== userId) throw failure('account_changed', 'Your Polyphonic account changed. Reopen these settings and try again.');
    return data.session;
  }
  async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const account = await session();
    if (signal?.aborted) throw failure('cancelled', 'Connection cancelled.');
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
        method, cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${account.access_token}`, Prefer: 'return=representation,resolution=merge-duplicates' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw failure(signal?.aborted ? 'cancelled' : 'network', signal?.aborted ? 'Connection cancelled.' : 'Could not reach Polyphonic. Check your connection and try again.'); }
    if (!response.ok) throw failure('save_failed', response.status === 401 ? 'Sign in to Polyphonic again to manage this connection.' : 'Polyphonic could not save this change. Please try again.');
    await session();
    if (signal?.aborted) throw failure('cancelled', 'Connection cancelled.');
    if (response.status === 204) return null;
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { throw failure('bad_response', 'Could not read the saved connection. Refresh to check its status.'); }
  }
  async function saveKey(key: string, signal?: AbortSignal) {
    if (!/^sk-or-[A-Za-z0-9_-]{16,500}$/.test(key.trim())) throw failure('invalid_key', 'Use your full OpenRouter API key, beginning sk-or-.');
    await request('rpc/save_user_api_key', 'POST', { p_key: key.trim() }, signal);
  }
  return {
    async load() {
      const owner = encodeURIComponent(userId);
      const [keys, settings, models] = await Promise.all([
        request(`user_api_keys?select=key_preview&user_id=eq.${owner}&limit=1`),
        request(`user_settings?select=default_model&user_id=eq.${owner}&limit=1`),
        publicModels(),
      ]);
      await session();
      if (!Array.isArray(keys) || !Array.isArray(settings)) throw failure('bad_response', 'Could not load your cloud connection. Please refresh.');
      return { connected: keys.length > 0, preview: typeof keys[0]?.key_preview === 'string' ? keys[0].key_preview : null,
        models: models ?? [], catalogError: models === null,
        model: typeof settings[0]?.default_model === 'string' ? settings[0].default_model : DEFAULT_CHAT_MODEL };
    },
    async connect(signal, onSaving) {
      const result = await connectOpenRouter({ signal, beforeAuthorize: async () => { await session(); } });
      await session();
      if (signal.aborted) throw failure('cancelled', 'Connection cancelled.');
      onSaving?.();
      await saveKey(result.key, signal);
    },
    saveKey,
    async disconnect() { await request('rpc/delete_user_api_key', 'POST', {}); },
    async setModel(model) {
      if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(model)) throw failure('invalid_model', 'Choose a cloud model.');
      await request('user_settings?on_conflict=user_id', 'POST', { user_id: userId, default_model: model });
    },
    async createThread(model) {
      const rows = await request('threads?select=id', 'POST', { user_id: userId, agent_id: 'luca', primary_agent_id: 'luca',
        participating_agent_ids: ['luca'], runtime_mode: 'classic', selected_model: model, memory_enabled: true });
      if (!Array.isArray(rows) || typeof rows[0]?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(rows[0].id)) throw failure('bad_response', 'Could not open the cloud conversation. Please try again.');
      return rows[0].id;
    },
  };
}
