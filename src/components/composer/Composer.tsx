import { forwardRef, type ReactNode, type RefObject } from 'react';
import { ArrowUp, ChevronDown, Square } from 'lucide-react';

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
  /** Key notice / pending attachments — stacked above the pill. */
  above?: ReactNode;
  /**
   * The Observer well. Rendered between `above` and the pill, so its tucked
   * bottom edge runs under the pill and the pill reads as sitting in its
   * mouth. The owner renders the whole well; this only places it and tells
   * the pill that a well is open.
   */
  well?: ReactNode;
  /** A well is open: the pill's hairline holds the focus value even unfocused. */
  wellOpen?: boolean;
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
 *     [above]                 notices / attachment chips
 *     [well]                  the Observer well — a cut in the floor the pill sits in
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
    well,
    wellOpen = false,
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
      {well}
      <div
        className="cmp-pill"
        data-well-open={wellOpen ? 'true' : undefined}
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

export interface ObserverWellProps {
  open: boolean;
  /** The Observer is generating: the label sweeps, and only then. */
  streaming?: boolean;
  /** One line of report — `observing your conversation` / `thinking…` / `replying…`. */
  status: string;
  onClose: () => void;
  scrollRef?: RefObject<HTMLDivElement>;
  /** The turns: `.cmp-well-msg.observer` / `.cmp-well-msg.user` elements. */
  children?: ReactNode;
}

/**
 * ObserverWell — a cut in the floor beneath the composer.
 *
 * Before the thin pill this was an "alcove": the same box as the input shell,
 * unfolding inside it. With the shell gone there is no inside to unfold into,
 * and a bare panel floating above a thin pill has nothing holding it. So the
 * Observer stops being a panel and becomes a WELL — the desktop app's
 * settled answer (design-lab/composer-notes.md, 2026-08-24, "the reply
 * context is the RECESS"): the ground recesses, the conversation lives down
 * in the cut, and the pill sits in the mouth. The pill never changes shape.
 *
 * It stays mounted in both states so opening and closing are both
 * transitions; closed it is a `grid-template-rows: 0fr` collapse carrying no
 * overlap margin, which costs exactly zero layout.
 *
 * Chrome only — the turns come from the owner, so ChatView and the DEV
 * harness photograph the same markup.
 */
export function ObserverWell({
  open,
  streaming = false,
  status,
  onClose,
  scrollRef,
  children,
}: ObserverWellProps) {
  return (
    <div
      className="cmp-well"
      data-open={open ? 'true' : undefined}
      data-streaming={streaming ? 'true' : undefined}
      aria-hidden={open ? undefined : true}
    >
      <div className="cmp-well-inner">
        <div className="cmp-well-surface">
          <div className="cmp-well-head">
            <div className="guardian-dot" />
            <div className="cmp-well-label">observer</div>
            <div className="cmp-well-sep" />
            <div className="cmp-well-status">{status}</div>
            <div className="cmp-well-spacer" />
            <button
              type="button"
              className="cmp-ctl cmp-well-close"
              onClick={onClose}
              aria-label="Close observer"
              tabIndex={open ? undefined : -1}
            >
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="cmp-well-msgs" ref={scrollRef}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Composer;
