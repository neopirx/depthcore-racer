// Basic set-pieces: runs, hops, steps, ledges, climbs, ramps, drops, obstacle runs, movers.
// Every walkway is on the gauge (kit.GAUGE): lane-wide decks, narrow precision plates.
import { PLATE, q } from '../kit.js';
import { jumpReach } from './builder.js';

export default function basic(k) {
  const { b, r, diff, G } = k;
  return {
    run() {
      const L = q(r, 3, 5, 0.5);
      k.runway(L);
      b.pt(L, 0, b.h);
      b.adv(L);
    },

    gap() {
      const Lr = q(r, 2.5, 4, 0.5);
      k.runway(Lr);
      let dh = Number(r.weighted({ 0: 3, 1: 1.5, '-1': 1.5, '-2': 0.8 }));
      if (b.h + dh > 40) dh = -1;
      // a sideways jog reads as deliberate when it's a clean fraction of the lane
      const shift = r.chance(0.5) ? r.sign() * q(r, 0.5, 1.5, 0.5) : 0;
      const maxG = jumpReach(dh, 6.6) * 0.82 - 0.4 - Math.abs(shift) * 0.4;
      const g = q(r, 1.8, Math.max(2.0, 1.8 + (maxG - 1.8) * (0.4 + 0.6 * diff)), 0.5);
      b.lip(Lr, -b.w / 2, b.w / 2, b.h);
      b.pt(Lr - 0.3, 0, b.h, { act: { type: 'jump', lead: 0.25 } });
      k.exit(Lr + g, q(r, 3.5, 5.5, 0.5), b.h + dh, { v: shift, cpAt: 1.2 });
    },

    stairs() {
      // precision zig-zag: narrow floating steps, each higher and offset sideways
      const Lr = q(r, 2.5, 4, 0.5);
      k.runway(Lr);
      const n = r.int(3, 4 + Math.round(diff * 2));
      const pw = diff > 0.6 ? 2 : G.narrow;
      let u = Lr;
      let v = 0;
      let h = b.h;
      let side = r.sign();
      for (let i = 0; i < n; i++) {
        const lastStep = i === n - 1;
        const dh = lastStep ? q(r, 0, 0.5, 0.25) : q(r, 0.5, 1.0 + 0.25 * diff, 0.25);
        const nv = lastStep ? 0 : Math.max(-3.5, Math.min(3.5, v + side * q(r, 1.25, 2, 0.25)));
        const g = k.hopGap(dh, nv - v, lastStep ? 1.4 : pw / 2);
        b.lip(u, v - 1, v + 1, h);
        b.pt(u - 0.35, v, h, { act: { type: 'jump', lead: 0.25 } });
        side = -side;
        if (lastStep) {
          b.pt(u + g + 1.1, nv, h + dh);
          k.exit(u + g, q(r, 3.5, 5, 0.5), h + dh, { cpAt: 1.2 });
          return;
        }
        const L = Math.max(pw, k.overrun(dh, g));
        b.slab(u + g, u + g + L, nv - pw / 2, nv + pw / 2, h + dh, { kind: 'step', thick: 0.75 });
        b.pt(u + g + Math.min(1.1, L / 2), nv, h + dh);
        u += g + L;
        v = nv;
        h += dh;
      }
    },

    ledge() {
      const Lr = q(r, 3, 4.5, 0.5);
      k.runway(Lr);
      const dh = q(r, 1, 1.5, 0.25);
      b.pt(Lr - 2.0, 0, b.h, { act: { type: 'jump', lead: 0.1 } });
      b.lip(Lr, -G.lane / 2, G.lane / 2, b.h + dh);
      b.pt(Lr + 0.8, 0, b.h + dh);
      k.exit(Lr, q(r, 3.5, 5, 0.5), b.h + dh, { extra: { thick: dh + PLATE }, cpAt: 1.4 });
    },

    climb(dhIn, LrIn) {
      const Lr = LrIn ?? q(r, 3, 4.5, 0.5);
      k.runway(Lr);
      const dh = dhIn ?? q(r, 2.5, 3.0 + diff * 0.8, 0.5);
      b.pt(Lr - 0.5, 0, b.h, { act: { type: 'climb', lead: 1.0 } });
      const L2 = q(r, 3.5, 5, 0.5);
      const w = G.lane;
      b.block(Lr, Lr + L2, -w / 2, w / 2, b.h + dh, { climbFace: true });
      b.climbFace(Lr, -0.8, 0.8, b.h, b.h + dh);
      b.lip(Lr, -w / 2, w / 2, b.h + dh);
      b.h += dh;
      b.w = w;
      b.pt(Lr + 0.8, 0, b.h);
      b.cp(Lr + 1.4, 0, b.h);
      b.pt(Lr + L2, 0, b.h);
      b.adv(Lr + L2);
    },

    ascent() {
      // stacked climbs: wall, short ledge, wall again
      const tiers = r.int(2, 3);
      this.climb(q(r, 2.5, 3, 0.5));
      for (let i = 1; i < tiers; i++) {
        const Lr = q(r, 3, 4.5, 0.5);
        const dh = q(r, 2.5, 3.0 + diff * 0.5, 0.5);
        const w = G.lane;
        b.pt(Lr - 0.5, 0, b.h, { act: { type: 'climb', lead: 1.0 } });
        b.slabC(0, Lr, w, b.h);
        b.block(Lr, Lr + 5, -w / 2, w / 2, b.h + dh, { climbFace: true });
        b.climbFace(Lr, -0.8, 0.8, b.h, b.h + dh);
        b.lip(Lr, -w / 2, w / 2, b.h + dh);
        b.h += dh;
        b.pt(Lr + 0.8, 0, b.h);
        b.cp(Lr + 1.4, 0, b.h);
        b.pt(Lr + 5, 0, b.h);
        b.adv(Lr + 5);
      }
    },

    vault() {
      const L = q(r, 6, 8, 0.5);
      k.runway(L);
      const u = L * q(r, 0.45, 0.6, 0.25);
      const d = q(r, 0.5, 1, 0.5);
      b.box(u, u + d, -b.w / 2, b.w / 2, b.h, b.h + q(r, 0.75, 1.25, 0.25), 'vault', { noWall: true });
      b.pt(u - 0.5, 0, b.h, { act: { type: 'vault' } });
      b.pt(u + d + 0.5, 0, b.h);
      b.pt(L, 0, b.h);
      b.adv(L);
    },

    slide() {
      const L = q(r, 7, 9, 0.5);
      k.runway(L);
      const u = L * q(r, 0.45, 0.55, 0.25);
      const d = r.chance(0.35) ? q(r, 2, 3.5, 0.5) : 0.5;
      const y0 = b.h + q(r, 1, 1.25, 0.25);
      const y1 = y0 + q(r, 0.5, 1, 0.5);
      b.box(u, u + d, -b.w / 2 - 0.25, b.w / 2 + 0.25, y0, y1, d > 1.5 ? 'duct' : 'gate', { noWall: true });
      for (const sd of [-1, 1]) b.box(u, u + 0.5, sd > 0 ? b.w / 2 : -b.w / 2 - 0.5, sd > 0 ? b.w / 2 + 0.5 : -b.w / 2, b.h - 2, y1 + 0.75, 'pylon', { noWall: true });
      b.pt(u - 2.4, 0, b.h, { act: { type: 'slide' } });
      b.pt(u + d + 0.5, 0, b.h);
      b.pt(L, 0, b.h);
      b.adv(L);
    },

    beam() {
      const Lr = q(r, 3, 5, 0.5);
      k.runway(Lr);
      const g = q(r, 5, 7 + diff * 3, 0.5);
      b.box(Lr - 0.25, Lr + g + 0.25, -0.25, 0.25, b.h - 0.5, b.h, 'beam', { noWall: true });
      b.pt(Lr - 0.5, 0, b.h);
      b.pt(Lr + g * 0.5, 0, b.h, { act: { type: 'beam' } });
      k.exit(Lr + g, q(r, 3.5, 5, 0.5), b.h, { cpAt: 1.4 });
    },

    pads() {
      // floating pillars: small tops, sideways hops, height changes both ways
      const Lr = q(r, 3, 5, 0.5);
      k.runway(Lr);
      const n = r.int(3, 3 + Math.round(diff * 2));
      const pw = diff > 0.6 ? 2 : G.pad;
      let u = Lr;
      let v = 0;
      let h = b.h;
      for (let i = 0; i <= n; i++) {
        const lastP = i === n;
        const dh = lastP ? 0 : Number(r.pick(['0', '0', '0.5', '-0.5']));
        b.lip(u, v - 0.9, v + 0.9, h);
        b.pt(u - 0.35, v, h, { act: { type: 'jump', lead: 0.25 } });
        const nv = lastP ? 0 : Math.max(-2.5, Math.min(2.5, v + q(r, -2, 2, 0.5)));
        const g = k.hopGap(dh, nv - v, lastP ? 1.4 : pw / 2);
        if (lastP) {
          b.pt(u + g + 1, nv, h);
          k.exit(u + g, q(r, 4, 5.5, 0.5), h, { cpAt: 1.4 });
          return;
        }
        const Lp = Math.max(pw, k.overrun(dh, g));
        const nh = h + dh;
        b.slab(u + g, u + g + Lp, nv - pw / 2, nv + pw / 2, nh, { kind: 'pad', thick: r.pick([4, 6, 8, 10]) });
        b.pt(u + g + Math.min(1, Lp / 2), nv, nh);
        u += g + Lp;
        v = nv;
        h = nh;
      }
    },

    ramp() {
      const Lr = q(r, 3, 5, 0.5);
      k.runway(Lr);
      const L = q(r, 8, 12, 0.5);
      const dH = L * q(r, 0.32, 0.5, 0.25);
      b.ramp(Lr, Lr + L, b.w, b.h, b.h - dH);
      b.pt(Lr - 0.2, 0, b.h, { act: { type: 'slide', hold: L + 1 } });
      b.pt(Lr + L, 0, b.h - dH);
      k.exit(Lr + L, q(r, 5, 7, 0.5), b.h - dH, { cpAt: 2 });
      return { calm: true };
    },

    drop() {
      const Lr = q(r, 3, 5, 0.5);
      k.runway(Lr);
      const g = q(r, 1.5, 2.5, 0.5);
      const dd = q(r, 4, 4.5 + 2 * diff, 0.5);
      b.lip(Lr, -b.w / 2, b.w / 2, b.h);
      b.pt(Lr - 0.3, 0, b.h, { act: { type: 'jump', lead: 0.25 } });
      const h2 = b.h - dd;
      b.pt(Lr + g + 1.5, 0, b.h - 1, { act: { type: 'roll', h: h2 } });
      const land = Math.max(q(r, 5.5, 7, 0.5), jumpReach(-dd, 10) - g + 2);
      k.exit(Lr + g, Math.ceil(land * 2) / 2, h2, { w: G.wide, cpAt: land * 0.5 });
    },

    cascade() {
      // downhill hop chain: narrow plates stepping down and side to side, then a long drop to roll
      const Lr = q(r, 3, 5, 0.5);
      k.runway(Lr);
      const n = r.int(3, 3 + Math.round(diff * 2));
      const pw = G.narrow;
      let u = Lr;
      let v = 0;
      let h = b.h;
      let side = r.sign();
      for (let i = 0; i < n; i++) {
        const dh = -q(r, 0.75, 1.5, 0.25);
        const nv = Math.max(-3, Math.min(3, v + side * q(r, 1.25, 2, 0.25)));
        side = -side;
        const g = k.hopGap(dh, nv - v, pw / 2);
        const L = Math.max(pw, k.overrun(dh, g));
        b.lip(u, v - 1, v + 1, h);
        b.pt(u - 0.35, v, h, { act: { type: 'jump', lead: 0.25 } });
        b.slab(u + g, u + g + L, nv - pw / 2, nv + pw / 2, h + dh, { kind: 'step', thick: 0.75 });
        b.pt(u + g + Math.min(1.1, L / 2), nv, h + dh);
        u += g + L;
        v = nv;
        h += dh;
      }
      // the last plate throws you off a real drop: roll it. The catch deck re-centres on the lane
      const g = q(r, 1.5, 2.5, 0.5);
      const dd = q(r, 3.5, 4.5, 0.5);
      b.lip(u, v - 1, v + 1, h);
      b.pt(u - 0.35, v, h, { act: { type: 'jump', lead: 0.25 } });
      const h2 = h - dd;
      const vc = Math.round(v) * 0.5;
      b.pt(u + g + 1.5, vc, h - 1, { act: { type: 'roll', h: h2 } });
      const land = Math.max(q(r, 7, 9, 0.5), jumpReach(-dd, 10) - g + 2);
      k.exit(u + g, Math.ceil(land * 2) / 2, h2, { v: vc, w: G.wide, cpAt: land * 0.5 });
    },

    gauntlet() {
      // rhythm corridor: barriers and slide gates in a row, spaced to the stride. Clean inputs
      // keep full speed through all of them; one late press costs the lot.
      const w = G.lane;
      const n = r.int(3, 3 + Math.round(diff * 1.5));
      const sp = 6.5;
      const L = 4 + n * sp + 3;
      k.runway(L, w);
      let gate = r.chance(0.5);
      for (let i = 0; i < n; i++) {
        const u = 4 + i * sp + (gate ? 1 : 0);
        if (gate) {
          b.box(u, u + 0.5, -w / 2 - 0.25, w / 2 + 0.25, b.h + 1.15, b.h + 1.75, 'gate', { noWall: true });
          for (const s2 of [-1, 1]) b.box(u, u + 0.5, s2 > 0 ? w / 2 : -w / 2 - 0.5, s2 > 0 ? w / 2 + 0.5 : -w / 2, b.h - 2, b.h + 2.5, 'pylon', { noWall: true });
          b.pt(u - 2.4, 0, b.h, { act: { type: 'slide' } });
          b.pt(u + 1, 0, b.h);
        } else {
          b.box(u, u + 0.5, -w / 2, w / 2, b.h, b.h + 1, 'vault', { noWall: true });
          b.pt(u - 0.5, 0, b.h, { act: { type: 'vault' } });
          b.pt(u + 1, 0, b.h);
        }
        gate = !gate;
      }
      b.pt(L, 0, b.h);
      b.adv(L);
    },

    gallery() {
      // covered passage: a slab enclosed by two wallrun walls and a roof plate, with a vault or a
      // slide gate inside. Roof sits above jump-head height so a plain jump never bonks.
      const w = G.lane;
      const L = r.pick([11, 12.5, 14]);
      k.runway(L, w);
      const u0 = 1.5;
      const u1 = L - 1.5;
      const t = 0.75;
      const roof = b.h + 4;
      for (const sd of [-1, 1]) {
        b.box(u0, u1, sd > 0 ? w / 2 : -w / 2 - t, sd > 0 ? w / 2 + t : -w / 2, b.h - 6, roof, 'wall', { runSide: -sd, refY: b.h });
      }
      b.box(u0 - 0.5, u1 + 0.5, -w / 2 - t - 0.25, w / 2 + t + 0.25, roof, roof + 0.75, 'block', { noWall: true, roof: true });
      const um = Math.round((u0 + u1)) / 2;
      if (r.chance(0.5)) {
        b.box(um, um + 0.5, -w / 2, w / 2, b.h, b.h + r.pick([0.75, 1]), 'vault', { noWall: true });
        b.pt(um - 0.5, 0, b.h, { act: { type: 'vault' } });
        b.pt(um + 1, 0, b.h);
      } else {
        b.box(um, um + 0.5, -w / 2, w / 2, b.h + 1.1, roof, 'gate', { noWall: true });
        b.pt(um - 2.4, 0, b.h, { act: { type: 'slide' } });
        b.pt(um + 1, 0, b.h);
      }
      b.pt(L, 0, b.h);
      b.adv(L);
    },

    shuttle() {
      // moving platforms across a gap, all on one clock so the hop rhythm stays readable:
      // side sweepers, fore/aft shuttles or lifts
      const axis = r.pick(['side', 'along', 'lift']);
      const Lr = q(r, 3.5, 5, 0.5);
      k.runway(Lr);
      const h0 = b.h;
      const n = r.int(2, diff > 0.5 ? 3 : 2);
      const T = q(r, 2.5, 3.5, 0.5);
      const ph = r.range(0, Math.PI * 2);
      const pw = axis === 'side' ? 3.5 : 3;
      const L = axis === 'side' ? 4 : 5.5;
      const A = axis === 'side' ? 1.25 : axis === 'along' ? 0.75 : 0.5;
      let u = Lr;
      let take = Lr - 0.35;   // takeoff point (local u) on the current surface
      for (let i = 0; i < n; i++) {
        // spaced like static hops: a full-speed jump lands mid-platform
        const dhIn = axis === 'lift' ? (i === 0 ? 0.5 : 0) : 0;
        const g = Math.max(1.5, k.hopGap(dhIn, 0, L / 2) - (take < u - 0.5 ? 0.65 : 0));
        b.lip(u, -pw / 2, pw / 2, h0);
        b.pt(take, 0, h0, { act: { type: 'jump', lead: 0.25 } });
        const y = axis === 'lift' ? h0 + 0.5 : h0;
        b.moverSlab(u + g, u + g + L, -pw / 2, pw / 2, y, {
          dv: axis === 'side' ? A : 0, du: axis === 'along' ? A : 0, dy: axis === 'lift' ? A : 0, T, ph, axis,
        });
        b.pt(u + g + L * 0.5, 0, y);
        u += g + L;
        // off a fore/aft shuttle jump early: its far edge comes and goes
        take = u - (axis === 'along' ? 1.0 : 0.35);
      }
      const g = Math.max(1.5, k.hopGap(axis === 'lift' ? -0.5 : 0, 0, 1.4) - (take < u - 0.5 ? 0.65 : 0));
      b.pt(take, 0, h0, { act: { type: 'jump', lead: 0.25 } });
      k.exit(u + g, q(r, 5, 6.5, 0.5), h0);
      return { calm: true };
    },
  };
}
