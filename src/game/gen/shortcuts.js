// Cross-segment shortcuts. Once the course is laid, spirals and hairpins leave later decks in
// jump or drop reach of earlier ones. This pass finds those places and turns the best of them
// into marked shortcuts: jump the gap between two legs, or drop off an upper leg onto the one
// below, and skip everything in between. Each is an alternate line (tag 'shortcut'), so
// `sim --alt` races it like any fork, and the flight is cleared against every solid on course.
import { jumpReach, yawOf, ROUTE_LABEL } from './builder.js';
import { buildWorld } from '../world.js';
import { Racer } from '../racer.js';
import { BotController } from '../bot.js';

const HEAD = 3.6;
const walk = (o) => o.kind === 'slab' || o.kind === 'step' || o.kind === 'pad';

/** cumulative distance along the raw racing line */
function arcLength(path) {
  const s = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const c = path[i];
    s.push(s[i - 1] + Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z));
  }
  return s;
}

/** ballistic samples of a flight: run-up point → takeoff (jump) → landing */
function flight(pre, take, land, speed = 7.5) {
  const out = [];
  const seg = (a, c, n) => { for (let k = 0; k <= n; k++) out.push({ x: a.x + (c.x - a.x) * k / n, y: a.y, z: a.z + (c.z - a.z) * k / n, ground: true }); };
  seg(pre, take, Math.max(2, Math.ceil(Math.hypot(take.x - pre.x, take.z - pre.z) / 0.5)));
  const D = Math.hypot(land.x - take.x, land.z - take.z);
  const n = Math.max(4, Math.ceil(D / 0.4));
  for (let k = 1; k <= n; k++) {
    const t = (k / n) * (D / speed);
    const y = Math.max(take.y + 8 * t - 11 * t * t, land.y);
    out.push({ x: take.x + (land.x - take.x) * k / n, y, z: take.z + (land.z - take.z) * k / n });
  }
  return out;
}

/** is the flight (and the landing zone) clear of every solid except its two decks? */
function clear(samples, solids, A, B) {
  for (const p of samples) {
    for (const o of solids) {
      if (o === A || o === B) continue;
      const q = o.sweep ?? o;
      if (walk(o) && q.y1 <= p.y + 0.3) continue;
      const m = walk(o) && q.y1 - q.y0 < 1.5 ? 0.9 : 1.4;
      if (p.x > q.x0 - m && p.x < q.x1 + m && p.z > q.z0 - m && p.z < q.z1 + m && q.y1 > p.y + 0.1 && q.y0 < p.y + HEAD) return false;
    }
  }
  return true;
}

