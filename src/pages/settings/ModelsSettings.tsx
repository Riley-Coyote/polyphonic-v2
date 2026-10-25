import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ProviderConnections } from '@/components/settings/ProviderConnections';
import { providerConnectionClient } from '@/lib/providerConnections';
import { supabase } from '@/integrations/supabase/client';
import { useSettingsStore } from '@/stores/settingsStore';
import { Toggle, SelectInput } from '@/components/settings/FormControls';
import { Section, InlinePill, Kbd } from '@/components/settings/Section';
import { MaskedInput, KeyStored } from '@/components/settings/MaskedInput';
import {
  ModelCard,
  ModelListControls,
} from '@/components/settings/ModelCard';
import {
  SettingsPage,
  AgentDot,
} from '@/components/settings/SettingsPage';
import { useClock } from '@/components/settings/useClock';
import ConnectOpenRouter from '@/components/ConnectOpenRouter';
import { CHAT_MODEL_OPTIONS } from '@/lib/chatRuntime';

const SYNTHESIS_MODEL_OPTIONS = Array.from(
  new Map(CHAT_MODEL_OPTIONS.map((model) => [model.id, { value: model.id, label: model.name }])).values(),
);

export default function ModelsSettings() {
  const user = useAuthStore(s => s.user);
  const userId = user?.id;
  const navigate = useNavigate();
  const connections = useMemo(() => userId ? providerConnectionClient(userId) : null, [userId]);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [connectionNotice, setConnectionNotice] = useState('');
  const finishing = useRef(false);
  useEffect(() => {
    if (!connections || finishing.current) return;
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const ticket = parameters.get('provider_complete'), failure = parameters.get('provider_error');
    if (!ticket && !failure) return;
    // Completion tickets never remain in browser history, referers, or persistent browser storage.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    if (failure || !ticket?.match(/^[A-Za-z0-9_-]{43}$/)) { setConnectionNotice('ChatGPT could not be connected. Please try sign-in again.'); return; }
    finishing.current = true;
    setConnectionNotice('Finishing ChatGPT connection…');
    connections.finishChatGPT(ticket).then(() => { setConnectionNotice('ChatGPT account connected. Choose an available model below.'); setConnectionRevision(x => x + 1); })
      .catch(error => setConnectionNotice(error instanceof Error ? error.message : 'Could not finish the ChatGPT connection.'))
      .finally(() => { finishing.current = false; });
  }, [connections]);
  const [apiKey, setApiKey] = useState('');
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [keyInfo, setKeyInfo] = useState('');

  const time = useClock();

  useEffect(() => {
    supabase
      .from('user_api_keys')
      .select('key_preview')
      .maybeSingle()
      .then(({ data }) => {
        if (data) setKeyPreview(data.key_preview);
      });
  }, []);

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setKeyError('');
    setKeyInfo('');
    const { error: saveError } = await supabase.rpc('save_user_api_key', {
      p_key: apiKey.trim(),
    });
    if (saveError) {
      setKeyError(saveError.message || 'Could not save API key.');
      setSaving(false);
      return;
    }
    const { data, error: previewError } = await supabase
      .from('user_api_keys')
      .select('key_preview')
      .maybeSingle();
    if (previewError) {
      setKeyError(
        previewError.message ||
          'API key saved, but preview could not be loaded.',
      );
    } else {
      setKeyPreview(data?.key_preview ?? null);
      setApiKey('');
      setKeyInfo('API key saved.');
    }
    setSaving(false);
  };

  const deleteKey = async () => {
    setRemoving(true);
    setKeyError('');
    setKeyInfo('');
    const { error } = await supabase.rpc('delete_user_api_key');
    if (error) {
      setKeyError(error.message || 'Could not remove API key.');
      setRemoving(false);
      return;
    }
    setKeyPreview(null);
    setApiKey('');
    setKeyInfo('API key removed.');
    setRemoving(false);
  };

  return (
    <SettingsPage
      folio={{
        left: (
          <>
            <span>
              <AgentDot /> luca
            </span>
            <span>
              settings · <span className="v">models</span>
            </span>
          </>
        ),
        right: (
          <>
            <span>opus 4.7</span>
            <span>{time}</span>
          </>
        ),
      }}
    >
      <div className="set-head">
        <div className="set-head-eye">
          <span className="num">§ 09 / 02</span>
          <span>·</span>
          <span className="v">Reasoning &amp; ensemble</span>
        </div>
        <h1 className="set-head-title">Models</h1>
        <p className="set-head-sub">
          Your connected model accounts, API keys, and reasoning models.
        </p>
      </div>

      <div className="set-body">
        {connections && <div className="set-section">
          {connectionNotice && <p role="status" style={{ marginBottom: 20, color: 'var(--text-secondary)' }}>{connectionNotice}</p>}
          <ProviderConnections key={`${user?.id}:${connectionRevision}`} client={connections} onConversation={id => navigate(`/chat/${id}`)} />
        </div>}
        <Section
          number="01"
          name="Authorization"
          title="API key"
          desc="Your OpenRouter API key. Encrypted and stored securely. Single key authorizes all reasoning models."
        >
          {keyPreview ? (
            <KeyStored
              preview={keyPreview}
              status="connected"
              onRemove={deleteKey}
              removing={removing}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <ConnectOpenRouter
                variant="primary"
                label="Connect with OpenRouter"
                onConnected={(preview) => {
                  if (preview) {
                    setKeyPreview(preview);
                    setKeyInfo('Connected to OpenRouter.');
                  }
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 'var(--settings-mono-size)',
                  fontWeight: 'var(--weight-medium)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: 'var(--track-folio)',
                  textTransform: 'uppercase',
                  color: 'var(--text-whisper)',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background:
                      'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 100%)',
                  }}
                />
                <span>or paste a key</span>
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background:
                      'linear-gradient(90deg, rgba(255,255,255,0.07) 0%, transparent 100%)',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <div style={{ flex: 1 }}>
                  <MaskedInput
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder="sk-or-v1-…"
                  />
                </div>
                <button
                  type="button"
                  className="set-btn primary"
                  onClick={saveKey}
                  disabled={!apiKey || saving}
                  style={{ height: 40 }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {keyError && (
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--settings-caption-size)',
                fontWeight: 'var(--weight-book)',
                color: 'var(--red-accent)',
                fontFamily: 'var(--font-sans)',
                letterSpacing: 'var(--track-body-tight)',
              }}
            >
              {keyError}
            </div>
          )}
          {keyInfo && (
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--settings-caption-size)',
                fontWeight: 'var(--weight-book)',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-sans)',
                letterSpacing: 'var(--track-body-tight)',
              }}
            >
              {keyInfo}
            </div>
          )}
        </Section>

        <ImageModelSection />
        <EnsembleSection />
      </div>
    </SettingsPage>
  );
}

