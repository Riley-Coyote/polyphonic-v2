/* Polyphonic — v3 landing. Progressive enhancement: every word is already in index.html; this
   file adds the shell's selection and replay, the Brain sources, the permission strip, the rooms
   rail, the scroll reveals and the beta sign-up. No third-party code, no network beyond the form. */
(() => {
'use strict';
/* ---- the page's data, the prototype's tables verbatim (see README.md, "v3") ---- */
const CONV = {"ns-morning":{"title":"morning","sub":"Northstar · Luca","parent":"Northstar","time":"11h","day":"Today","msgs":[]},"ns-general":{"title":"general","sub":"Northstar · Luca · Fifty","parent":"Northstar","time":"2w","day":"Thursday, August 27th","msgs":[["s","You","created this room."],["s","Fifty","was added by you, along with Luca."],["u","","Who is picking up the empty screen?"],["a","Fifty","9:12","I have it. One prompt, nothing else added."],["a","Luca","9:14","I will keep the decision with the project."]]},"ns-firstrun":{"title":"FirstRun","sub":"Northstar · Fifty","parent":"Northstar","time":"5h","day":"Today","msgs":[["u","","Add one clear next step to the welcome screen."],["a","Fifty","8:02","Done. One prompt, two tests updated, nothing else touched."],["u","","Diff here or in the room?"],["a","Fifty","8:05","Either. I left a short note on what changed."]]},"ns-firstscreen":{"title":"first screen","sub":"Northstar · Trinity · Luca","parent":"Northstar","time":"3d","day":"Wednesday, September 10th","msgs":[["u","","Three actions on the first screen, or one?"],["a","Trinity","16:40","One. Three competing actions is a menu. One is an invitation."],["a","Luca","16:44","Agreed. The rest goes a click away, and I will hold the decision."]]},"lc-brief":{"title":"brief check","sub":"launch · Trinity","parent":"launch","time":"2h","day":"Today","msgs":[["u","","Does the welcome screen still match the brief?"],["a","Trinity","11:20","Nearly. One route from a note to a plan, as promised."],["a","Trinity","11:21","The empty screen does not point anywhere yet. The rest holds."],["u","","So we add the prompt and leave the rest?"]]},"lc-copy":{"title":"copy review","sub":"launch · Trinity","parent":"launch","time":"1d","day":"Friday, September 12th","msgs":[["u","","Does the launch page promise what the app does?"],["a","Trinity","14:05","Mostly. Lead with one home for your agents, and show them working together before you explain how."],["a","Trinity","14:07","The word instantly has to go. You do not need the flourish."]]},"lc-notes":{"title":"release notes","sub":"launch · Fifty","parent":"launch","time":"4d","day":"Tuesday, September 9th","msgs":[["u","","Anything left in the release notes?"],["a","Fifty","10:30","One claim I would soften. We say syncs instantly and it takes about a second."],["a","Fifty","10:33","Already marked it. Ready when you are."]]}};
const LISTS = {"agent:luca":["ns-morning","ns-general","ns-firstscreen"],"agent:fifty":["ns-firstrun","ns-general","lc-notes"],"agent:trinity":["lc-brief","lc-copy","ns-firstscreen"],"project:northstar":["ns-general","ns-morning","ns-firstrun","ns-firstscreen"],"project:launch":["lc-brief","lc-copy","lc-notes"]};
const NAMES = {"northstar":"Northstar","launch":"launch","fifty":"Fifty","luca":"Luca","trinity":"Trinity"};
const AGENT_RT = {"luca":"hermes","fifty":"claude","trinity":"claude"};
const GLYPH = {"luca":"M0.3 0H1V1H0.3A0.3 0.3 0 0 1 0 0.7V0.3A0.3 0.3 0 0 1 0.3 0Z M1 0H2V1H1V0Z M2 0H2.7A0.3 0.3 0 0 1 3 0.3V1H2V0Z M4.3 0H5V1H4V0.3A0.3 0.3 0 0 1 4.3 0Z M5 0H6V1H5V0Z M6 0H6.7A0.3 0.3 0 0 1 7 0.3V0.7A0.3 0.3 0 0 1 6.7 1H6V0Z M2 1H3V2H2V1Z M3 1H4V2H3V1Z M4 1H5V2H4V1Z M2 2H3V3H2V2Z M4 2H5V3H4V2Z M0.3 3H1V4H0V3.3A0.3 0.3 0 0 1 0.3 3Z M1 3H2V4H1V3Z M2 3H3V3.7A0.3 0.3 0 0 1 2.7 4H2V3Z M4 3H5V4H4.3A0.3 0.3 0 0 1 4 3.7V3Z M5 3H6V4H5V3Z M6 3H6.7A0.3 0.3 0 0 1 7 3.3V4H6V3Z M0 4H1V5H0V4Z M6 4H7V5H6V4Z M0 5H1V6H0V5Z M6 5H7V6H6V5Z M0 6H1V6.7A0.3 0.3 0 0 1 0.7 7H0.3A0.3 0.3 0 0 1 0 6.7V6Z M6 6H7V6.7A0.3 0.3 0 0 1 6.7 7H6.3A0.3 0.3 0 0 1 6 6.7V6Z","fifty":"M0.3 0H1V1H0V0.3A0.3 0.3 0 0 1 0.3 0Z M1 0H2V1H1V0Z M2 0H2.7A0.3 0.3 0 0 1 3 0.3V0.7A0.3 0.3 0 0 1 2.7 1H2V0Z M4.3 0H5V1H4.3A0.3 0.3 0 0 1 4 0.7V0.3A0.3 0.3 0 0 1 4.3 0Z M5 0H6V1H5V0Z M6 0H6.7A0.3 0.3 0 0 1 7 0.3V1H6V0Z M0 1H1V2H0V1Z M6 1H7V2H6V1Z M0 2H1V3H0V2Z M6 2H7V3H6V2Z M0 3H1V4H0V3Z M6 3H7V4H6V3Z M0 4H1V5H0V4Z M6 4H7V5H6V4Z M0 5H1V6H0.3A0.3 0.3 0 0 1 0 5.7V5Z M1 5H2V6H1V5Z M2 5H3V6H2V5Z M3 5H4V6H3V5Z M4 5H5V6H4V5Z M5 5H6V6H5V5Z M6 5H7V5.7A0.3 0.3 0 0 1 6.7 6H6V5Z M2 6H3V6.7A0.3 0.3 0 0 1 2.7 7H2.3A0.3 0.3 0 0 1 2 6.7V6Z M4 6H5V6.7A0.3 0.3 0 0 1 4.7 7H4.3A0.3 0.3 0 0 1 4 6.7V6Z","trinity":"M5.3 0H5.7A0.3 0.3 0 0 1 6 0.3V1H5V0.3A0.3 0.3 0 0 1 5.3 0Z M2.3 1H2.7A0.3 0.3 0 0 1 3 1.3V2H2V1.3A0.3 0.3 0 0 1 2.3 1Z M5 1H6V2H5V1Z M0.3 2H1V3H0V2.3A0.3 0.3 0 0 1 0.3 2Z M1 2H2V3H1V2Z M2 2H3V3H2V2Z M4.3 2H5V3H4V2.3A0.3 0.3 0 0 1 4.3 2Z M5 2H6V3H5V2Z M6 2H6.7A0.3 0.3 0 0 1 7 2.3V3H6V2Z M0 3H1V4H0V3Z M2 3H3V4H2V3Z M3 3H4V4H3V3Z M4 3H5V4H4V3Z M6 3H7V4H6V3Z M0 4H1V5H0.3A0.3 0.3 0 0 1 0 4.7V4Z M1 4H2V5H1V4Z M2 4H3V4.7A0.3 0.3 0 0 1 2.7 5H2V4Z M4 4H5V5H4V4Z M5 4H6V5H5V4Z M6 4H7V4.7A0.3 0.3 0 0 1 6.7 5H6V4Z M1 5H2V6H1V5Z M4 5H5V5.7A0.3 0.3 0 0 1 4.7 6H4.3A0.3 0.3 0 0 1 4 5.7V5Z M1 6H2V6.7A0.3 0.3 0 0 1 1.7 7H1.3A0.3 0.3 0 0 1 1 6.7V6Z","vektor":"M1.3 0H2V1H1V0.3A0.3 0.3 0 0 1 1.3 0Z M2 0H3V1H2V0Z M3 0H4V1H3V0Z M4 0H5V1H4V0Z M5 0H5.7A0.3 0.3 0 0 1 6 0.3V1H5V0Z M1 1H2V2H1V1Z M5 1H6V2H5V1Z M1 2H2V3H1V2Z M5 2H6V3H5V2Z M1 3H2V4H1.3A0.3 0.3 0 0 1 1 3.7V3Z M2 3H2.7A0.3 0.3 0 0 1 3 3.3V4H2V3Z M4.3 3H5V4H4V3.3A0.3 0.3 0 0 1 4.3 3Z M5 3H6V3.7A0.3 0.3 0 0 1 5.7 4H5V3Z M2 4H3V5H2V4Z M4 4H5V5H4V4Z M0.3 5H1V6H0.3A0.3 0.3 0 0 1 0 5.7V5.3A0.3 0.3 0 0 1 0.3 5Z M1 5H2V6H1V5Z M2 5H3V5.7A0.3 0.3 0 0 1 2.7 6H2V5Z M4 5H5V6H4.3A0.3 0.3 0 0 1 4 5.7V5Z M5 5H6V6H5V5Z M6 5H6.7A0.3 0.3 0 0 1 7 5.3V5.7A0.3 0.3 0 0 1 6.7 6H6V5Z M1 6H2V6.7A0.3 0.3 0 0 1 1.7 7H1.3A0.3 0.3 0 0 1 1 6.7V6Z M5 6H6V6.7A0.3 0.3 0 0 1 5.7 7H5.3A0.3 0.3 0 0 1 5 6.7V6Z"};
const HASH = "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18";
const MSG_ONE = "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719";
const MSG_MANY = "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2zM20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1";
const SAYS = {"repositories":"The repo shows the empty screen still has no next step.","claude":"On Tuesday, in Claude Code, you chose one clear prompt.","codex":"Codex finished the walkthrough last night.","files":"The brief wants one route from a note to a plan."};
const SAYS_ORDER = ["files","repositories","codex","claude"];
const SAYS_NONE = "Morning. I don't have anything on Northstar yet. What is it?";
const P1 = "You wanted the first release kept small, so I held the line on that. Codex finished the walkthrough overnight, and Mira read it this morning.";
const P2 = "She thinks the empty screen needs one clear next step. Want me to bring her in, or look at it together first?";

/* ------------------------------------------------------------------ helpers */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/* ------------------------------------------------------------------ reveals */
/* data-rv: opacity 0 / +26px into place over .7s, once. The stylesheet hides them until then, so
   nothing flashes before this runs; under reduced motion it never hides them at all. */
if (!reduced.matches && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.setAttribute('data-rv', 'on');
    io.unobserve(e.target);
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-rv]').forEach(el => io.observe(el));
} else {
  $$('[data-rv]').forEach(el => el.setAttribute('data-rv', 'on'));
}

/* ------------------------------------------------------------------ rooms rail */
/* One rAF chain, a constant walk left, the card list rendered twice so the seam is invisible.
   It does not react to scroll and does not pause on hover. dt is clamped, and the clock is
   re-based when the tab comes back, so a backgrounded tab never catches up in a jump. */
(() => {
  const rail = $('#pp-rail');
  if (!rail || reduced.matches) return;
  const half = rail.children.length >> 1;
  let x = 0, period = 0, last = 0, raf = 0;
  const step = ts => {
    if (!last) last = ts;
    const dt = Math.min(64, ts - last);
    last = ts;
    if (!period && rail.children[half]) period = rail.children[half].offsetLeft - rail.children[0].offsetLeft;
    x -= dt * 0.019;
    if (period && x <= -period) x += period;
    rail.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) last = 0; });
})();

