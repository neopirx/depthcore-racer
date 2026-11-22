// Course generator: plans a sequence of set-pieces (gen/catalog.js) and lays them with the
// builder (gen/builder.js), validating that every new segment keeps clear of everything already
// built. Pure data, no Three.js.
//
//   gen/builder.js     cursor, solids, racing line, routes (forks), jump physics
//   gen/common.js      helpers shared by modules (gauge runway, hop spacing, exits, gates)
//   gen/mod_basic.js   runs, hops, climbs, ramps, drops, obstacle runs, movers
//   gen/mod_walls.js   wallruns, kicks, climb-kicks and the 90° turns
//   gen/mod_grapple.js swings, pivot whips, switchbacks
//   gen/mod_routes.js  forks, shortcuts, speed checks, multi-level areas
//   gen/mod_multilevel.js legacy stacked ribbons (kept for saved levels; the planner folds routes now)
//   gen/mod_vertical.js shafts, wall climbs, stacked two-level forks, level-changing turns
//   gen/mod_skill.js   chained-move rhythm checks and rooftop hop runs
//   gen/catalog.js     what each module is (weights, tags) for the planner and the editor
import { makeRng } from '../core/rng.js';
import { buildWorld } from './world.js';
import { GRID, snap, STYLES, GAUGE, dress } from './kit.js';
import { Builder, yawOf } from './gen/builder.js';
import { makeCtx } from './gen/common.js';
import basic from './gen/mod_basic.js';
import walls from './gen/mod_walls.js';
import grapple from './gen/mod_grapple.js';
import routes from './gen/mod_routes.js';
import multilevel from './gen/mod_multilevel.js';
import vertical from './gen/mod_vertical.js';
import skill from './gen/mod_skill.js';
import { CATALOG, MODULE_TYPES, TURN_TYPES, SPIRAL_TURN, SPIRAL_LEG, weights } from './gen/catalog.js';
import { addShortcuts } from './gen/shortcuts.js';

export { jumpReach } from './gen/builder.js';
export { MODULE_TYPES, TURN_TYPES, CATALOG };

/** Free shapes the editor can drop anywhere (they are plain solids: the bot's line ignores them). */
export const SHAPE_KINDS = ['slab', 'block', 'wall', 'pillar', 'pad', 'anchor'];

export const diffForSector = (sector) => Math.min(1, 0.15 + sector * 0.12);
export const lengthForSector = (sector) => Math.min(430 + sector * 55, 980);

/** All module generators bound to one builder, one segment rng stream and a difficulty. */
function modules(b, r, diff) {
  const k = makeCtx(b, r, diff);
  return Object.assign({}, basic(k), walls(k), grapple(k), routes(k), multilevel(k), vertical(k), skill(k));
}

/**
 * Procedurally builds one course. Both racers run the same course (the rival is a ghost).
 * Returns pure data: collision world, racing line (path), bot actions, checkpoints, plus
 * track.level: the editable segment list that rebuilds exactly this course (buildLevel).
 * opts: only (force module types), alt (race route N of every fork: true = 1), diff (0..1), length (m).
 */
export function generateTrack(seed, sector = 1, opts = {}) {
  return buildCourse(seed >>> 0, sector, opts, null);
}

/**
 * Rebuild a course from a level spec (map editor / custom levels):
 * { seed, sector, diff, modules: [{ type, seed, style, td?, diff? }], shapes: [...] }.
 * Each module carries its own seed, so editing one segment leaves every other one's shape intact.
 */
export function buildLevel(level, opts = {}) {
  return buildCourse((level.seed ?? 1) >>> 0, level.sector ?? 1, { ...opts, diff: level.diff }, level);
}