export function addShortcuts(b, rng, diff) {
  const P = b.path;
  if (P.length < 10) return 0;
  const S = arcLength(P);
  // walkable decks and where the racing line runs on them
  const decks = [];
  for (const o of b.solids) {
    if (o.kind !== 'slab' || o.mover || o.deco || o.start || o.final || o.seg === undefined) continue;
    const on = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.x > o.x0 - 0.05 && p.x < o.x1 + 0.05 && p.z > o.z0 - 0.05 && p.z < o.z1 + 0.05 && Math.abs(p.y - o.y1) < 0.3) on.push(i);
    }
    if (on.length) decks.push({ o, first: on[0], last: on[on.length - 1] });
  }
  const cands = [];
  for (const A of decks) {
    for (const B of decks) {
      if (B.o.seg < A.o.seg + 2) continue;
      const save = S[B.first] - S[A.last];
      if (save < 30) continue;
      const dh = B.o.y1 - A.o.y1;
      if (dh > 3.5 || dh < -8) continue;
      for (const ax of ['x', 'z']) {
        const bx = ax === 'x' ? 'z' : 'x';
        // the decks must face each other across `ax` with a shared stretch along `bx`
        const lo = Math.max(A.o[`${bx}0`], B.o[`${bx}0`]) + 1;
        const hi = Math.min(A.o[`${bx}1`], B.o[`${bx}1`]) - 1;
        if (hi - lo < 0) continue;
        for (const dir of [1, -1]) {
          const edgeA = dir > 0 ? A.o[`${ax}1`] : A.o[`${ax}0`];
          const nearB = dir > 0 ? B.o[`${ax}0`] : B.o[`${ax}1`];
          const farB = dir > 0 ? B.o[`${ax}1`] : B.o[`${ax}0`];
          let gap = (nearB - edgeA) * dir;
          let landAt;
          const drop = -dh;
          let climb = 0;
          if (dh > 1.25) {
            // the later deck is a storey up: a climb block fills the gap, face flush with our edge
            if (gap < 1.5 || gap > 4) continue;
            climb = dh;
            landAt = nearB + dir * 1.6;
          } else if (dh > 0.75) {
            continue;
          } else if (gap >= 1 && drop >= -0.75) {
            // a jump across open air (a drop past 3.5 m is rolled)
            const reach = drop > 0.5 ? Math.min(4.5, jumpReach(dh, 6.5) * 0.7) : 3;
            if (gap > reach) continue;
            landAt = nearB + dir * (drop > 3.5 ? 2.5 : 1.6);
          } else if (drop >= 3 && (farB - edgeA) * dir >= 3) {
            // the lower deck runs on past the upper one's edge: run off and drop onto it
            gap = 0;
            landAt = edgeA + dir * 1.8;
          } else continue;
          if ((farB - landAt) * dir < 1.2) continue;
          // run-up: the upper deck must give 2 m along the jump
          if ((dir > 0 ? A.o[`${ax}1`] - A.o[`${ax}0`] : A.o[`${ax}1`] - A.o[`${ax}0`]) < 2.5) continue;
          const c = (lo + hi) / 2;
          const pt = (a, y) => (ax === 'x' ? { x: a, y, z: c } : { x: c, y, z: a });
          const pre = pt(edgeA - dir * 2.2, A.o.y1);
          const take = pt(edgeA - dir * 0.35, A.o.y1);
          const land = pt(landAt, B.o.y1);
          cands.push({ A, B, save, pre, take, land, drop, climb, gap, lo, hi, dirX: ax === 'x' ? dir : 0, dirZ: ax === 'z' ? dir : 0, ax, c, edgeA });
        }
      }
    }
  }
  if (!cands.length) return 0;
  // biggest savings first, with a little shuffle so neighbouring seeds differ
  cands.sort((p, q) => (q.save + rng.range(0, 25)) - (p.save + rng.range(0, 25)));
  const want = 1 + (diff > 0.35 ? 1 : 0) + (diff > 0.7 ? 1 : 0);
  const taken = [];
  for (const cd of cands) {
    if (taken.length >= want) break;
    const s0 = S[cd.A.last] - 15;
    const s1 = S[cd.B.first] + 15;
    if (taken.some((t) => s0 < t.s1 && s1 > t.s0)) continue;
    // approach: from where the line runs on the upper deck, veer at most ~45° into the jump
    // (a bisector between the line and the jump direction), like a turn-and-jump corner
    const near = nearestOn(P, cd.A, cd.take);
    let from = near;
    while (from > cd.A.first && Math.hypot(P[from].x - cd.take.x, P[from].z - cd.take.z) < 4.5) from--;
    const fx = P[from].x - cd.take.x;
    const fz = P[from].z - cd.take.z;
    const fl0 = Math.hypot(fx, fz);
    if (fl0 < 3) continue;
    // never backwards: the line must come toward the edge, not run away from it
    if ((-fx * cd.dirX - fz * cd.dirZ) / fl0 < -0.2) continue;
    let px = fx / fl0 - cd.dirX;
    let pz = fz / fl0 - cd.dirZ;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;
    cd.pre = { x: cd.take.x + px * 2.2, y: cd.A.o.y1, z: cd.take.z + pz * 2.2 };
    const Ao = cd.A.o;
    if (cd.pre.x < Ao.x0 + 0.3 || cd.pre.x > Ao.x1 - 0.3 || cd.pre.z < Ao.z0 + 0.3 || cd.pre.z > Ao.z1 - 0.3) continue;
    // a sharp veer leaves less speed for the jump
    const veer = (-fx * cd.dirX - fz * cd.dirZ) / fl0;
    if (!cd.climb && cd.drop < 3 && veer < 0.5 && cd.gap > 2.5) continue;
    let blk = null;
    let fl;
    if (cd.climb) {
      // climb block: from below our deck up to the later deck's top, across the gap
      const e = cd.edgeA;
      const n = e + (cd.dirX || cd.dirZ) * cd.gap;
      const [a0, a1] = [Math.min(e, n), Math.max(e, n)];
      const [c0, c1] = [cd.c - 1.25, cd.c + 1.25];
      blk = cd.ax === 'x'
        ? { x0: a0, x1: a1, z0: c0, z1: c1, y0: cd.A.o.y1 - 3, y1: cd.B.o.y1, kind: 'block', climbFace: true, seg: cd.B.o.seg }
        : { x0: c0, x1: c1, z0: a0, z1: a1, y0: cd.A.o.y1 - 3, y1: cd.B.o.y1, kind: 'block', climbFace: true, seg: cd.B.o.seg };
      if (!blockFits(blk, b, cd.A.o, cd.B.o)) continue;
      const top = { ...cd.land, x: cd.land.x - (cd.dirX * (cd.gap + 1.2)), z: cd.land.z - (cd.dirZ * (cd.gap + 1.2)) };
      fl = flight(P[from], cd.take, { ...top, y: cd.B.o.y1 });
      fl = fl.filter((p) => p.ground);
      cd.top = top;
    } else {
      fl = [...flight(P[from], cd.pre, cd.pre).filter((p) => p.ground), ...flight(cd.pre, cd.take, cd.land)];
    }
    if (!clear(fl, b.solids, cd.A.o, cd.B.o)) continue;
    cd.blk = blk;
    const to = nextOn(P, cd.B, cd.land);
    if (from < 0 || to < 0) continue;
    if (!trial(b, P, from, to, cd)) continue;
    if (cd.blk) b.solids.push(cd.blk);
    taken.push({ ...cd, from, to, s0, s1 });
  }
  if (!taken.length) return 0;
  // lay them: last first, so splices don't shift the indices of the earlier ones
  taken.sort((p, q) => q.from - p.from);
  for (const t of taken) {
    const segA = t.A.o.seg;
    const segB = t.B.o.seg;
    const line = cutLine(t);
    // runner vision: the takeoff edge and a SHORTCUT marker over it
    const along = t.ax === 'x' ? 'z' : 'x';
    const e0 = { [t.ax]: t.edgeA, [along]: t.c - 1.5 };
    const e1 = { [t.ax]: t.edgeA, [along]: t.c + 1.5 };
    b.lips.push({ x0: e0.x, z0: e0.z, x1: e1.x, z1: e1.z, y: t.A.o.y1 });
    b.signs.push({ x: t.pre.x, y: t.A.o.y1 + 2.6, z: t.pre.z, yaw: yawOf(t.dirX, t.dirZ), td: 0, kind: 'alt', label: ROUTE_LABEL.shortcut });
    const main = P.slice(t.from, t.to + 1).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const alt = [P[t.from], ...line, P[t.to]].map((p) => ({ x: p.x, y: p.y, z: p.z, ...(p.act?.type === 'jump' ? { j: true } : {}) }));
    if (b.prefer > 0) {
      // race the shortcut (sim --alt): splice it into the line, keep the skipped stretch as an alt
      P.splice(t.from + 1, t.to - t.from - 1, ...line);
      main.tag = 'main';
      main.seg = segA;
      b.alts.push(main);
    } else {
      alt.tag = 'shortcut';
      alt.seg = segA;
      b.alts.push(alt);
    }
  }
  b.maxRoutes = Math.max(b.maxRoutes, 2);
  return taken.length;
}

