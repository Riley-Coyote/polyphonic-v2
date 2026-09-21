import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/** Every `@media (max-width: …)` block in the stylesheet, with its body. */
function mediaBlocks(css: string, match: RegExp): Array<{ head: string; body: string }> {
  const lines = css.split('\n');
  const out: Array<{ head: string; body: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith('@media') || !match.test(lines[i])) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j += 1) {
      depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
      if (depth === 0 && j > i) {
        out.push({ head: lines[i].trim(), body: lines.slice(i + 1, j).join('\n') });
        break;
      }
    }
  }
  return out;
}

describe('phone chrome', () => {
  it('spends one breakpoint on phones', () => {
    const styles = readRepoFile('src/index.css');
    // 719 and 768 used to split the same "phone" idea across three numbers.
    expect(styles).not.toMatch(/max-width:\s*719px/);
    expect(styles).not.toMatch(/max-width:\s*768px/);
    expect(mediaBlocks(styles, /767px/).length).toBeGreaterThan(5);
  });

  it('gives the app bar back the screen it was padding away', () => {
    const styles = readRepoFile('src/index.css');
    const bar = styles.slice(styles.indexOf('.mobile-app-bar {'), styles.indexOf('.mobile-bar-button {'));
    // The synthetic 10px inset floor plus 16px is gone: the inset is read as
    // it actually is, and the rest of the bar is 8 + 40 + 8.
    expect(bar).toContain('min-height: calc(env(safe-area-inset-top, 0px) + 56px)');
    expect(bar).toContain('padding: calc(env(safe-area-inset-top, 0px) + 8px) 14px 8px');
    expect(bar).not.toContain('max(env(safe-area-inset-top), 10px)');
    expect(styles).toMatch(/\.mobile-bar-button \{[^}]*height: 40px/);
    // Hover is a mouse state — it used to stick after every tap.
    expect(styles).toMatch(/@media \(hover: hover\) \{\s*\.mobile-bar-button:hover/);
  });

  it('draws touch targets as hit-boxes instead of fat controls', () => {
    const styles = readRepoFile('src/index.css');
    expect(styles).toContain('--touch-target:');
    const coarse = mediaBlocks(styles, /pointer: coarse/).map((b) => b.body).join('\n');
    // The old rules grew the drawing; nothing visible is 44px any more.
    expect(coarse).not.toMatch(/\.cmp-send \{[^}]*width: 44px/);
    expect(coarse).not.toMatch(/\.cmp-lead \.attach-btn \{[^}]*width: 44px/);
    expect(coarse).toContain('::after');
    expect(coarse).toContain('var(--touch-target)');
  });

  it('keeps nothing under 11px in the phone rules it owns', () => {
    const styles = readRepoFile('src/index.css');
    const phone = mediaBlocks(styles, /767px/).map((b) => b.body).join('\n');
    const offenders: string[] = [];
    let selector = '';
    for (const line of phone.split('\n')) {
      if (line.includes('{')) selector = line.trim();
      const size = /font-size:\s*([0-9.]+)px/.exec(line);
      if (size && Number(size[1]) < 11 && /\.(msg|thinking|cmp|mobile|drawer)/.test(selector)) {
        offenders.push(`${selector} ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(phone).toMatch(/\.msg-time,\s*\n\s*\.msg-author \{\s*\n\s*font-size: 11px/);
  });

  it('stands the phone on the app floor instead of pure black', () => {
    const styles = readRepoFile('src/index.css');
    const phone = mediaBlocks(styles, /767px/).map((b) => b.body).join('\n');
    // The floor tokens are no longer redefined, and no phone rule paints #000.
    expect(phone).not.toMatch(/--floor:\s*#000/);
    expect(phone).not.toMatch(/--canvas:\s*#000/);
    expect(phone).not.toMatch(/--bg-(deep|primary|elevated):\s*#000/);
    expect(phone).not.toMatch(/background:\s*#000/);
    // With a floor again, the well cuts down here exactly as on the desktop.
    expect(phone).not.toContain('--cmp-well-bg: rgba(255, 255, 255, 0.022)');
    // The contrast lift on the faint text tiers is kept.
    expect(phone).toContain('--text-whisper: rgba(178, 176, 172, 0.56)');
  });

  it('follows the bottom of the thread only when the reader was already there', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    const effect = chatView.indexOf('window.visualViewport');
    expect(effect).toBeGreaterThan(-1);
    const onResize = chatView.indexOf('const onResize = () => {', effect);
    const guard = chatView.indexOf('if (!userPinnedRef.current) return;', onResize);
    expect(guard).toBeGreaterThan(-1);
    expect(guard - onResize).toBeLessThan(400);
  });

  it('shows the empty state when the route loses its thread', () => {
    const chatView = readRepoFile('src/pages/ChatView.tsx');
    // `/chat` used to early-return and leave the previous thread on screen,
    // which made New chat and the drawer's Chat row look like no-ops.
    expect(chatView).not.toContain('if (!threadId) return;');
    const branch = chatView.indexOf('if (!threadId) {');
    expect(branch).toBeGreaterThan(-1);
    expect(chatView.slice(branch, branch + 500)).toContain('setCurrentThread(null)');
  });
});

describe('the conversations drawer', () => {
  const drawer = () => readRepoFile('src/components/mobile/MobileNavDrawer.tsx');

  it('spends the drawer on three regions, with only the middle scrolling', () => {
    const src = drawer();
    const scroll = src.indexOf('className="mobile-nav-scroll"');
    const footer = src.indexOf('className="mobile-nav-footer"');
    expect(scroll).toBeGreaterThan(-1);
    // Search is pinned above the scroller; the agent row, New chat and the
    // conversations are inside it; the footer is outside it, below.
    expect(src.indexOf('className="mobile-nav-search"')).toBeLessThan(scroll);
    for (const inside of ['mobile-agent-row', 'mobile-nav-primary', 'className="mobile-nav-threads"']) {
      expect(src.indexOf(inside)).toBeGreaterThan(scroll);
      expect(src.indexOf(inside)).toBeLessThan(footer);
    }
    expect(footer).toBeGreaterThan(scroll);

    const styles = readRepoFile('src/index.css');
    expect(styles).toMatch(/\.mobile-nav-scroll \{[^}]*overflow-y: auto/);
    expect(styles).toMatch(/\.mobile-nav-footer \{[^}]*flex: 0 0 auto/);
    // The footer reaches the screen edge: it owns the bottom inset, the
    // drawer no longer pads it away.
    expect(styles).toMatch(/\.mobile-nav-footer \{[^}]*padding-bottom: env\(safe-area-inset-bottom, 0px\)/);
    expect(styles).toMatch(/\.mobile-nav-drawer \{[^}]*padding: calc\(10px \+ env\(safe-area-inset-top\)\) 12px 0;/);
  });

  it('retires the section tile grid', () => {
    const src = drawer();
    expect(src).not.toContain('mobile-nav-tile');
    expect(src).not.toContain('mobile-nav-rule');
    expect(src).not.toContain('STUDIO_SECTIONS');
    const styles = readRepoFile('src/index.css');
    expect(styles).not.toContain('.mobile-nav-tile');
    expect(styles).not.toContain('.mobile-nav-rule');
    expect(styles).not.toContain('--mobile-tile-h');
  });

  it("puts the agent's own pages behind the agent's row", () => {
    const src = drawer();
    const pages = src.slice(src.indexOf('const STUDIO_AGENT_PAGES'), src.indexOf('];', src.indexOf('const STUDIO_AGENT_PAGES')));
    for (const label of ['Memory', 'Mind', 'Journal']) expect(pages).toContain(`label: '${label}'`);
    // Projects and Profile left the list: one is the All link, one the footer.
    expect(pages).not.toContain("label: 'Projects'");
    expect(pages).not.toContain("label: 'Profile'");

    const menu = src.slice(src.indexOf('mobile-nav-agent-menu'), src.indexOf('mobile-nav-primary'));
    expect(menu).toContain('mobile-nav-agent-page');
    expect(menu).toContain('mobile-nav-agent-rule');
    expect(menu).toContain('Switch agent');
    // Switching an agent re-points those pages; it does not close the drawer.
    expect(menu).toContain('mobile-agent-scope-option');
    const select = src.slice(src.indexOf('const handleSelectAgentScope'), src.indexOf('const handleSignOut'));
    expect(select).toContain('setActiveAgent(id)');
    expect(select).not.toContain('close()');

    const styles = readRepoFile('src/index.css');
    // One-shot grid-rows toggle, and collapsed content leaves the tab order.
    expect(styles).toMatch(/\.mobile-nav-agent-menu \{[^}]*grid-template-rows: 0fr/);
    expect(styles).toMatch(/\.mobile-nav-agent-menu \{[^}]*transition: grid-template-rows var\(--dur-fast\) var\(--ease-out\)/);
    expect(styles).toMatch(/\.mobile-nav-agent-menu-clip \{[^}]*visibility: hidden/);
    expect(styles).toMatch(/\.mobile-nav-agent-page,\s*\n\.mobile-nav-agent-switch \{[^}]*min-height: 40px/);
  });

  it('gives the projects region its one door to the projects page', () => {
    const src = drawer();
    expect(src).toContain('mobile-nav-projects-head');
    const head = src.slice(src.indexOf('mobile-nav-projects-head'), src.indexOf('projectGroups.map'));
    expect(head).toContain('mobile-nav-projects-all');
    expect(head).toContain("go('/projects')");
    // No second Projects entry anywhere else in the drawer.
    expect(src.match(/go\('\/projects'\)/g)?.length).toBe(1);
  });

  it('pins the account, activity and settings into a footer', () => {
    const src = drawer();
    const footer = src.slice(src.indexOf('className="mobile-nav-footer"'));
    expect(footer).toContain('mobile-nav-footer-identity');
    expect(footer).toContain("go('/profile')");
    expect(footer).toContain('mobile-nav-footer-signout');
    expect(footer).toContain('handleOpenActivity');
    expect(footer).toContain('mobile-nav-count');
    expect(footer).toContain('aria-label="Settings"');
    expect(footer).toContain("go('/settings')");

    const styles = readRepoFile('src/index.css');
    expect(styles).toMatch(/\.mobile-nav-footer \{[^}]*height: calc\(var\(--mobile-row-h\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(styles).toMatch(/\.mobile-nav-footer \{[^}]*border-top: 1px solid var\(--cmp-hairline\)/);
    expect(styles).toMatch(/\.mobile-nav-footer-btn \{[^}]*width: 40px/);
    // 40px drawn, 44px hit — the sign-out link takes the 32px its cell has.
    const coarse = mediaBlocks(styles, /pointer: coarse/).map((b) => b.body).join('\n');
    expect(coarse).toContain('.mobile-nav-footer-btn::after');
    expect(coarse).toContain('.mobile-nav-agent-page::after');
    expect(coarse).toContain('.mobile-nav-projects-all::after');
    expect(coarse).toMatch(/\.mobile-nav-footer-signout::after \{[^}]*height: 32px/);
  });

  it('reuses the desktop grouping rather than inventing a second one', () => {
    const src = drawer();
    expect(src).toContain("from '@/lib/threadGrouping'");
    expect(src).toContain('groupThreadsByDate(');
    expect(src).toContain("from '@/stores/projectStore'");
    expect(src).toContain('threadsForProject(');
    expect(src).toContain('sortProjects(');
    // Paged, not truncated at 32 with no way to see the rest.
    expect(src).not.toContain('.slice(0, 32)');
    expect(src).toContain('THREAD_PAGE');
    expect(src).toContain('Show older');
  });

  it('quiets the active agent from a card down to a row', () => {
    const src = drawer();
    expect(src).not.toContain('Active agent');
    expect(src).not.toContain('Journal · Memory · Mind');
    expect(src).not.toContain('mobile-agent-scope-trigger');
    expect(src).toContain('mobile-agent-row');
    expect(src).toContain('handleSelectAgentScope');

    const styles = readRepoFile('src/index.css');
    expect(styles).toMatch(/\.mobile-agent-row \{[^}]*height: var\(--mobile-agent-row-h\)/);
    expect(styles).toContain('--mobile-agent-row-h:  36px');
    expect(styles).not.toContain('.mobile-agent-scope-kicker');
  });

  it('sizes every row from a token, with five states on each', () => {
    const styles = readRepoFile('src/index.css');
    expect(styles).toContain('--mobile-row-h:        var(--touch-target)');
    for (const sel of [
      '.mobile-thread-row',
      '.mobile-nav-footer-btn',
      '.mobile-nav-footer-identity',
    ]) {
      expect(styles).toContain(`${sel}:hover`);
      expect(styles).toContain(`${sel}:active`);
      expect(styles).toContain(`${sel}:focus-visible`);
      expect(styles).toContain(`${sel}[data-active="true"]`);
    }
    for (const sel of ['.mobile-nav-agent-switch', '.mobile-nav-projects-all', '.mobile-nav-footer-signout']) {
      expect(styles).toContain(`${sel}:hover`);
      expect(styles).toContain(`${sel}:active`);
      expect(styles).toContain(`${sel}:focus-visible`);
    }
    // Focus is the element's own border brightening in place — never a ring.
    const row = styles.slice(styles.indexOf('.mobile-thread-row:focus-visible'), styles.indexOf('.mobile-thread-row[data-active'));
    expect(row).toContain('border-color: var(--cmp-focus-border)');
    expect(row).toContain('outline: none');
    // The one-shot toggles collapse under reduced motion.
    const reduced = mediaBlocks(styles, /prefers-reduced-motion/).map((b) => b.body).join('\n');
    for (const sel of ['.mobile-nav-agent-menu', '.mobile-nav-footer-btn', '.mobile-nav-agent-switch-chevron']) {
      expect(reduced).toContain(sel);
    }
  });

  it('keeps both dev harnesses behind import.meta.env.DEV', () => {
    const app = readRepoFile('src/App.tsx');
    expect(app).toContain('const MobileNavHarness = import.meta.env.DEV');
    const routeIndex = app.indexOf('path="/__dev/mobile-nav"');
    expect(routeIndex).toBeGreaterThan(-1);
    const guardIndex = app.lastIndexOf('import.meta.env.DEV', routeIndex);
    expect(routeIndex - guardIndex).toBeLessThan(90);
    // Fixtures live in the harness and nowhere near app code.
    const harness = readRepoFile('src/dev/MobileNavHarness.tsx');
    expect(harness).toContain('fixture');
    expect(drawer()).not.toContain('fixture');
  });
});
