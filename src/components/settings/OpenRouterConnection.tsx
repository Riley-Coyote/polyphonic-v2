import { useEffect, useId, useRef, useState } from 'react';
import type { OpenRouterSettingsClient, OpenRouterSnapshot } from '@/lib/openrouterSettings';
import { CHAT_MODEL_OPTIONS } from '@/lib/chatRuntime';
import './provider-connections.css';

// This panel accepts a client so the design lab never needs an account or real key.
type Props = { client: OpenRouterSettingsClient; onConversation: (id: string) => void; onModelSaved?: (model: string) => void };
const message = (e: unknown) => e instanceof Error ? e.message : 'Could not update OpenRouter. Please try again.';
export function OpenRouterConnection({ client, onConversation, onModelSaved }: Props) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<OpenRouterSnapshot>();
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [key, setKey] = useState('');
  const flow = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setSnapshot(undefined); setBusy('load'); setError(''); setNotice(''); setKey('');
    client.load().then(value => { if (current === generation.current) setSnapshot(value); })
      .catch(e => { if (current === generation.current) setError(message(e)); })
      .finally(() => { if (current === generation.current) setBusy(null); });
    return () => { generation.current = current + 1; flow.current?.abort(); flow.current = null; };
  }, [client]);
  async function run(name: string, action: (signal: AbortSignal) => Promise<string | void>) {
    if (busy) return;
    const controller = new AbortController(), current = generation.current;
    flow.current = controller;
    setBusy(name); setError(''); setNotice('');
    try {
      const text = await action(controller.signal);
      if (controller.signal.aborted || current !== generation.current) return;
      const value = await client.load();
      if (controller.signal.aborted || current !== generation.current) return;
      setSnapshot(value);
      if (text) setNotice(text);
    } catch (e) { if (!controller.signal.aborted && current === generation.current) setError(message(e)); }
    finally { if (current === generation.current && flow.current === controller) { setBusy(null); flow.current = null; } }
  }
  const connected = snapshot?.connected;
  const available = snapshot?.models;
  const modelOptions = available ? CHAT_MODEL_OPTIONS.filter(m => available.some(current => current.id === m.id)) : CHAT_MODEL_OPTIONS;
  const selectedAvailable = !available || available.some(m => m.id === snapshot?.model);
  const selectedModelName = available?.find(m => m.id === snapshot?.model)?.name ?? snapshot?.model;

  return <section className="provider-connections openrouter-connection" aria-labelledby={`${id}-heading`}>
    <div className="provider-heading"><div><h2 id={`${id}-heading`}>Cloud intelligence</h2><p>Chat in Polyphonic and Ghost, wherever you are.</p></div><button type="button" className="provider-button subtle" disabled={Boolean(busy)} onClick={() => void run('refresh', async () => {})}>Refresh</button></div>
    <div className="or-connection-body">
      <div className="provider-account-top"><div><h3>OpenRouter</h3><p>{connected ? <>Connected{snapshot.preview && <> <span aria-hidden="true">·</span> <span className="or-key-preview">{snapshot.preview}</span></>}</> : 'One connection for models from many providers.'}</p></div>
        {connected && <button className="provider-button subtle" type="button" disabled={Boolean(busy)} onClick={() => void run('disconnect', async () => { await client.disconnect(); return 'OpenRouter disconnected from Polyphonic. Your conversations are still saved.'; })}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>}
      </div>
      {!connected && snapshot && <><button type="button" className="provider-button or-primary" disabled={Boolean(busy)} onClick={() => void run('connect', async signal => { await client.connect(signal); return 'OpenRouter connected. Choose a model to start a chat.'; })}>{busy === 'connect' ? 'Finish sign-in in OpenRouter…' : 'Connect OpenRouter'}</button><p className="provider-note">Sign in or create an OpenRouter account. Model usage is billed to your OpenRouter credits.</p></>}
      {busy === 'connect' && <button type="button" className="provider-button subtle or-cancel" onClick={() => { flow.current?.abort(); flow.current = null; setBusy(null); setNotice('Connection cancelled.'); }}>Cancel sign-in</button>}
      {connected && <div className="or-cloud-model"><label htmlFor={`${id}-model`}>Default cloud model</label><select id={`${id}-model`} className="provider-input" disabled={Boolean(busy) || snapshot.catalogError} value={snapshot.model} onChange={event => { const model = event.target.value; void run('model', async signal => { await client.setModel(model); if (!signal.aborted) onModelSaved?.(model); return 'Default cloud model saved.'; }); }}>
        {!modelOptions.some(m => m.id === snapshot.model) && <option value={snapshot.model} disabled={!selectedAvailable}>{selectedModelName}{selectedAvailable ? '' : ' · unavailable'}</option>}
        {modelOptions.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>{snapshot.catalogError ? <p className="provider-note" role="status">OpenRouter’s model list could not be loaded. Refresh to try again. Your saved connection is still here.</p> : !selectedAvailable && <p className="provider-note" role="status">Your saved model is no longer listed by OpenRouter. Choose an available model to start a new chat.</p>}<p className="provider-note">Used for new OpenRouter chats and Ghost’s account default. Model usage is billed to your OpenRouter credits.</p>
        <div className="or-actions"><button type="button" className="provider-button or-primary" disabled={Boolean(busy) || !selectedAvailable || snapshot.catalogError} onClick={() => void run('chat', async signal => { const thread = await client.createThread(snapshot.model); if (!signal.aborted) onConversation(thread); })}>{busy === 'chat' ? 'Opening chat…' : 'Chat with Luca'}</button><a className="provider-button subtle" href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">Manage OpenRouter credits<span className="sr-only"> (opens a new tab)</span></a></div>
      </div>}
      {snapshot && <details className="or-manual"><summary>{connected ? 'Replace API key' : 'Use an API key instead'}</summary><form onSubmit={event => { event.preventDefault(); const secret = key.trim(); setKey(''); void run('key', async signal => { await client.saveKey(secret, signal); return 'OpenRouter API key saved.'; }); }}><label htmlFor={`${id}-key`}>OpenRouter API key</label><input id={`${id}-key`} className="provider-input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="sk-or-…" value={key} disabled={Boolean(busy)} onChange={event => setKey(event.target.value)} required /><button className="provider-button" type="submit" disabled={Boolean(busy) || !key.trim()}>{busy === 'key' ? 'Saving…' : 'Save API key'}</button><p className="provider-note">Encrypted in your Polyphonic account. Never saved in browser storage.</p></form></details>}
    </div>
    <div className="provider-feedback" aria-live="polite">{busy === 'load' && <p>Loading your connection…</p>}{busy === 'model' && <p>Saving cloud model…</p>}{notice && <p role="status">{notice}</p>}{error && <p className="provider-error" role="alert">{error}</p>}</div>
    <p className="provider-note provider-boundary">Your existing Polyphonic agents are available when you sign in with the same account. Mac apps and local tools require a reachable Mac.</p>
  </section>;
}