/* ------------------------------------------------------------------ the shell */
(() => {
  const shell = $('[data-pp-shell]');
  if (!shell) return;
  const chatsMark = $('[data-pp-chats-mark]'), chatsName = $('[data-pp-chats-name]');
  const chatRows = $('[data-pp-chat-rows]'), closeList = $('[data-pp-close-list]');
  const convMark = $('[data-pp-conv-mark]'), convTitle = $('[data-pp-conv-title]');
  const convSub = $('[data-pp-conv-sub]'), convBody = $('[data-pp-conv-body]');
  const morningHTML = convBody.innerHTML;
  let selKind = 'agent', selKey = 'luca', chatId = 'ns-morning';

  const icon = (d, sz, extra) => '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra ? ' style="' + extra + '"' : '') + '><path d="' + d + '"></path></svg>';

  const renderChatList = () => {
    const ids = LISTS[selKind + ':' + selKey] || [];
    chatsName.textContent = NAMES[selKey] || 'Northstar';
    closeList.setAttribute('aria-label', 'Close ' + chatsName.textContent + ' chats');
    chatsMark.innerHTML = selKind === 'agent'
      ? '<svg width="19" height="19" viewBox="0 0 7 7" fill="currentColor" aria-hidden="true"><path d="' + GLYPH[selKey] + '"></path></svg>'
      : icon(HASH, 16);
    chatRows.innerHTML = ids.map(id => {
      const c = CONV[id], on = id === chatId, many = c.sub.split(' · ').length > 2;
      return '<button type="button" data-pp-row="" data-chat="' + id + '" data-active="' + on + '" aria-pressed="' + on + '">'
        + '<span style="width:20px;height:20px;flex:none;display:grid;place-items:center;color:hsl(var(--mn-ink-faint));">' + icon(many ? MSG_MANY : MSG_ONE, 14) + '</span>'
        + '<span style="flex:1;min-width:0;display:flex;flex-direction:column;"><span style="font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.title) + '</span>'
        + (selKind === 'agent' && c.parent ? '<span style="font-size:8px;line-height:12px;letter-spacing:.09em;text-transform:uppercase;color:hsl(var(--mn-ink-faint));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.parent) + '</span>' : '')
        + '</span>'
        + '<span style="flex:none;font-size:11px;line-height:16.5px;font-variant-numeric:tabular-nums;color:hsl(var(--mn-ink-faint));">' + c.time + '</span></button>';
    }).join('');
  };

  const staticBody = c => {
    let h = '<div style="display:flex;align-items:center;gap:14px;margin:0 0 22px;font-size:12.5px;color:#84837b;"><span style="flex:1;height:1px;background:#232322;"></span>' + esc(c.day) + '<span style="flex:1;height:1px;background:#232322;"></span></div>';
    for (const m of c.msgs) {
      if (m[0] === 's') h += '<div style="margin:0 0 18px;font-size:14.5px;color:#97968d;"><span style="font-weight:600;color:var(--app-ink);">' + esc(m[1]) + '</span> ' + esc(m[2]) + '</div>';
      else if (m[0] === 'u') h += '<div style="margin:0 0 22px auto;width:fit-content;max-width:85%;padding:11px 16px 12px;background:#222221;border-radius:16px;box-shadow:inset 0 1px #ffffff08;color:var(--app-ink);text-wrap:pretty;">' + esc(m[2]) + '</div>';
      else h += '<div style="margin:0 0 22px;"><span style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px;font-size:14px;"><span style="font-weight:600;color:var(--app-ink);">' + esc(m[1]) + '</span><span style="font-size:11px;color:#93928a;">managed by you</span><time style="font-size:11px;color:#93928a;">' + esc(m[2]) + '</time></span><span style="display:block;text-wrap:pretty;">' + esc(m[3]) + '</span></div>';
    }
    return h;
  };

  const renderConv = () => {
    const c = CONV[chatId];
    const who = c.sub.split(' · ').slice(1);
    const rt = who.length === 1 ? AGENT_RT[who[0].toLowerCase()] || null : null;
    convTitle.textContent = c.title;
    convTitle.style.transform = rt ? 'none' : 'translateY(1px)';
    convSub.textContent = c.sub;
    convMark.innerHTML = rt === 'claude'
      ? '<img src="/beta/assets/polyphonic/harness/claude.png" width="20" height="20" alt="" style="display:block;object-fit:contain;">'
      : rt === 'hermes'
        ? '<span aria-hidden="true" style="display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:28%;background:hsl(var(--mn-ink) / .06);color:hsl(var(--mn-ink-muted));"><svg viewBox="0 0 20 20" style="display:block;width:100%;height:100%;"><text x="10" y="10.5" dominant-baseline="central" text-anchor="middle" font-size="11" font-weight="500" fill="currentColor">H</text></svg></span>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;color:hsl(var(--mn-ink-muted));"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"></path></svg>';
    convBody.dataset.conv = chatId;
    convBody.innerHTML = chatId === 'ns-morning' ? morningHTML : staticBody(c);
  };

  chatRows.addEventListener('click', e => {
    const b = e.target.closest('[data-chat]');
    if (!b) return;
    chatId = b.dataset.chat;
    $$('[data-chat]', chatRows).forEach(r => {
      const on = r === b;
      r.dataset.active = String(on);
      r.setAttribute('aria-pressed', String(on));
    });
    renderConv();
  });

  shell.addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const [kind, key] = b.dataset.pick.split(':');
    selKind = kind; selKey = key;
    chatId = (LISTS[kind + ':' + key] || [])[0] || 'ns-morning';
    $$('[data-pick]', shell).forEach(r => {
      const on = r === b, isAgent = r.dataset.pick.startsWith('agent:');
      if (isAgent) r.dataset.open = String(on); else r.dataset.active = String(on);
      r.setAttribute('aria-pressed', String(on));
    });
    shell.removeAttribute('data-list');
    renderChatList();
    renderConv();
  });

  closeList.addEventListener('click', () => shell.setAttribute('data-list', 'closed'));

  /* Luca's `morning` replay: typing dots, then text at ~20ms a character, two saved-note cards,
     the second paragraph and the receipt. It runs once, when the shell first scrolls into view.
     The finished text is already in the page holding every height, so nothing moves while it types. */
  if (convBody.dataset.replay === 'armed') {
    if (reduced.matches) convBody.removeAttribute('data-replay');
    else {
      const run = () => {
        const dots = $('[data-pp-typing]', convBody);
        const p1 = $('[data-pp-type="1"]', convBody), p2 = $('[data-pp-type="2"]', convBody);
        const cards = $$('[data-pp-cards] > *', convBody), rc = $('[data-pp-receipt]', convBody);
        if (!dots || !p1 || !p2) { convBody.removeAttribute('data-replay'); return; }
        dots.hidden = false;
        const t0 = performance.now();
        const show = el => { if (el && el.dataset.on !== '1') { el.dataset.on = '1'; el.classList.add('pp-fade'); } };
        const frame = () => {
          if (convBody.dataset.conv !== 'ns-morning') { requestAnimationFrame(frame); return; }
          const e = performance.now() - t0;
          dots.hidden = e >= 900;
          p1.textContent = P1.slice(0, e < 900 ? 0 : Math.min(P1.length, Math.floor((e - 900) / 20)));
          if (e > 4300) show(cards[0]);
          if (e > 4700) show(cards[1]);
          p2.textContent = P2.slice(0, e < 5200 ? 0 : Math.min(P2.length, Math.floor((e - 5200) / 20)));
          if (e > 7700) show(rc);
          if (e > 7800) { convBody.removeAttribute('data-replay'); return; }
          requestAnimationFrame(frame);
        };
        frame();
      };
      const preview = $('#preview');
      if (preview && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver(es => es.forEach(en => {
          if (!en.isIntersecting) return;
          io.disconnect();
          run();
        }), { threshold: 0.35 });
        io.observe(preview);
      } else run();
    }
  }
})();

