// The structure library: one construction grid, one size palette and a small set of named
// structure styles that every course is assembled from. Modules (trackgen.js) decide *where*
// platforms go; this file decides what they are built like, so neighbouring pieces always
// read as parts of the same structure instead of arbitrary floating boxes.
//
// Pure data, no Three.js: the dressing parts are real collision solids.

export const GRID = 0.25;
export const snap = (x) => Math.round(x / GRID) * GRID;
// extents snap outward: a platform never loses footing to the grid
export const snapLo = (x) => Math.floor(x / GRID + 1e-6) * GRID;
export const snapHi = (x) => Math.ceil(x / GRID - 1e-6) * GRID;

// Standard section depths (metres).
export const PLATE = 1.0;      // running plate under every slab
export const DATUM = 6;        // walls / pillars reach this far below the floor they serve
export const TIER = 0.5;       // keel tier inset and the base step of every stepped form

/**
 * The course gauge: every walkway is one of these widths, so consecutive segments line up into
 * one continuous built thing instead of a run of random-width plates. A width only changes on
 * purpose (a precision plate, a fork deck that splits into lanes) and changes back the same way.
 *  - lane:   the standard runway / landing deck
 *  - wide:   catch decks after a long flight (swing, whip, big drop). Kept equal to the lane:
 *            sims show the 4 m deck catches every whip / swing, and one width reads cleaner
 *  - narrow: precision hop plates (stairs, cascades)
 *  - pad:    floating pillar tops
 *  - fork:   lane width inside a multi-lane deck (lanes + dividers make a deck)
 *  - div:    divider wall between fork lanes
 */
export const GAUGE = { lane: 4, wide: 4, narrow: 2.5, pad: 2.5, fork: 3.5, div: 0.75, start: 8, final: 10 };
/** width of an n-lane fork deck */
export const deckW = (n) => n * GAUGE.fork + (n - 1) * GAUGE.div;

/** Random value from lo..hi on a `step` lattice: sizes come from a palette, not a continuum. */
export const q = (r, lo, hi, step = 0.5) => lo + step * r.int(0, Math.floor((hi - lo) / step + 1e-6));

/**
 * Structure styles. A run of consecutive modules shares one, so a stretch of course reads as
 * one built thing; the style changes every few modules.
 *  - tiered:   stepped keel (inverted ziggurat), 1–3 tiers by footprint
 *  - pylon:    one tier + a hanging column with a cap: the plate hangs off a mast
 *  - truss:    two deep edge girders along the long axis with cross ribs: a bridge deck
 *  - monolith: the plate is the top of a deep floating block with a recessed foot
 */
export const STYLES = ['tiered', 'pylon', 'truss', 'monolith'];

const mk = (x0, x1, y0, y1, z0, z1, kind, extra = {}) => ({
  x0: snap(x0), x1: snap(x1), y0: snap(y0), y1: snap(y1), z0: snap(z0), z1: snap(z1), kind, deco: true, ...extra,
});

/** Parts for one slab in a style (deterministic from the footprint: same size, same shape). */
function styleParts(style, o) {
  const W = o.x1 - o.x0;
  const D = o.z1 - o.z0;
  const m = Math.min(W, D);
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  const inset = (k, y0, y1, kind = 'keel', extra = {}) => mk(o.x0 + k, o.x1 - k, y0, y1, o.z0 + k, o.z1 - k, kind, { parent: o, ...extra });
  const parts = [];
  switch (style) {
    case 'tiered': {
      const n = Math.max(1, Math.min(3, Math.floor((m - 1) / (2 * TIER))));
      let y = o.y0;
      for (let t = 1; t <= n; t++) {
        const th = t === n ? 1.0 : 0.5;
        parts.push(inset(TIER * t, y - th, y));
        y -= th;
      }
      break;
    }
    case 'pylon': {
      parts.push(inset(TIER, o.y0 - 0.5, o.y0));
      const c = m >= 5 ? 1.0 : 0.5;
      const len = o.start || o.final ? 14 : m >= 5 ? 9 : 6;
      const y = o.y0 - 0.5;
      parts.push(mk(cx - c, cx + c, y - len, y, cz - c, cz + c, 'spine', { parent: o, noWall: true }));
      parts.push(mk(cx - c - 0.5, cx + c + 0.5, y - len - 0.75, y - len, cz - c - 0.5, cz + c + 0.5, 'spine', { parent: o, noWall: true }));
      break;
    }
    case 'truss': {
      const alongX = W >= D;
      const L = alongX ? W : D;
      const y = o.y0;
      // edge girders
      for (const e of [0, 1]) {
        parts.push(alongX
          ? mk(o.x0 + 0.25, o.x1 - 0.25, y - 1.5, y, e ? o.z1 - 0.75 : o.z0 + 0.25, e ? o.z1 - 0.25 : o.z0 + 0.75, 'keel', { parent: o })
          : mk(e ? o.x1 - 0.75 : o.x0 + 0.25, e ? o.x1 - 0.25 : o.x0 + 0.75, y - 1.5, y, o.z0 + 0.25, o.z1 - 0.25, 'keel', { parent: o }));
      }
      // cross ribs every 2 m
      const n = Math.max(2, Math.round(L / 2));
      for (let i = 0; i <= n; i++) {
        const a = (alongX ? o.x0 : o.z0) + 0.5 + (L - 1) * (i / n);
        parts.push(alongX
          ? mk(a - 0.125, a + 0.125, y - 1.0, y, o.z0 + 0.75, o.z1 - 0.75, 'fin', { parent: o })
          : mk(o.x0 + 0.75, o.x1 - 0.75, y - 1.0, y, a - 0.125, a + 0.125, 'fin', { parent: o }));
      }
      break;
    }
    case 'monolith': {
      parts.push(inset(0.25, o.y0 - 4, o.y0, 'keel'));
      parts.push(inset(1.0, o.y0 - 6, o.y0 - 4, 'keel'));
      break;
    }
    case 'thin':   // fallback: always fits, keeps every plate from looking unfinished
      parts.push(inset(TIER, o.y0 - 0.5, o.y0));
      break;
  }
  return parts.filter((p) => p.x1 > p.x0 && p.z1 > p.z0 && p.y1 > p.y0);
}