function buildCourse(seed, sector, opts, level) {
  // the type picker's stream: a level being extended past its last segment gets a fresh one
  const rng = makeRng(opts.extendSeed ?? seed);
  const b = new Builder(rng);
  b.prefer = opts.alt === true ? 1 : Math.max(0, opts.alt | 0);
  // structure style runs: a few modules in a row share one look from the library
  const styleRng = makeRng((seed ^ 0x57a1e) >>> 0);
  let styleLeft = 0;
  const diff = opts.diff ?? diffForSector(sector);
  const length = opts.length ?? lengthForSector(sector);
  const plan = [];
  const segments = [];

  // ---- start platform
  b.w = GAUGE.start;
  b.slabC(-10, 16, b.w, 0, { start: true, thick: 3 });
  b.cp(0, 0, 0);
  b.pt(16, 0, 0);
  b.adv(16);
  b.w = GAUGE.lane;
  let travelled = 16;

  // planner state
  let last = 'run';
  let latLen = 0;
  let latLimit = 0;
  let sinceTurn = 0;
  let mustRun = 0;
  let wantDown = false;
  let lastFast = false;
  let fastLeft = 0;
  let pat = null;        // active same-spin pattern: { kind, spin, dir, turns, leg, h0, fails }
  let retSpin = 0;       // heading south after a pattern: the way to turn back without crossing

  /** one module: its own rng stream (seeded per segment) so segments can be edited independently */
  const place = (entry) => {
    const i = segments.length;
    const lateral = b.heading !== 'N';
    const s0 = b.solids.length;
    const p0 = b.path.length;
    const r0 = b.ramps.length;
    const f0 = b.faces.length;
    const a0 = b.alts.length;
    b.style = entry.style;
    const M = modules(b, makeRng(entry.seed), entry.diff ?? diff);
    // an explicit turn side is only honoured heading north: a lateral leg always turns back north.
    // `spin` (planner spirals / hairpins) turns that way from any heading.
    const td = entry.spin ?? (lateral ? undefined : entry.td || undefined);
    const res = TURN_TYPES.has(entry.type) ? M[entry.type](td) : M[entry.type]();
    for (let k = s0; k < b.solids.length; k++) b.solids[k].seg ??= i;
    for (let k = r0; k < b.ramps.length; k++) b.ramps[k].seg ??= i;
    for (let k = f0; k < b.faces.length; k++) b.faces[k].seg ??= i;
    for (let k = Math.max(0, p0); k < b.path.length; k++) b.path[k].seg ??= i;
    for (let k = a0; k < b.alts.length; k++) b.alts[k].seg ??= i;
    // Measure route distance, including return legs and climbs (not endpoint displacement).
    for (let k = Math.max(1, p0); k < b.path.length; k++) {
      const a = b.path[k - 1]; const c = b.path[k];
      travelled += Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
    }
    segments.push({ i, type: entry.type, style: entry.style, heading: b.heading, h: b.h, routes: 1 + b.alts.length - a0 });
    plan.push({ type: entry.type, seed: entry.seed, style: entry.style, ...(entry.td ? { td: entry.td } : {}), ...(entry.spin ? { spin: entry.spin } : {}), ...(entry.diff !== undefined ? { diff: entry.diff } : {}) });
    return res;
  };

  // ---- 3D clearance: shared footprints are allowed at separate heights; flush joins touch
  const LISTS = ['solids', 'ramps', 'path', 'lips', 'faces', 'signs', 'frames', 'alts', 'movers', 'anchors'];
  const rejected = {};
  const save = () => ({
    n: LISTS.map((k) => b[k].length), px: b.px, pz: b.pz, fx: b.fx, fz: b.fz, h: b._h, w: b.w, travelled, seg: segments.length, mr: b.maxRoutes, style: b.style,
  });
  const restore = (S) => {
    LISTS.forEach((k, j) => { b[k].length = S.n[j]; });
    b.px = S.px; b.pz = S.pz; b.setDir(S.fx, S.fz); b._h = S.h; b.w = S.w; b.maxRoutes = S.mr; b.style = S.style;
    travelled = S.travelled;
    segments.length = S.seg;
    plan.length = S.seg;
  };
  /**
   * Racing line → samples every half metre. A jump / kick flies a ballistic arc well above the
   * straight line through its points (and over several of them on a long drop), so samples after
   * a takeoff ride the arc: takeoff height + jumpV t − g t²/2 at ~8.6 m/s along the line, until
   * the arc falls back under the line.
   */
  const LAUNCH = new Set(['jump', 'kick', 'walljump', 'climbjump']);
  // wallruns ride up the wall (lift, then a wall-jump's rise on top): the line through a wall
  // section sits a couple of metres under where the racer really goes
  const WALL = new Set(['wallrun', 'walljump', 'kick']);
  const sampleSeq = (pts, k0, k1, out, extra) => {
    let fl = null;
    let wallLeft = 0;
    for (let k = Math.max(1, k0 - 8); k < k1; k++) {
      const a = pts[k - 1];
      const c = pts[k];
      if (LAUNCH.has(a.act?.type) || a.j) fl = { y0: a.y, d: 0 };
      if (WALL.has(a.act?.type) || a.w) wallLeft = 4; else if (wallLeft > 0) wallLeft--;
      const dh = Math.hypot(c.x - a.x, c.z - a.z);
      const m = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) / 0.5));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        let y = a.y + (c.y - a.y) * t;
        if (fl) {
          const tt = (fl.d + dh * t) / 8.6;
          const yb = fl.y0 + 8 * tt - 11 * tt * tt;
          if (yb > y) y = yb; else if (tt > 0.35) fl = null;
        }
        if (k >= k0) out.push({ x: a.x + (c.x - a.x) * t, y, z: a.z + (c.z - a.z) * t, up: wallLeft > 0 ? 2.5 : 0, ...extra(a, c) });
      }
      if (fl) fl.d += dh;
    }
  };
  const lineSamples = [];      // racing line of every accepted segment, every half metre
  let sampled = 0;
  let sampledAlts = 0;
  const sampleUpTo = (n, out) => sampleSeq(b.path, Math.max(1, sampled), n, out,
    (a, c) => ({ seg: c.seg ?? -1, m: c.whip ? 1.5 : 0.4, fly: Math.max(c.whip ? 1.8 : 0, c.fly ?? 0, a.fly ?? 0) }));
  const sampleLine = (pts, out, seg) => sampleSeq(pts, 1, pts.length, out, () => ({ seg, m: 0.4 }));
  const bx = (o) => o.sweep ?? o;
  const walk = (o) => o.kind === 'slab' || o.kind === 'step' || o.kind === 'pad';
  /**
   * body envelope of a racing-line sample vs a solid (floors under the feet don't count). The
   * envelope reaches HEAD above the line: a deck stacked over an older route leaves room to jump
   * (apex 1.45 m + body 1.8 m) underneath it.
   */
  const HEAD = 3.6;
  const blocks = (p, o) => {
    const q2 = bx(o);
    // a floor may sit just under the feet, except under a swing / whip (fly = metres of sag)
    if (walk(o) && q2.y1 <= p.y + (p.fly ? -p.fly : 0.3)) return false;
    // anything else is in the way: a whip swings wide of its ideal arc; a wall or block keeps the
    // wall-catch probe (body + 0.85 m) off the line (brushing one starts a wallrun); a deck
    // overhead keeps a body's width plus the bot's steering slop
    // (a deep platform's flank is a wall too)
    const m = Math.max(p.m ?? 0.4, walk(o) && q2.y1 - q2.y0 < 1.5 ? 0.9 : 1.4);
    return p.x > q2.x0 - m && p.x < q2.x1 + m && p.z > q2.z0 - m && p.z < q2.z1 + m
      && q2.y1 > p.y + 0.1 - (p.fly ?? 0) && q2.y0 < p.y + HEAD + (p.up ?? 0);
  };
  const fits = (S) => {
    const i = S.seg;
    const s0 = S.n[0];
    // grapple nodes keep apart: a hook fires at the best node in its cone, so a stacked route
    // must not bring another segment's node into reach of this one's
    const a0 = S.n[LISTS.indexOf('anchors')];
    for (let j = a0; j < b.anchors.length; j++) {
      const A = b.anchors[j];
      for (let k = 0; k < a0; k++) {
        const B = b.anchors[k];
        if (Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) < 18) return false;
      }
    }
    const rampBox = (o) => ({ ...o, y0: Math.min(o.h0, o.h1) - 1.2, y1: Math.max(o.h0, o.h1), kind: 'ramp' });
    const N = [...b.solids.slice(s0), ...b.ramps.slice(S.n[1]).map(rampBox)];
    const old = [...b.solids.slice(0, s0), ...b.ramps.slice(0, S.n[1]).map(rampBox)];
    // headroom over every deck: a racer can be anywhere across a lane (landing off a turn,
    // dodging), so nothing of another segment may hang lower than HEAD over a walkable top
    const overDeck = (hi, deckObj, deck, m) => walk(deckObj)
      && hi.x0 < deck.x1 + m && hi.x1 > deck.x0 - m && hi.z0 < deck.z1 + m && hi.z1 > deck.z0 - m
      && hi.y1 > deck.y1 + 0.1 && hi.y0 < deck.y1 + HEAD;
    for (const n of N) {
      const A = bx(n);
      for (const o of old) {
        const B = bx(o);
        // the segment before may meet us flush; anything older keeps a clear gap
        const m = (o.seg ?? -1) >= i - 1 ? -0.01 : 0.75;
        if (A.x0 < B.x1 + m && A.x1 > B.x0 - m && A.z0 < B.z1 + m && A.z1 > B.z0 - m && A.y0 < B.y1 + m && A.y1 > B.y0 - m) return false;
        const mh = (o.seg ?? -1) >= i - 1 ? -0.01 : 0.3;
        if (overDeck(A, o, B, mh) || overDeck(B, n, A, mh)) return false;
      }
    }
    // new pieces vs the old racing line, and the new racing line vs old pieces
    sampleUpTo(S.n[2], lineSamples);
    sampled = Math.max(sampled, S.n[2]);
    for (; sampledAlts < S.n[7]; sampledAlts++) {
      const line = b.alts[sampledAlts];
      sampleLine(line, lineSamples, line.seg ?? -1);
    }
    for (const p of lineSamples) {
      if (p.seg >= i) continue;
      // the segment before only away from the joint (its line runs flush onto our first piece);
      // a wide arc of its (a pivot whip, a kick) still has to stay clear of what we build
      if (p.seg === i - 1 && Math.hypot(p.x - S.px, p.z - S.pz) < 2.5) continue;
      for (const n of N) if (blocks(p, n)) return false;
    }
    const fresh = [];
    const keep = sampled;
    sampled = S.n[2];
    sampleUpTo(b.path.length, fresh);
    sampled = keep;
    // alternate lines of the new segment count too: a shortcut mustn't run through old geometry
    for (const line of b.alts.slice(S.n[7])) sampleLine(line, fresh, i);
    for (const p of fresh) {
      const nearJoint = Math.hypot(p.x - S.px, p.z - S.pz) < 2.5;
      for (const o of old) {
        const sg = o.seg ?? -1;
        if ((sg < i - 1 || (sg === i - 1 && !nearJoint)) && blocks(p, o)) return false;
      }
    }
    return true;
  };

  /** corners until the route heads north again (south needs two) */
  function closeOut() {
    for (let k = 0; k < 2 && b.heading !== 'N'; k++) {
      modules(b, makeRng(seed ^ (0xf1a1 + k)), diff).corner(b.heading === 'E' ? -1 : 1);
    }
  }

  if (level) {
    for (const e of level.modules ?? []) {
      if (!CATALOG[e.type]) continue;
      place({ ...e, style: STYLES.includes(e.style) ? e.style : 'tiered', seed: (e.seed ?? 1) >>> 0 });
    }
    if (plan.length) {
      last = plan[plan.length - 1].type;
      b.style = plan[plan.length - 1].style;
      if (b.heading !== 'N') latLimit = rng.range(10, 30);
    }
  }
  // random fill: the whole course, or (opts.extend) everything after the level's last segment
  if (!level || opts.extend) {
    /** weighted type choice for the current planner state; `ban` holds types that didn't fit here */
    let pickSpin = 0;
    const pick = (ban) => {
      const lateral = b.heading !== 'N';
      pickSpin = 0;
      if (opts.only) {
        // the planner's entry rules still apply (a speed check is never entered at speed)
        const pool = opts.only.filter((t) => !ban.has(t) && !(TURN_TYPES.has(t) && lateral && latLen < 6)
          && !(lastFast && (CATALOG[t].calmIn || CATALOG[t].precise)));
        return pool.length ? rng.pick(pool) : 'run';
      }
      if (mustRun > 0) return 'run';
      const state = {
        diff, h: b.h, last, lateral, canTurn: !lateral && sinceTurn > 0, up: b.h < 30,
        lastFast, wantDown, mustTurnBack: lateral && latLen > latLimit,
      };
      if (pat) {
        // inside a spiral / hairpin: short legs between turns that all go the same way
        const turnPhase = pat.leg <= 0;
        const tbl = (turnPhase ? SPIRAL_TURN : SPIRAL_LEG)[pat.dir];
        const lastM = CATALOG[last] ?? {};
        const w = {};
        for (const [t, x] of Object.entries(tbl)) {
          const m = CATALOG[t];
          if (!m || ban.has(t) || (t === last && !turnPhase)) continue;
          if (m.family && m.family === lastM.family) continue;
          if (lastFast && (m.precise || m.calmIn)) continue;
          if (!turnPhase && m.w({ ...state, up: true, lateral: false, canTurn: true }) <= 0) continue;
          if (pat.dir === 'up' && b.h > 36) continue;
          w[t] = x * (1 + (t === 'pivot' ? 0 : diff * 0.3));
        }
        if (Object.values(w).some((x) => x > 0)) {
          const t = rng.weighted(w);
          if (turnPhase) pickSpin = pat.spin;
          return t;
        }
        pat.fails++;
        return 'run';
      }
      if (state.mustTurnBack && b.heading === 'S') {
        // facing back down the course: turn away from the way we came unless it is far below
        const w = weights(state, ban);
        if (Object.values(w).some((x) => x > 0)) { pickSpin = retSpin || rng.sign(); return rng.weighted(w); }
      }
      const w = weights(state, ban);
      return Object.values(w).some((x) => x > 0) ? rng.weighted(w) : 'run';
    };

    /** maybe begin a spiral / hairpin here */
    const maybePattern = () => {
      if (pat || opts.only || mustRun > 0 || b.heading === 'S') return;
      const lateral = b.heading !== 'N';
      if (lateral ? latLen < 4 : sinceTurn < 1) return;
      if (!rng.chance((lateral ? 0.18 : 0.3) + 0.15 * diff)) return;
      const kind = rng.weighted({ spiral: 1.6, hairpin: 1 });
      let dir = b.h < -10 ? 'up' : b.h > 24 ? 'down' : rng.weighted({ up: 1.3, level: kind === 'hairpin' ? 1 : 0.4, down: 0.7 });
      if (kind === 'spiral' && dir === 'level') dir = 'up';
      const spin = lateral ? (b.heading === 'E' ? -1 : 1) : rng.sign();
      pat = {
        kind, spin, dir, h0: b.h, fails: 0,
        turns: kind === 'hairpin' ? 2 : lateral ? rng.int(2, 3) : rng.int(3, 4),
        // spirals climb (or dive) a leg before their first turn so the fold clears itself
        leg: dir === 'level' ? rng.int(0, 1) : 1,
      };
    };

    // Reserve the finish approach too: a return leg may otherwise aim its final
    // sixty metres through an earlier tower, even though its next module fits.
    const finishFits = () => {
      const S = save();
      closeOut();
      b.slabC(0, 36, GAUGE.final, b.h, { thick: 3 });
      b.pt(36, 0, b.h);
      const clear = fits(S);
      restore(S);
      lineSamples.length = 0; sampled = 0; sampledAlts = 0;
      return clear;
    };
    const history = [];
    let backtracks = 0;
    while (travelled < length || !finishFits()) {
      if (--styleLeft <= 0) {
        b.style = styleRng.pick(STYLES.filter((x) => x !== b.style));
        styleLeft = styleRng.int(2, 4);
      }
      // place, then make sure the new segment keeps clear of everything already built
      // (the route turns and doubles back, so a piece can reach into an earlier one): if it
      // doesn't, roll it back and try another type
      maybePattern();
      const ban = new Set();
      let type;
      let res;
      let spin = 0;
      const startS = b.path.length;
      let accepted = null;
      for (let tries = 0; tries < 17; tries++) {
        type = tries < 8 ? pick(ban) : 'run';
        spin = tries < 8 ? pickSpin : 0;
        const snap0 = save();
        res = place({ type, seed: rng.int(1, 0x7fffffff), style: b.style, ...(spin && TURN_TYPES.has(type) ? { spin } : {}) });
        if (fits(snap0)) { accepted = snap0; break; }
        restore(snap0);
        ban.add(type);
        rejected[type] = (rejected[type] || 0) + 1;
      }
      if (!accepted) {
        // A stacked structure can box in a later turn. Replan the last few random
        // pieces instead of silently accepting an intersecting fallback runway.
        if (!history.length || ++backtracks > 64) throw new Error(`No clear continuation (seed ${seed})`);
        const rewind = history.splice(Math.max(0, history.length - 3))[0];
        restore(rewind);
        lineSamples.length = 0; sampled = 0; sampledAlts = 0;
        last = plan.at(-1)?.type ?? 'run';
        latLen = 0; latLimit = rng.range(10, 30); sinceTurn = 0;
        mustRun = 0; wantDown = false; pat = null;
        fastLeft = CATALOG[last].fast ? 2 : 0; lastFast = fastLeft > 0;
        continue;
      }
      history.push(accepted);
      if (mustRun > 0 && type === 'run') mustRun--;
      const p0 = b.path[startS - 1];
      const p1 = b.path[b.path.length - 1];
      const moved = p0 ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : 10;
      sinceTurn++;
      if (b.heading !== 'N') latLen += moved;
      if (res?.turned) {
        sinceTurn = 0;
        if (b.heading !== 'N') { latLen = 0; latLimit = b.heading === 'S' ? rng.range(4, 12) : rng.range(8, 20); }
      }
      if (pat) {
        if (res?.turned) { pat.turns--; pat.leg = pat.dir === 'level' ? rng.int(0, 1) : rng.weighted({ 0: 1, 1: 1.2 }); } else pat.leg--;
        if (pat.turns <= 0 || pat.fails > 2) {
          // leaving a pattern heading south: turn back away from the fold unless we're well clear of it
          retSpin = Math.abs(b.h - pat.h0) >= 6 ? 0 : -pat.spin;
          if (b.heading !== 'N') { latLen = 0; latLimit = b.heading === 'S' ? rng.range(2, 8) : rng.range(4, 14); }
          pat = null;
        }
      }
      if (res?.calm) mustRun = Math.max(mustRun, 1);
      const m = CATALOG[type];
      wantDown = m.rises ? rng.chance(0.35) : false;
      // fast exits keep small-target hops and speed checks away for the next two pieces
      // (a speed line's slid exit is hotter still: three pieces). Only a climb really bleeds it.
      fastLeft = m.fast ? (type === 'speedtrap' || type === 'speedcorner' ? 3 : 2)
        : m.rises || type === 'climb' || type === 'ledge' ? 0 : Math.max(0, fastLeft - 1);
      lastFast = fastLeft > 0;
      last = type;
    }
  }

  // ---- final approach: always arrive heading north
  closeOut();
  const finalLen = 36;
  b.w = GAUGE.final;
  b.slabC(0, finalLen, b.w, b.h, { final: true, thick: 3 });
  b.cp(1, 0, b.h);
  b.pt(22, 0, b.h, { finish: true });
  b.pt(finalLen, 0, b.h);
  const coreX = b.X(finalLen + 140, 0);
  const coreZ = b.Z(finalLen + 140, 0);
  const finishGate = { x: b.X(22, 0), z: b.Z(22, 0), y: b.h, yaw: yawOf(b.fx, b.fz), w: b.w };
  b.adv(finalLen);

  // ---- shortcuts between segments: where the folded route brings a later deck in reach
  // experimental (opts.shortcuts): rare so far, and not yet reliable in full races
  const shortcuts = opts.shortcuts ? addShortcuts(b, makeRng((seed ^ 0x5c07c) >>> 0), diff) : 0;

  // ---- free shapes (editor): plain solids anywhere; course dressing keeps clear of them
  const shapes = (level?.shapes ?? []).filter((sh) => SHAPE_KINDS.includes(sh.kind));
  for (const sh of shapes) {
    if (sh.kind === 'anchor') b.anchors.push({ x: sh.x ?? 0, y: sh.y ?? 0, z: sh.z ?? 0, shape: true });
    else b.solids.push(shapeSolid(sh));
  }

  return finalize(b, {
    seed, sector,
    core: { x: coreX, y: b.h + 30, z: coreZ },
    finishGate,
    segments,
    rejected,
    shortcuts,
    maxRoutes: b.maxRoutes,
    level: { version: 2, seed, sector, diff, modules: plan, shapes: shapes.map((sh) => ({ ...sh })) },
  });
}