/* ------------------------------------------------------------------ Brain sources */
(() => {
  const line = $('[data-pp-luca-line]');
  const buttons = $$('[data-pp-toggle]');
  if (!line || !buttons.length) return;
  const on = {};
  buttons.forEach(b => { on[b.dataset.ppToggle] = true; });
  const dot = '<span aria-hidden="true" style="width:6px;height:6px;flex:none;border-radius:50%;background:#86D8A8;"></span>';
  const paint = b => {
    const key = b.dataset.ppToggle, is = on[key], label = is ? 'Connected' : b.dataset.action;
    b.innerHTML = (is ? dot : '') + esc(label);
    b.style.borderColor = is ? 'transparent' : 'var(--line2)';
    b.style.color = is ? 'var(--t2)' : 'var(--t1)';
    b.setAttribute('aria-pressed', String(is));
    b.setAttribute('aria-label', label + ', ' + b.closest('[data-pp-source]').querySelector('span > span').textContent);
  };
  const say = () => {
    const said = SAYS_ORDER.filter(k => on[k]).map(k => SAYS[k]);
    line.textContent = said.length ? said.join(' ') : SAYS_NONE;
  };
  buttons.forEach(b => b.addEventListener('click', () => {
    on[b.dataset.ppToggle] = !on[b.dataset.ppToggle];
    paint(b);
    say();
  }));
})();

