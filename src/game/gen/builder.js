// The course builder: a cursor that walks forward (u) and sideways (v) in a local frame and lays
// solids, the racing line, runner-vision marks and bot actions. Modules (gen/mod_*.js) only ever
// talk to this, never to world coordinates. Pure data, no Three.js.
import { BASE_STATS, GEN_SPEED } from '../constants.js';
import { GRID, snap, snapLo, snapHi, PLATE, GAUGE, sweepOf } from '../kit.js';

/** Horizontal distance of a ground jump at `speed` landing dh higher (+) or lower (-). */
export function jumpReach(dh, speed = GEN_SPEED) {
  const { jumpV: v, gravity: g } = BASE_STATS;
  const disc = v * v - 2 * g * dh;
  if (disc < 0) return 0;
  return ((v + Math.sqrt(disc)) / g) * speed;
}

/**
 * Speeds off a downhill ramp of height `drop` (generator model of racer.stepGround):
 *  - slide: sliding converts the drop into speed (0.85 g along the slope, no friction downhill)
 *  - run:   running only lifts the cap by a quarter of the slope pull, at full flow
 * Speed-check gaps sit between the two, so only a slid ramp clears them.
 */
export function rampSpeeds(drop, len) {
  const { maxSpeed, flowBonus, gravity: g } = BASE_STATS;
  const v0 = maxSpeed + 1.1;                       // slide-start boost
  const slide = Math.sqrt(v0 * v0 + 2 * 0.85 * g * drop);
  const run = maxSpeed * (1 + flowBonus) + 0.25 * g * (drop / len);
  return { slide, run };
}

/** Time a ground jump spends in the air before falling to dh (below the takeoff when dh < 0). */
export function airTime(dh) {
  const { jumpV: v, gravity: g } = BASE_STATS;
  const disc = v * v - 2 * g * dh;
  return disc < 0 ? 0 : (v + Math.sqrt(disc)) / g;
}

export const yawOf = (fx, fz) => Math.atan2(-fx, -fz);

/** What each route tag says on its marker sign (and in the editor). */
export const ROUTE_LABEL = { skill: 'SKILL LINE', speed: 'SPEED LINE', high: 'HIGH LINE', low: 'LOW LINE', shortcut: 'SHORTCUT' };

/**
 * Headings are axis-aligned. Multi-level ribbons can return south and cross earlier
 * legs at a different height; ordinary modules keep their entry/exit heading. Everything floats in a void: slabs (platforms), blocks (climbable
 * monoliths), walls (wallrun panels), pillars. No buildings.
 */
export class Builder {
  constructor(rng) {
    this.rng = rng;
    this.solids = [];
    this.ramps = [];
    this.path = [];
    this.lips = [];       // takeoff edges for runner-vision lines
    this.faces = [];      // runner-vision panels: wallrun bands, climb faces
    this.signs = [];      // holo arrows at turns / route markers
    this.frames = [];     // gantry frame candidates over runways (resolved in dress())
    this.alts = [];       // alternate lines (forks / shortcuts): world-space polylines, .tag
    this.movers = [];     // moving platforms
    this.anchors = [];    // grapple anchor nodes
    this.style = 'tiered';
    this.prefer = 0;      // debug/sim: which route of every fork is raced (0 = main line)
    this.maxRoutes = 1;
    this.px = 0;
    this.pz = 0;
    this._h = 0;
    this.w = GAUGE.lane;
    this.setDir(0, -1);
  }

  /** current floor height (always on the grid, so every module's floors line up) */
  get h() { return this._h; }
  set h(v) { this._h = snap(v); }

  setDir(fx, fz) {
    this.fx = fx; this.fz = fz;
    this.rx = -fz; this.rz = fx;
  }

  get heading() {
    return this.fz < 0 ? 'N' : this.fz > 0 ? 'S' : this.fx > 0 ? 'E' : 'W';
  }

  X(u, v) { return this.px + this.fx * u + this.rx * v; }
  Z(u, v) { return this.pz + this.fz * u + this.rz * v; }

  box(u0, u1, v0, v1, y0, y1, kind, extra = {}) {
    const xa = this.X(u0, v0); const xb = this.X(u1, v1);
    const za = this.Z(u0, v0); const zb = this.Z(u1, v1);
    const walk = kind === 'slab' || kind === 'step' || kind === 'pad';
    const lo = walk ? snapLo : snap;
    const hi = walk ? snapHi : snap;
    const o = {
      x0: lo(Math.min(xa, xb)), x1: hi(Math.max(xa, xb)), y0: snap(y0), y1: snap(y1),
      z0: lo(Math.min(za, zb)), z1: hi(Math.max(za, zb)), kind, ...extra,
    };
    if (o.x1 - o.x0 < GRID) o.x1 = o.x0 + GRID;
    if (o.z1 - o.z0 < GRID) o.z1 = o.z0 + GRID;
    if (o.y1 - o.y0 < GRID) o.y0 = o.y1 - GRID;
    this.solids.push(o);
    return o;
  }

