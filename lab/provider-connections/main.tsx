import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { OpenRouterConnection } from '../../src/components/settings/OpenRouterConnection';
import type { OpenRouterSettingsClient, OpenRouterSnapshot } from '../../src/lib/openrouterSettings';
import { ProviderConnections } from '../../src/components/settings/ProviderConnections';
import type { ConnectionSnapshot, ProviderConnectionClient } from '../../src/lib/providerConnections';
import '../../src/index.css';
import './style.css';

const namespace = 'ui-design-lab.polyphonic.provider-connections.v1';
type Settings = { gap: number; radius: number; width: number };
type Saved = { id: string; name: string; createdAt: string; schema: 1; settings: Settings };
const presets: Record<string, Settings> = { 'Existing settings': { gap: 24, radius: 8, width: 820 }, 'Compact connections': { gap: 18, radius: 6, width: 720 }, 'Phone settings': { gap: 28, radius: 8, width: 390 } };
const normalize = (v: Partial<Settings> | null): Settings => ({ gap: Math.min(36, Math.max(18, Number(v?.gap) || 24)), radius: Math.min(12, Math.max(0, Number(v?.radius) || 0)), width: Math.min(1000, Math.max(360, Number(v?.width) || 820)) });
function readSaved(): { saved: Saved[]; settings: Settings; warning: string } {
  try { const value = JSON.parse(localStorage.getItem(namespace) || 'null'); return { saved: Array.isArray(value?.saved) ? value.saved.filter((s: Saved) => s.schema === 1 && typeof s.name === 'string').map((s: Saved) => ({ ...s, settings: normalize(s.settings) })) : [], settings: value ? normalize(value.settings) : presets['Existing settings'], warning: '' }; }
  catch { return { saved: [], settings: presets['Existing settings'], warning: 'Saved lab settings could not be read. You can still explore and export this study.' }; }
}
export function Specimen() {
  const [notice, setNotice] = useState('');
  const [scenario, setScenario] = useState('new');
  const openRouter = useMemo<OpenRouterSettingsClient>(() => {
    const state: OpenRouterSnapshot = { connected: scenario !== 'new', preview: scenario === 'new' ? null : 'sk-or-…test', model: 'moonshotai/kimi-k2.6' };
    return {
      async load() { return { ...state }; },
      async connect() { state.connected = true; state.preview = 'sk-or-…test'; },
      async saveKey(key) { if (key !== 'fixture-key') throw new Error('Simulation only: use fixture-key. No real credentials are used.'); state.connected = true; state.preview = 'sk-or-…test'; },
      async disconnect() { state.connected = false; state.preview = null; },
      async setModel(model) { state.model = model; },
      async createThread() { if (scenario === 'credits') throw new Error('Your OpenRouter account needs available credits. Add credits in OpenRouter, then send your message again.'); setNotice('Simulated Luca chat opened using your OpenRouter connection.'); return 'fixture-openrouter-thread'; },
    };
  }, [scenario]);
  const client = useMemo<ProviderConnectionClient>(() => {
    const snapshot: ConnectionSnapshot = { connections: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', provider: 'anthropic', label: 'Claude API', status: 'connected', expires_at: null, created_at: '2026-10-24T00:00:00Z' }], capabilities: { anthropic: { available: true }, chatgpt: { available: false, reason: 'approval_required' } } };
    return {
      async list() { return structuredClone(snapshot); },
      async models() { return [{ id: 'fixture-claude', name: 'Claude · simulated model' }]; },
      async saveAnthropic(id, key) { if (key !== 'fixture-key') throw new Error('Simulation only: use fixture-key. No real credentials or network requests are used.'); snapshot.connections.push({ id, provider: 'anthropic', label: 'Claude API · simulated', status: 'connected', expires_at: null, created_at: '2026-10-24T00:00:00Z' }); },
      async disconnect(id) { snapshot.connections = snapshot.connections.filter(c => c.id !== id); },
      async startChatGPT() { return '#simulated-signin'; }, async finishChatGPT() {},
      async createThread() { setNotice('Simulated chat opened. In the app this opens a new conversation using your chosen account and model.'); return 'fixture-thread'; },
    };
  }, []);
  return <main className="specimen"><p className="lab-simulation">Polyphonic · simulated model connections · no live services</p><label className="lab-scenario" htmlFor="scenario">Account state<select id="scenario" value={scenario} onChange={e => { setScenario(e.target.value); setNotice(''); }}><option value="new">New user</option><option value="connected">Existing OpenRouter connection</option><option value="credits">No OpenRouter credits</option></select></label><OpenRouterConnection key={scenario} client={openRouter} onConversation={() => {}} /><ProviderConnections title="Other AI connections" description="Connect a provider directly, or use an available subscription connection." client={client} onConversation={() => {}} onAuthorization={() => setNotice('Simulated sign-in only. No account is connected.')} />{notice && <p role="status">{notice}</p>}</main>;
}
export function Lab() {
  const [initial] = useState(readSaved);
  const [settings, setSettings] = useState(initial.settings);
  const [saved, setSaved] = useState(initial.saved);
  const [notice, setNotice] = useState(initial.warning);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState('My connection study');
  const frame = useRef<HTMLIFrameElement>(null);
  const currentPreset = Object.keys(presets).find(k => JSON.stringify(presets[k]) === JSON.stringify(settings)) || 'Custom';
  const brief = `Polyphonic cloud model connections. Direction: ${currentPreset}. Preserve the existing neutral settings typography and divided sections. Use ${settings.gap}px section spacing, ${settings.radius}px control corners, and an actual ${settings.width}px preview viewport. Keep 44px controls, a primary OpenRouter sign-in, a tucked-away manual API key form, an explicit default cloud model, clear approval and API-credit states, masked key entry, and no automatic paid fallback. This is an isolated interaction study; all accounts and actions are simulated.`;
  useEffect(() => { try { localStorage.setItem(namespace, JSON.stringify({ schema: 1, settings, saved })); } catch { setNotice('Local saving is unavailable. Keep a JSON export of this study.'); } }, [settings, saved]);
  const tune = () => { const root = frame.current?.contentDocument?.documentElement; root?.style.setProperty('--provider-lab-gap', `${settings.gap}px`); root?.style.setProperty('--provider-lab-radius', `${settings.radius}px`); };
  useEffect(tune, [settings]);
  return <main className="lab-shell"><header><div><p className="lab-eyebrow">Polyphonic / cloud runtime</p><h1>Model connections</h1><p>Connect your own intelligence, choose a model, and start chatting in the cloud.</p></div><button onClick={() => setHidden(x => !x)}>{hidden ? 'Show controls' : 'Hide controls'}</button></header>
    {!hidden && <aside className="lab-controls" aria-label="Design controls"><div><label htmlFor="preset">Direction · {currentPreset}</label><select id="preset" value={currentPreset === 'Custom' ? '' : currentPreset} onChange={e => setSettings(presets[e.target.value])}><option value="" disabled>Custom</option>{Object.keys(presets).map(p => <option key={p}>{p}</option>)}</select></div>
      {(['gap', 'radius', 'width'] as const).map(k => <div key={k}><label htmlFor={k}>{k === 'gap' ? 'Section spacing' : k === 'radius' ? 'Control corners' : 'Preview width'} · {settings[k]}px</label><input id={k} type="range" min={k === 'gap' ? 18 : k === 'radius' ? 0 : 360} max={k === 'gap' ? 36 : k === 'radius' ? 12 : 1000} step={k === 'width' ? 10 : 1} value={settings[k]} onChange={e => setSettings(s => normalize({ ...s, [k]: Number(e.target.value) }))} /></div>)}
      <div className="lab-save"><label htmlFor="variation">Saved variation</label><input id="variation" value={name} maxLength={80} onChange={e => setName(e.target.value)} /><button onClick={() => { if (name.trim()) { setSaved(s => [...s, { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), schema: 1, settings: { ...settings } }]); setNotice('Variation saved in this browser.'); } }}>Save variation</button></div>
      <div className="lab-saved">{saved.map(s => <div key={s.id}><button onClick={() => setSettings(normalize(s.settings))}>Restore {s.name}</button><button aria-label={`Remove ${s.name}`} onClick={() => setSaved(all => all.filter(v => v.id !== s.id))}>×</button></div>)}</div><button onClick={() => setSettings(presets['Existing settings'])}>Reset starting direction</button>
    </aside>}
    <section className="lab-preview" aria-label="Interactive preview"><iframe title="Simulated provider settings" ref={frame} src="?specimen=1" style={{ width: settings.width } as CSSProperties} onLoad={tune} /></section>
    {!hidden && <section className="lab-brief"><h2>Design brief</h2><textarea aria-label="Copyable design brief" readOnly value={brief} /><div><button onClick={async () => { try { await navigator.clipboard.writeText(brief); setNotice('Design brief copied.'); } catch { setNotice('Select the brief above and copy it manually.'); } }}>Copy brief</button><button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify({ project: 'Polyphonic', study: 'provider-connections', schema: 1, settings, brief }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'polyphonic-provider-connections.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export JSON</button></div><p>Variations are local to this browser and origin. JSON export is portable.</p></section>}
    <p role="status">{notice}</p></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('specimen') ? <Specimen /> : <Lab />);