/** index of the racing-line point on deck A closest to (but not past) the run-up point */
function nearestOn(P, A, q) {
  let best = -1;
  let bd = Infinity;
  for (let i = A.first; i <= A.last; i++) {
    const d = Math.hypot(P[i].x - q.x, P[i].z - q.z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** first racing-line point on deck B at or past the landing (along the line) */
function nextOn(P, B, q) {
  let best = -1;
  let bd = Infinity;
  for (let i = B.first; i <= B.last; i++) {
    const d = Math.hypot(P[i].x - q.x, P[i].z - q.z);
    if (d < bd) { bd = d; best = i; }
  }
  return best < 0 ? -1 : Math.min(best + 1, B.last);
}

/** a shortcut's climb block must clear every solid (but its two decks) and every racing line */
function blockFits(blk, b, A, B) {
  for (const o of b.solids) {
    if (o === A || o === B) continue;
    const q = o.sweep ?? o;
    if (blk.x0 < q.x1 + 0.5 && blk.x1 > q.x0 - 0.5 && blk.z0 < q.z1 + 0.5 && blk.z1 > q.z0 - 0.5 && blk.y0 < q.y1 + 0.5 && blk.y1 > q.y0 - 0.5) return false;
  }
  const lines = [b.path, ...b.alts];
  for (const L of lines) {
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1]; const c = L[i];
      const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.5));
      for (let k = 0; k <= n; k++) {
        const x = a.x + (c.x - a.x) * k / n; const y = a.y + (c.y - a.y) * k / n; const z = a.z + (c.z - a.z) * k / n;
        if (x > blk.x0 - 1.4 && x < blk.x1 + 1.4 && z > blk.z0 - 1.4 && z < blk.z1 + 1.4 && blk.y1 > y + 0.1 && blk.y0 < y + HEAD + 2) {
          // the shortcut's own decks touch it: only lines on those decks' tops may come close
          if (Math.abs(y - A.y1) < 0.3 || Math.abs(y - B.y1) < 0.3) {
            if (x > blk.x0 + 0.05 && x < blk.x1 - 0.05 && z > blk.z0 + 0.05 && z < blk.z1 - 0.05) return false;
            continue;
          }
          return false;
        }
      }
    }
  }
  return true;
}