/** shape {kind, x, y (top), z, w (x size), d (z size), h (height), style?} -> collision solid */
export function shapeSolid(sh) {
  const w = Math.max(GRID, snap(sh.w ?? 4));
  const d = Math.max(GRID, snap(sh.d ?? 4));
  const h = Math.max(GRID, snap(sh.h ?? 1));
  const x0 = snap((sh.x ?? 0) - w / 2);
  const z0 = snap((sh.z ?? 0) - d / 2);
  const y1 = snap(sh.y ?? 0);
  const o = { x0, x1: x0 + w, y0: y1 - h, y1, z0, z1: z0 + d, kind: sh.kind, shape: true };
  if (sh.kind === 'slab') o.style = STYLES.includes(sh.style) ? sh.style : 'tiered';
  return o;
}

// ---------------------------------------------------------------------------- finalize
function finalize(b, extra) {
  // subdivide the racing line and measure it
  const src = b.path;
  const path = [];
  for (let i = 0; i < src.length; i++) {
    const p = src[i];
    if (i > 0) {
      const q = src[i - 1];
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      const n = Math.ceil(d / 2.5);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        path.push({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, z: q.z + (p.z - q.z) * t });
      }
    }
    path.push({ ...p });
  }
  let s = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) s += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
    path[i].s = s;
  }

  const checkpoints = [];
  const actions = [];
  const checks = [];
  let finishS = s;
  path.forEach((p, i) => {
    if (p.cp !== undefined) checkpoints.push({ x: p.x, y: p.y, z: p.z, yaw: p.cp, s: p.s, pi: Math.min(i, path.length - 2) });
    if (p.act) actions.push({ ...p.act, s: p.s, x: p.x, y: p.y, z: p.z });
    if (p.chk) checks.push({ ...p.chk, s: p.s, x: p.x, z: p.z, seg: p.seg });
    if (p.finish) finishS = p.s;
  });

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of path) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }

  // segment extents along the racing line and in space (editor selection / sim reports)
  for (const seg of extra.segments ?? []) { seg.s0 = Infinity; seg.s1 = -Infinity; }
  for (const p of path) {
    const seg = extra.segments?.[p.seg];
    if (seg) { seg.s0 = Math.min(seg.s0, p.s); seg.s1 = Math.max(seg.s1, p.s); }
  }
  for (const o of b.solids) {
    const seg = extra.segments?.[o.seg];
    if (!seg) continue;
    seg.box ??= { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    const q2 = o.sweep ?? o;
    for (const k of ['x0', 'y0', 'z0']) seg.box[k] = Math.min(seg.box[k], q2[k]);
    for (const k of ['x1', 'y1', 'z1']) seg.box[k] = Math.max(seg.box[k], q2[k]);
  }

  const sp = checkpoints[0];
  dress(b, path, makeRng((extra.seed ^ 0x5eed) >>> 0));
  extra.movers = b.movers;
  extra.alts = b.alts;
  extra.anchors = b.anchors;
  const world = buildWorld(b.solids, b.ramps);
  return {
    ...extra,
    solids: b.solids,
    ramps: b.ramps,
    lips: b.lips,
    faces: b.faces,
    signs: b.signs,
    world,
    path,
    actions,
    checkpoints,
    checks,
    finishS,
    length: s,
    minY: minY - 26,
    maxY,
    spawn: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw },
  };
}

/** Point on the racing line at distance s (for cameras and scenery). */
export function pathAt(track, s, out = {}) {
  const P = track.path;
  let lo = 0;
  let hi = P.length - 1;
  if (s <= 0) return Object.assign(out, P[0]);
  if (s >= P[hi].s) return Object.assign(out, P[hi]);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P[m].s <= s) lo = m; else hi = m;
  }
  const a = P[lo];
  const c = P[hi];
  const t = (s - a.s) / (c.s - a.s || 1);
  out.x = a.x + (c.x - a.x) * t;
  out.y = a.y + (c.y - a.y) * t;
  out.z = a.z + (c.z - a.z) * t;
  out.dx = c.x - a.x;
  out.dz = c.z - a.z;
  const L = Math.hypot(out.dx, out.dz) || 1;
  out.dx /= L;
  out.dz /= L;
  out.i = lo;
  return out;
}
