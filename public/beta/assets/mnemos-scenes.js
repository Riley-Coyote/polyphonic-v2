/* ============================================================
   MNEMOS — display scenes  ·  rev 01
   Registers onto the shared engine. Load AFTER dot-display.js:

     <script src="dot-display.js"></script>
     <script src="mnemos-scenes.js"></script>

   memory    the cover scene. a mind's graph: traces forming,
             linking, being reached for, and softening. the only
             image the brand has, so it has to carry a page.
   headline  hero-scale generated dot type from data-text.
   ============================================================ */
(function () {
  'use strict';
  var DD = window.DotDisplay;
  if (!DD) { console.error('mnemos-scenes: dot-display.js must load first'); return; }

  var hash = DD.hash, ease = DD.ease, CAP = DD.CAP;

  /* a soft ellipse of charge — the recall ring */
  function ring(d, cx, cy, r, v, squash) {
    var steps = Math.max(16, Math.round(r * 5)), i, a;
    for (i = 0; i < steps; i++) {
      a = i / steps * 6.2832;
      d.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * (squash || 0.7), v);
    }
  }

  /* breadth-first hop levels from a seed, over the CURRENT geometry.
     recomputed every wave, because the nodes drift and the graph
     genuinely reorganises — that is the part worth watching. */
  function hops(nodes, s, LR) {
    var lev = nodes.map(function () { return -1; }), frontier = [s], next, i, j, depth = 0;
    lev[s] = 0;
    while (frontier.length && depth < 6) {
      next = [];
      for (i = 0; i < frontier.length; i++) {
        for (j = 0; j < nodes.length; j++) {
          if (lev[j] !== -1) continue;
          if (Math.hypot(nodes[j].x - nodes[frontier[i]].x, nodes[j].y - nodes[frontier[i]].y) <= LR) {
            lev[j] = depth + 1; next.push(j);
          }
        }
      }
      frontier = next; depth++;
    }
    return lev;
  }

  DD.scenes.memory = function (d, t, cv) {
    var S = d.s, i, j, k, n, a, b, dist, near, act, v, w;
    var bias = cv && cv.dataset.bias;                 /* "tr" keeps the lower-left clear for type */
    var top = CAP + 1, bot = d.rows - 3, H = Math.max(8, bot - top);

    if (!S.nodes || S.cols !== d.cols || S.rows !== d.rows) {
      S.cols = d.cols; S.rows = d.rows;
      var N = Math.max(13, Math.min(24, Math.round(d.cols / 5)));
      var x0 = bias === 'tr' ? 0.34 : 0.06, xs = bias === 'tr' ? 0.60 : 0.88;
      var y0 = 0.04, ys = bias === 'tr' ? 0.60 : 0.92;
      S.nodes = [];
      for (i = 0; i < N; i++) {
        S.nodes.push({
          hx: x0 + hash(i, 7, 3) * xs,
          hy: y0 + hash(i, 19, 11) * ys,
          fx: 0.000085 + hash(i, 3, 29) * 0.00017,
          fy: 0.000070 + hash(i, 31, 5) * 0.00015,
          ph: hash(i, 41, 17) * 6.2832,
          amp: 0.016 + hash(i, 13, 23) * 0.038,
          base: 0.42 + hash(i, 53, 9) * 0.44,
          a: 0
        });
      }
      S.x0 = x0; S.xs = xs; S.y0 = y0; S.ys = ys;
      S.waves = [{ t0: -1e9, lev: null, seed: 0 }, { t0: -1e9, lev: null, seed: 0 }, { t0: -1e9, lev: null, seed: 0 }];
      S.wi = 0; S.nextAt = 0; S.ep = -1;
    }

    var nodes = S.nodes, NN = nodes.length;
    var LR = Math.max(14, Math.min(d.cols * 0.26, 40));
    var rot = t * 0.0000075;                            /* one turn in ~15 minutes */
    var ca = Math.cos(rot), sa = Math.sin(rot);
    var ccx = d.cols / 2, ccy = top + H / 2;

    d.fade(0.93);

    /* the substrate: a static dither field, breathing under a slow travelling
       wave. set() rather than add(), so the field holds an exact brightness
       instead of accumulating against the retention and blowing out — and so
       every mark above it still wins on contrast. */
    var W = d.cols, x, y, s2, nz;
    for (y = top; y < bot; y++) {
      for (x = 1; x < W - 1; x++) {
        nz = hash(x, y, 1);
        if (nz < 0.60) continue;
        s2 = Math.sin((x * 0.17 + y * 0.12) - t * 0.00052);
        d.set(x, y, 0.045 + (nz - 0.60) * 0.20 + 0.070 * (0.5 + 0.5 * s2));
      }
    }

    /* positions */
    for (i = 0; i < NN; i++) {
      n = nodes[i];
      var px = n.hx + Math.sin(t * n.fx + n.ph) * n.amp - 0.5;
      var py = n.hy + Math.cos(t * n.fy + n.ph * 1.7) * n.amp - 0.5;
      var rx = px * ca - py * sa, ry = px * sa + py * ca;
      n.x = ccx + rx * (d.cols - 4);
      n.y = ccy + ry * H;
    }

    /* three overlapping waves of recall, so the graph is never still.
       each is recomputed against the CURRENT geometry, because the nodes
       drift and the graph genuinely reorganises — that is the part
       worth watching. */
    if (t >= S.nextAt) {
      S.wi++;
      w = S.waves[S.wi % 3];
      w.seed = Math.floor(hash(S.wi, 91, 13) * NN) % NN;
      w.lev = hops(nodes, w.seed, LR);
      w.t0 = t;
      S.nextAt = t + 1250 + hash(S.wi, 7, 3) * 1250;
    }
    for (i = 0; i < NN; i++) {
      a = 0;
      for (k = 0; k < 3; k++) {
        w = S.waves[k];
        if (!w.lev) continue;
        var L = w.lev[i];
        if (L < 0) continue;
        var dt = (t - w.t0) - L * 290;
        if (dt > -240 && dt < 1500) {
          v = 1 - Math.abs(dt - 270) / 900;
          if (v > a) a = v;
        }
      }
      nodes[i].a = a < 0 ? 0 : a;
    }

    /* links — brightness is proximity plus whatever is firing through them */
    for (i = 0; i < NN; i++) {
      for (j = i + 1; j < NN; j++) {
        a = nodes[i]; b = nodes[j];
        dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist > LR) continue;
        near = 1 - dist / LR;
        act = a.a > b.a ? a.a : b.a;
        v = 0.30 * near + 0.70 * act * near;
        if (v > 0.03) d.link(a.x, a.y, b.x, b.y, v, 2);
      }
    }

    /* the ring each recall leaves behind */
    for (k = 0; k < 3; k++) {
      w = S.waves[k];
      if (!w.lev) continue;
      var age = t - w.t0;
      if (age < 0 || age > 2100) continue;
      n = nodes[w.seed];
      v = 0.42 * (1 - age / 2100);
      if (v > 0.02) ring(d, n.x, n.y, age * 0.019, v, 0.74);
    }

    /* the traces themselves */
    for (i = 0; i < NN; i++) {
      n = nodes[i];
      s2 = n.base + n.a * 0.58;
      if (s2 > 1) s2 = 1;
      d.disc(n.x, n.y, 1.6 + n.base * 1.8 + n.a * 2.2, s2 * 0.95, true);
      d.set(n.x, n.y, 1);
    }

    /* every eleven seconds: what was reached for strengthens, everything
       else softens, and the weakest trace goes out and reappears new. */
    var EPOCH = 11000, ep = Math.floor(t / EPOCH);
    if (S.ep !== ep) {
      if (S.ep >= 0) {
        for (i = 0; i < NN; i++) nodes[i].base = Math.max(0.28, nodes[i].base - 0.020);
        for (k = 0; k < 3; k++) {
          w = S.waves[k];
          if (!w.lev) continue;
          for (i = 0; i < NN; i++) if (w.lev[i] >= 0) nodes[i].base = Math.min(0.88, nodes[i].base + 0.034);
        }
        var wk = 0;
        for (i = 0; i < NN; i++) if (nodes[i].base < nodes[wk].base) wk = i;
        nodes[wk].hx = S.x0 + hash(ep, wk, 7) * S.xs;
        nodes[wk].hy = S.y0 + hash(ep, wk, 19) * S.ys;
        nodes[wk].base = 0.32;
      }
      S.ep = ep;
    }

    d.draw(t);
  };

  /* hero-scale dot type. one phrase, dithered in, held, dithered out. */
  DD.scenes.headline = function (d, t, cv) {
    var raw = (cv && cv.dataset.text) || 'MEMORY VERIFIED';
    var S = d.s, k, c;
    if (!S.cells || S.key !== raw + '|' + d.cols + 'x' + d.rows) {
      S.key = raw + '|' + d.cols + 'x' + d.rows;
      var lines = DD.reflow(d, String(raw).toUpperCase().split('|').map(function (s) { return s.trim(); }), 4);
      var bh = lines.length * 9 - 2;
      var oy = Math.max(CAP, Math.round((d.rows - bh) / 2));
      S.cells = d.cellsOf(lines, oy);
      S.order = S.cells.map(function (v, i) { return i; })
        .sort(function (a, b) { return hash(a, 7, 1) - hash(b, 7, 1); });
    }
    d.fade(0.90);
    var CYCLE = 9200, p = t % CYCLE, n = S.order.length, on;
    if (p < 1500) on = Math.floor(n * ease(p / 1500));
    else if (p < 7600) on = n;
    else on = Math.floor(n * (1 - ease((p - 7600) / 1600)));
    for (k = 0; k < on; k++) { c = S.cells[S.order[k]]; d.set(c[0], c[1], 1); }
    d.draw(t);
  };

  DD.PRESETS.memory = { cell: 12, glow: .93, bloom: .30, scan: .026, ink: .150, inkLit: .32 };
  DD.PRESETS.headline = { cell: 7, glow: .90, bloom: .16, scan: .028, ink: .17, inkLit: .30 };

  DD.mnemos = true;
})();
