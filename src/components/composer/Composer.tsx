import { forwardRef, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Square } from 'lucide-react';

export interface ComposerProps {
  /** Draft text. The owner keeps the state; this component only renders it. */
  value: string;
  onChange: (next: string) => void;
  /** Fired by the send circle when it is armed. Enter is the owner's job (onKeyDown). */
  onSend: () => void;
  /** Fired by the send circle while a response is streaming. */
  onStop?: () => void;
  streaming?: boolean;
  /**
   * True while the send is in flight (optimistic row already on screen, insert
   * not yet acknowledged). The only visible effect is the send slot holding the
   * armed fill with a dimmed glyph — no animation, no timer.
   */
  sending?: boolean;
  /** The send affordance is live: there is content and nothing blocks it. */
  armed?: boolean;
  /** Composing is blocked entirely (no model key). Ink drops to ghost. */
  disabled?: boolean;
  /** Tooltip explaining `disabled` / a blocked send. */
  disabledReason?: string;
  placeholder?: string;
  ariaLabel: string;
  /** aria-label for the send circle in its current state. */
  sendLabel: string;
  textareaRef?: RefObject<HTMLTextAreaElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Mobile rest state: unfocused + empty collapses the bar away. */
  collapsed?: boolean;
  /** Suppress pointer-down default on the bar (mobile keyboard retention). */
  onBarMouseDown?: (e: React.MouseEvent) => void;
  /** The `+` add control — lives inside the pill, left of the text. */
  leading?: ReactNode;
  /** Left group of the naked toolbar beneath the pill. */
  barLeft?: ReactNode;
  /** Right group of the naked toolbar beneath the pill. */
  barRight?: ReactNode;
  /** Alcove / key notice / pending attachments — stacked above the pill. */
  above?: ReactNode;
  /** Hidden file inputs and other non-chrome children. */
  children?: ReactNode;
  className?: string;
}

/**
 * Composer — the thin pill and the send moment.
 *
 * Anatomy (Claude Code's input, not ChatGPT's tall pill):
 *
 *   .cmp                      measure-bounded wrapper
 *     [above]                 alcove / notices / attachment chips
 *     .cmp-pill               ONE box: [leading] [textarea] [send]
 *     .cmp-bar                naked toolbar on the ground — no surface, no border
 *
 * The pill is the only object with weight, and inside it only the send circle
 * carries fill. The bar beneath reads as chrome because nothing sits behind it.
 *
 * Presentational by contract: every piece of state and every handler belongs to
 * the owner (ChatView). This renders two places in ChatView — the empty welcome
 * state and the thread state — from one source.
 */
export const Composer = forwardRef<HTMLDivElement, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    onStop,
    streaming = false,
    sending = false,
    armed = false,
    disabled = false,
    disabledReason,
    placeholder,
    ariaLabel,
    sendLabel,
    textareaRef,
    onKeyDown,
    onPaste,
    onFocusChange,
    collapsed = false,
    onBarMouseDown,
    leading,
    barLeft,
    barRight,
    above,
    children,
    className,
  },
  ref,
) {
  // One slot, two glyphs: the stop square replaces the arrow in place rather
  // than appearing beside it, so the hand aims at the same point either way.
  const showStop = streaming && !!onStop;

  return (
    <div className={`cmp${className ? ` ${className}` : ''}`} ref={ref}>
      {children}
      {above}
      <div
        className="cmp-pill"
        data-sending={sending ? 'true' : undefined}
        data-disabled={disabled ? 'true' : undefined}
        data-collapsed={collapsed ? 'true' : undefined}
      >
        {leading && <div className="cmp-lead">{leading}</div>}
        <textarea
          ref={textareaRef}
          className="cmp-input"
          rows={1}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck={true}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
        />
        <button
          type="button"
          className="cmp-send"
          data-armed={armed && !showStop ? 'true' : undefined}
          data-streaming={showStop ? 'true' : undefined}
          aria-label={sendLabel}
          title={disabledReason}
          disabled={!showStop && !armed}
          onClick={() => {
            if (showStop) {
              onStop?.();
              return;
            }
            onSend();
          }}
        >
          {showStop ? (
            <Square size={12} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
          ) : (
            <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="cmp-bar" onMouseDown={onBarMouseDown}>
        {barLeft}
        {barRight}
      </div>
    </div>
  );
});

export default Composer;
