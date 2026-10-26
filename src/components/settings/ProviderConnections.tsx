import { useEffect, useId, useState } from 'react';
import type { ConnectedModel, ConnectionSnapshot, ProviderConnectionClient } from '@/lib/providerConnections';
import './provider-connections.css';

type Props = { client: ProviderConnectionClient; onConversation: (id: string) => void; onAuthorization?: (url: string) => void; agentId?: string; title?: string; description?: string };
const statusLabels = { connected: 'Connected', identity_only: 'Signed in · chat permission needed', needs_reconnect: 'Reconnect to continue', disabled: 'Disconnected' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not update the connection. Please try again.';
export function ProviderConnections({ client, onConversation, onAuthorization = url => window.location.assign(url), agentId = 'luca', title = 'Your model accounts', description = 'Keep chatting in the cloud when your desktop is away.' }: Props) {
  const formId = useId();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>();
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [key, setKey] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, ConnectedModel[]>>({});
  const [selection, setSelection] = useState<Record<string, string>>({});
  async function refresh() { setSnapshot(await client.list()); }
  useEffect(() => {
    let mounted = true;
    client.list().then(value => { if (mounted) setSnapshot(value); }).catch(e => { if (mounted) setError(errorText(e)); }).finally(() => { if (mounted) setBusy(null); });
    return () => { mounted = false; };
  }, [client]);
  async function run(id: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(id); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }
  async function connectChatGPT(id: string = crypto.randomUUID()) {
    await run(id, async () => onAuthorization(await client.startChatGPT(id)));
  }
  return <div className="provider-connections">
    <div className="provider-heading"><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="provider-button subtle" disabled={Boolean(busy)} onClick={() => void run('refresh', refresh)}>Refresh</button></div>
    <div className="provider-feedback" aria-live="polite">{busy === 'load' && <p>Loading connections…</p>}{notice && <p role="status">{notice}</p>}{error && <p className="provider-error" role="alert">{error}</p>}</div>
    {snapshot?.connections.map(connection => <section className="provider-account" key={connection.id} aria-label={connection.label}>
      <div className="provider-account-top"><div><h3>{connection.label}</h3><p>{connection.provider === 'chatgpt' ? 'ChatGPT subscription' : 'Anthropic API credits'} <span aria-hidden="true">·</span> {statusLabels[connection.status]}</p></div>
        <button type="button" className="provider-button subtle" disabled={Boolean(busy)} onClick={() => void run(connection.id, async () => { await client.disconnect(connection.id); setCatalogs(c => { const next = { ...c }; delete next[connection.id]; return next; }); await refresh(); setNotice('Account disconnected. Existing conversation history is still available.'); })}>Disconnect<span className="sr-only"> {connection.label}</span></button></div>
      {connection.status === 'connected' ? <div className="provider-model-controls">
        {catalogs[connection.id] ? <><label className="provider-model-label" htmlFor={`${formId}-${connection.id}`}>Model</label><select id={`${formId}-${connection.id}`} className="provider-input" value={selection[connection.id] || ''} disabled={Boolean(busy)} onChange={event => setSelection(s => ({ ...s, [connection.id]: event.target.value }))}><option value="">Choose a model</option>{catalogs[connection.id].map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select><button type="button" className="provider-button" disabled={Boolean(busy) || !selection[connection.id]} onClick={() => void run(connection.id, async () => onConversation(await client.createThread(connection.id, selection[connection.id], agentId)))}>Start chat</button></> : <button type="button" className="provider-button" disabled={Boolean(busy)} onClick={() => void run(connection.id, async () => { const models = await client.models(connection.id); setCatalogs(c => ({ ...c, [connection.id]: models })); })}>Choose a model</button>}
      </div> : connection.provider === 'chatgpt' ? <button type="button" className="provider-button" disabled={Boolean(busy) || !snapshot.capabilities.chatgpt.available} onClick={() => void connectChatGPT(connection.id)}>Reconnect ChatGPT</button> : <button type="button" className="provider-button" disabled={Boolean(busy)} onClick={() => { setEditing(connection.id); document.getElementById(`${formId}-key`)?.focus(); }}>Update API key</button>}
    </section>)}
    <div className="provider-add">
      <section aria-labelledby={`${formId}-chatgpt`}><h3 id={`${formId}-chatgpt`}>ChatGPT</h3><p>Use your ChatGPT plan through an approved connection.</p><button type="button" className="provider-button" disabled={Boolean(busy) || !snapshot?.capabilities.chatgpt.available} onClick={() => void connectChatGPT()}>Connect ChatGPT</button>
        {!snapshot?.capabilities.chatgpt.available && snapshot && <p className="provider-note">{snapshot.capabilities.chatgpt.reason === 'approval_required' ? 'Awaiting OpenAI approval for hosted plan access.' : 'ChatGPT connection is being configured.'}</p>}</section>
      <form onSubmit={event => { event.preventDefault(); const secret = key; setKey(''); void run('anthropic', async () => { await client.saveAnthropic(editing ?? crypto.randomUUID(), secret.trim(), workspace.trim()); setEditing(null); setWorkspace(''); await refresh(); setNotice('Claude API connected. Choose a model to start a chat.'); }); }}>
        <h3>Claude API</h3><p>Connect an Anthropic Console key. Your API credits fund these chats.</p>
        <label htmlFor={`${formId}-key`}>Anthropic API key</label><input id={`${formId}-key`} className="provider-input" type="password" autoComplete="off" spellCheck={false} value={key} placeholder="Paste your Claude Console secret key" disabled={Boolean(busy)} onChange={event => setKey(event.target.value)} required />
        <label htmlFor={`${formId}-workspace`}>Workspace ID <span>(if your key requires it)</span></label><input id={`${formId}-workspace`} className="provider-input" value={workspace} placeholder="wrkspc_…" autoComplete="off" spellCheck={false} disabled={Boolean(busy)} onChange={event => setWorkspace(event.target.value)} />
        <button type="submit" className="provider-button" disabled={Boolean(busy) || !key.trim() || !snapshot}>{editing ? 'Update Claude key' : 'Connect Claude API'}</button>
        <p className="provider-note">Claude Pro and Max sign-in is separate from API billing.</p>
      </form>
    </div>
    <p className="provider-note provider-boundary">Choose an account and model for each new chat. Existing chats keep their connection. Usage limits never switch you to another paid provider.</p>
  </div>;
}