  /** Floating platform: the running surface is its top. Built in the current structure style. */
  slab(u0, u1, v0, v1, h, extra = {}) {
    const thick = extra.thick ?? PLATE;
    return this.box(u0, u1, v0, v1, h - thick, h, extra.kind ?? 'slab', { style: this.style, ...extra });
  }

  /** Slab centred on the line (v = 0), `w` wide. */
  slabC(u0, u1, w, h, extra) {
    return this.slab(u0, u1, -w / 2, w / 2, h, extra);
  }

  /**
   * Moving platform: a slab whose offset is amp * sin(2π t / T + ph) along local (du, dv, dy).
   * Racers standing on it are carried (racer.ride).
   */
  moverSlab(u0, u1, v0, v1, h, { du = 0, dv = 0, dy = 0, T = 3, ph = 0, axis = 'side' } = {}) {
    const o = this.slab(u0, u1, v0, v1, h, { thick: 0.75, kind: 'slab', noWall: true });
    o.mover = { ax: this.fx * du + this.rx * dv, ay: dy, az: this.fz * du + this.rz * dv, T, ph, axis };
    o.base = { x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1, z0: o.z0, z1: o.z1 };
    o.sweep = sweepOf(o);
    this.movers.push(o);
    return o;
  }

  /** Solid monolith with a climbable face from well below the current floor. */
  block(u0, u1, v0, v1, h, extra = {}) {
    return this.box(u0, u1, v0, v1, Math.min(this.h, h) - (extra.below ?? 3), h, 'block', extra);
  }

  /** Straight downhill (or uphill) ramp from u0 at h0 to u1 at h1, `w` wide, with its base. */
  ramp(u0, u1, w, h0, h1) {
    const X0 = this.X(u0, -w / 2); const X1 = this.X(u1, w / 2);
    const Z0 = this.Z(u0, -w / 2); const Z1 = this.Z(u1, w / 2);
    const axis = this.fx !== 0 ? 'x' : 'z';
    this.ramps.push({
      x0: snap(Math.min(X0, X1)), x1: snap(Math.max(X0, X1)), z0: snap(Math.min(Z0, Z1)), z1: snap(Math.max(Z0, Z1)),
      axis, c0: snap(axis === 'x' ? this.X(u0, 0) : this.Z(u0, 0)), c1: snap(axis === 'x' ? this.X(u1, 0) : this.Z(u1, 0)),
      h0: snap(h0), h1: snap(h1), w,
    });
    const lo = Math.min(h0, h1);
    this.box(u0, u1, -w / 2, w / 2, lo - 1.2, lo, 'rampbase');
  }

  /**
   * Several ways through one stretch. Each route lays its racing-line points with pt(); the
   * first is the main line (bot, progress, checkpoints), the rest are kept as alternate lines
   * for clearance and runner vision. `prefer` picks which one is raced instead (sim --alt N),
   * which is how every shortcut is proven makeable. routes: [{ tag, lay }] or plain functions.
   */
  routes(list) {
    const P = this.path;
    const n0 = P.length;
    const laid = list.map((r) => {
      const lay = typeof r === 'function' ? r : r.lay;
      lay();
      return { tag: (typeof r === 'function' ? null : r.tag) ?? 'skill', pts: P.splice(n0) };
    });
    const k = Math.min(this.prefer, laid.length - 1);
    this.maxRoutes = Math.max(this.maxRoutes, laid.length);
    const prev = P[n0 - 1];
    P.push(...laid[k].pts);
    laid.forEach((r, j) => {
      if (j === k) return;
      const line = [prev, ...r.pts].filter(Boolean).map((p) => ({ x: p.x, y: p.y, z: p.z, ...(p.act?.type === 'jump' ? { j: true } : {}), ...(['wallrun', 'walljump', 'kick'].includes(p.act?.type) ? { w: true } : {}) }));
      line.tag = j === 0 ? 'main' : r.tag;
      this.alts.push(line);
    });
  }

  /** Back-compat two-way fork (main, alt). */
  fork(main, alt, tag = 'skill') {
    this.routes([{ tag: 'main', lay: main }, { tag, lay: alt }]);
  }