/* ------------------------------------------------------------------ permission strip */
(() => {
  const ask = $('[data-pp-perm-ask]'), done = $('[data-pp-perm-done]'), note = $('[data-pp-perm-note]');
  const feed = $('[data-pp-feed]');
  if (!ask || !done || !feed) return;
  const first = feed.firstElementChild;
  let extra = null;
  const resolve = allowed => {
    ask.hidden = true; done.hidden = false; done.classList.add('pp-fade');
    note.textContent = allowed
      ? 'Allowed once. Vektor wrote the file and signed it.'
      : 'Denied. Vektor was told, and nothing was written.';
    if (extra) extra.remove();
    extra = document.createElement('div');
    extra.className = 'pp-fade';
    extra.setAttribute('data-pp-extra', '');
    extra.setAttribute('style', 'display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 18px;border-top:1px solid var(--line);background:' + (allowed ? 'rgba(134,216,168,.05)' : 'rgba(255,255,255,.025)') + ';');
    extra.innerHTML = '<span style="width:36px;height:36px;border-radius:50%;background:var(--glass);display:grid;place-items:center;flex:none;margin-top:2px;"><svg width="18" height="18" viewBox="0 0 7 7" fill="#EFEFED" aria-hidden="true"><path d="' + GLYPH.vektor + '"></path></svg></span>'
      + '<span style="min-width:0;"><span style="display:flex;align-items:baseline;gap:9px;"><span style="color:var(--t0);">Vektor</span><span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t2);">codex</span></span><span style="display:block;margin-top:2px;font-size:13.5px;color:var(--t1);">'
      + (allowed ? 'Wrote src/FirstRun.tsx after you allowed it once.' : 'Asked to write src/FirstRun.tsx. You declined; nothing was written.')
      + '</span></span>'
      + '<span style="display:grid;justify-items:end;gap:3px;white-space:nowrap;"><span style="font-family:var(--mono);font-size:11px;color:var(--t2);">now</span><span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--t2);">signed<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#86D8A8" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><path d="M4 13l5 5L20 6"></path></svg></span></span>';
    feed.insertBefore(extra, first);
    $('[data-pp-reset-perm]').focus({ preventScroll: true });
  };
  $('[data-pp-allow]').addEventListener('click', () => resolve(true));
  $('[data-pp-deny]').addEventListener('click', () => resolve(false));
  $('[data-pp-reset-perm]').addEventListener('click', () => {
    done.hidden = true; ask.hidden = false;
    if (extra) { extra.remove(); extra = null; }
    $('[data-pp-allow]').focus({ preventScroll: true });
  });
})();