/**
 * Polyline → samples every half metre (used for the racing-line clearance envelope). After a
 * jump / kick point the samples ride its ballistic arc (well above the straight line through
 * the points), so dressing keeps clear of where a racer's head actually goes.
 */
const LAUNCH = new Set(['jump', 'kick', 'walljump', 'climbjump']);
function sampleLine(pts, out) {
  let fl = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) {
      const a = pts[i - 1];
      if (LAUNCH.has(a.act?.type) || a.j) fl = { y0: a.y, d: 0 };
      const dh = Math.hypot(p.x - a.x, p.z - a.z);
      const n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) / 0.5);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        let y = a.y + (p.y - a.y) * t;
        if (fl) {
          const tt = (fl.d + dh * t) / 8.6;
          const yb = fl.y0 + 8 * tt - 11 * tt * tt;
          if (yb > y) y = yb; else if (tt > 0.35) fl = null;
        }
        out.push({ x: a.x + (p.x - a.x) * t, y, z: a.z + (p.z - a.z) * t });
      }
      if (fl) fl.d += dh;
    } else out.push(p);
  }
  return out;
}

/**
 * Dresses the bare course with the library. Every piece is a real solid and must stay clear of
 * the racing-line envelope (main line AND alternate lines) and of every course solid it doesn't
 * belong to. Styles apply all-or-nothing (falling back to 'thin'), so no platform ends up
 * half-dressed.
 */
