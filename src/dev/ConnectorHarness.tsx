import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConsentView, type ConsentState } from '@/pages/OAuthConsentPage';
import { ConnectedAppsView, type ConnectedApp } from '@/pages/settings/ConnectedAppsSettings';

/**
 * ConnectorHarness — DEV ONLY, route `/__dev/connector`.
 *
 * The consent page only renders mid sign-in (it needs a live authorization
 * request from the OAuth server), and Connected apps needs a signed-in person
 * with real grants. This page feeds the same view components fixture props so
 * every state can be looked at and photographed.
 *
 * Registered in App.tsx inside `if (import.meta.env.DEV)`, so it is absent
 * from a production build. Every string below is fixture text.
 *
 *   ?view=consent&state=ask|loading|missing|expired|guest|returning
 *                 &companions=1..4&app=Claude&from=claude.ai|local|scheme
 *   ?view=apps&apps=0..3&error=1&confirm=1
 */

const FIXTURE_COMPANIONS = [
  { id: 'luca', name: 'Luca' },
  { id: 'ziggy', name: 'Ziggy' },
  { id: 'wren', name: 'Wren' },
  { id: 'the-archivist', name: 'The Archivist' },
];

const FIXTURE_APPS: ConnectedApp[] = [
  {
    clientId: 'fixture-claude',
    name: 'Claude',
    from: 'claude.ai',
    companions: ['Luca', 'Ziggy'],
    connectedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    lastUsed: new Date(Date.now() - 42 * 60_000).toISOString(),
  },
  {
    clientId: 'fixture-claude-code',
    name: 'Claude Code',
    from: 'this computer',
    companions: ['Luca'],
    connectedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    lastUsed: null,
  },
  {
    clientId: 'fixture-chatgpt',
    name: 'ChatGPT',
    from: 'chatgpt.com',
    companions: [],
    connectedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    lastUsed: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
];

function redirectFor(from: string | null) {
  if (from === 'local') return { host: 'this computer', label: 'an app on this computer' };
  if (from === 'scheme') return { host: 'cursor://', label: 'the cursor app on this device' };
  const host = from || 'claude.ai';
  return { host, label: host };
}

export default function ConnectorHarness() {
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'consent';

  if (view === 'apps') return <AppsFixture params={params} />;
  return <ConsentFixture params={params} />;
}

function ConsentFixture({ params }: { params: URLSearchParams }) {
  const kind = params.get('state') ?? 'ask';
  const count = Math.max(1, Math.min(4, Number(params.get('companions') ?? 2)));
  const app = params.get('app') ?? 'Claude';
  const companions = FIXTURE_COMPANIONS.slice(0, count);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(companions.map((c) => c.id)));
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  const state = useMemo<ConsentState>(() => {
    if (kind === 'loading') return { kind: 'loading' };
    if (kind === 'missing') return { kind: 'missing' };
    if (kind === 'expired') return { kind: 'expired' };
    if (kind === 'guest') return { kind: 'guest' };
    if (kind === 'returning') return { kind: 'returning', appName: app };
    return {
      kind: 'ask',
      details: {
        authorizationId: 'fixture',
        clientId: 'fixture',
        appName: app,
        redirect: redirectFor(params.get('from')),
        companions,
      },
    };
  }, [kind, app, params, companions]);

  return (
    <ConsentView
      state={state}
      selected={selected}
      busy={busy}
      error={params.get('error') === '1' ? 'The connection could not be approved. Go back to the app and try connecting again.' : ''}
      email="person@example.com"
      nextPath="/oauth/consent?authorization_id=fixture"
      onToggle={(id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onAllow={() => setBusy('allow')}
      onDeny={() => setBusy('deny')}
    />
  );
}

function AppsFixture({ params }: { params: URLSearchParams }) {
  const count = Math.max(0, Math.min(3, Number(params.get('apps') ?? 3)));
  const apps = FIXTURE_APPS.slice(0, count);
  const [confirming, setConfirming] = useState<ConnectedApp | null>(params.get('confirm') === '1' ? apps[0] ?? null : null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  return (
    <div style={{ height: '100vh', overflow: 'auto', background: 'var(--canvas)' }}>
      <ConnectedAppsView
        apps={params.get('loading') === '1' ? null : apps}
        loadError={params.get('error') === '1'}
        removingId={removingId}
        time="10:42"
        confirming={confirming}
        onAsk={setConfirming}
        onCancel={() => setConfirming(null)}
        onDisconnect={(app) => {
          setConfirming(null);
          setRemovingId(app.clientId);
        }}
      />
    </div>
  );
}
