import { Eye } from 'lucide-react';
import { useObserverStore } from '@/stores/observerStore';

interface ObserverEyeChipProps {
  threadId: string | null;
  open: boolean;
  onToggle: () => void;
}

/**
 * Composer chip that toggles the Observer well (the floor beneath the
 * composer recesses). The Observer is NOT a selectable agent — it lives
 * behind this dedicated button and watches the conversation in the
 * background.
 */
export function ObserverEyeChip({ threadId, open, onToggle }: ObserverEyeChipProps) {
  const notes = useObserverStore((s) =>
    threadId ? s.notesByThread[threadId] : undefined
  );
  const count = notes?.length ?? 0;

  return (
    <button
      type="button"
      className={`agent-pill${open ? ' targeted' : ''}`}
      title="Observer (⌘J) — open to ask about this conversation"
      onClick={onToggle}
      /* No inline colour: an inline declaration beats every CSS rule, which
         would lock the chip out of the toolbar's own five states. `.targeted`
         is the active hook the bar styles against. */
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <Eye size={12} />
      <span>observer</span>
      {count > 0 && (
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-whisper)',
            letterSpacing: 'var(--track-meta)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default ObserverEyeChip;
