import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { isAnonymousUser } from '@/lib/accessTier';
import LandingParticleField from '@/components/LandingParticleField';
import { AuthCard, AuthCardEyebrow, AuthCardSubtitle, AuthCardTitle } from '@/components/auth/AuthCard';
import {
  describeRedirect,
  isKnownApp,
  loadCompanions,
  namesList,
  saveGrant,
  type ConnectorCompanion,
} from '@/lib/connector';

/**
 * /oauth/consent — Supabase Auth's OAuth server sends people here when an app
 * (Claude, ChatGPT, Claude Code, Codex…) asks to connect to Polyphonic. The
 * person picks which companions the app may reach; that choice is stored in
 * connector_grants before the sign-in is approved, and the connector checks
 * every call against it.
 */

export interface ConsentAsk {
  authorizationId: string;
  clientId: string;
  appName: string;
  redirect: { host: string | null; label: string };
  companions: ConnectorCompanion[];
}

/** Names of the apps Polyphonic connects with; a request using one from elsewhere is told so plainly. */
const KNOWN_APP_NAME = /\b(claude|chatgpt|codex)\b/i;

/** An app Polyphonic doesn't connect with. authorizationId is set when the request can still be declined. */
export interface ConsentUnsupported {
  authorizationId: string | null;
  appName: string;
  redirect: { host: string | null; label: string };
}

export type ConsentState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'expired' }
  | { kind: 'guest' }
  | { kind: 'returning'; appName: string | null }
  | { kind: 'unsupported'; details: ConsentUnsupported }
  | { kind: 'ask'; details: ConsentAsk };

