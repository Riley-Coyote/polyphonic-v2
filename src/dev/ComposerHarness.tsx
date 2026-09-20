import { useRef, useState } from 'react';
import { Eye, Plus } from 'lucide-react';
import Composer, { ObserverWell } from '@/components/composer/Composer';
import EffortControl from '@/components/composer/EffortControl';
import type { ReasoningEffort } from '@/lib/chatRuntime';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * ComposerHarness — DEV ONLY, route `/__dev/composer`.
 *
 * The composer's states are all behind a signed-in session and a live model
 * key, which makes them impossible to look at honestly. This page mounts the
 * same <Composer> with local state and nothing else on the canvas, so each
 * state can be forced and photographed.
 *
 * It is registered in App.tsx inside `if (import.meta.env.DEV)` and is
 * therefore absent from a production build. Nothing here is app code: the
 * stand-in controls exist only so the toolbar has real buttons to style.
 */

type HarnessState =
  | 'empty'
  | 'armed'
  | 'streaming'
  | 'disabled'
  | 'multiline'
  | 'sending'
  | 'observer'
  | 'observer-thinking';

const STATES: HarnessState[] = [
  'empty',
  'armed',
  'streaming',
  'disabled',
  'multiline',
  'sending',
  'observer',
  'observer-thinking',
];

/* Harness-only sample turns. The app never renders invented Observer copy —
   these exist so the well has something to be a well around. */
const SAMPLE_TURNS: Array<{ role: 'observer' | 'user'; text: string }> = [
  { role: 'observer', text: 'observing your conversation. ask me anything about what you and Luca have been discussing.' },
  { role: 'user', text: 'what changed between the two audits?' },
  { role: 'observer', text: 'the second audit dropped the spinner and the SENDING label, and moved the clear-and-insert to the top of the send path. the first one still had both on a timer.' },
];

const EIGHT_LINES = [
  'The composer should be so well designed you forget it exists.',
  'Thin. Claude Code is the reference, not a tall pill.',
  'One box: the card. The toolbar is naked on the floor beneath it.',
  'Arming can be gentle; disarming has to be quick.',
  'Focus is the border brightening in place — never a second ring.',
  'Your own message appears before the round trip, not after it.',
  'A failed send keeps the row and marks it. It never erases itself.',
  'Hierarchy comes from size and opacity, never from weight.',
].join('\n');

export default function ComposerHarness() {
  const [state, setState] = useState<HarnessState>('empty');
  const [value, setValue] = useState('');
  const [effort, setEffort] = useState<ReasoningEffort>('medium');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror ChatView: effort and voice are desktop-only, and an unfocused
  // empty composer collapses its bar on mobile.
  const isMobile = useIsMobile();

  const apply = (next: HarnessState) => {
    setState(next);
    if (next === 'multiline') setValue(EIGHT_LINES);
    else if (next === 'armed' || next === 'streaming' || next === 'sending') {
      setValue('What happened between the two audits?');
    } else setValue('');
  };

  const streaming = state === 'streaming';
  const disabled = state === 'disabled';
  const sending = state === 'sending';
  const armed = !streaming && !disabled && value.trim().length > 0;
  // The well: `observer` shows three turns at rest, `observer-thinking` the
  // dots and the sweeping label. Closed, it must cost zero layout.
  const wellOpen = state === 'observer' || state === 'observer-thinking';
  const wellThinking = state === 'observer-thinking';

  return (
    <div
      data-dev-harness="composer"
      style={{
        minHeight: '100dvh',
        background: 'var(--canvas)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: '32px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        role="group"
        aria-label="Composer states"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}
      >
        {STATES.map((item) => (
          <button
            key={item}
            type="button"
            data-state-button={item}
            aria-pressed={state === item}
            onClick={() => apply(item)}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--cmp-hairline)',
              background: state === item ? 'var(--cmp-plate-active)' : 'transparent',
              color: state === item ? 'var(--cmp-ink)' : 'var(--cmp-ink-faint)',
              fontFamily: 'var(--font-sans)',
              fontSize: 11.5,
              letterSpacing: 'var(--track-ui)',
              cursor: 'pointer',
            }}
          >
            {item}
          </button>
        ))}
      </div>

      <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <Composer
          value={value}
          onChange={setValue}
          onSend={() => setValue('')}
          onStop={() => setState('empty')}
          streaming={streaming}
          sending={sending}
          armed={armed || sending}
          disabled={disabled}
          collapsed={isMobile && state === 'empty'}
          placeholder={wellOpen ? 'Ask the Observer...' : disabled ? 'Add a model key to start chatting…' : 'Message Luca...'}
          ariaLabel={wellOpen ? 'Ask Observer' : 'Message Luca'}
          sendLabel={streaming ? 'Stop response' : 'Send message'}
          textareaRef={textareaRef}
          wellOpen={wellOpen}
          well={
            <ObserverWell
              open={wellOpen}
              streaming={wellThinking}
              status={wellThinking ? 'thinking\u2026' : 'observing your conversation'}
              onClose={() => apply('empty')}
            >
              {SAMPLE_TURNS.map((turn, i) => (
                <div key={i} className={`cmp-well-msg ${turn.role}`}>{turn.text}</div>
              ))}
              {wellThinking && (
                <div className="cmp-well-msg observer cmp-well-dots">
                  {[0, 1, 2].map((i) => <span key={i} />)}
                </div>
              )}
            </ObserverWell>
          }
          leading={
            !wellOpen ? (
              <button type="button" className="attach-btn" aria-label="Add attachment">
                <Plus size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ) : null
          }
          barLeft={
            <div className="agent-pills">
              {/* Shaped like ObserverEyeChip so the active plate can be seen. */}
              <button
                type="button"
                className={`agent-pill${wellOpen ? ' targeted' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => apply(wellOpen ? 'empty' : 'observer')}
              >
                <Eye size={12} aria-hidden="true" />
                <span>observer</span>
              </button>
              {!wellOpen && <div className="pill-sep" />}
              {!wellOpen && <button type="button" className="cmp-ctl">Modes</button>}
            </div>
          }
          barRight={
            <div className="composer-actions">
              {!isMobile && (
                <EffortControl
                  value={effort}
                  options={['low', 'medium', 'high']}
                  onChange={setEffort}
                  disabled={disabled}
                  disabledTitle="This model currently requires Max reasoning"
                />
              )}
              <button type="button" className="cmp-ctl" aria-label="Dictate">Dictate</button>
              {!isMobile && <button type="button" className="cmp-ctl" aria-label="Voice mode">Voice</button>}
            </div>
          }
        />
      </div>
    </div>
  );
}