  /**
   * Grapple anchor node hanging in the void at local (u, v), height y. kind 'swing' is a
   * pendulum node overhead; 'pivot' is a post beside the line you whip round horizontally.
   */
  anchor(u, v, y, kind = 'swing') {
    // swing nodes remember the heading they're swung along (their rings stand in that plane)
    const a = { x: this.X(u, v), y, z: this.Z(u, v), kind, dir: { x: this.fx, z: this.fz } };
    this.anchors.push(a);
    return a;
  }

  /**
   * The whip a pivot post carries you round, for the view: radius R, starting at local angle
   * a0 (u = cos, v = sin, centred on the post) and sweeping `sweep` rad, at height y.
   * The local frame is a pure rotation of the world one, so the sweep keeps its sense.
   */
  whip(A, R, a0, sweep, y) {
    const c = Math.cos(a0);
    const s = Math.sin(a0);
    A.arc = { r: R, a0: Math.atan2(this.fz * c + this.rz * s, this.fx * c + this.rx * s), sweep, y };
    return A;
  }

  pt(u, v, y, extra = {}) {
    const p = { x: this.X(u, v), y, z: this.Z(u, v), ...extra };
    this.path.push(p);
    return p;
  }

  /** Respawn checkpoint on the racing line. */
  cp(u, v, y) {
    return this.pt(u, v, y, { cp: yawOf(this.fx, this.fz) });
  }

  /** Runner-vision panel on a wall parallel to travel, at side offset v, from u0 to u1. */
  runFace(v, u0, u1, y0, y1, nSide) {
    this.faces.push({
      kind: 'run', y0, y1,
      ax: this.X(u0, v), az: this.Z(u0, v), bx: this.X(u1, v), bz: this.Z(u1, v),
      nx: this.rx * nSide, nz: this.rz * nSide,
    });
  }

  /** Runner-vision panel on a face across travel (climb walls); back = facing ahead instead. */
  climbFace(u, v0, v1, y0, y1, back = false) {
    const k = back ? 1 : -1;
    this.faces.push({
      kind: 'climb', y0, y1,
      ax: this.X(u, v0), az: this.Z(u, v0), bx: this.X(u, v1), bz: this.Z(u, v1),
      nx: k * this.fx, nz: k * this.fz,
    });
  }

  /** Candidate gantry frame across the route at u (posts just outside a runway of width w). */
  frame(u, w) {
    this.frames.push({ x: this.X(u, 0), z: this.Z(u, 0), y: this.h, w, alongX: this.fx !== 0 });
  }

  /**
   * Holo sign facing back toward the approach. kind 'turn' / 'pivot': arrows to the side we
   * turn to (td); kind 'alt': a route marker whose arrows point ahead, labelled by route tag.
   */
  sign(u, v, y, td, kind = 'turn', tag) {
    this.signs.push({ x: this.X(u, v), y, z: this.Z(u, v), yaw: yawOf(this.fx, this.fz), td, kind, ...(tag ? { label: ROUTE_LABEL[tag] ?? tag } : {}) });
  }

  lip(u, v0, v1, y) {
    this.lips.push({ x0: this.X(u, v0), z0: this.Z(u, v0), x1: this.X(u, v1), z1: this.Z(u, v1), y });
  }

  /** takeoff edge running along travel (side edges) */
  lipAlong(v, u0, u1, y) {
    this.lips.push({ x0: this.X(u0, v), z0: this.Z(u0, v), x1: this.X(u1, v), z1: this.Z(u1, v), y });
  }

  adv(u, v = 0) {
    this.px = this.X(u, v);
    this.pz = this.Z(u, v);
    this.snapCursor();
  }

  /**
   * Put the cursor on the grid, rounding *forward* along travel: walkable extents snap outward,
   * so the far edge of the piece we just laid sits on the next grid line ahead. The next piece
   * then starts flush against it instead of overlapping it by a grid step (coplanar seams).
   */
  snapCursor() {
    const f = (x, d) => (d > 0 ? snapHi(x) : d < 0 ? snapLo(x) : snap(x));
    this.px = f(this.px, this.fx);
    this.pz = f(this.pz, this.fz);
  }

  turn(td) {
    // td +1 = right, -1 = left
    if (td > 0) this.setDir(this.rx, this.rz); else this.setDir(-this.rx, -this.rz);
  }

  /** Move the cursor to local (u, v) and turn toward td: the next piece starts there. */
  pivot(u, v, td) {
    this.px = this.X(u, v);
    this.pz = this.Z(u, v);
    this.turn(td);
    this.snapCursor();
  }

  /** Resolve a local-frame target into world coords on an action. */
  tgt(act, u, v) {
    act.tx = this.X(u, v);
    act.tz = this.Z(u, v);
    return act;
  }
}
