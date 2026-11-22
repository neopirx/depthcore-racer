// Helpers every module family shares: the gauge-aware runway, hop spacing from jump physics,
// turn sides, pivot arcs. makeCtx() binds them to one builder + one segment's rng stream.
import { BASE_STATS } from '../constants.js';
import { DATUM, GAUGE, q, snap } from '../kit.js';
import { jumpReach } from './builder.js';

export function makeCtx(b, r, diff) {
  const G = GAUGE;
  const ctx = {
    b, r, diff, G,

    /** the standard lead-in: a lane-gauge slab from the cursor, with a checkpoint near its start */
    runway(L, w = G.lane) {
      b.w = w;
      b.slabC(0, L, w, b.h);
      b.cp(Math.min(1, L * 0.25), 0, b.h);
      if (L >= 5 && r.chance(0.12)) b.frame(L * 0.45, w);
    },

    /**
     * Forward gap to a small target so a full-speed jump lands near its middle:
     * jumps can't be shortened, so spacing is what makes a hop sequence readable.
     */
    hopGap(dh, dv, half) {
      const D = jumpReach(dh, 8.4) * r.range(0.84, 0.94);
      const fwd = Math.sqrt(Math.max(1, D * D - dv * dv));
      return Math.max(0.8, fwd - 0.35 - half);
    },

    /**
     * Length a small hop target needs so a jump at full-flow speed still lands on it
     * (takeoff 0.35 m before the edge, gap g, 0.3 m of footing left past the touchdown).
     */
    overrun(dh, g) {
      return jumpReach(dh, BASE_STATS.maxSpeed * (1 + BASE_STATS.flowBonus) + 0.1) - 0.35 - g + 0.3;
    },

    /** turn direction: from north pick a side; from a lateral leg always turn back north */
    turnDir(td) {
      return td ?? (b.heading === 'N' ? r.sign() : b.heading === 'E' ? -1 : 1);
    },

    /** side for a sideways excursion: either way heading north, never back south on a lateral leg */
    sideDir() {
      return b.heading === 'N' ? r.sign() : b.heading === 'E' ? -1 : 1;
    },

    /** racing-line points round a pivot post at (cu, cv): angle a0 (u = cos, v = sin), sweeping `sweep` rad */
    arc(cu, cv, R, a0, sweep, y, n = 5) {
      for (let i = 1; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        b.pt(cu + R * Math.cos(a), cv + R * Math.sin(a), y, { whip: true });
      }
    },

    /** thin wall along travel at side offset v, from u0 to u1, standing to h + 4.5 */
    divider(v, u0, u1, h, t = G.div) {
      return b.box(u0, u1, v - t / 2, v + t / 2, h - DATUM, h + 4.5, 'wall', { noRibs: true });
    },

    /**
     * Whip radius round a pivot post: wide and forgiving early on (a long, readable arc you can
     * see coming), tightening toward the hard sectors.
     */
    whipR(lo = 0) {
      return Math.max(lo, snap(q(r, 3.75 - 1.25 * diff, 4.5 - 1.0 * diff, 0.25)));
    },

    /** lay the exit deck of a module: centred at v, from u0, L long, w wide; cursor to its end */
    exit(u0, L, h, { v = 0, w = G.lane, cpAt = 1.5, extra } = {}) {
      b.slab(u0, u0 + L, v - w / 2, v + w / 2, h, extra);
      b.h = h;
      b.w = w;
      b.cp(u0 + Math.min(cpAt, L * 0.5), v, h);
      b.pt(u0 + L, v, h);
      b.adv(u0 + L, v);
    },

    /** gate across a lane [v0, v1] at u: slide under it; a pylon on the outer side holds it up */
    gate(u, v0, v1, h, outer = 0) {
      b.box(u, u + 0.5, v0, v1, h + 1.15, h + 1.75, 'gate', { noWall: true });
      if (outer) b.box(u, u + 0.5, outer > 0 ? v1 : v0 - 0.5, outer > 0 ? v1 + 0.5 : v0, h - 2, h + 2.5, 'pylon', { noWall: true });
    },

    /** vault barrier across a lane [v0, v1] at u */
    barrier(u, v0, v1, h, hh = 1) {
      b.box(u, u + 0.5, v0, v1, h, h + hh, 'vault', { noWall: true });
    },
  };
  return ctx;
}
