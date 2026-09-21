import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { getReasoningEffortLabel, type ReasoningEffort } from '@/lib/chatRuntime';

interface EffortControlProps {
  value: ReasoningEffort;
  options: ReasoningEffort[];
  onChange: (next: ReasoningEffort) => void;
  /** The model pins the effort — the trigger reads but cannot be opened. */
  disabled?: boolean;
  /** Same explanation the old <select> carried in its title attribute. */
  disabledTitle?: string;
}

/**
 * EffortControl — the thinking-effort chip on the naked toolbar.
 *
 * Replaces a raw `<select>`, whose native popup is the one piece of OS chrome
 * the composer could not style and the one control that broke the row's quiet.
 * A `.cmp-ctl` trigger opens a small listbox that follows the same portal /
 * trigger-rect / outside-click idiom as ModesDropdown (there is no shared
 * helper to reuse — the positioning is inlined the same way there).
 *
 * `max` is never offered as a choice: it only ever appears as a model's FIXED
 * value, in which case the control is disabled and reads that label.
 */
export default function EffortControl({
  value,
  options,
  onChange,
  disabled = false,
  disabledTitle,
}: EffortControlProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  const choices = options.filter((effort) => effort !== 'max');

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popRef.current) return;
    const place = () => {
      if (!triggerRef.current || !popRef.current) return;
      const tRect = triggerRef.current.getBoundingClientRect();
      const pRect = popRef.current.getBoundingClientRect();
      const top = tRect.top - pRect.height - 8;
      const rawLeft = tRect.left + tRect.width / 2 - pRect.width / 2;
      const clampedLeft = Math.max(
        8,
        Math.min(window.innerWidth - pRect.width - 8, rawLeft),
      );
      setPopPos({ top, left: clampedLeft });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // The list takes focus on open so arrow keys land on it without a Tab.
  useEffect(() => {
    if (open) popRef.current?.focus();
  }, [open]);

  // Outside click close, matching ModesDropdown. Escape is handled on the list.
  useEffect(() => {
    if (!open) return;
    const onDocMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouse);
    return () => document.removeEventListener('mousedown', onDocMouse);
  }, [open]);

  const commit = (next: ReasoningEffort) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(choices.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const next = choices[active];
      if (next) commit(next);
    }
  };

  return (
    <div ref={wrapRef} className="effort-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`cmp-ctl effort-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        aria-label="Thinking effort"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setActive(Math.max(0, choices.indexOf(value as (typeof choices)[number])));
          setOpen((v) => !v);
        }}
      >
        <span>{getReasoningEffortLabel(value)}</span>
        <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          className="effort-pop"
          role="listbox"
          aria-label="Thinking effort"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          style={popPos ? { top: popPos.top, left: popPos.left } : { visibility: 'hidden' }}
        >
          {choices.map((effort, index) => (
            <button
              key={effort}
              type="button"
              role="option"
              aria-selected={effort === value}
              className={`effort-item${index === active ? ' active' : ''}${effort === value ? ' selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(effort)}
            >
              {getReasoningEffortLabel(effort)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
