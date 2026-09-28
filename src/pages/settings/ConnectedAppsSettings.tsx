import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';
import { Section } from '@/components/settings/Section';
import { CodeBlock } from '@/components/settings/CodeBlock';
import { ConfirmDialog } from '@/components/settings/FormControls';
import { SettingsPage, AgentDot } from '@/components/settings/SettingsPage';
import { useClock } from '@/components/settings/useClock';
import {
  CONNECTOR_URL,
  deleteGrant,
  loadCompanions,
  loadGrants,
  loadLastUsed,
  namesList,
  relativeTime,
} from '@/lib/connector';

export interface ConnectedApp {
  clientId: string;
  name: string;
  from: string | null;
  companions: string[];
  connectedAt: string | null;
  lastUsed: string | null;
}

/**
 * Settings → Connected apps: the apps a person let reach their companions
 * through the Polyphonic connector, and the one address to add in new ones.
 * The auth server's grants are the source of truth for what's connected;
 * connector_grants adds which companions each app may reach.
 */
export default function ConnectedAppsSettings() {
  const user = useAuthStore((s) => s.user);
  const time = useClock();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState<ConnectedApp | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [authGrants, ours, lastUsed, companions] = await Promise.allSettled([
      supabase.auth.oauth.listGrants(),
      loadGrants(),
      loadLastUsed(),
      loadCompanions(user.id),
    ]);
    if (authGrants.status !== 'fulfilled' || authGrants.value.error) {
      setLoadError(true);
      setApps([]);
      return;
    }
    const grantRows = ours.status === 'fulfilled' ? ours.value : [];
    const used = lastUsed.status === 'fulfilled' ? lastUsed.value : new Map<string, string>();
    const names = new Map(
      (companions.status === 'fulfilled' ? companions.value : []).map((c) => [c.id, c.name]),
    );
    const rows = (authGrants.value.data ?? []).map((grant) => {
      const ourRow = grantRows.find((row) => row.clientId === grant.client.id);
      return {
        clientId: grant.client.id,
        name: grant.client.name?.trim() || ourRow?.clientName || 'An app',
        from: ourRow?.redirectHost ?? null,
        companions: (ourRow?.agentIds ?? []).map((id) => names.get(id) ?? id),
        connectedAt: grant.granted_at ?? null,
        lastUsed: used.get(grant.client.id) ?? null,
      };
    });
    rows.sort((a, b) => (b.lastUsed ?? b.connectedAt ?? '').localeCompare(a.lastUsed ?? a.connectedAt ?? ''));
    setLoadError(false);
    setApps(rows);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (app: ConnectedApp) => {
    if (!user) return;
    setConfirming(null);
    setRemovingId(app.clientId);
    // The auth grant goes first: once it's revoked the app's sign-in stops
    // working at once, whatever happens to the row below.
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: app.clientId });
    if (error) {
      setRemovingId(null);
      toast({ title: 'Could not disconnect', description: `${app.name} is still connected. Try again.`, variant: 'destructive' });
      return;
    }
    await deleteGrant(user.id, app.clientId).catch(() => undefined);
    setRemovingId(null);
    toast({ title: `${app.name} disconnected`, description: 'It can no longer reach your companions.' });
    void load();
  };

  return (
    <ConnectedAppsView
      apps={apps}
      loadError={loadError}
      removingId={removingId}
      time={time}
      confirming={confirming}
      onAsk={setConfirming}
      onCancel={() => setConfirming(null)}
      onDisconnect={(app) => void disconnect(app)}
    />
  );
}

export function ConnectedAppsView({
  apps,
  loadError,
  removingId,
  time,
  confirming,
  onAsk,
  onCancel,
  onDisconnect,
}: {
  apps: ConnectedApp[] | null;
  loadError: boolean;
  removingId: string | null;
  time: string;
  confirming: ConnectedApp | null;
  onAsk: (app: ConnectedApp) => void;
  onCancel: () => void;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  const count = apps?.length ?? 0;

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, onCancel]);

  return (
    <SettingsPage
      folio={{
        left: (
          <>
            <span>
              <AgentDot /> luca
            </span>
            <span>
              settings · <span className="v">connected apps</span>
            </span>
            <span>
              {count} app{count === 1 ? '' : 's'}
            </span>
          </>
        ),
        right: <span>{time}</span>,
      }}
    >
      <div className="set-head">
        <div className="set-head-eye">
          <span className="num">§ 09</span>
          <span>·</span>
          <span className="v">Connector</span>
        </div>
        <h1 className="set-head-title">Connected apps</h1>
        <p className="set-head-sub">
          Bring Luca and your other companions into Claude, ChatGPT, Claude Code and Codex. They arrive
          with their memory, and what matters comes home with them.
        </p>
      </div>

      <div className="set-body">
        <Section
          number="01"
          name="Address"
          title="Your companions, anywhere"
          desc={
            <>
              Add this address as a connector in the app you use. You'll sign in here and choose which
              companions it may reach.{' '}
              <Link to="/connect" className="connected-link">
                Steps for each app
              </Link>
            </>
          }
        >
          <CodeBlock code={CONNECTOR_URL} prompt="" />
        </Section>

        <Section
          number="02"
          name={`Apps · ${count} connected`}
          title="Apps that can reach your companions"
          desc="Disconnecting an app ends its sign-in right away. What your companions saved there stays in their memory."
        >
          {apps === null ? (
            <div className="connected-empty">Loading connected apps…</div>
          ) : loadError ? (
            <div className="connected-empty" role="alert">
              Connected apps couldn't be loaded. Refresh the page to try again.
            </div>
          ) : apps.length === 0 ? (
            <div className="connected-empty">
              No apps connected yet. Add the address above in Claude, ChatGPT, Claude Code or Codex.
            </div>
          ) : (
            <div>
              {apps.map((app) => (
                <div className="connected-app" key={app.clientId}>
                  <div style={{ minWidth: 0 }}>
                    <div className="connected-app-name">{app.name}</div>
                    <div className="connected-app-meta">
                      {app.companions.length > 0
                        ? `Can reach ${namesList(app.companions)}`
                        : 'No companions chosen: reconnect to choose'}
                      {app.from ? ` · from ${app.from}` : ''}
                    </div>
                    <div className="connected-app-meta">
                      Connected {relativeTime(app.connectedAt)} ·{' '}
                      {app.lastUsed ? `last used ${relativeTime(app.lastUsed)}` : 'not used yet'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="set-btn compact danger"
                    onClick={() => onAsk(app)}
                    disabled={removingId === app.clientId}
                  >
                    {removingId === app.clientId ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Disconnect ${confirming.name}?`}
          message={`${confirming.name} won't be able to reach your companions until you connect it again. Nothing they remember is deleted.`}
          confirmLabel="Disconnect"
          onConfirm={() => onDisconnect(confirming)}
          onCancel={onCancel}
        />
      )}
    </SettingsPage>
  );
}