export default function OAuthConsentPage() {
  const user = useAuthStore((s) => s.user);
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const [state, setState] = useState<ConsentState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    if (!authorizationId) {
      setState({ kind: 'missing' });
      return;
    }
    if (isAnonymousUser(user)) {
      setState({ kind: 'guest' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const [detailsRes, companionsRes] = await Promise.allSettled([
        supabase.auth.oauth.getAuthorizationDetails(authorizationId),
        loadCompanions(user.id),
      ]);
      if (cancelled) return;
      if (detailsRes.status !== 'fulfilled' || detailsRes.value.error || !detailsRes.value.data) {
        setState({ kind: 'expired' });
        return;
      }
      const data = detailsRes.value.data;
      if (!('authorization_id' in data)) {
        // Already allowed earlier: the auth server sends the app straight back,
        // but only to an app Polyphonic connects with.
        if (!isKnownApp(data.redirect_url)) {
          setState({
            kind: 'unsupported',
            details: { authorizationId: null, appName: 'This app', redirect: describeRedirect(data.redirect_url) },
          });
          return;
        }
        setState({ kind: 'returning', appName: null });
        window.location.assign(data.redirect_url);
        return;
      }
      if (!isKnownApp(data.redirect_uri)) {
        setState({
          kind: 'unsupported',
          details: {
            authorizationId: data.authorization_id,
            appName: data.client.name?.trim() || 'This app',
            redirect: describeRedirect(data.redirect_uri),
          },
        });
        return;
      }
      if (companionsRes.status !== 'fulfilled') {
        setError('Your companions could not be loaded. Refresh to try again.');
        return;
      }
      const companions = companionsRes.value;
      setSelected(new Set(companions.map((c) => c.id)));
      setState({
        kind: 'ask',
        details: {
          authorizationId: data.authorization_id,
          clientId: data.client.id,
          appName: data.client.name?.trim() || 'An app',
          redirect: describeRedirect(data.redirect_uri),
          companions,
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authorizationId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allow = async () => {
    if (state.kind !== 'ask' || !user || busy) return;
    const { details } = state;
    const agentIds = details.companions.map((c) => c.id).filter((id) => selected.has(id));
    if (agentIds.length === 0) return;
    setBusy('allow');
    setError('');
    try {
      await saveGrant({
        userId: user.id,
        clientId: details.clientId,
        clientName: details.appName,
        redirectHost: details.redirect.host,
        agentIds,
      });
      const { data, error: approveError } = await supabase.auth.oauth.approveAuthorization(
        details.authorizationId,
        { skipBrowserRedirect: true },
      );
      if (approveError || !data?.redirect_url) throw new Error('approve');
      setState({ kind: 'returning', appName: details.appName });
      window.location.assign(data.redirect_url);
    } catch (e) {
      setBusy(null);
      setError(
        e instanceof Error && e.message !== 'approve'
          ? e.message
          : 'The connection could not be approved. Go back to the app and try connecting again.',
      );
    }
  };

  const deny = async () => {
    if ((state.kind !== 'ask' && state.kind !== 'unsupported') || busy) return;
    const { authorizationId } = state.details;
    if (!authorizationId) return;
    setBusy('deny');
    setError('');
    const { data, error: denyError } = await supabase.auth.oauth.denyAuthorization(
      authorizationId,
      { skipBrowserRedirect: true },
    );
    if (denyError || !data?.redirect_url) {
      setBusy(null);
      setError('The request could not be declined. You can close this page; nothing was connected.');
      return;
    }
    setState({ kind: 'returning', appName: state.details.appName });
    window.location.assign(data.redirect_url);
  };

  return (
    <ConsentView
      state={state}
      selected={selected}
      busy={busy}
      error={error}
      email={user?.email ?? null}
      nextPath={`/oauth/consent${authorizationId ? `?authorization_id=${encodeURIComponent(authorizationId)}` : ''}`}
      onToggle={toggle}
      onAllow={() => void allow()}
      onDeny={() => void deny()}
    />
  );
}

export function ConsentView({
  state,
  selected,
  busy,
  error,
  email,
  nextPath,
  onToggle,
  onAllow,
  onDeny,
}: {
  state: ConsentState;
  selected: Set<string>;
  busy: 'allow' | 'deny' | null;
  error: string;
  email: string | null;
  nextPath: string;
  onToggle: (id: string) => void;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const chosen =
    state.kind === 'ask'
      ? namesList(state.details.companions.filter((c) => selected.has(c.id)).map((c) => c.name))
      : '';

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden" style={{ background: 'var(--floor)' }}>
      <LandingParticleField state="auth" />

      <header className="absolute top-0 left-0 right-0 px-6 md:px-10 py-5" style={{ zIndex: 3 }}>
        <a href="/" aria-label="Polyphonic" className="consent-wordmark">
          POLYPHONIC
        </a>
      </header>

      <main
        className="relative min-h-screen w-full flex items-center justify-center px-4 sm:px-6 py-20"
        style={{ zIndex: 1 }}
      >
        <div className="relative w-full" style={{ maxWidth: 440 }}>
          <AuthCard>
            {state.kind === 'loading' &&
              (error ? (
                <p className="consent-error" role="alert">{error}</p>
              ) : (
                <p className="consent-quiet">Checking the request…</p>
              ))}

            {state.kind === 'missing' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                <AuthCardTitle>This link is missing its request.</AuthCardTitle>
                <AuthCardSubtitle>Go back to the app you were connecting and start again from there.</AuthCardSubtitle>
              </>
            )}

            {state.kind === 'expired' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                <AuthCardTitle>This request has expired.</AuthCardTitle>
                <AuthCardSubtitle>
                  It may have timed out or already been answered. Go back to the app and connect again.
                </AuthCardSubtitle>
              </>
            )}

            {state.kind === 'guest' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                <AuthCardTitle>Sign in to connect apps.</AuthCardTitle>
                <AuthCardSubtitle>
                  Your companions live with your account. Sign in or create one, and you'll come right back here.
                </AuthCardSubtitle>
                <div className="consent-actions">
                  <Link to={`/auth/login?next=${encodeURIComponent(nextPath)}`} className="consent-allow">
                    Sign in
                  </Link>
                </div>
              </>
            )}

            {state.kind === 'unsupported' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                {KNOWN_APP_NAME.test(state.details.appName) ? (
                  <>
                    <AuthCardTitle>{state.details.appName} can't connect from this address.</AuthCardTitle>
                    <AuthCardSubtitle>
                      This request says it's {state.details.appName}, but it came from {state.details.redirect.label},
                      not from {state.details.appName} itself. Nothing was shared.
                    </AuthCardSubtitle>
                  </>
                ) : (
                  <>
                    <AuthCardTitle>{state.details.appName} can't connect to Polyphonic yet.</AuthCardTitle>
                    <AuthCardSubtitle>
                      Polyphonic connects with Claude, ChatGPT, Claude Code and Codex. This request came from{' '}
                      {state.details.redirect.label}, so nothing was shared.
                    </AuthCardSubtitle>
                  </>
                )}

                {error && <p className="consent-error" role="alert">{error}</p>}

                <div className="consent-actions">
                  {state.details.authorizationId ? (
                    <button type="button" className="consent-deny" onClick={onDeny} disabled={busy !== null}>
                      {busy === 'deny' ? 'Declining…' : 'Decline'}
                    </button>
                  ) : (
                    <p className="consent-quiet">You can close this page.</p>
                  )}
                </div>

                <p className="consent-meta">Signed in as {email ?? 'you'}.</p>
              </>
            )}

            {state.kind === 'returning' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                <AuthCardTitle>Taking you back{state.appName ? ` to ${state.appName}` : ''}…</AuthCardTitle>
                <AuthCardSubtitle>If nothing happens, you can close this page and return to the app.</AuthCardSubtitle>
              </>
            )}

            {state.kind === 'ask' && (
              <>
                <AuthCardEyebrow>Connect an app</AuthCardEyebrow>
                <AuthCardTitle>{state.details.appName} wants to talk with your companions</AuthCardTitle>
                <AuthCardSubtitle>
                  The request came from {state.details.redirect.label}. Choose who {state.details.appName} may
                  reach.
                </AuthCardSubtitle>

                <div className="consent-companions" role="group" aria-label="Companions this app may reach">
                  {state.details.companions.map((companion) => {
                    const on = selected.has(companion.id);
                    return (
                      <button
                        key={companion.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        className="consent-companion"
                        onClick={() => onToggle(companion.id)}
                        disabled={busy !== null}
                      >
                        <span className="consent-check" aria-hidden="true">
                          {on && <Check size={11} strokeWidth={2.4} />}
                        </span>
                        <span className="consent-companion-name">{companion.name}</span>
                        {companion.id === 'luca' && <span className="consent-companion-note">your companion</span>}
                      </button>
                    );
                  })}
                </div>

                <p className="consent-can-lead">
                  {chosen ? `In ${state.details.appName}, ${chosen} will be able to:` : 'Choose at least one companion.'}
                </p>
                {chosen && (
                  <ul className="consent-can">
                    <li>speak as themselves, from their soul and what they remember about you</li>
                    <li>read their memory, their journal and your recent conversations</li>
                    <li>save what matters, and a note of each visit, labeled with where it came from</li>
                  </ul>
                )}
                {chosen && (
                  <p className="consent-can-lead consent-can-after">
                    Who they are only changes at home, by them.
                  </p>
                )}

                {error && <p className="consent-error" role="alert">{error}</p>}

                <div className="consent-actions">
                  <button
                    type="button"
                    className="consent-allow"
                    onClick={onAllow}
                    disabled={busy !== null || selected.size === 0}
                  >
                    {busy === 'allow' ? 'Connecting…' : 'Allow'}
                  </button>
                  <button type="button" className="consent-deny" onClick={onDeny} disabled={busy !== null}>
                    {busy === 'deny' ? 'Declining…' : 'Deny'}
                  </button>
                </div>

                <p className="consent-meta">
                  Signed in as {email ?? 'you'}. You can change this anytime in Settings, under Connected apps.
                </p>
              </>
            )}
          </AuthCard>
        </div>
      </main>
    </div>
  );
}