/* ------------------------------------------------------------------ beta sign-up */
/* The contract is unchanged from the page this replaces: JSON to config.signupEndpoint with a
   honeypot, source 'polyphonic-beta', a 12s timeout, and the three success statuses. With no
   endpoint the form says so and sends nothing. */
(() => {
  const form = $('#beta-form'), email = $('#email'), submit = $('#signup-submit'), note = $('#signup-note');
  if (!form) return;
  const config = window.POLYPHONIC_CONFIG || {};
  let busy = false;
  if (config.signupEndpoint) note.textContent = 'macOS · one email with the app, nothing else.';
  if (config.privacyUrl) {
    const a = document.createElement('a');
    a.textContent = 'Privacy';
    a.href = config.privacyUrl;
    a.className = 'pp-privacy';
    $('#privacy-slot').replaceWith(a);
  }
  email.addEventListener('input', () => {
    email.removeAttribute('aria-invalid');
    if (!busy) { submit.disabled = false; submit.textContent = 'Request the beta'; }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    if (!email.validity.valid || !email.value.trim()) {
      email.setAttribute('aria-invalid', 'true');
      note.textContent = 'Please enter a valid email address.';
      email.focus();
      return;
    }
    if (!config.signupEndpoint) { note.textContent = 'Beta requests aren’t open yet. Your email has not been sent or saved.'; return; }
    busy = true; submit.disabled = true; submit.textContent = 'Requesting…';
    form.setAttribute('aria-busy', 'true');
    note.textContent = 'Sending your request…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(config.signupEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), source: 'polyphonic-beta', website: ($('#website') || {}).value || '' }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Signup failed: ' + response.status);
      const result = await response.json().catch(() => ({}));
      note.textContent = result.status === 'already_subscribed'
        ? 'You’re already on the list. We’ll email your download link when a build is ready.'
        : result.status === 'confirmation_required'
          ? 'Check your inbox to confirm your email address.'
          : 'You’re on the list. We’ll email your download link when a build is ready.';
      submit.textContent = 'Requested'; email.value = ''; submit.disabled = true;
    } catch {
      note.textContent = 'Your request couldn’t be confirmed. Please try again.';
      submit.textContent = 'Request the beta';
      submit.disabled = false;
    } finally {
      clearTimeout(timeout);
      busy = false;
      form.removeAttribute('aria-busy');
    }
  });
})();
})();
