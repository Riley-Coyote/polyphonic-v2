import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Composer from '@/components/composer/Composer';
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

type HarnessState = 'empty' | 'armed' | 'streaming' | 'disabled' | 'multiline' | 'sending';

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
        {(['empty', 'armed', 'streaming', 'disabled', 'multiline', 'sending'] as HarnessState[]).map((item) => (
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
          placeholder={disabled ? 'Add a model key to start chatting…' : 'Message Luca...'}
          ariaLabel="Message Luca"
          sendLabel={streaming ? 'Stop response' : 'Send message'}
          textareaRef={textareaRef}
          leading={
            <button type="button" className="attach-btn" aria-label="Add attachment">
              <Plus size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          }
          barLeft={
            <div className="agent-pills">
              <button type="button" className="cmp-ctl">observer</button>
              <div className="pill-sep" />
              <button type="button" className="cmp-ctl">Modes</button>
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
