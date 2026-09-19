import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('thin composer', () => {
  it('renders one Composer component in both places instead of two inline shells', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');

    // The old shell is gone from the chat surface entirely (LandingPage still
    // owns `.input-shell`; this assertion is about ChatView only).
    expect(chatView).not.toContain('input-shell');
    expect([...chatView.matchAll(/<Composer\b/g)]).toHaveLength(2);

    // The chips the composer reuses are still mounted, not reimplemented.
    expect(chatView).toContain('<AttachmentSourceControl');
    expect(chatView).toContain('<ObserverEyeChip');
    expect(chatView).toContain('<ModesDropdown');
    expect(chatView).toContain('<EffortControl');
    expect(chatView).not.toContain('className="effort-select"');
  });

  it('guards Enter against an active IME composition', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    expect(chatView).toContain('native?.isComposing || native?.keyCode === 229');
  });

  it('shows the message before it asks the database to store it', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    const sendStart = chatView.indexOf('const sendMessage = useCallback(');
    expect(sendStart).toBeGreaterThan(-1);

    const optimistic = chatView.indexOf('addMessage({\n        id: optimisticId,', sendStart);
    const insert = chatView.indexOf('insertMessageWithFreshSession({', sendStart);
    expect(optimistic).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(optimistic).toBeLessThan(insert);

    // The persisted row carries the same id, so there is no optimistic swap.
    expect(chatView).toContain('...(useOptimisticRow ? { id: optimisticId } : {})');
    // A failed send keeps the row and marks it.
    expect(chatView).toContain('send_failed: true');
    // The decorative 720ms settle is gone.
    expect(chatView).not.toContain('sending-turn');
    expect(readRepoFile('src/index.css')).not.toContain('composerSendSettle');
  });

  it('keeps the dev harness route behind import.meta.env.DEV', () => {
    const app = readRepoFile('src/App.tsx');
    const routeIndex = app.indexOf('path="/__dev/composer"');
    expect(routeIndex).toBeGreaterThan(-1);
    const guardIndex = app.lastIndexOf('import.meta.env.DEV', routeIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    // The guard is the line immediately wrapping the route, not an unrelated one.
    expect(routeIndex - guardIndex).toBeLessThan(80);
    // And the lazy import itself is guarded, so no harness chunk is emitted.
    expect(app).toContain('const ComposerHarness = import.meta.env.DEV');
  });

  it('spends tokens for every composer colour, radius and duration', () => {
    const styles = readRepoFile('src/index.css');
    for (const token of [
      '--thread-measure',
      '--cmp-radius',
      '--cmp-fill',
      '--cmp-hairline-focus',
      '--cmp-lit-edge',
      '--cmp-ink',
      '--cmp-ink-faint',
      '--cmp-plate-hover',
      '--cmp-arm',
      '--cmp-disarm',
    ]) {
      expect(styles).toContain(`${token}:`);
    }
    // Arm and disarm are declared on the state being entered, not shared.
    const armed = styles.indexOf('.cmp-send[data-armed="true"]');
    expect(styles.slice(armed, armed + 400)).toContain('var(--cmp-arm)');
    // No gradient anywhere in the composer block.
    const block = styles.slice(styles.indexOf('.cmp {'), styles.indexOf('/* Alcove panel'));
    expect(block).not.toContain('gradient(');
  });
});
