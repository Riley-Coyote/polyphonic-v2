/** OpenRouter PKCE. The verifier and returned key stay in memory until the key is vaulted. */
const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_TYPE = 'openrouter-auth-callback';
let pending = false;

export interface OpenRouterConnectResult { key: string; user_id?: string; label?: string }
export class OpenRouterAuthError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'OpenRouterAuthError'; }
}
interface ConnectOpts {
  callbackUrl?: string;
  onPopupOpen?: () => void;
  signal?: AbortSignal;
  /** Check the Polyphonic account before authorization and again before exchange. */
  beforeAuthorize?: () => Promise<void>;
}
function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return encode(bytes);
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function cancelled(): OpenRouterAuthError { return new OpenRouterAuthError('cancelled', 'Connection cancelled.'); }
function checkSignal(signal: AbortSignal) { if (signal.aborted) throw signal.reason instanceof OpenRouterAuthError ? signal.reason : cancelled(); }
function validKey(key: unknown): key is string {
  return typeof key === 'string' && /^sk-or-[A-Za-z0-9_-]{16,500}$/.test(key);
}
function channelName(state: string) { return `polyphonic.openrouter.${state}`; }

interface CallbackPayload { type: string; state: string; code?: string; error?: boolean }
function callbackCode(popup: Window, state: string, signal: AbortSignal, authorize: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: BroadcastChannel | undefined;
    let settled = false;
    const finish = (code?: string, error?: OpenRouterAuthError) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', onAbort);
      if (interval !== undefined) window.clearInterval(interval);
      channel?.close();
      if (error) reject(error); else resolve(code!);
    };
    const receive = (data: CallbackPayload | null) => {
      if (!data || data.type !== CALLBACK_TYPE || data.state !== state) return;
      if (data.error) finish(undefined, new OpenRouterAuthError('authorization_denied', 'OpenRouter was not connected. You can try again.'));
      else if (typeof data.code === 'string' && data.code.length > 0 && data.code.length <= 4096) finish(data.code);
      else finish(undefined, new OpenRouterAuthError('missing_code', 'Sign-in did not finish. Please try again.'));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === popup) receive(event.data);
    };
    const onAbort = () => finish(undefined, signal.reason instanceof OpenRouterAuthError ? signal.reason : cancelled());
    window.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort, { once: true });
    // Some identity providers sever window.opener using COOP. A per-flow same-origin
    // channel recovers that case without persisting the code or verifier in storage.
    try { channel = new BroadcastChannel(channelName(state)); channel.onmessage = event => receive(event.data); } catch { /* postMessage remains available */ }
    const interval = window.setInterval(() => {
      try {
        // COOP can report a still-open popup as closed. Keep the channel alive in
        // that case; the user can cancel explicitly or the bounded timeout ends it.
        if (!channel && popup.closed) finish(undefined, new OpenRouterAuthError('popup_closed', 'Sign-in window closed. Please try again.'));
      } catch { /* Cross-origin popup is expected during authorization. */ }
    }, 500);
    if (signal.aborted) onAbort();
    else { try { authorize(); } catch { finish(undefined, new OpenRouterAuthError('popup_blocked', 'Allow popups for Polyphonic, or use an API key instead.')); } }
  });
}

export async function connectOpenRouter(opts: ConnectOpts = {}): Promise<OpenRouterConnectResult> {
  if (typeof window === 'undefined') throw new OpenRouterAuthError('no_window', 'OpenRouter sign-in needs a browser.');
  if (pending) throw new OpenRouterAuthError('flow_pending', 'Finish or cancel the current OpenRouter connection first.');
  if (opts.signal?.aborted) throw cancelled();
  const callback = new URL(opts.callbackUrl || '/auth/openrouter/callback', window.location.origin);
  if (callback.origin !== window.location.origin) throw new OpenRouterAuthError('invalid_callback', 'Sign-in must return to Polyphonic.');
  const state = randomValue(), verifier = randomValue();
  callback.searchParams.set('state', state);
  // Open synchronously inside the click gesture, before hashing or checking auth.
  const popup = window.open('about:blank', `polyphonic-openrouter-${state}`, 'width=520,height=720,menubar=no,toolbar=no');
  if (!popup) throw new OpenRouterAuthError('popup_blocked', 'Allow popups for Polyphonic, or use an API key instead.');
  pending = true;
  const controller = new AbortController();
  const abort = () => controller.abort(cancelled());
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new OpenRouterAuthError('timeout', 'OpenRouter sign-in took too long. Please try again.')), TIMEOUT_MS);
  try {
    opts.onPopupOpen?.();
    await opts.beforeAuthorize?.();
    checkSignal(controller.signal);
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    checkSignal(controller.signal);
    const auth = new URL(AUTH_URL);
    auth.search = new URLSearchParams({ callback_url: callback.href, code_challenge: challenge, code_challenge_method: 'S256', state, key_label: 'Polyphonic' }).toString();
    const code = await callbackCode(popup, state, controller.signal, () => { popup.location.href = auth.href; });
    await opts.beforeAuthorize?.();
    checkSignal(controller.signal);
    let response: Response;
    try {
      response = await fetch(EXCHANGE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
    } catch { checkSignal(controller.signal); throw new OpenRouterAuthError('network', 'Could not reach OpenRouter. Check your connection and try again.'); }
    // Upstream bodies can contain codes or credentials. Never display or log them.
    if (!response.ok) throw new OpenRouterAuthError('exchange_failed', 'OpenRouter could not finish sign-in. Please try connecting again.');
    let payload: { key?: unknown; api_key?: unknown; user_id?: string; label?: string };
    try { payload = await response.json(); } catch { throw new OpenRouterAuthError('bad_response', 'OpenRouter returned an incomplete connection. Please try again.'); }
    checkSignal(controller.signal);
    const key = payload?.key ?? payload?.api_key;
    if (!validKey(key)) throw new OpenRouterAuthError('no_key', 'OpenRouter did not return a usable key. Please try again.');
    return { key, user_id: payload.user_id, label: payload.label };
  } finally {
    window.clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', abort);
    try { popup.close(); } catch { /* Browser may already have closed it. */ }
    pending = false;
  }
}
export function isOpenRouterFlowPending(): boolean { return pending; }

/** Callback carries a single-use code; scrub the URL before rendering anything. */
export function handleOpenRouterCallbackInPopup(): { ok: boolean; message: string } {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state'), code = params.get('code'), error = params.has('error');
  window.history.replaceState(window.history.state, '', window.location.pathname);
  if (!state || !/^[A-Za-z0-9_-]{64}$/.test(state)) return { ok: false, message: 'Return to Polyphonic and start the connection again.' };
  const payload: CallbackPayload = { type: CALLBACK_TYPE, state, ...(code && !error ? { code } : { error: true }) };
  let delivered = false;
  try { if (window.opener) { window.opener.postMessage(payload, window.location.origin); delivered = true; } } catch { /* Try the same-origin channel. */ }
  try {
    const channel = new BroadcastChannel(channelName(state));
    channel.postMessage(payload); delivered = true;
    window.setTimeout(() => channel.close(), 150);
  } catch { /* Browser may not support channels. */ }
  if (delivered) window.setTimeout(() => { try { window.close(); } catch { /* May be opened directly. */ } }, 200);
  if (!code || error) return { ok: false, message: 'OpenRouter was not connected. Return to Polyphonic to try again.' };
  return delivered ? { ok: true, message: 'Sign-in received. Polyphonic will finish saving your connection.' } : { ok: false, message: 'Return to Polyphonic and start the connection again.' };
}
