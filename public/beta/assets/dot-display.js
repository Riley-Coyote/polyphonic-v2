/* ============================================================
   FIELD UNIT — dot-display engine  ·  rev a
   The DISPLAY material, as a reusable painter.

   Load it:   <script src="dot-display.js"></script>
   Use it:    <canvas data-scene="field"></canvas>
              DotDisplay.mount()          // finds every canvas[data-scene]

   The one idea that matters: the panel HOLDS CHARGE. The buffer
   persists between frames and decays; nothing ever cuts to black,
   it goes out. Bloom bleeds each cell into its neighbours so a lit
   dot throws light. A slow raster sweep keeps idle glass alive.

   Tunable per canvas with data-* attributes:
     data-cell   dot pitch in px          (default 4, hero 5)
     data-glow   per-frame retention      (.78 fast … .95 dreamlike)
     data-bloom  neighbour bleed          (0 … .45)
     data-scan   raster sweep lift        (0 … .06)
     data-ink    base dot radius fraction (default .19)
   Scene content, where the scene reads it:
     data-text   marquee / hold
     data-lines  type            "A|B|C"
     data-labels bars            "CURIOSITY,WARMTH"
   ============================================================ */
(function (global) {
  'use strict';

  /* 5×7 engraving face — the display's own alphabet */
  const FONT = {
    A:'01110,10001,10001,11111,10001,10001,10001',B:'11110,10001,10001,11110,10001,10001,11110',
    C:'01110,10001,10000,10000,10000,10001,01110',D:'11110,10001,10001,10001,10001,10001,11110',
    E:'11111,10000,10000,11110,10000,10000,11111',F:'11111,10000,10000,11110,10000,10000,10000',
    G:'01110,10001,10000,10111,10001,10001,01111',H:'10001,10001,10001,11111,10001,10001,10001',
    I:'11111,00100,00100,00100,00100,00100,11111',J:'00111,00010,00010,00010,00010,10010,01100',
    K:'10001,10010,10100,11000,10100,10010,10001',L:'10000,10000,10000,10000,10000,10000,11111',
    M:'10001,11011,10101,10101,10001,10001,10001',N:'10001,11001,10101,10011,10001,10001,10001',
    O:'01110,10001,10001,10001,10001,10001,01110',P:'11110,10001,10001,11110,10000,10000,10000',
    Q:'01110,10001,10001,10001,10101,10010,01101',R:'11110,10001,10001,11110,10100,10010,10001',
    S:'01111,10000,10000,01110,00001,00001,11110',T:'11111,00100,00100,00100,00100,00100,00100',
    U:'10001,10001,10001,10001,10001,10001,01110',V:'10001,10001,10001,10001,01010,01010,00100',
    W:'10001,10001,10001,10101,10101,11011,10001',X:'10001,01010,01010,00100,01010,01010,10001',
    Y:'10001,10001,01010,00100,00100,00100,00100',Z:'11111,00001,00010,00100,01000,10000,11111',
    '0':'01110,10001,10011,10101,11001,10001,01110','1':'00100,01100,00100,00100,00100,00100,01110',
    '2':'01110,10001,00001,00010,00100,01000,11111','3':'11111,00010,00100,00010,00001,10001,01110',
    '4':'00010,00110,01010,10010,11111,00010,00010','5':'11111,10000,11110,00001,00001,10001,01110',
    '6':'00110,01000,10000,11110,10001,10001,01110','7':'11111,00001,00010,00100,01000,01000,01000',
    '8':'01110,10001,10001,01110,10001,10001,01110','9':'01110,10001,10001,01111,00001,00010,01100',
    '-':'00000,00000,00000,11111,00000,00000,00000','.':'00000,00000,00000,00000,00000,01100,01100',
    ':':'00000,01100,01100,00000,01100,01100,00000','/':'00001,00010,00010,00100,01000,01000,10000',
    '+':'00000,00100,00100,11111,00100,00100,00000','>':'01000,00100,00010,00001,00010,00100,01000',
    '?':'01110,10001,00001,00110,00100,00000,00100','!':'00100,00100,00100,00100,00100,00000,00100',
    "'":'00100,00100,00000,00000,00000,00000,00000',',':'00000,00000,00000,00000,01100,01100,01000',
    '%':'11001,11010,00010,00100,01000,01011,10011','×':'00000,10001,01010,00100,01010,10001,00000',
    ' ':'00000,00000,00000,00000,00000,00000,00000'
  };

  function hash(a, b, c) { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); }
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

  /* phosphor endpoints — never themed. glass is glass at noon and at midnight. */
  const PDIM = [42, 43, 42], PHOT = [239, 239, 237];

  class Display {
    constructor(cv, o) {
      o = o || {};
      this.cv = cv;
      this.cell = o.cell || 4;
      this.ink = o.ink != null ? o.ink : 0.19;
      this.inkLit = o.inkLit != null ? o.inkLit : 0.25;
      this.glow = o.glow != null ? o.glow : 0.84;
      /* Bloom bleeds a lit cell into its neighbours, and that bleed is always
         ONE CELL wide. At a 4px pitch that reads as a shimmer; at a 12px hero
         pitch the same rule paints a ring of large half-lit dots around every
         letter and the drawn type stops looking sharp. So bloom is attenuated
         as the pitch coarsens: full strength up to 5px, gone by 14px. */
      const bl = o.bloom != null ? o.bloom : 0.34;
      const c = o.cell || 4;
      this.bloom = c <= 5 ? bl : bl * Math.max(0, 1 - (c - 5) / 9);
      this.scan = o.scan != null ? o.scan : 0.05;
      this.s = {};            /* scene scratch — cleared on resize */
      this.ok = false;
      this.resize();
    }
    resize() {
      const cv = this.cv;
      if (!cv || !cv.isConnected) { this.ok = false; return false; }
      const r = cv.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) { this.ok = false; return false; }
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      this.ctx = cv.getContext('2d'); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = r.width; this.h = r.height;
      this.cols = Math.max(1, Math.floor(r.width / this.cell));
      this.rows = Math.max(1, Math.floor(r.height / this.cell));
      this.ox = (r.width - this.cols * this.cell) / 2;
      this.oy = (r.height - this.rows * this.cell) / 2;
      this.q = new Float32Array(this.cols * this.rows);
      this.b = new Float32Array(this.cols * this.rows);
      this.s = {};
      this.ok = true; return true;
    }
    clear() { if (this.ok) this.q.fill(0); }
    /* decay, don't erase — this is the whole material */
    fade(k) {
      if (!this.ok) return;
      const q = this.q, g = k == null ? this.glow : k;
      for (let i = 0; i < q.length; i++) { const v = q[i] * g; q[i] = v < 0.004 ? 0 : v; }
    }
    set(x, y, v) {
      if (!this.ok) return;
      x = x | 0; y = y | 0;
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const i = y * this.cols + x; if (v > this.q[i]) this.q[i] = v;
    }
    add(x, y, v) {
      if (!this.ok) return;
      x = x | 0; y = y | 0;
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const i = y * this.cols + x; this.q[i] = clamp01(this.q[i] + v);
    }
    get(x, y) { return (!this.ok || x < 0 || y < 0 || x >= this.cols || y >= this.rows) ? 0 : this.q[(y | 0) * this.cols + (x | 0)]; }
    hline(x0, x1, y, v) { for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, v); }
    vline(x, y0, y1, v) { for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, v); }
    fill(x0, y0, w, h, v) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(x0 + x, y0 + y, v); }
    frame(x0, y0, w, h, v) {
      this.hline(x0, x0 + w - 1, y0, v); this.hline(x0, x0 + w - 1, y0 + h - 1, v);
      this.vline(x0, y0, y0 + h - 1, v); this.vline(x0 + w - 1, y0, y0 + h - 1, v);
    }
    disc(cx, cy, r, v, soft) {
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        this.set(cx + dx, cy + dy, soft ? v * Math.pow(1 - d / r, 1.5) : v);
      }
    }
    /* a dotted run between two points — the language's mark for a relationship */
    link(x0, y0, x1, y1, v, step) {
      const d = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
      for (let i = 1; i < d; i += (step || 2)) { const k = i / d; this.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, v); }
    }
    measure(str) { return String(str).length * 6 - 1; }
    text(str, ox, oy, v) {
      let cx = Math.round(ox);
      const s = String(str).toUpperCase();
      for (let n = 0; n < s.length; n++) {
        const g = (FONT[s[n]] || FONT[' ']).split(',');
        for (let r = 0; r < 7; r++) { const row = g[r]; for (let c = 0; c < 5; c++) if (row[c] === '1') this.set(cx + c, oy + r, v); }
        cx += 6;
      }
    }
    textC(str, y, v) { this.text(str, Math.round((this.cols - this.measure(str)) / 2), y, v); }
    /* the cells a block of text would occupy — for reveal / erase animations */
    cellsOf(lines, y0) {
      const n = lines.length, bh = n * 9 - 2;
      const oy = y0 != null ? y0 : Math.round((this.rows - bh) / 2), out = [];
      lines.forEach((l, i) => {
        const ox = Math.round((this.cols - this.measure(l)) / 2), s = String(l).toUpperCase();
        for (let k = 0; k < s.length; k++) {
          const g = (FONT[s[k]] || FONT[' ']).split(',');
          for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') out.push([ox + k * 6 + c, oy + i * 9 + r]);
        }
      });
      return out;
    }
    draw(t) {
      if (!this.ok) return;
      const { ctx, cell, cols, rows, ox, oy, q, b, ink, inkLit, bloom } = this;
      if (bloom > 0) {
        for (let y = 0; y < rows; y++) {
          const yo = y * cols;
          for (let x = 0; x < cols; x++) {
            const i = yo + x;
            let m = 0;
            if (x > 0) m = q[i - 1];
            if (x < cols - 1 && q[i + 1] > m) m = q[i + 1];
            if (y > 0 && q[i - cols] > m) m = q[i - cols];
            if (y < rows - 1 && q[i + cols] > m) m = q[i + cols];
            const bv = m * bloom;
            b[i] = q[i] > bv ? q[i] : bv;
          }
        }
      } else { b.set(q); }
      const sweep = this.scan > 0 ? ((t || 0) * 0.028) % (rows + 24) - 12 : -99;
      ctx.clearRect(0, 0, this.w, this.h);
      for (let y = 0; y < rows; y++) {
        const near = sweep > -90 ? Math.abs(y - sweep) : 99;
        const lift = near < 2.2 ? this.scan * (1 - near / 2.2) : 0;
        const yo = y * cols, cy = oy + y * cell + cell / 2;
        for (let x = 0; x < cols; x++) {
          let c = b[yo + x] + lift;
          if (c > 1) c = 1;
          ctx.fillStyle = 'rgb(' + ((PDIM[0] + (PHOT[0] - PDIM[0]) * c) | 0) + ',' +
                                   ((PDIM[1] + (PHOT[1] - PDIM[1]) * c) | 0) + ',' +
                                   ((PDIM[2] + (PHOT[2] - PDIM[2]) * c) | 0) + ')';
          ctx.beginPath();
          ctx.arc(ox + x * cell + cell / 2, cy, cell * (ink + inkLit * c), 0, 6.2832);
          ctx.fill();
        }
      }
    }
  }

  /* CAP — rows reserved at the top of every well for the HTML caption
     overlay that sits on the glass. Scenes must not draw glyphs there. */
  const CAP = 9;

  /* Re-pack lines onto word boundaries so every line fits the panel.
     Only a single word longer than the panel is ever cut. */
  function reflow(d, lines, pad) {
    const max = Math.max(6, d.cols - (pad == null ? 4 : pad));
    const chars = Math.max(1, Math.floor((max + 1) / 6));
    const out = [];
    lines.forEach(line => {
      const words = String(line).split(/\s+/).filter(Boolean);
      let cur = '';
      words.forEach(w => {
        if (w.length > chars) {
          if (cur) { out.push(cur); cur = ''; }
          for (let i = 0; i < w.length; i += chars) out.push(w.slice(i, i + chars));
          return;
        }
        const next = cur ? cur + ' ' + w : w;
        if (d.measure(next) <= max) cur = next;
        else { if (cur) out.push(cur); cur = w; }
      });
      if (cur) out.push(cur);
    });
    return out.length ? out : lines;
  }

  const scenes = {
    /* ambient — the system is on and nothing is being asked of it */
    field(d, t) {
      d.fade(0.86);
      const k = t * 0.00022;
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        const v = 0.5 + 0.26 * Math.sin(x * 0.21 + k * 3.1) + 0.24 * Math.sin(y * 0.29 - k * 2.2)
                      + 0.18 * Math.sin((x + y) * 0.16 + k * 1.4);
        const th = ((((y & 3) * 4 + ((x & 3) * 5 % 7)) % 16) + 0.5) / 16;
        if (v > 0.52 + th * 0.42) d.set(x, y, 0.35 + 0.5 * (v - 0.5));
      }
      d.draw(t);
    },
    /* listening / live idle */
    pulse(d, t) {
      d.fade(0.80);
      const cx = (d.cols - 1) / 2, cy = (d.rows - 1) / 2;
      const r = (t * 0.006) % (Math.max(d.cols, d.rows) * 0.6);
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        const near = Math.abs(dist - r);
        if (near < 1.4) d.set(x, y, 1 - near / 1.4);
        else if (dist < 1.6) d.set(x, y, 0.9);
        else d.set(x, y, 0.10);
      }
      d.draw(t);
    },
    /* reading — a row scan crossing the panel */
    scan(d, t) {
      d.fade(0.82);
      const row = Math.floor(t / 90) % d.rows;
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        if (hash(3, x, y) > 0.86) d.set(x, y, 0.16);
      }
      d.hline(0, d.cols - 1, row, 1);
      d.hline(0, d.cols - 1, (row - 1 + d.rows) % d.rows, 0.4);
      d.draw(t);
    },
    /* searching */
    radar(d, t) {
      d.fade(0.88);
      const cx = (d.cols - 1) / 2, cy = (d.rows - 1) / 2;
      const a = (t * 0.0016) % 6.2832;
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        let dd = (a - Math.atan2(y - cy, x - cx) + 12.566) % 6.2832;
        if (dd < 0.34) d.set(x, y, 1 - dd / 0.34);
        else if (hash(5, x, y) > 0.9) d.set(x, y, 0.18);
      }
      d.draw(t);
    },
    /* waiting, short and bounded */
    orbit(d, t) {
      d.fade(0.78);
      const n = 12, step = Math.floor(t / 100) % n;
      const cx = (d.cols - 1) / 2, cy = (d.rows - 1) / 2;
      const r = Math.min(d.cols, d.rows) * 0.3;
      for (let i = 0; i < n; i++) {
        const ang = i / n * 6.2832 - 1.5708;
        const k = (i - step + n) % n;
        d.disc(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r),
               1.3, k === 0 ? 1 : (k <= 2 ? 0.5 : 0.16), false);
      }
      d.draw(t);
    },
    /* computing — noise settling into order, then loosening again */
    resolve(d, t) {
      d.fade(0.84);
      const phase = (t % 4000) / 4000;
      const order = phase < 0.5 ? ease(phase * 2) : ease((1 - phase) * 2);
      const bw = Math.max(4, Math.round(d.cols * 0.34)), bh = Math.max(3, Math.round(d.rows * 0.34));
      const bx = Math.round((d.cols - bw) / 2), by = Math.round((d.rows - bh) / 2);
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        const inside = x >= bx && x < bx + bw && y >= by && y < by + bh;
        const n = hash(7, x, y + Math.floor(t / 150)) > 0.82;
        if (inside) d.set(x, y, 0.35 + 0.65 * order);
        else if (n) d.set(x, y, 0.5 * (1 - order));
      }
      d.draw(t);
    },
    /* determinate loading — a bayer wipe with an honest edge */
    wipe(d, t) {
      const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
      d.fade(0.80);
      const p = ((t % 3400) / 3400) * (d.cols + 10) - 5;
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
        const v = (p - x) / 7 + 0.5;
        d.set(x, y, v > (B4[y & 3][x & 3] + 0.5) / 16 ? 0.9 : 0.12);
      }
      d.draw(t);
    },
    /* the display saying something — data-text */
    marquee(d, t, cv) {
      d.fade(0.72);
      const txt = ((cv && cv.dataset.text) || 'FIELD UNIT · THE DISPLAY SPEAKS IN DOTS · ').toUpperCase();
      const w = d.measure(txt) + 12;
      const off = Math.round((t * 0.022) % w);
      const y = Math.round((d.rows - 7) / 2);
      d.text(txt, -off, y, 0.95);
      d.text(txt, -off + w, y, 0.95);
      d.draw(t);
    },
    /* a note arriving line by line — data-lines "A|B|C".
       A line too wide for the panel is re-packed on WORD boundaries, never
       sliced: a broken word in a display reads as a bug, not as a style. */
    type(d, t, cv) {
      const raw = (cv && cv.dataset.lines) || 'IT WROTE THIS|WHILE YOU|WERE AWAY';
      const LINES = reflow(d, raw.split('|').map(s => s.trim().toUpperCase()));
      const PER = 2200, ONE = LINES.length * PER + 2400, p = t % ONE;
      d.fade(0.93);
      for (let i = 0; i < 20; i++) {
        d.set(Math.round((hash(83, i, 0) * d.cols + t * 0.0014) % d.cols),
              Math.round(hash(85, i, 0) * d.rows), 0.13);
      }
      const idx = Math.floor(p / PER);
      if (idx < LINES.length) {
        const lp = (p % PER) / PER;
        const v = lp < 0.2 ? ease(lp / 0.2) : (lp > 0.74 ? 1 - ease((lp - 0.74) / 0.26) : 1);
        d.textC(LINES[idx], Math.round(d.rows / 2) - 3, v * 0.95);
      }
      d.draw(t);
    },
    /* relationships — activation spreading two hops through a graph */
    net(d, t) {
      d.fade(0.83);
      if (!d.s.nodes) {
        const N = 7, nodes = [];
        for (let i = 0; i < N; i++) nodes.push([2 + Math.round(hash(71, i, 0) * (d.cols - 5)), CAP + Math.round(hash(73, i, 0) * (d.rows - CAP - 3))]);
        d.s.nodes = nodes;
        d.s.links = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6]];
      }
      const { nodes, links } = d.s, p = (t % 5000) / 5000;
      links.forEach(l => d.link(nodes[l[0]][0], nodes[l[0]][1], nodes[l[1]][0], nodes[l[1]][1], 0.13, 2));
      const h1 = clamp01(p / 0.34), h2 = clamp01((p - 0.36) / 0.34);
      nodes.forEach((n, i) => {
        const lit = i === 0 ? 0.55 + 0.45 * Math.sin(p * 12.566) : (i < 4 ? 0.2 + 0.7 * h1 : 0.2 + 0.65 * h2);
        d.disc(n[0], n[1], 1.6, Math.min(0.95, lit), false);
      });
      links.forEach(l => {
        const k = l[0] === 0 ? h1 : h2;
        if (k <= 0 || k >= 1) return;
        const A = nodes[l[0]], B = nodes[l[1]], e = ease(k);
        d.disc(Math.round(A[0] + (B[0] - A[0]) * e), Math.round(A[1] + (B[1] - A[1]) * e), 1.1, 1, false);
      });
      d.draw(t);
    },
    /* transfer — a thing leaves, crosses, and arrives */
    travel(d, t) {
      d.fade(0.80);
      const y = Math.round((d.rows + CAP) / 2), x0 = 5, x1 = d.cols - 6;
      d.link(x0, y, x1, y, 0.13, 3);
      d.fill(x0 - 3, y - 1, 3, 3, 0.7);
      d.frame(x1, y - 3, 6, 7, 0.5);
      const p = (t % 4200) / 4200;
      if (p < 0.62) d.disc(Math.round(x0 + (x1 - x0) * ease(p / 0.62)), y, 1.3, 0.95, false);
      else { d.frame(x1, y - 3, 6, 7, 0.95); d.set(x1 + 2, y, 1); d.set(x1 + 3, y, 1); }
      d.draw(t);
    },
    /* state — levels drifting against a threshold. data-labels.
       Labels are 7 dot rows each, so a labelled stack of n needs about
       CAP + 9n rows — roughly 180px at cell 4 for four of them — and
       enough width left over for a real bar track. Rather than chop text
       to fit, the scene drops to a compact unlabelled stack: the same
       reading, honestly smaller. */
    bars(d, t, cv) {
      const labels = ((cv && cv.dataset.labels) || 'LEVEL A,LEVEL B,LEVEL C,LEVEL D')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      d.fade(0.88);
      const n = labels.length;
      if (!n) { d.draw(t); return; }
      const level = i => clamp01(0.4 + 0.26 * Math.sin(t * (0.00013 + i * 0.00004) + i * 1.7)
                                     + 0.08 * Math.sin(t * 0.0005 + i));
      const sel = 0.46 + 0.16 * Math.sin(t * 0.00015);

      const availL = d.rows - CAP - 8;
      let pitch = 9;
      while (pitch > 7 && n * pitch > availL) pitch--;
      let widest = 0; labels.forEach(l => { widest = Math.max(widest, d.measure(l)); });
      /* Gate on what actually has to stay readable — the bar track that
         survives the label column — not on a fixed fraction of the panel.
         A long label on a wide panel is fine; a short one on a narrow panel
         is not, and a percentage cap gets both of those backwards. */
      const track = d.cols - widest - 9;

      if (track >= 20 && n * pitch <= availL) {
        const barX = widest + 5, barW = Math.max(6, d.cols - barX - 4);
        const sx = barX + Math.round(barW * sel);
        for (let y = CAP - 3; y < CAP + n * pitch; y += 2) d.set(sx, y, 0.3);
        labels.forEach((lab, i) => {
          const y = CAP + i * pitch;
          const v = level(i), over = v > sel, w = Math.round(barW * v);
          d.text(lab, 2, y, over ? 0.85 : 0.32);
          for (let x = 0; x < barW; x++) d.set(barX + x, y + 3, x < w ? (over ? 0.9 : 0.42) : 0.09);
          d.set(barX + w, y + 2, over ? 1 : 0.5); d.set(barX + w, y + 4, over ? 1 : 0.5);
        });
      } else {
        const avail = Math.max(4, d.rows - CAP - 3);
        const pc = Math.max(2, Math.min(5, Math.floor(avail / n)));
        const shown = Math.max(1, Math.min(n, Math.floor(avail / pc)));
        const top = CAP + Math.max(0, Math.round((avail - shown * pc) / 2));
        const barX = 3, barW = Math.max(6, d.cols - barX - 4);
        const sx = barX + Math.round(barW * sel);
        for (let y = top - 2; y < top + shown * pc + 1; y += 2) d.set(sx, y, 0.34);
        for (let i = 0; i < shown; i++) {
          const y = top + i * pc, v = level(i), over = v > sel, w = Math.round(barW * v);
          for (let x = 0; x < barW; x++) d.set(barX + x, y, x < w ? (over ? 0.95 : 0.44) : 0.09);
          d.set(barX + w, y, 1);
        }
      }
      d.draw(t);
    },
    /* scarcity — a few real things buried by a flood, then still there */
    burial(d, t) {
      const SETTLE = 2200, POUR = 3600, HOLD = 1800, DRAIN = 2600, ONE = SETTLE + POUR + HOLD + DRAIN;
      const p = t % ONE;
      if (!d.s.core) {
        d.s.core = [];
        for (let i = 0; i < 12; i++) d.s.core.push([
          Math.round(4 + ((i % 6) + 0.5) * (d.cols - 8) / 6),
          Math.round(CAP + 2 + (Math.floor(i / 6) + 0.5) * (d.rows - CAP - 6) / 2)
        ]);
      }
      if (p < SETTLE) {
        d.fade(0.84);
        const a = ease(p / SETTLE);
        d.s.core.forEach((c, i) => { if (i / 12 <= a + 0.02) d.disc(c[0], c[1], 1.5, 0.95, false); });
      } else if (p < SETTLE + POUR) {
        d.fade(0.90);
        const a = (p - SETTLE) / POUR, n = Math.round(50 + a * a * 420);
        for (let i = 0; i < n; i++) d.add(Math.round(hash(53, i, Math.floor(t / 90)) * d.cols),
                                          Math.round(hash(59, i, Math.floor(t / 90)) * d.rows), 0.1 + 0.32 * hash(61, i, 0));
        d.s.core.forEach(c => d.disc(c[0], c[1], 1.5, 0.95, false));
      } else if (p < SETTLE + POUR + HOLD) {
        d.fade(0.985);
        for (let i = 0; i < 360; i++) d.add(Math.round(hash(53, i, 7) * d.cols), Math.round(hash(59, i, 7) * d.rows), 0.02);
      } else {
        d.fade(0.86);
        d.s.core.forEach(c => d.disc(c[0], c[1], 1.5, 0.95, false));
      }
      d.draw(t);
    },
    /* loss — written, held, erased by a bar. nothing accumulates. data-text */
    hold(d, t, cv) {
      const FORM = 2000, KEEP = 1500, WIPE = 900, ONE = FORM + KEEP + WIPE, p = t % ONE;
      d.fade(0.84);
      const txt = ((cv && cv.dataset.text) || 'NOT KEPT').toUpperCase();
      const lines = reflow(d, [txt]);
      const cells = d.cellsOf(lines);
      const ys = cells.length ? cells[0][1] : Math.round(d.rows / 2);
      const bh = lines.length * 9 - 2;
      if (p < FORM) {
        const n = Math.round(ease(p / FORM) * cells.length);
        for (let i = 0; i < n; i++) d.set(cells[i][0], cells[i][1], 1);
      } else if (p < FORM + KEEP) {
        cells.forEach(c => d.set(c[0], c[1], 1));
      } else {
        const bar = ys - 3 + ((p - FORM - KEEP) / WIPE) * (bh + 8);
        cells.forEach(c => { if (c[1] > bar) d.set(c[0], c[1], 1); });
        d.hline(0, d.cols - 1, Math.round(bar), 0.55);
      }
      d.draw(t);
    }
  };

  /* per-scene defaults — a scene knows what glass it wants */
  const PRESETS = {
    field:   { cell: 4, glow: .86, bloom: .30, scan: .04 },
    pulse:   { cell: 4, glow: .80, bloom: .36, scan: .05 },
    scan:    { cell: 4, glow: .82, bloom: .30, scan: .05 },
    radar:   { cell: 4, glow: .88, bloom: .34, scan: .04 },
    orbit:   { cell: 4, glow: .78, bloom: .38, scan: .05 },
    resolve: { cell: 4, glow: .84, bloom: .30, scan: .04 },
    wipe:    { cell: 4, glow: .80, bloom: .24, scan: .04 },
    marquee: { cell: 5, glow: .72, bloom: .34, scan: .04, inkLit: .27 },
    type:    { cell: 4, glow: .93, bloom: .42, scan: .03, ink: .175, inkLit: .28 },
    net:     { cell: 4, glow: .83, bloom: .40, scan: .05, inkLit: .27 },
    travel:  { cell: 4, glow: .80, bloom: .34, scan: .05 },
    bars:    { cell: 4, glow: .88, bloom: .26, scan: .035, ink: .18 },
    burial:  { cell: 4, glow: .88, bloom: .30, scan: .035, inkLit: .26 }
  };

  function cfgFrom(cv) {
    const o = {}, n = k => cv.dataset[k] != null ? parseFloat(cv.dataset[k]) : undefined;
    ['cell', 'ink', 'inkLit', 'glow', 'bloom', 'scan'].forEach(k => { const v = n(k); if (v != null && !isNaN(v)) o[k] = v; });
    return o;
  }

  /* mount(root, opts) — find every canvas[data-scene], give each a real
     settle frame immediately, gate animation on visibility, and run one
     shared ~26fps loop. Returns {stop, settle, items}. */
  function mount(root, opts) {
    root = root || document;
    opts = opts || {};
    const reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const all = Object.assign({}, scenes, opts.scenes || {});
    const items = [];
    root.querySelectorAll('canvas[data-scene]').forEach(cv => {
      const fn = all[cv.dataset.scene];
      if (!fn) return;
      const cfg = Object.assign({}, PRESETS[cv.dataset.scene] || {}, cfgFrom(cv));
      items.push({ cv, fn, d: new Display(cv, cfg), live: true, seed: cv.dataset.seed ? +cv.dataset.seed : 3000 });
    });
    if (!items.length) return { items, stop() { }, settle() { } };

    let io = null;
    if ('IntersectionObserver' in global) {
      const map = new Map(items.map(it => [it.cv, it]));
      items.forEach(it => it.live = false);
      io = new IntersectionObserver(es => es.forEach(e => { const it = map.get(e.target); if (it) it.live = e.isIntersecting; }),
        { threshold: 0.01, rootMargin: '120px' });
      items.forEach(it => io.observe(it.cv));
    }

    /* one real frame before any loop — so nothing is ever blank glass in a
       screenshot, a throttled tab, or under reduced motion */
    const settle = () => items.forEach(it => {
      it.d.resize();
      if (it.d.ok) { it.d.clear(); try { it.fn(it.d, it.seed, it.cv); } catch (e) { } }
    });
    settle();

    let rz, raf = 0;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(settle, 140); };
    global.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);

    if (!reduce && opts.animate !== false) {
      let last = 0;
      const loop = t => {
        raf = requestAnimationFrame(loop);
        if (t - last < 38) return;
        last = t;
        for (const it of items) if (it.live && it.d.ok) { try { it.fn(it.d, t, it.cv); } catch (e) { } }
      };
      raf = requestAnimationFrame(loop);
    }
    return {
      items, settle,
      stop() { cancelAnimationFrame(raf); global.removeEventListener('resize', onResize); if (io) io.disconnect(); }
    };
  }

  global.DotDisplay = { Display, FONT, scenes, PRESETS, mount, reflow, hash, clamp01, ease, CAP };
})(window);
