var LucaDots = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/shared/ui/dot-display/physics.ts
	/** Exported so the lab's readout ramps are built by the same code as the
	*  production ones — two ramp builders would drift. */
	function buildLut(stops) {
		const lut = new Uint8Array(256 * 3);
		for (let i = 0; i < 256; i++) {
			const t = i / 255;
			let a = stops[0];
			let b = stops[stops.length - 1];
			for (let s = 0; s < stops.length - 1; s++) if (t >= stops[s][0] && t <= stops[s + 1][0]) {
				a = stops[s];
				b = stops[s + 1];
				break;
			}
			const f = (t - a[0]) / (b[0] - a[0] || 1);
			lut[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * f | 0;
			lut[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f | 0;
			lut[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f | 0;
		}
		return lut;
	}
	/**
	* indigo whisper -> violet -> magenta -> coral -> amber -> white-hot.
	* Faithful to magnitude, but the cold end is a dark indigo that disappears on a
	* near-black floor. Correct for a large data display, wrong for a small mark.
	*/
	var MAGNITUDE_LUT = buildLut([
		[0, [
			38,
			48,
			116
		]],
		[.2, [
			104,
			54,
			182
		]],
		[.42, [
			196,
			58,
			150
		]],
		[.62, [
			240,
			96,
			86
		]],
		[.8, [
			250,
			168,
			66
		]],
		[1, [
			255,
			242,
			220
		]]
	]);
	/**
	* The ramp the app actually uses. Quiet events stay in near-ink greyscale so a
	* resting mark is still legible on the #060608 floor; colour only enters once
	* something of real magnitude has happened. This is what lets one ramp serve
	* both as an identity mark and as a live dial.
	*/
	var MAGNITUDE_LUT_INKFLOOR = buildLut([
		[0, [
			188,
			192,
			196
		]],
		[.3, [
			150,
			150,
			175
		]],
		[.5, [
			196,
			58,
			150
		]],
		[.72, [
			240,
			120,
			86
		]],
		[.88, [
			250,
			178,
			76
		]],
		[1, [
			255,
			244,
			226
		]]
	]);
	function usePile(p, key, preseed) {
		return p.useSim(key, () => {
			const n = p.W * p.H;
			const st = {
				grid: new Int16Array(n),
				delta: new Int16Array(n),
				scorch: new Float32Array(n),
				smag: new Float32Array(n),
				size: 0,
				scale: 0,
				inAvalanche: false,
				acc: 0,
				angle: 0
			};
			const cx = p.W >> 1;
			const cy = p.H >> 1;
			for (let k = 0; k < preseed; k++) {
				st.grid[cy * p.W + cx]++;
				let guard = 0;
				while (sweepPile(p, st) > 0 && guard++ < 400);
			}
			st.scorch.fill(0);
			return st;
		});
	}
	/** One simultaneous toppling sweep. Abelian: order does not matter. */
	function sweepPile(p, st) {
		const { W, H } = p;
		st.delta.fill(0);
		let fired = 0;
		for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
			if (st.grid[i] < 4) continue;
			st.delta[i] -= 4;
			if (x > 0) st.delta[i - 1]++;
			if (x < W - 1) st.delta[i + 1]++;
			if (y > 0) st.delta[i - W]++;
			if (y < H - 1) st.delta[i + W]++;
			st.scorch[i] = 1;
			st.smag[i] = st.scale;
			fired++;
		}
		if (fired) for (let i = 0; i < st.grid.length; i++) st.grid[i] += st.delta[i];
		return fired;
	}
	function hasUnstable(st) {
		for (let i = 0; i < st.grid.length; i++) if (st.grid[i] >= 4) return true;
		return false;
	}
	/** Calibrates when an avalanche reads as "big". Avalanche sizes follow a power
	*  law, so a log scale is what keeps the common small ones from all mapping to
	*  the same cold value. */
	var SCALE_DEN = Math.log2(220);
	var scaleOf = (size) => Math.min(1, Math.max(0, Math.log2(size + 1) / SCALE_DEN) ** .82);
	/**
	* One critical field, many forcings. `pour` decides where grains land, which is
	* the only difference between thinking, working, remembering and resting.
	*
	* `key` namespaces the per-panel simulation state, so switching a panel between
	* two pile scenes cannot read the other one's grid back as garbage.
	*/
	function pileScene(key, rate, pour) {
		return (p, t) => {
			const st = usePile(p, key, 90);
			p.fade(.86);
			if (st.inAvalanche || hasUnstable(st)) {
				st.inAvalanche = true;
				const fired = sweepPile(p, st);
				st.size += fired;
				st.scale = scaleOf(st.size);
				if (!fired) {
					st.inAvalanche = false;
					st.size = 0;
				}
			} else {
				st.acc += rate / 60;
				while (st.acc >= 1) {
					const [x, y] = pour(p, st, t);
					const i = (y | 0) * p.W + (x | 0);
					if (i >= 0 && i < st.grid.length) st.grid[i]++;
					st.acc -= 1;
					st.scale = 0;
				}
			}
			for (let i = 0; i < st.grid.length; i++) {
				const g = st.grid[i];
				if (g > 0) {
					const v = .028 + .034 * Math.min(3, g);
					if (v > p.buf[i]) p.buf[i] = v;
				}
				const s = st.scorch[i];
				if (s > .004) {
					const v = s * .9;
					if (v > p.buf[i]) p.buf[i] = v;
					if (p.magnitude) p.magnitude[i] = st.smag[i] * s;
					st.scorch[i] = s * .9;
				} else if (s) {
					st.scorch[i] = 0;
					if (p.magnitude) p.magnitude[i] = 0;
				}
			}
		};
	}
	function makeDla(p) {
		const stuck = new Uint8Array(p.W * p.H);
		const age = new Float32Array(p.W * p.H);
		stuck[(p.H >> 1) * p.W + (p.W >> 1)] = 1;
		age[(p.H >> 1) * p.W + (p.W >> 1)] = 1;
		const walkers = [];
		const n = Math.max(6, Math.round(Math.min(p.W, p.H) * .7));
		for (let i = 0; i < n; i++) {
			const a = Math.random() * Math.PI * 2;
			walkers.push({
				x: (p.W - 1) / 2 + Math.cos(a) * 3,
				y: (p.H - 1) / 2 + Math.sin(a) * 3
			});
		}
		return {
			stuck,
			walkers,
			age,
			radius: 1,
			count: 1
		};
	}
	/**
	* Walkers stick to what is already remembered, so memory visibly accretes into
	* a dendrite. Slow and hypnotic, and — unusually for a fine-structured scene —
	* it survives 28px, because the branches are one cell wide either way.
	*/
	var dlaScene = (p) => {
		const st = p.useSim("dla", () => makeDla(p));
		p.fade(.9);
		const cx = (p.W - 1) / 2;
		const cy = (p.H - 1) / 2;
		const bound = Math.min(p.W, p.H) * .46;
		const neighbourStuck = (x, y) => {
			if (x > 0 && st.stuck[y * p.W + x - 1]) return true;
			if (x < p.W - 1 && st.stuck[y * p.W + x + 1]) return true;
			if (y > 0 && st.stuck[(y - 1) * p.W + x]) return true;
			if (y < p.H - 1 && st.stuck[(y + 1) * p.W + x]) return true;
			return false;
		};
		/** Release on a ring just outside the aggregate — the standard trick, and
		*  what makes growth read as radial rather than as scattered clumps. */
		const release = (w) => {
			const a = Math.random() * Math.PI * 2;
			const r = Math.min(bound, st.radius + 2.5);
			w.x = cx + Math.cos(a) * r;
			w.y = cy + Math.sin(a) * r;
		};
		for (let step = 0; step < 5; step++) for (const w of st.walkers) {
			const d = Math.random() * 4 | 0;
			if (d === 0) w.x += 1;
			else if (d === 1) w.x -= 1;
			else if (d === 2) w.y += 1;
			else w.y -= 1;
			const rr = Math.hypot(w.x - cx, w.y - cy);
			if (rr > bound + 4) {
				release(w);
				continue;
			}
			const ix = Math.round(w.x);
			const iy = Math.round(w.y);
			if (ix < 0 || iy < 0 || ix >= p.W || iy >= p.H) {
				release(w);
				continue;
			}
			if (step === 4) p.add(ix, iy, .22);
			if (neighbourStuck(ix, iy)) {
				const i = iy * p.W + ix;
				st.stuck[i] = 1;
				st.age[i] = 1;
				st.radius = Math.max(st.radius, rr);
				st.count++;
				release(w);
			}
		}
		if (st.radius >= bound - 1 || st.count > p.W * p.H * .3) Object.assign(st, makeDla(p));
		for (let i = 0; i < st.stuck.length; i++) {
			if (!st.stuck[i]) continue;
			const a = st.age[i];
			const v = .3 + .68 * a;
			if (v > p.buf[i]) p.buf[i] = v;
			if (p.magnitude) p.magnitude[i] = .2 + .7 * a;
			if (a > .001) st.age[i] = a * .985;
		}
	};
	//#endregion
	//#region \0@oxc-project+runtime@0.133.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.133.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.133.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.133.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	//#endregion
	//#region src/shared/ui/dot-display/engine.ts
	/**
	* Persistent-phosphor dot-matrix engine.
	*
	* Ported from the Luca/Mnemos design prototype. Two properties give it its
	* character and must not be "simplified" away:
	*
	* 1. The charge buffer is multiplied down between frames and never cleared, so
	*    marks decay like phosphor instead of blinking out. Scenes add charge; the
	*    fade is what produces the trails.
	* 2. Everything is computed in DEVICE pixels on an integer lattice. A dot drawn
	*    at a fractional device pixel is antialiased, and a grid of antialiased dots
	*    reads as crooked and soft no matter how good the pattern is. So the cell
	*    pitch is a whole number of device pixels, the grid origin is an integer,
	*    and every dot is an integer rect.
	*
	* Scenes are pure functions of (panel, elapsed-ms), addressed in dot cells
	* rather than pixels, so the same scene works at 28px in a rail and at 300px on
	* a board.
	*/
	/** Identity is stable per seed: same public key, same mark, forever. */
	function seeded$1(input) {
		const str = String(input);
		let h = 1779033703 ^ str.length;
		for (let i = 0; i < str.length; i++) {
			h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
			h = h << 13 | h >>> 19;
		}
		return () => {
			h = Math.imul(h ^ h >>> 16, 2246822507);
			h = Math.imul(h ^ h >>> 13, 3266489909);
			h ^= h >>> 16;
			return (h >>> 0) / 4294967296;
		};
	}
	var DEFAULT_CELL = 4;
	/** Below this, a cell is treated as carrying no event at all and is drawn in
	*  plain ink rather than sampled from the colour ramp. See `draw`. */
	var MAGNITUDE_EPSILON = .02;
	/**
	* Derive a resident's emblem from their public key. Pure and deterministic —
	* the same key yields the same mark forever, which is the whole point of an
	* identity mark. Split out from the panel so it is testable without a canvas.
	*
	* The pattern is half-width and mirrored, so a mark reads as an emblem rather
	* than as noise.
	*/
	function sigilPattern(seed) {
		const rnd = seeded$1(seed);
		const PW = 4;
		const PH = 7;
		let grid = [];
		let lit = 0;
		let tries = 0;
		do {
			grid = [];
			lit = 0;
			for (let y = 0; y < PH; y++) {
				const row = [];
				let rowLit = 0;
				for (let x = 0; x < PW; x++) {
					const on = rnd() < .5 ? 1 : 0;
					row.push(on);
					if (on) rowLit++;
				}
				if (!rowLit) {
					row[Math.floor(rnd() * PW)] = 1;
					rowLit = 1;
				}
				for (let k = 0; k < PW; k++) if (row[k]) lit += k === PW - 1 ? 1 : 2;
				grid.push(row);
			}
			tries++;
		} while ((lit / (PH * (PW * 2 - 1)) < .4 || lit / (PH * (PW * 2 - 1)) > .6) && tries < 24);
		return {
			grid,
			patternWidth: PW,
			patternHeight: PH,
			phase: rnd() * 6.28
		};
	}
	var DotPanel = class {
		/** Allocate the magnitude channel and attach a LUT. Idempotent. */
		enableMagnitude(lut) {
			this.lut = lut;
			if (!this.magnitude || this.magnitude.length !== this.buf.length) this.magnitude = new Float32Array(this.buf.length);
		}
		disableMagnitude() {
			this.lut = null;
			this.magnitude = null;
		}
		/** Scene-owned state, allocated once per (panel, scene) pair. */
		useSim(key, create) {
			if (!this.sim || this.sim.key !== key) this.sim = {
				key,
				state: create()
			};
			return this.sim.state;
		}
		constructor(canvas, options = {}) {
			_defineProperty(this, "canvas", void 0);
			_defineProperty(this, "ctx", void 0);
			_defineProperty(this, "scene", void 0);
			_defineProperty(this, "visible", true);
			_defineProperty(this, "opt", void 0);
			_defineProperty(this, "startedAt", void 0);
			_defineProperty(
				this,
				/** Lattice dimensions, in cells. */
				"W",
				0
			);
			_defineProperty(this, "H", 0);
			_defineProperty(
				this,
				/** Charge buffer and the scratch buffer used by the bloom pass. */
				"buf",
				new Float32Array(0)
			);
			_defineProperty(this, "bloomBuf", new Float32Array(0));
			_defineProperty(this, "cellPx", DEFAULT_CELL);
			_defineProperty(this, "originX", 0);
			_defineProperty(this, "originY", 0);
			_defineProperty(this, "canvasW", 0);
			_defineProperty(this, "canvasH", 0);
			_defineProperty(
				this,
				/** Memoised sigil pattern. The only per-scene cache the engine itself owns —
				*  physics-carrying scenes use the generic `sim` slot below. */
				"sigil",
				null
			);
			_defineProperty(
				this,
				/**
				* Free-form per-panel simulation state, for scenes that carry a physics
				* (sandpiles, wave fields, aggregates). Keyed by scene so switching scenes
				* cannot read another scene's memory back as garbage.
				*/
				"sim",
				null
			);
			_defineProperty(
				this,
				/**
				* Optional per-cell magnitude, 0..1, paired with a 256-entry RGB lookup
				* table. When both are present `draw` colours each dot by its magnitude
				* instead of the flat ink — "how much just moved" as a live dial. Left null,
				* the panel stays monochrome.
				*/
				"magnitude",
				null
			);
			_defineProperty(this, "lut", null);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("dot-display: 2d context unavailable");
			this.canvas = canvas;
			this.ctx = ctx;
			this.scene = canvas.dataset.scene || "listen";
			this.startedAt = performance.now() - (Number(canvas.dataset.phase) || 0);
			this.opt = {
				glow: .88,
				bloom: 0,
				glass: "transparent",
				dot: "239,239,237",
				cell: DEFAULT_CELL,
				level: .5,
				breath: false,
				seed: "luca",
				...options
			};
			this.resize();
		}
		/** Recompute the lattice. Returns false while the canvas has no layout box. */
		resize() {
			const rect = this.canvas.getBoundingClientRect();
			if (!rect.width || !rect.height) return false;
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			const cw = Math.round(rect.width * dpr);
			const ch = Math.round(rect.height * dpr);
			const cell = Math.max(2, Math.round(this.opt.cell * dpr));
			const W = Math.max(3, Math.floor(cw / cell));
			const H = Math.max(3, Math.floor(ch / cell));
			if (W === this.W && H === this.H && this.canvas.width === cw) return true;
			this.W = W;
			this.H = H;
			this.cellPx = cell;
			this.canvas.width = cw;
			this.canvas.height = ch;
			this.canvasW = cw;
			this.canvasH = ch;
			this.originX = Math.floor((cw - W * cell) / 2);
			this.originY = Math.floor((ch - H * cell) / 2);
			this.buf = new Float32Array(W * H);
			this.bloomBuf = new Float32Array(W * H);
			if (this.magnitude) this.magnitude = new Float32Array(W * H);
			this.sigil = null;
			this.sim = null;
			return true;
		}
		elapsed(now) {
			return now - this.startedAt;
		}
		fade(k) {
			const b = this.buf;
			for (let i = 0; i < b.length; i++) {
				b[i] *= k;
				if (b[i] < .005) b[i] = 0;
			}
		}
		set(x, y, v) {
			const ix = x | 0;
			const iy = y | 0;
			if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
			const i = iy * this.W + ix;
			if (v > this.buf[i]) this.buf[i] = v;
		}
		add(x, y, v) {
			const ix = x | 0;
			const iy = y | 0;
			if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
			const i = iy * this.W + ix;
			this.buf[i] = Math.min(1.5, this.buf[i] + v);
		}
		rect(x, y, w, h, v) {
			for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v);
		}
		disc(cx, cy, r, v, soft = false) {
			for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
				const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
				if (d <= r) this.set(x, y, soft ? v * (1 - d / (r + .001)) : v);
			}
		}
		ring(cx, cy, r, v) {
			const n = Math.max(8, Math.round(2 * Math.PI * r));
			for (let i = 0; i < n; i++) {
				const a = i / n * Math.PI * 2;
				this.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), v);
			}
		}
		/** Dashed connector — every other cell, so links read as links not bars. */
		link(x0, y0, x1, y1, v) {
			const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
			for (let s = 0; s <= n; s++) {
				if (s % 2) continue;
				this.set(Math.round(x0 + (x1 - x0) * s / n), Math.round(y0 + (y1 - y0) * s / n), v);
			}
		}
		draw() {
			if (!this.buf.length) return;
			const c = this.ctx;
			const { W, H } = this;
			const cell = this.cellPx;
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.clearRect(0, 0, this.canvasW, this.canvasH);
			if (this.opt.glass !== "transparent") {
				c.fillStyle = this.opt.glass;
				c.fillRect(0, 0, this.canvasW, this.canvasH);
			}
			const gutter = cell >= 8 ? Math.round(cell * .25) : cell >= 4 ? 1 : 0;
			const d = Math.max(1, cell - gutter);
			const off = Math.floor((cell - d) / 2);
			if (this.opt.bloom > 0) {
				const b = this.buf;
				const o = this.bloomBuf;
				o.fill(0);
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const v = b[y * W + x];
					if (v <= .03) continue;
					for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
						o[ny * W + nx] += v * (dx || dy ? .13 : .34);
					}
				}
				c.globalCompositeOperation = "lighter";
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const g = o[y * W + x];
					if (g <= .05) continue;
					c.fillStyle = `rgba(${this.opt.dot},${Math.min(.3, g * this.opt.bloom * .3)})`;
					c.fillRect(this.originX + x * cell, this.originY + y * cell, cell, cell);
				}
				c.globalCompositeOperation = "source-over";
			}
			const mag = this.magnitude;
			const lut = this.lut;
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const i = y * W + x;
				const q = this.buf[i];
				if (q <= .03) continue;
				if (mag && lut && mag[i] > MAGNITUDE_EPSILON) {
					const m = Math.max(0, Math.min(255, mag[i] * 255 | 0)) * 3;
					c.fillStyle = `rgba(${lut[m]},${lut[m + 1]},${lut[m + 2]},${Math.min(1, q)})`;
				} else c.fillStyle = `rgba(${this.opt.dot},${Math.min(1, q)})`;
				c.fillRect(this.originX + x * cell + off, this.originY + y * cell + off, d, d);
			}
		}
		getSigil() {
			this.sigil ?? (this.sigil = sigilPattern(this.opt.seed));
			return this.sigil;
		}
		/** Re-seat the lattice origin so a PATTERN (not the cell grid) is centred on
		*  the pixel box. Centring in whole cells leaves the odd cell on one side,
		*  which at 20px is a visible lean. */
		reseatOrigin(patternW, patternH, scale, x0, y0) {
			const cell = this.cellPx;
			this.originX = Math.round((this.canvasW - patternW * scale * cell) / 2) - x0 * cell;
			this.originY = Math.round((this.canvasH - patternH * scale * cell) / 2) - y0 * cell;
		}
	};
	var scenes = {
		/**
		* Identity. Static by design: a mark that twinkles is a mark you cannot
		* recognise. `breath` lifts the whole mark uniformly rather than re-lighting
		* single cells, so an idle resident reads as present without the mark ever
		* becoming unrecognisable.
		*/
		sigil(p, t) {
			const s = p.getSigil();
			const FW = s.patternWidth * 2 - 1;
			const scale = Math.max(1, Math.floor(Math.min(p.W / (FW + 2), p.H / (s.patternHeight + 2))));
			const x0 = Math.floor((p.W - FW * scale) / 2);
			const y0 = Math.floor((p.H - s.patternHeight * scale) / 2);
			p.reseatOrigin(FW, s.patternHeight, scale, x0, y0);
			let v = p.opt.glow;
			if (p.opt.breath) v *= .86 + .14 * (.5 + .5 * Math.sin(t / 2100 + s.phase));
			p.buf.fill(0);
			for (let y = 0; y < s.patternHeight; y++) for (let x = 0; x < FW; x++) {
				const col = x < s.patternWidth ? x : FW - 1 - x;
				if (!s.grid[y][col]) continue;
				p.rect(x0 + x * scale, y0 + y * scale, scale, scale, v);
			}
		},
		/**
		* Present, doing nothing. The field is fed barely above nothing, so it rests
		* just below the critical slope and the occasional micro-topple *is* the
		* twinkle — idle is the same physics as thinking, only starved.
		*/
		listen: pileScene("listen", 4, (p) => [Math.floor(Math.random() * p.W), Math.floor(Math.random() * p.H)]),
		/**
		* Generating. Grains pour at the centre and cascades bloom outward on a power
		* law, so it is mostly small activity punctuated by the occasional whole-field
		* avalanche. It never completes and never repeats — a token stream is not a
		* progress bar and should not pretend to be one.
		*/
		think: pileScene("think", 34, (p) => [p.W >> 1, p.H >> 1]),
		/**
		* Reading memory. Not a sandpile: walkers stick to what is already remembered,
		* so the mark visibly accretes into a dendrite. The different physics is
		* deliberate — it is what keeps `recall` distinguishable from the pile states
		* at rail scale.
		*/
		recall: dlaScene,
		/** Background work: a metered pour walking across the field. Determinate in
		*  position, but the ticks are topple events rather than a smooth fill. */
		work: pileScene("work", 26, (p, _st, t) => [Math.floor(t / 5200 % 1 * p.W), p.H >> 1]),
		/** A room: two pour points, cascades colliding — so a glance at the rail
		*  tells you the room is alive without you. */
		net: pileScene("net", 22, (p, st, t) => {
			const which = Math.sin(t / 1700) > 0 ? .3 : .7;
			st.angle += .02;
			return [Math.floor(p.W * which), Math.floor(p.H * (.4 + .2 * Math.sin(st.angle)))];
		}),
		/** Asleep — the well nearly out, one dot every few seconds. */
		sleep(p) {
			p.fade(.97);
			if (Math.random() < .09) p.add(Math.floor(Math.random() * p.W), Math.floor(Math.random() * p.H), .3);
		},
		/** Speaking — rings leaving the centre. */
		pulse(p, t) {
			p.fade(.86);
			const maxr = Math.min(p.W, p.H) * .5;
			for (let k = 0; k < 3; k++) {
				const r = (t / 900 + k / 3) % 1 * maxr;
				p.ring(p.W / 2, p.H / 2, r, .85 * (1 - r / maxr));
			}
			p.disc(p.W / 2, p.H / 2, 1.2, .9, true);
		},
		/**
		* Disconnected — the field losing charge.
		*
		* The earlier version lit one row of a fourteen-row lattice, so ~90% of the
		* panel was empty and it read as broken rather than as *disconnected*. Here
		* the whole field is de-energising from the edges inward and the stalled
		* trace is simply the last thing still lit. Monochrome by law: nothing is
		* happening, so there is no magnitude to colour.
		*/
		fault(p, t) {
			p.fade(.93);
			const cx = (p.W - 1) / 2;
			const cy = (p.H - 1) / 2;
			const horizon = Math.hypot(cx, cy) * (.6 + .4 * (.5 + .5 * Math.sin(t / 5400)));
			for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
				const r = Math.hypot(x - cx, y - cy);
				if (r > horizon) continue;
				if (Math.random() < .04) p.add(x, y, .04 + .13 * (1 - r / horizon));
			}
			const y0 = Math.round(cy);
			const gap = Math.round(p.W * .5);
			const gapW = Math.max(2, p.W * .1);
			const jitter = Math.sin(t / 190) > .84 ? 1 : 0;
			for (let x = 0; x < p.W; x++) {
				if (Math.abs(x - gap) < gapW) continue;
				const falloff = 1 - Math.abs(x - cx) / (p.W * .75);
				p.set(x, y0 + (x > gap ? jitter : 0), .32 + .4 * Math.max(0, falloff));
			}
			if (Math.sin(t / 640) > .93) p.add(gap, y0, .9);
		},
		/** Occupancy as a held level. A quantity is not a process: this never
		*  animates, and the lattice runs full width so it reads as a scale even when
		*  nearly empty. */
		fill(p) {
			p.buf.fill(0);
			const lvl = Math.max(0, Math.min(1, p.opt.level));
			const base = p.H - 2;
			const edge = Math.round(lvl * (p.W - 1));
			for (let x = 0; x < p.W; x++) for (let y = 0; y < base; y++) {
				if ((x + y) % 2) continue;
				p.set(x, y, x < edge ? .42 : .075);
			}
			for (let y = 0; y < base; y++) p.set(edge, y, .95);
			for (let x = 0; x < p.W; x += 4) p.set(x, base + 1, x < edge ? .62 : .14);
		}
	};
	var panels = /* @__PURE__ */ new Set();
	var rafId = 0;
	var intersectionObserver = null;
	var resizeObserver = null;
	var panelByCanvas = /* @__PURE__ */ new WeakMap();
	function prefersReducedMotion() {
		return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	/**
	* Extra scenes registered at runtime. The exploration lab injects its
	* experimental table here so nothing experimental has to be added to the
	* production `scenes` record (and so nothing experimental can ship by
	* accident).
	*/
	var extraScenes = /* @__PURE__ */ new Map();
	function registerScene(name, fn) {
		extraScenes.set(name, fn);
	}
	/**
	* Scenes that actually write `panel.magnitude`. Colour is enabled ONLY for
	* these, because a scene whose magnitude is zero everywhere gets painted the
	* cold end of the ramp in every cell — flat indigo, and worse than monochrome.
	* Colour therefore reads as "how much just moved", never as decoration.
	*
	* Keep this in step with the scene table: a scene added here that does not
	* write magnitude will go flat, and one omitted from here will lose its colour.
	*/
	var MAGNITUDE_SCENES = new Set([
		"listen",
		"think",
		"recall",
		"work",
		"net"
	]);
	/**
	* Apply the colour law for a panel's current scene. Idempotent, so it is safe
	* to call on every scene change.
	*/
	function applySceneColour(p) {
		if (MAGNITUDE_SCENES.has(p.scene)) p.enableMagnitude(MAGNITUDE_LUT_INKFLOOR);
		else p.disableMagnitude();
	}
	function runScene(p, t) {
		(extraScenes.get(p.scene) ?? scenes[p.scene] ?? scenes.listen)(p, t);
	}
	/**
	* Advance a panel to a representative frame and paint it once. Used for the
	* first paint (so a panel never shows as blank glass) and as the entire render
	* under reduced motion.
	*/
	function settle(p) {
		if (!p.buf.length) return;
		for (let i = 0; i < 26; i++) runScene(p, i * 33);
		p.draw();
	}
	function frame(now) {
		rafId = requestAnimationFrame(frame);
		for (const p of panels) {
			if (!p.visible || !p.buf.length) continue;
			if (!p.canvas.isConnected) {
				unregisterPanel(p.canvas);
				continue;
			}
			runScene(p, p.elapsed(now));
			p.draw();
		}
	}
	let motionPaused = false;
	function startLoop() {
		if (motionPaused || rafId || prefersReducedMotion() || document.hidden) return;
		rafId = requestAnimationFrame(frame);
	}
	function stopLoop() {
		if (!rafId) return;
		cancelAnimationFrame(rafId);
		rafId = 0;
	}
	function handleVisibilityChange() {
		if (document.hidden) stopLoop();
		else if (panels.size) startLoop();
	}
	if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
	function registerPanel(canvas, options = {}) {
		const existing = panelByCanvas.get(canvas);
		if (existing) return existing;
		const panel = new DotPanel(canvas, options);
		panelByCanvas.set(canvas, panel);
		panels.add(panel);
		if (!intersectionObserver && typeof IntersectionObserver !== "undefined") intersectionObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const p = panelByCanvas.get(entry.target);
				if (p) p.visible = entry.isIntersecting;
			}
		}, { rootMargin: "160px" });
		if (!resizeObserver && typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const p = panelByCanvas.get(entry.target);
				if (p?.resize()) settle(p);
			}
		});
		intersectionObserver?.observe(canvas);
		resizeObserver?.observe(canvas);
		applySceneColour(panel);
		settle(panel);
		startLoop();
		return panel;
	}
	function unregisterPanel(canvas) {
		const panel = panelByCanvas.get(canvas);
		if (!panel) return;
		intersectionObserver?.unobserve(canvas);
		resizeObserver?.unobserve(canvas);
		panels.delete(panel);
		panelByCanvas.delete(canvas);
		if (!panels.size) stopLoop();
	}
	/** Test/debug hook: how many panels are mounted and whether one loop is running. */
	function __dotDisplayStats() {
		let visible = 0;
		for (const p of panels) if (p.visible) visible++;
		return {
			panels: panels.size,
			running: rafId !== 0,
			visible
		};
	}
	//#endregion
	//#region src/shared/ui/dot-display/scenes-lab.ts
	/** Deterministic per-panel noise, so a mark's character is stable per key. */
	function seeded(input) {
		const str = String(input);
		let h = 1779033703 ^ str.length;
		for (let i = 0; i < str.length; i++) {
			h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
			h = h << 13 | h >>> 19;
		}
		return () => {
			h = Math.imul(h ^ h >>> 16, 2246822507);
			h = Math.imul(h ^ h >>> 13, 3266489909);
			h ^= h >>> 16;
			return (h >>> 0) / 4294967296;
		};
	}
	function useAfterglow(p, key) {
		return p.useSim(key, () => ({
			scorch: new Float32Array(p.W * p.H),
			mag: new Float32Array(p.W * p.H)
		}));
	}
	function compositeAfterglow(p, a, decay) {
		const n = p.W * p.H;
		for (let i = 0; i < n; i++) {
			const s = a.scorch[i];
			if (s <= .004) {
				a.scorch[i] = 0;
				continue;
			}
			const v = s * .55;
			if (v > p.buf[i]) p.buf[i] = v;
			if (p.magnitude) p.magnitude[i] = a.mag[i];
			a.scorch[i] = s * decay;
		}
	}
	/**
	* work — determinate background task.
	* The production version calls buf.fill(0) every frame, deleting the phosphor,
	* then paints a flat checkerboard: a progress bar in a dot costume. Here the
	* front is a soft advancing wave with a gradient wake, the completed region
	* keeps a textured stain, and ticks are events rather than a smooth fill.
	*/
	var workV2 = (p, t) => {
		const a = useAfterglow(p, "workV2");
		p.fade(.88);
		const edge = t % 5200 / 5200 * p.W;
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			const d = edge - x;
			if (d < 0 || d > p.W * .35) continue;
			const falloff = 1 - d / (p.W * .35);
			const grain = .55 + .45 * Math.sin(x * 1.7 + y * 2.3);
			const v = falloff * falloff * .85 * grain;
			if (v > .02) {
				p.add(x, y, v * .5);
				const i = y * p.W + x;
				if (falloff > .72) {
					a.scorch[i] = Math.max(a.scorch[i], falloff);
					a.mag[i] = .45 + .4 * falloff;
				}
			}
		}
		const steps = 8;
		for (let s = 0; s < steps; s++) {
			const x = Math.round((s + .5) / steps * (p.W - 1));
			const done = x < edge;
			p.set(x, p.H - 1, done ? .8 : .14);
		}
		compositeAfterglow(p, a, .972);
	};
	/**
	* fault — disconnected.
	* The production version lights one row of a fourteen-row lattice, so ~90% of
	* the panel is empty. Here the whole field is losing charge: it de-energises
	* from the edges inward and the broken trace is the last thing still lit,
	* twitching, over the resident's own cooling ghost.
	*/
	var faultV2 = (p, t) => {
		const a = useAfterglow(p, "faultV2");
		const rnd = p.useSim("faultV2rnd", () => seeded(`${p.opt.seed}f`));
		p.fade(.93);
		const cx = (p.W - 1) / 2;
		const cy = (p.H - 1) / 2;
		const horizon = Math.hypot(cx, cy) * (.62 + .38 * (.5 + .5 * Math.sin(t / 5400)));
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			const r = Math.hypot(x - cx, y - cy);
			if (r > horizon) continue;
			if (rnd() < .03) p.add(x, y, .05 + .14 * (1 - r / horizon));
		}
		const y0 = Math.round(cy);
		const gap = Math.round(p.W * .5);
		const gapW = Math.max(2, p.W * .11);
		const jitter = Math.sin(t / 190) > .82 ? 1 : 0;
		for (let x = 0; x < p.W; x++) {
			if (Math.abs(x - gap) < gapW) continue;
			const yy = y0 + (x > gap ? jitter : 0);
			const falloff = 1 - Math.abs(x - cx) / (p.W * .75);
			p.set(x, yy, .35 + .4 * Math.max(0, falloff));
			const i = yy * p.W + x;
			a.scorch[i] = Math.max(a.scorch[i], .5);
			a.mag[i] = .05;
		}
		if (Math.sin(t / 640) > .93) {
			p.add(gap, y0, .9);
			if (p.magnitude) p.magnitude[y0 * p.W + gap] = .95;
		}
		compositeAfterglow(p, a, .985);
	};
	var recallV2 = (p, t) => {
		const st = p.useSim("recallV2", () => {
			const rnd = seeded(`${p.opt.seed}r2`);
			const pts = [];
			const n = Math.max(7, Math.round(p.W * p.H * .035));
			for (let i = 0; i < n; i++) pts.push({
				x: rnd(),
				y: rnd(),
				charge: 0
			});
			return { pts };
		});
		const a = useAfterglow(p, "recallV2glow");
		p.fade(.9);
		const cx = (p.W - 1) / 2;
		const cy = (p.H - 1) / 2;
		const ang = t / 1900 % (Math.PI * 2);
		const maxR = Math.min(p.W, p.H) * .48;
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const r = Math.hypot(dx, dy);
			if (r > maxR || r < .5) continue;
			let pa = Math.atan2(dy, dx);
			if (pa < 0) pa += Math.PI * 2;
			let d = Math.abs(pa - ang);
			if (d > Math.PI) d = Math.PI * 2 - d;
			const wedge = Math.max(0, 1 - d / .42);
			if (wedge <= 0) continue;
			const radial = .25 + .6 * (r / maxR);
			p.add(x, y, wedge * wedge * radial * .5);
		}
		for (const pt of st.pts) {
			const x = 1 + pt.x * (p.W - 2);
			const y = 1 + pt.y * (p.H - 2);
			let pa = Math.atan2(y - cy, x - cx);
			if (pa < 0) pa += Math.PI * 2;
			let d = Math.abs(pa - ang);
			if (d > Math.PI) d = Math.PI * 2 - d;
			if (d < .2) pt.charge = 1;
			pt.charge *= .955;
			if (pt.charge > .01) {
				p.disc(x, y, .6 + 1.7 * pt.charge, .35 + .65 * pt.charge, true);
				const i = Math.round(y) * p.W + Math.round(x);
				if (i >= 0 && i < a.scorch.length) {
					a.scorch[i] = Math.max(a.scorch[i], pt.charge * .8);
					a.mag[i] = .35 + .5 * pt.charge;
				}
			}
		}
		compositeAfterglow(p, a, .976);
	};
	var netV2 = (p, t) => {
		const st = p.useSim("netV2", () => {
			const rnd = seeded(`${p.opt.seed}n2`);
			const nodes = [];
			for (let i = 0; i < 6; i++) nodes.push([.16 + rnd() * .68, .18 + rnd() * .64]);
			const pulses = [];
			for (let i = 0; i < 4; i++) pulses.push({
				from: Math.floor(rnd() * 6),
				to: Math.floor(rnd() * 6),
				at: rnd(),
				speed: .004 + rnd() * .006
			});
			return {
				nodes,
				pulses
			};
		});
		p.fade(.9);
		const px = (n) => 1 + n[0] * (p.W - 2);
		const py = (n) => 1 + n[1] * (p.H - 2);
		for (let i = 0; i < st.nodes.length; i++) {
			const a = st.nodes[i];
			const b = st.nodes[(i + 2) % st.nodes.length];
			p.link(px(a), py(a), px(b), py(b), .14);
		}
		for (const pulse of st.pulses) {
			const a = st.nodes[pulse.from];
			const b = st.nodes[pulse.to];
			if (a === b) continue;
			pulse.at += pulse.speed;
			if (pulse.at > 1) {
				pulse.at = 0;
				pulse.from = pulse.to;
				pulse.to = (pulse.to + 1 + Math.floor(Math.random() * 4)) % st.nodes.length;
			}
			const x = px(a) + (px(b) - px(a)) * pulse.at;
			const y = py(a) + (py(b) - py(a)) * pulse.at;
			p.disc(x, y, 1.4, .95, true);
		}
		for (const n of st.nodes) p.disc(px(n), py(n), 1.1, .4 + .2 * Math.sin(t / 1300 + n[0] * 9), true);
	};
	/** sleep — the well nearly out, but settling rather than dead. */
	var sleepV2 = (p, t) => {
		p.fade(.975);
		const phase = t / 11e3;
		const cx = p.W * (.5 + .32 * Math.sin(phase));
		const cy = p.H * (.5 + .32 * Math.cos(phase * .61));
		const reach = Math.max(p.W, p.H) * .6;
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			const d = Math.hypot(x - cx, y - cy) / reach;
			if (d >= 1) continue;
			const v = .009 * (1 - d) * (1 - d);
			if (v > .003) p.add(x, y, v);
		}
		if (Math.random() < .07) p.add(Math.floor(Math.random() * p.W), Math.floor(Math.random() * p.H), .34);
	};
	/** thinking — pour at the centre; cascades bloom outward. */
	var pileThink = pileScene("pileThink", 34, (p) => [p.W >> 1, p.H >> 1]);
	/** working — a metered pour that walks across the field. */
	var pileWork = pileScene("pileWork", 26, (p, _st, t) => [Math.floor(t / 5200 % 1 * p.W), p.H >> 1]);
	/** remembering — the pour orbits, so cascades light what it passes. */
	var pileRecall = pileScene("pileRecall", 24, (p, st) => {
		st.angle += .06;
		const r = Math.min(p.W, p.H) * .3;
		return [(p.W >> 1) + Math.cos(st.angle) * r, (p.H >> 1) + Math.sin(st.angle) * r];
	});
	/** listening — barely fed, so the field sits just below critical and the
	*  occasional micro-topple *is* the twinkle. */
	var pileListen = pileScene("pileListen", 4, (p) => [Math.floor(Math.random() * p.W), Math.floor(Math.random() * p.H)]);
	/** a room — two pour points, cascades colliding. */
	var pileNet = pileScene("pileNet", 22, (p, st, t) => {
		const which = Math.sin(t / 1700) > 0 ? .3 : .7;
		st.angle += .02;
		return [Math.floor(p.W * which), Math.floor(p.H * (.4 + .2 * Math.sin(st.angle)))];
	});
	/** PROMOTED as the production `recall`. Re-exported under its lab name so the
	*  lab still shows it in the Track 3 row. */
	var dla = dlaScene;
	/**
	* think (Chladni) — sand settling onto the nodal lines of a vibrating plate.
	* The spec already describes thinking as "noise resolving into order, then
	* loosening"; that is literally what a Chladni plate does. Drifting the drive
	* frequency means it never repeats.
	*/
	var chladni = (p, t) => {
		p.fade(.87);
		const m = 2.4 + 1.6 * (.5 + .5 * Math.sin(t / 7300));
		const n = 2.1 + 1.9 * (.5 + .5 * Math.sin(t / 5100 + 1.7));
		const order = .5 + .5 * Math.sin(t / 4300);
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			const u = (x + .5) / p.W;
			const v = (y + .5) / p.H;
			const amp = Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v) + Math.sin(n * Math.PI * u) * Math.sin(m * Math.PI * v);
			const nodal = 1 - Math.min(1, Math.abs(amp) * 2.6);
			if (nodal <= .02) continue;
			const jitter = (1 - order) * (Math.random() - .5) * 1.6;
			p.add(x + jitter, y + jitter, nodal * nodal * (.16 + .5 * order));
		}
	};
	/**
	* net (wave interference) — each participant is a source; when residents talk
	* the waves genuinely interfere. The metaphor is the physics.
	*/
	var interference = (p, t) => {
		const src = p.useSim("interference", () => {
			const rnd = seeded(`${p.opt.seed}w`);
			return [
				[
					.26,
					.32,
					1
				],
				[
					.74,
					.38,
					1.13
				],
				[
					.5,
					.78,
					.87
				]
			].map((s) => [
				s[0] + (rnd() - .5) * .1,
				s[1] + (rnd() - .5) * .1,
				s[2]
			]);
		});
		p.fade(.8);
		for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
			let sum = 0;
			for (const s of src) {
				const sx = s[0] * p.W;
				const sy = s[1] * p.H;
				const r = Math.hypot(x - sx, y - sy);
				sum += Math.sin(r * 1.15 - t / 420 * s[2]) / (1 + r * .28);
			}
			const v = sum * .5;
			if (v > .06) p.add(x, y, v * .55);
		}
	};
	var flow = (p, t) => {
		const st = p.useSim("flow", () => {
			const parts = [];
			const n = Math.max(10, Math.round(p.W * p.H * .09));
			for (let i = 0; i < n; i++) parts.push({
				x: Math.random() * p.W,
				y: Math.random() * p.H
			});
			return { parts };
		});
		p.fade(.9);
		const time = t / 3400;
		for (const q of st.parts) {
			const s = .42;
			const u = -.42 * Math.sin(q.x * s + time) * Math.sin(q.y * s - time * .7);
			const v = -.42 * Math.cos(q.x * s + time) * Math.cos(q.y * s - time * .7);
			q.x += u * 3.4;
			q.y += v * 3.4;
			if (q.x < 0) q.x += p.W;
			if (q.x >= p.W) q.x -= p.W;
			if (q.y < 0) q.y += p.H;
			if (q.y >= p.H) q.y -= p.H;
			p.add(q.x, q.y, .26);
		}
	};
	var labScenes = {
		workV2,
		faultV2,
		recallV2,
		netV2,
		sleepV2,
		pileThink,
		pileWork,
		pileRecall,
		pileListen,
		pileNet,
		chladni,
		dla,
		interference,
		flow
	};
	//#endregion
	exports.MAGNITUDE_LUT = MAGNITUDE_LUT;
	exports.MAGNITUDE_LUT_INKFLOOR = MAGNITUDE_LUT_INKFLOOR;
	exports.__dotDisplayStats = __dotDisplayStats;
	exports.applySceneColour = applySceneColour;
	exports.dlaScene = dlaScene;
	exports.labScenes = labScenes;
	exports.pileScene = pileScene;
	exports.setMotionPaused = value => { motionPaused = value; if(value) stopLoop(); else startLoop(); };
	exports.registerPanel = registerPanel;
	exports.registerScene = registerScene;
	exports.scenes = scenes;
	exports.settle = settle;
	exports.sigilPattern = sigilPattern;
	exports.unregisterPanel = unregisterPanel;
	return exports;
})({});