/** the racing-line points of a shortcut, from the run-up to the landing */
function cutLine(t) {
  const segA = t.A.o.seg;
  const segB = t.B.o.seg;
  if (t.blk) {
    return [
      { ...t.pre, seg: segA },
      { ...t.take, x: t.take.x - t.dirX * 0.15, z: t.take.z - t.dirZ * 0.15, seg: segA, act: { type: 'climb', lead: 1.0 } },
      { x: t.take.x + t.dirX * 1.1, y: t.B.o.y1, z: t.take.z + t.dirZ * 1.1, seg: segB },
      { ...t.land, seg: segB },
    ];
  }
  return [
    { ...t.pre, seg: segA },
    { ...t.take, seg: segA, act: { type: 'jump', lead: 0.25 } },
    t.drop >= 3.5 ? { x: (t.take.x + t.land.x) / 2, y: t.land.y + 1.2, z: (t.take.z + t.land.z) / 2, seg: segB, act: { type: 'roll', h: t.land.y } } : null,
    { ...t.land, seg: segB },
  ].filter(Boolean);
}

/**
 * Race the shortcut before keeping it: a perfect bot runs in from 14 m up the line at speed,
 * takes the cut and must carry on along the line past the landing without a fall, bonk or
 * failed climb. Geometry rules can't see every way a flight goes wrong; the racer can.
 */
function trial(b, P, from, to, cd) {
  let i0 = from;
  let back = 0;
  while (i0 > 0 && back < 14) { back += Math.hypot(P[i0].x - P[i0 - 1].x, P[i0].z - P[i0 - 1].z); i0--; }
  const i1 = Math.min(P.length - 1, to + 3);
  const raw = [...P.slice(i0, from + 1), ...cutLine(cd), ...P.slice(to, i1 + 1)];
  const path = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (i > 0) {
      const q = raw[i - 1];
      const n = Math.ceil(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / 2.5);
      for (let k = 1; k < n; k++) path.push({ x: q.x + (p.x - q.x) * k / n, y: q.y + (p.y - q.y) * k / n, z: q.z + (p.z - q.z) * k / n });
    }
    path.push({ ...p });
  }
  let sAcc = 0;
  path.forEach((p, i) => { if (i) sAcc += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z); p.s = sAcc; });
  if (path.length < 3) return false;
  const actions = path.filter((p) => p.act).map((p) => ({ ...p.act, s: p.s, x: p.x, y: p.y, z: p.z }));
  const sp = path[0];
  const yaw = yawOf(path[1].x - sp.x, path[1].z - sp.z);
  let minY = Infinity;
  for (const p of path) minY = Math.min(minY, p.y);
  const solids = cd.blk ? [...b.solids, cd.blk] : b.solids;
  const track = {
    world: buildWorld(solids, b.ramps), path, actions, anchors: b.anchors,
    checkpoints: [{ x: sp.x, y: sp.y, z: sp.z, yaw, s: 0, pi: 0 }],
    finishS: sAcc - 1, finishGate: null, minY: minY - 20, spawn: { x: sp.x, y: sp.y, z: sp.z, yaw },
  };
  const r = new Racer(track);
  const L = Math.hypot(path[1].x - sp.x, path[1].z - sp.z) || 1;
  r.vx = ((path[1].x - sp.x) / L) * 8.4;
  r.vz = ((path[1].z - sp.z) / L) * 8.4;
  const bot = new BotController(track, 1, { speedMul: 1, jitter: 0, mistake: 0 });
  let bad = false;
  for (let k = 0; k < 120 * 9 && !r.finished && !bad; k++) {
    r.step(1 / 120, bot.getInput(r));
    for (const e of r.events) if (e.type === 'fall' || e.type === 'bonk' || e.type === 'climbfail' || e.type === 'hardland') bad = true;
    r.events.length = 0;
  }
  return r.finished && !bad;
}