export function dress(b, path, rng) {
  const base = b.solids.slice();
  const S = sampleLine(path, []);
  for (const alt of b.alts) sampleLine(alt, S);
  const clearOfLine = (o, R = 1.5, below = 0.6, above = 4.8) => {
    for (const p of S) {
      if (p.x > o.x0 - R && p.x < o.x1 + R && p.z > o.z0 - R && p.z < o.z1 + R && o.y1 > p.y - below && o.y0 < p.y + above) return false;
    }
    return true;
  };
  const touches = (o, m, parent) => {
    for (const s of base) {
      if (s === parent) continue;
      const q2 = s.sweep ?? s;
      if (q2.x0 < o.x1 + m && q2.x1 > o.x0 - m && q2.z0 < o.z1 + m && q2.z1 > o.z0 - m && q2.y0 < o.y1 + m && q2.y1 > o.y0 - m) return true;
    }
    return false;
  };
  const ok = (o, parent, R, m) => clearOfLine(o, R) && !touches(o, m, parent);
  const tryAll = (parts, parent, R, m) => {
    if (!parts.length || !parts.every((o) => ok(o, parent, R, m))) return false;
    for (const o of parts) b.solids.push(o);
    return true;
  };

  for (const o of base) {
    if (o.mover) continue;
    const W = o.x1 - o.x0;
    const D = o.z1 - o.z0;
    const cx = (o.x0 + o.x1) / 2;
    const cz = (o.z0 + o.z1) / 2;

    if (o.kind === 'slab' || o.kind === 'step') {
      const style = o.kind === 'step' ? 'thin' : o.start || o.final ? 'tiered' : (o.style ?? 'tiered');
      // keep the wall-catch probe's reach (body + 0.85 m) clear: a keel hanging beside a lower
      // route would otherwise start a wallrun on it
      if (!tryAll(styleParts(style, o), o, 1.3, -0.01) && style !== 'thin') tryAll(styleParts('thin', o), o, 1.3, -0.01);
      if ((o.start || o.final) && style === 'tiered') {
        const y = o.y0 - 2;
        tryAll([
          mk(cx - 1, cx + 1, y - 14, y, cz - 1, cz + 1, 'spine', { noWall: true }),
          mk(cx - 1.5, cx + 1.5, y - 14.75, y - 14, cz - 1.5, cz + 1.5, 'spine', { noWall: true }),
        ], o, 1.0, 0.1);
      }
    } else if (o.kind === 'wall' && !o.noRibs) {
      // ribs on the back face (the side away from the racing line)
      const alongX = W > D;
      let near = S[0];
      let best = Infinity;
      for (const p of S) {
        const d = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        if (d < best) { best = d; near = p; }
      }
      const back = alongX ? (near.z > cz ? -1 : 1) : (near.x > cx ? -1 : 1);
      const L = alongX ? W : D;
      const n = Math.floor(L / 1.5);
      const a0 = (alongX ? o.x0 : o.z0) + (L - (n - 1) * 1.5) / 2;
      const ribs = [];
      for (let i = 0; i < n; i++) {
        const a = a0 + i * 1.5;
        const y0 = o.y0 + 0.5;
        const y1 = o.y1 - (i % 2 ? 1.0 : 0.5);
        ribs.push(alongX
          ? mk(a - 0.125, a + 0.125, y0, y1, back > 0 ? o.z1 : o.z0 - 0.5, back > 0 ? o.z1 + 0.5 : o.z0, 'fin', { noWall: true })
          : mk(back > 0 ? o.x1 : o.x0 - 0.5, back > 0 ? o.x1 + 0.5 : o.x0, y0, y1, a - 0.125, a + 0.125, 'fin', { noWall: true }));
      }
      tryAll(ribs, o, 1.2, -0.01);
    } else if (o.kind === 'block') {
      // climb monoliths stand on a stepped plinth (faces stay flush: nothing to snag a climb)
      tryAll([mk(o.x0 + 0.5, o.x1 - 0.5, o.y0 - 1.5, o.y0, o.z0 + 0.5, o.z1 - 0.5, 'keel')], o, 1.0, -0.01);
    }
  }

  // gantry frames across runways: two posts outside the slab and a lintel well above jump height
  for (const f of b.frames) {
    const half = f.w / 2 + 0.75;
    const t = 0.5;
    const yB = f.y - 3;
    const yT = f.y + 6.5;
    const P = (a0, a1, y0, y1, noWall) => (f.alongX
      ? mk(f.x - t / 2, f.x + t / 2, y0, y1, f.z + a0, f.z + a1, 'frame', { noWall })
      : mk(f.x + a0, f.x + a1, y0, y1, f.z - t / 2, f.z + t / 2, 'frame', { noWall }));
    const fr = [
      P(-half - t, -half, yB, yT, false),
      P(half, half + t, yB, yT, false),
      P(-half - t, half + t, yT, yT + 0.75, true),
    ];
    if (!fr.some((o) => b.solids.some((s) => s.deco && ov3(s, o, 0.3)))) tryAll(fr, null, 0.9, 0.3);
  }
}

const ov3 = (a, b, m) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;

// ------------------------------------------------------------------------------ moving parts
/**
 * Movers are solids whose position is a pure function of race time, so both racers (and the
 * headless sim) see exactly the same motion. mover = { ax, ay, az, T, ph }: sinusoidal offset
 * of amplitude (ax, ay, az) with period T seconds and phase ph (radians).
 */
export function moverOffset(m, t) {
  const s = Math.sin((t / m.T) * Math.PI * 2 + m.ph);
  return [m.ax * s, m.ay * s, m.az * s];
}

/** Advance every mover in the world to time t (monotonic: extra calls for the same t are free). */
export function moveMovers(world, t) {
  if (!world.movers.length || t <= world.moverT) return;
  world.moverT = t;
  for (const o of world.movers) {
    const [dx, dy, dz] = moverOffset(o.mover, t);
    const B = o.base;
    o.x0 = B.x0 + dx; o.x1 = B.x1 + dx;
    o.y0 = B.y0 + dy; o.y1 = B.y1 + dy;
    o.z0 = B.z0 + dz; o.z1 = B.z1 + dz;
  }
}

/** Swept bounds of a mover over its whole cycle (for the collision grid and clearance tests). */
export function sweepOf(o) {
  const m = o.mover;
  return {
    x0: o.x0 - Math.abs(m.ax), x1: o.x1 + Math.abs(m.ax),
    y0: o.y0 - Math.abs(m.ay), y1: o.y1 + Math.abs(m.ay),
    z0: o.z0 - Math.abs(m.az), z1: o.z1 + Math.abs(m.az),
  };
}
