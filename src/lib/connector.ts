import { supabase } from '@/integrations/supabase/client';

/**
 * The Polyphonic connector (supabase/functions/polyphonic-connect): one
 * address people add to Claude, ChatGPT, Claude Code or Codex to bring their
 * companions along. These helpers back /oauth/consent, Settings → Connected
 * apps and /connect.
 */

/**
 * The connector's permanent address. Apps save it when someone connects, so it
 * never changes: connect.polyphonic.chat forwards to the edge function wherever
 * it lives (polyphonic-app packages/connect-forwarder, on Deno Deploy).
 * VITE_CONNECTOR_URL overrides it for local testing.
 */
export const CONNECTOR_URL = (
  (import.meta.env.VITE_CONNECTOR_URL as string | undefined) || 'https://connect.polyphonic.chat'
).replace(/\/+$/, '');

export interface ConnectorCompanion {
  id: string;
  name: string;
}

export interface ConnectorGrant {
  clientId: string;
  clientName: string;
  redirectHost: string | null;
  agentIds: string[];
  updatedAt: string | null;
}

// connector_grants / connector_calls are newer than the generated types.
const db = supabase as unknown as { from: (table: string) => any };

const SIDECARS = new Set(['observer', 'guardian']);

/** Luca first, then the person's own agents: the same list the connector serves. */
export async function loadCompanions(userId: string): Promise<ConnectorCompanion[]> {
  const { data, error } = await supabase
    .from('agent_configs')
    .select('id, name')
    .eq('user_id', userId)
    .eq('pending', false);
  if (error) throw new Error('Your companions could not be loaded.');
  let luca: ConnectorCompanion = { id: 'luca', name: 'Luca' };
  const others: ConnectorCompanion[] = [];
  const seen = new Set(['luca']);
  for (const row of data ?? []) {
    const id = String(row.id ?? '').trim();
    const name = String(row.name ?? '').trim() || id;
    if (!id) continue;
    if (id === 'luca') {
      luca = { id, name: name || 'Luca' };
      continue;
    }
    if (seen.has(id) || SIDECARS.has(id.toLowerCase())) continue;
    seen.add(id);
    others.push({ id, name });
  }
  others.sort((a, b) => a.name.localeCompare(b.name));
  return [luca, ...others];
}

export async function loadGrants(): Promise<ConnectorGrant[]> {
  const { data, error } = await db
    .from('connector_grants')
    .select('client_id, client_name, redirect_host, agent_ids, updated_at');
  if (error) throw new Error('Connected apps could not be loaded.');
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    clientId: String(row.client_id),
    clientName: String(row.client_name || ''),
    redirectHost: typeof row.redirect_host === 'string' ? row.redirect_host : null,
    agentIds: Array.isArray(row.agent_ids) ? row.agent_ids.map(String) : [],
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }));
}

/** Written with the person's own session, right before the sign-in is approved. */
export async function saveGrant(input: {
  userId: string;
  clientId: string;
  clientName: string;
  redirectHost: string | null;
  agentIds: string[];
}): Promise<void> {
  const { error } = await db.from('connector_grants').upsert(
    {
      user_id: input.userId,
      client_id: input.clientId,
      client_name: input.clientName.slice(0, 200),
      redirect_host: input.redirectHost,
      agent_ids: input.agentIds,
    },
    { onConflict: 'user_id,client_id' },
  );
  if (error) throw new Error('Your choice could not be saved.');
}

export async function deleteGrant(userId: string, clientId: string): Promise<void> {
  const { error } = await db.from('connector_grants').delete().eq('user_id', userId).eq('client_id', clientId);
  if (error) throw new Error('The app could not be removed.');
}

/** When each app last reached a companion, from the connector's content-free log. */
export async function loadLastUsed(): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('connector_calls')
    .select('client_id, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  const last = new Map<string, string>();
  if (error) return last;
  for (const row of (data ?? []) as Array<{ client_id: string; created_at: string }>) {
    if (!last.has(row.client_id)) last.set(row.client_id, row.created_at);
  }
  return last;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The apps Polyphonic connects with, by where their sign-in returns: Claude and
 * ChatGPT return to their own sites, Claude Code and Codex to this computer.
 * /oauth/consent refuses every other return address, so no other app ever gets a
 * token. Keep in step with KNOWN_APP_HOSTS in
 * supabase/functions/_shared/connector/tools.ts, which re-checks every call.
 */
export const KNOWN_APP_SITES = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'] as const;

/** True when a sign-in would return to Claude, ChatGPT, or an app on this computer. */
export function isKnownApp(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const url = new URL(uri);
    if (LOOPBACK.has(url.hostname)) return url.protocol === 'http:' || url.protocol === 'https:';
    return url.protocol === 'https:' && (KNOWN_APP_SITES as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** Where a sign-in goes back to, in words a person can check. */
export function describeRedirect(uri: string | null | undefined): { host: string | null; label: string } {
  if (!uri) return { host: null, label: 'an unknown address' };
  try {
    const url = new URL(uri);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (LOOPBACK.has(url.hostname)) return { host: 'this computer', label: 'an app on this computer' };
      return { host: url.hostname, label: url.hostname };
    }
    const scheme = url.protocol.replace(/:$/, '');
    return { host: `${scheme}://`, label: `the ${scheme} app on this device` };
  } catch {
    return { host: null, label: 'an unknown address' };
  }
}

export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'never';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