const OPENROUTER_IMAGE_MODELS = [
  { value: 'google/gemini-2.5-flash-image', label: 'Nano Banana (Gemini 2.5 Flash Image) · Fast, high quality' },
  { value: 'google/gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image (Preview)' },
  { value: 'google/gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (Preview) · Highest quality' },
];

const OPENAI_IMAGE_MODELS = [
  { value: 'gpt-image-1', label: 'OpenAI gpt-image-1 · Medium quality' },
  { value: 'gpt-image-2', label: 'OpenAI gpt-image-2 · High quality (slow, expensive)' },
];

function ImageModelSection() {
  const { image_provider, image_model, updateSetting } = useSettingsStore();
  const options = image_provider === 'openai' ? OPENAI_IMAGE_MODELS : OPENROUTER_IMAGE_MODELS;
  const setProvider = (next: 'openrouter' | 'openai') => {
    if (next === image_provider) return;
    updateSetting('image_provider', next);
    const defaultModel = next === 'openai' ? 'gpt-image-1' : 'google/gemini-2.5-flash-image';
    updateSetting('image_model', defaultModel);
  };

  return (
    <Section
      number="02"
      name="Image generation"
      title="Image model"
      desc="Default routes through OpenRouter (uses your OpenRouter key when set, otherwise the platform key). Switch to OpenAI to use your personal OpenAI key — requires OPENAI_API_KEY on the server."
    >
      <div className="set-row">
        <div className="set-row-copy">
          <div className="set-row-label">Provider</div>
          <div className="set-row-desc">
            OpenRouter is the default. OpenAI is an opt-in path for your personal key.
          </div>
        </div>
        <div className="set-row-control" style={{ display: 'flex', gap: 6 }}>
          {(['openrouter', 'openai'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`set-btn compact${image_provider === p ? ' primary' : ''}`}
            >
              {p === 'openrouter' ? 'OpenRouter' : 'OpenAI'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 'var(--settings-mono-size)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-soft)',
            letterSpacing: 'var(--track-folio)',
            textTransform: 'uppercase',
            marginBottom: 10,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Model
        </div>
        <SelectInput
          value={image_model}
          onChange={(v) => updateSetting('image_model', v)}
          options={options}
          width="100%"
        />
        <div
          style={{
            fontSize: 'var(--settings-caption-size)',
            fontWeight: 'var(--weight-book)',
            color: 'var(--text-tertiary)',
            marginTop: 8,
            lineHeight: 1.55,
            letterSpacing: 'var(--track-body-tight)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Used whenever the assistant calls the generate_image or edit_image tool.
        </div>
      </div>
    </Section>
  );
}

function EnsembleSection() {
  const {
    multi_model_enabled,
    ensemble_models,
    synthesis_model,
    reasoning_effort,
    updateSetting,
  } = useSettingsStore();

  const [query, setQuery] = useState('');

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CHAT_MODEL_OPTIONS;
    return CHAT_MODEL_OPTIONS.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [query]);

  const selectedSet = useMemo(
    () => new Set(ensemble_models),
    [ensemble_models],
  );

  // Selection is currently frozen — the codebase uses `ensemble_models` as a
  // fixed list of 3 slots. Until the new rotation system ships, we render
  // selection as read-only (clicking does not mutate state).
  const isSelected = (id: string) => selectedSet.has(id);
  const toggleSelected = (_id: string) => {
    // No-op until rotation system ships.
  };

  return (
    <>
      <Section
        number="03"
        name="Default behavior"
        title="When ensemble is armed"
        desc={
          <>
            The ensemble pill on the composer can be pre-armed by default or
            left for you to toggle per-message.
          </>
        }
      >
        <div className="set-row">
          <div className="set-row-copy">
            <div className="set-row-label">Default ensemble to on</div>
            <div className="set-row-desc">
              When on, every new message runs through the ensemble. Override
              per-message with <Kbd>⌘E</Kbd>.
            </div>
          </div>
          <div className="set-row-control">
            <Toggle
              on={multi_model_enabled}
              onChange={() =>
                updateSetting('multi_model_enabled', !multi_model_enabled)
              }
            />
          </div>
        </div>
      </Section>

      <Section
        number="04"
        name="Ensemble"
        title="Models in rotation"
        desc="The signature ensemble (Luca · Anima · Vektor) runs in the meantime. A richer model-rotation system with custom slots and persona presets is on the way."
        pill={<InlinePill variant="amber">Under construction</InlinePill>}
      >
        <ModelListControls
          query={query}
          onQueryChange={setQuery}
          selectedCount={selectedSet.size}
          totalCount={CHAT_MODEL_OPTIONS.length}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        >
          {filteredModels.map((m) => (
            <ModelCard
              key={m.id}
              name={m.name}
              id={m.id}
              flags={m.flags}
              active={isSelected(m.id)}
              onToggle={() => toggleSelected(m.id)}
            />
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 'var(--settings-mono-size)',
              fontWeight: 'var(--weight-medium)',
              color: 'var(--text-soft)',
              letterSpacing: 'var(--track-folio)',
              textTransform: 'uppercase',
              marginBottom: 10,
              fontFamily: 'var(--font-mono)',
            }}
          >
            Synthesis model
          </div>
          <SelectInput
            value={synthesis_model}
            onChange={(v) => updateSetting('synthesis_model', v)}
            options={SYNTHESIS_MODEL_OPTIONS}
            width="100%"
          />
          <div
            style={{
              fontSize: 'var(--settings-caption-size)',
              fontWeight: 'var(--weight-book)',
              color: 'var(--text-tertiary)',
              marginTop: 8,
              lineHeight: 1.55,
              letterSpacing: 'var(--track-body-tight)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            The model that synthesizes the final response from all ensemble
            outputs.
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 'var(--settings-mono-size)',
              fontWeight: 'var(--weight-medium)',
              color: 'var(--text-soft)',
              letterSpacing: 'var(--track-folio)',
              textTransform: 'uppercase',
              marginBottom: 10,
              fontFamily: 'var(--font-mono)',
            }}
          >
            Default thinking effort
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['low', 'medium', 'high'] as const).map((level) => (
              <button
                type="button"
                key={level}
                onClick={() => updateSetting('reasoning_effort', level)}
                className={`set-btn compact${
                  reasoning_effort === level ? ' primary' : ''
                }`}
              >
                {level === 'low' ? 'Light' : level === 'medium' ? 'Medium' : 'Deep'}
              </button>
            ))}
          </div>
          <div
            style={{
              fontSize: 'var(--settings-caption-size)',
              fontWeight: 'var(--weight-book)',
              color: 'var(--text-tertiary)',
              marginTop: 8,
              lineHeight: 1.55,
              letterSpacing: 'var(--track-body-tight)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Controls how deeply reasoning models think before responding. Can
            be overridden per-message in the chat input.
          </div>
        </div>
      </Section>
    </>
  );
}
