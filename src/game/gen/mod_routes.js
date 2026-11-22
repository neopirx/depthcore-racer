// Multi-route set-pieces: forks, shortcuts, speed checks and multi-level areas.
//
// Every module here lays 2–3 routes through one stretch with b.routes(): the first is the main
// line (the rival's line, progress, checkpoints), the others are marked alternates (ALT signs in
// the level accent). Each route is a complete racing line, so `sim --alt N` races any of them.
//
//  - speed checks size a gap between what a slid ramp and a flat-out run can reach (rampSpeeds):
//    only the slide clears it. The point after the gap carries `chk` so tools/speedcheck.js can
//    prove a runner who doesn't slide falls short.
//  - multi-level areas stack routes: failing the high line drops you onto the low one, never
//    into the void.
import { DATUM, q, deckW, snap } from '../kit.js';
import { rampSpeeds, airTime } from './builder.js';

/** ramp slope used by every speed-check ramp (≈ 23°) */
const SLOPE = 0.42;

/**
 * Lay out a speed-check flight: from takeoff to the face of a target `dU` below the lip.
 * Returns the face distance D (horizontal) so that
 *  - a running jump (full flow, no slide) reaches the face ≥ mantle reach below the top: no grab
 *  - a slid ramp lands ≥ `margin` past the face
 * dU is raised until such a window exists.
 */
function speedWindow(drop, len, dU0, margin = 0.9) {
  const { slide, run } = rampSpeeds(drop, len);
  for (let dU = dU0; dU < dU0 + 3; dU += 0.5) {
    const slow = run * airTime(-(dU + 1.85)) + 0.25;
    const fast = slide * 0.92 * airTime(-dU) - margin;
    if (fast >= slow) return { dU, D: Math.ceil(((slow + fast) / 2) * 4) / 4, slow, fast };
  }
  return null;
}

export default function routes(k) {
  const { b, r, diff, G } = k;
  return {
    bypass() {
      // fork: climb over a monolith (safe), or wallrun its flank over the void (keeps speed)
      const sd = r.sign();
      const w = G.lane;
      const lane = G.fork;
      // room to cross into the skill lane after a fast landing (it starts beside the runway)
      const Lr = q(r, 7, 8.5, 0.5);
      b.w = w;
      b.slab(0, Lr, sd > 0 ? -w / 2 : -w / 2 - lane, sd > 0 ? w / 2 + lane : w / 2, b.h);
      b.cp(1, 0, b.h);
      const h0 = b.h;
      const top = h0 + q(r, 2.5, 3, 0.5);
      const Lb = q(r, 5.5, 6.5, 0.5);
      const g = 2.5;
      b.block(Lr, Lr + Lb, -w / 2, w / 2, top, { climbFace: true, below: 4 });
      b.climbFace(Lr, -0.8, 0.8, h0, top);
      b.lip(Lr, -w / 2, w / 2, top);
      // lead-in fin flush with the monolith's flank: the wall starts before the corner, so the
      // skill line is already on it when the floor ends (and can't snag the climb face)
      b.box(Lr - 2, Lr, sd > 0 ? w / 2 - 0.5 : -w / 2, sd > 0 ? w / 2 : -w / 2 + 0.5, h0 - DATUM, top, 'wall', { noRibs: true });
      b.runFace(sd * w / 2, Lr - 1.9, Lr + Lb, h0 + 0.5, h0 + 3, sd);
      b.lipAlong(sd * (w / 2 + lane), Lr - 2, Lr, h0);
      b.sign(Lr - 0.5, sd * (w / 2 + lane / 2), h0 + 3.4, sd, 'alt', 'skill');
      const L2 = q(r, 6, 7.5, 0.5);
      const ue = Lr + Lb + g;
      b.slab(ue, ue + L2, sd > 0 ? -w / 2 : -w / 2 - lane, sd > 0 ? w / 2 + lane : w / 2, h0);
      const vW = sd * (w / 2 + 0.55);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(Lr - 0.5, 0, h0, { act: { type: 'climb', lead: 1.0 } });
        b.pt(Lr + 0.8, 0, top);
        b.pt(Lr + Lb - 0.3, 0, top, { act: { type: 'jump', lead: 0.2 } });
        b.pt(ue + 1.5, 0, h0);
      } }, { tag: 'skill', lay: () => {
        b.pt(Lr - 5.5, sd * (w / 2 + 1.1), h0);
        b.pt(Lr - 2.5, sd * (w / 2 + 0.8), h0);
        b.pt(Lr - 0.4, vW, h0, { act: { type: 'wallrun' } });
        b.pt(Lr + Lb * 0.5, sd * (w / 2 + 0.35), h0 + 1.4);
        b.pt(Lr + Lb, sd * (w / 2 + 0.35), h0 + 1.3);
        b.pt(ue + 1.5, vW, h0);
      } }]);
      b.cp(ue + 2, 0, h0);
      b.pt(ue + L2, 0, h0);
      b.adv(ue + L2);
      return { calm: true };
    },

    split() {
      // fork: a divider splits the deck into two lanes. Obstacle lane (vault + slide gate)
      // or the skill lane: one long gap you jump or wallrun along the divider, no slowdowns.
      const sd = r.sign();
      const lane = G.fork;
      const div = G.div;
      const W = deckW(2);
      const Lr = q(r, 5.5, 7, 0.5);
      k.runway(Lr);
      b.slabC(Lr, Lr + 1.5, W, b.h);   // apron: the deck widens before it splits
      const u0 = Lr + 1.5;
      const h0 = b.h;
      const Ls = q(r, 13, 15, 0.5);
      const vs = (side, kk) => side * (div / 2 + kk);   // offset into a lane
      k.divider(0, u0, u0 + Ls, h0);
      b.runFace(sd * div / 2, u0 + 3, u0 + Ls - 3, h0 + 0.5, h0 + 3, sd);
      b.runFace(-sd * div / 2, u0, u0 + Ls, h0 + 0.5, h0 + 3, -sd);
      // obstacle lane (-sd)
      const lo = Math.min(vs(-sd, 0), vs(-sd, lane));
      const hi = Math.max(vs(-sd, 0), vs(-sd, lane));
      b.slab(u0, u0 + Ls, lo, hi, h0);
      const uV = u0 + q(r, 3, 4, 0.5);
      k.barrier(uV, lo, hi, h0);
      const uG = u0 + Ls - q(r, 4, 5, 0.5);
      k.gate(uG, lo, hi, h0, -sd);
      // skill lane (sd): floor, a long gap, floor
      const sl = Math.min(vs(sd, 0), vs(sd, lane));
      const sh = Math.max(vs(sd, 0), vs(sd, lane));
      const gA = u0 + q(r, 2.5, 3.5, 0.5);
      const gap = q(r, 4.5, 5.5, 0.5);
      b.slab(u0, gA, sl, sh, h0);
      b.slab(gA + gap, u0 + Ls, sl, sh, h0);
      b.lip(gA, sl, sh, h0);
      b.sign(u0 - 0.5, vs(sd, lane / 2), h0 + 3, sd, 'alt', 'skill');
      const vm = vs(-sd, lane / 2);
      const va = vs(sd, lane / 2);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(u0 - 3, vm * 0.6, h0);
        b.pt(u0 - 0.5, vm, h0);
        b.pt(uV - 0.5, vm, h0, { act: { type: 'vault' } });
        b.pt(uV + 1, vm, h0);
        b.pt(uG - 2.4, vm, h0, { act: { type: 'slide' } });
        b.pt(uG + 1, vm, h0);
        b.pt(u0 + Ls, vm, h0);
      } }, { tag: 'skill', lay: () => {
        b.pt(u0 - 3, va * 0.6, h0);
        b.pt(u0 - 0.5, va, h0);
        b.pt(gA - 0.3, va, h0, { act: { type: 'jump', lead: 0.2 } });
        b.pt(gA + gap + 1.2, va, h0);
        b.pt(u0 + Ls, va, h0);
      } }]);
      b.slabC(u0 + Ls, u0 + Ls + 2, W, h0);
      k.exit(u0 + Ls + 2, q(r, 4, 5, 0.5), h0, { cpAt: 0.5 });
    },

    overunder() {
      // fork: the deck splits round a long low duct. Under: slide the duct (safe). Over: hop
      // onto the monolith beside it and run its top, dropping off the end (keeps more speed)
      const sd = r.sign();
      const lane = G.fork;
      const W = lane * 2;
      const Lr = q(r, 5, 6.5, 0.5);
      k.runway(Lr);
      b.slabC(Lr, Lr + 1.5, W, b.h);
      const u0 = Lr + 1.5;
      const h0 = b.h;
      const Ld = q(r, 3, 4, 0.5);
      const top = h0 + 1;
      const vs = (side) => side * lane / 2;   // lane centre
      const span = (side) => [Math.min(0, side * lane), Math.max(0, side * lane)];
      // under lane (-sd): floor plus the duct, with its pylon on the outer edge
      const [ul, uh] = span(-sd);
      b.slab(u0, u0 + Ld + 2, ul, uh, h0);
      b.box(u0 + 1, u0 + 1 + Ld, ul - (sd > 0 ? 0.25 : 0), uh + (sd > 0 ? 0 : 0.25), h0 + 1.15, h0 + 2.25, 'duct', { noWall: true });
      b.box(u0 + 1, u0 + 1.5, -sd > 0 ? uh : ul - 0.5, -sd > 0 ? uh + 0.5 : ul, h0 - 2, h0 + 3, 'pylon', { noWall: true });
      // over lane (sd): the monolith
      const [ol, oh] = span(sd);
      b.block(u0, u0 + Ld + 2, ol, oh, top, { climbFace: true, below: 3 });
      b.climbFace(u0, vs(sd) - 0.8, vs(sd) + 0.8, h0, top);
      b.lip(u0, ol, oh, top);
      b.lip(u0 + Ld + 2, ol, oh, top);
      b.sign(u0 - 0.5, vs(sd), top + 2.2, sd, 'alt', 'high');
      const ue = u0 + Ld + 2;
      const vm = vs(-sd);
      const va = vs(sd);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(u0 - 3, vm * 0.6, h0);
        b.pt(u0 - 1, vm, h0);
        b.pt(u0 + 1 - 2.4, vm, h0, { act: { type: 'slide' } });
        b.pt(u0 + Ld + 1.5, vm, h0);
        b.pt(ue, vm, h0);
      } }, { tag: 'high', lay: () => {
        b.pt(u0 - 3, va * 0.6, h0);
        b.pt(u0 - 2.4, va, h0, { act: { type: 'jump', lead: 0.2 } });
        b.pt(u0 + 1.5, va, top);
        b.pt(ue, va, top);
      } }]);
      b.slabC(ue, ue + 2.5, W, h0);
      k.exit(ue + 2.5, q(r, 3, 4, 0.5), h0, { cpAt: 0.5 });
    },

    // -------------------------------------------------------------------------- speed checks
    speedtrap() {
      // two levels, one gap. A ramp drops onto a short runout that ends in the void. Slide the
      // ramp and the speed carries you across onto the high deck (SPEED LINE); run it and you fall
      // short onto the low deck below, roll, and climb the high deck's face to rejoin.
      const w = G.lane;
      const Lr = q(r, 4, 5.5, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const drop = q(r, 4.5, 5, 0.5);
      const Lm = Math.round((drop / SLOPE) * 2) / 2;
      const win = speedWindow(drop, Lm, 2);
      const h1 = h0 - drop;
      const runout = 2.5;
      const uLip = Lr + Lm + runout;
      b.ramp(Lr, Lr + Lm, w, h0, h1);
      b.slabC(Lr + Lm, uLip, w, h1);
      b.lip(uLip, -w / 2, w / 2, h1);
      const hU = h1 - win.dU;
      const climbH = 2.5;
      const hL = hU - climbH;
      const take = uLip - 0.3;
      const uF = snap(take + win.D);
      // low deck under the whole flight, high deck beyond it (its face is the low line's climb)
      b.h = hL;
      b.slabC(uLip, uF, w, hL);
      const LU = q(r, 6, 8, 0.5);
      b.block(uF, uF + LU, -w / 2, w / 2, hU, { climbFace: true, below: 3 });
      b.climbFace(uF, -0.8, 0.8, hL, hU);
      b.lip(uF, -w / 2, w / 2, hU);
      b.sign(Lr - 0.5, 0, h0 + 3, 0, 'alt', 'speed');
      b.routes([{ tag: 'main', lay: () => {
        b.pt(Lr + Lm, 0, h1);
        b.pt(uLip - 0.5, 0, h1);
        b.pt(uLip + 2, 0, h1 - 1, { act: { type: 'roll', h: hL } });
        b.pt(uLip + 6.5, 0, hL);
        b.cp(uLip + 7, 0, hL);
        b.pt(uF - 0.5, 0, hL, { act: { type: 'climb', lead: 1.0 } });
        b.pt(uF + 0.8, 0, hU);
      } }, { tag: 'speed', lay: () => {
        b.pt(Lr - 0.2, 0, h0, { act: { type: 'slide', hold: Lm + 0.5, ramp: { y1: h1, vT: rampSpeeds(drop, Lm).slide } } });
        b.pt(Lr + Lm, 0, h1);
        b.pt(take, 0, h1, { act: { type: 'jump', lead: 0.25 } });
        b.pt((take + uF) / 2, 0, h1 + 1);
        b.pt(uF + 1.5, 0, hU, { chk: { y: hU - 0.5 } });
      } }]);
      b.h = hU;
      b.w = w;
      b.cp(uF + 2, 0, hU);
      b.pt(uF + LU, 0, hU);
      b.adv(uF + LU);
      return { calm: true };
    },

    speedcorner(tdIn) {
      // a ramp runs into a corner. Main line: run the corner and step down onto the new leg.
      // SPEED LINE: slide the ramp, veer to the inside edge and jump the corner diagonally across
      // the void straight onto the new leg — only a slid ramp carries that far.
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const Lr = q(r, 3.5, 5, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const drop = q(r, 4.5, 5, 0.5);
      const Lm = Math.round((drop / SLOPE) * 2) / 2;
      const win = speedWindow(drop, Lm, 2, 1.2);
      const h1 = h0 - drop;
      const hN = h1 - win.dU;
      const uB = Lr + Lm;
      b.ramp(Lr, uB, w, h0, h1);
      // takeoff on the inside edge, a short run after the ramp; the flight leaves at ~25°
      const uT = uB + 2;
      const vT = td * (w / 2 - 0.35);
      const th = 0.44;
      const uF = snap(uT + win.D * Math.cos(th));          // back face of the new leg
      const vF = vT + td * win.D * Math.sin(th);
      const uE = uF + w;                                     // the corner deck runs to the leg's far side
      b.slabC(uB, uE, w, h1);
      b.lipAlong(td * w / 2, uB, uF, h1);
      // the new leg: one lane deep (u), running off to the td side, a step below the corner deck
      const vLand = Math.abs(vF) + 1.5;
      const Ln = Math.ceil((vLand + 5 - w / 2) * 2) / 2;
      b.slab(uF, uE, Math.min(td * w / 2, td * (w / 2 + Ln)), Math.max(td * w / 2, td * (w / 2 + Ln)), hN);
      b.lip(uF, td * w / 2, td * (w / 2 + Ln), hN);
      b.sign(uE + 0.3, -td * w * 0.15, h1 + 3, td);
      b.sign(uB - 2, td * (w / 2 - 0.6), h1 + 3.2, td, 'alt', 'speed');
      const uc = uF + w / 2;
      const vEnd = td * (vLand + 2);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(uB, 0, h1);
        b.cp(uB + 1, 0, h1);
        b.pt(uc - 1.5, 0, h1);
        b.pt(uc, td * w * 0.2, h1);
        b.pt(uc, td * (w / 2 + 1.25), hN);
        b.pt(uc, vEnd, hN);
      } }, { tag: 'speed', lay: () => {
        b.pt(Lr - 0.2, 0, h0, { act: { type: 'slide', hold: Lm - 2, ramp: { y1: h1, vT: rampSpeeds(drop, Lm).slide } } });
        b.pt(uB - 2.5, td * 0.25, h1 + 2.5 * SLOPE);
        b.pt(uT, vT, h1, { act: { type: 'jump', lead: 0.25 } });
        b.pt(uF + 1, td * vLand, hN, { chk: { y: hN - 0.5 } });
        b.pt(uc, vEnd, hN);
      } }]);
      b.pivot(uc, vEnd, td);
      b.h = hN;
      b.w = w;
      const rest = Ln - (vLand + 2 - w / 2);
      b.cp(0.5, 0, hN);
      b.pt(rest, 0, hN);
      b.adv(rest);
      return { turned: true, calm: true };
    },

    // -------------------------------------------------------------------- multi-lane / level
    triple() {
      // a three-lane hall. Centre (main): vault + slide gate. One side: a long gap you wallrun
      // along the outer wall. Other side: floating pads over the void.
      const lw = G.fork;
      const dv = G.div;
      const W = deckW(3);
      const Lr = q(r, 4, 5.5, 0.5);
      k.runway(Lr);
      const h0 = b.h;
      const u0 = Lr + 4;
      b.slabC(Lr, u0, W, h0);    // apron: the hall opens up ahead of the lanes
      const sa = r.sign();       // wallrun lane side; pads on -sa
      const vc = (s) => s * (lw + dv);   // side lane centres
      // pad lane: floor, pads, floor — its length sets the hall's
      const pw = G.pad;
      const vP = vc(-sa);
      const a = 2.5;
      let u = u0 + a;
      const pads = [];
      const nP = diff > 0.5 ? 2 : 1;
      for (let i = 0; i < nP; i++) {
        const g = k.hopGap(0, 0, pw / 2);
        const Lp = Math.max(pw, k.overrun(0, g));
        pads.push({ take: u, u0: u + g, u1: u + g + Lp });
        u += g + Lp;
      }
      const gEnd = k.hopGap(0, 0, 1.4);
      const padEnd = u + gEnd;
      const gW = q(r, 7, 8.5, 0.5);            // wallrun lane gap
      const aW = 5;
      const Ls = Math.ceil(Math.max(padEnd + 3 - u0, aW + gW + 3, 14) * 2) / 2;
      const u1 = u0 + Ls;
      for (const s of [-1, 1]) k.divider(s * (lw / 2 + dv / 2), u0, u1, h0);
      // centre lane: vault, then a gate between the dividers
      b.slab(u0, u1, -lw / 2, lw / 2, h0);
      const uV = u0 + q(r, 3, 4, 0.5);
      k.barrier(uV, -lw / 2, lw / 2, h0);
      const uG = u1 - q(r, 4, 5, 0.5);
      k.gate(uG, -lw / 2, lw / 2, h0);
      // pad lane
      const pl = vP - lw / 2;
      const ph = vP + lw / 2;
      b.slab(u0, u0 + a, pl, ph, h0);
      for (const p of pads) b.slab(p.u0, p.u1, vP - pw / 2, vP + pw / 2, h0, { kind: 'pad', thick: r.pick([6, 8, 10]) });
      b.slab(padEnd, u1, pl, ph, h0);
      b.lip(u0 + a, pl, ph, h0);
      // wallrun lane: floor, gap, floor, with a tall outer wall over the gap
      const vW = vc(sa);
      const wl = vW - lw / 2;
      const wh = vW + lw / 2;
      b.slab(u0, u0 + aW, wl, wh, h0);
      b.slab(u0 + aW + gW, u1, wl, wh, h0);
      b.lip(u0 + aW, wl, wh, h0);
      const vO = vW + sa * lw / 2;    // outer face
      b.box(u0 + aW - 1.75, u0 + aW + gW + 3, sa > 0 ? vO : vO - 1.25, sa > 0 ? vO + 1.25 : vO, h0 - DATUM, h0 + q(r, 5, 6.5, 0.5), 'wall', { runSide: -sa, refY: h0 });
      b.runFace(vO, u0 + aW - 1.7, u0 + aW + gW + 2.5, h0 + 0.5, h0 + 3.2, -sa);
      b.sign(u0 - 0.5, vP, h0 + 3, -sa, 'alt', 'skill');
      b.sign(u0 - 0.5, vW, h0 + 3, sa, 'alt', 'skill');
      const lineV = vW + sa * (lw / 2 - 0.55);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(u0, 0, h0);
        b.pt(uV - 0.5, 0, h0, { act: { type: 'vault' } });
        b.pt(uV + 1, 0, h0);
        b.pt(uG - 2.4, 0, h0, { act: { type: 'slide' } });
        b.pt(uG + 1, 0, h0);
        b.pt(u1, 0, h0);
      } }, { tag: 'skill', lay: () => {
        b.pt(Lr + 1, vW * 0.3, h0);
        b.pt(u0 + aW - 2.5, lineV, h0);
        b.pt(u0 + aW - 0.4, lineV, h0, { act: { type: 'wallrun' } });
        b.pt(u0 + aW + gW * 0.5, vW + sa * (lw / 2 - 0.35), h0 + 1.4);
        b.pt(u0 + aW + gW + 1.5, vW + sa * (lw / 2 - 0.35), h0 + 1.3);
        b.pt(u1 - 1, vW, h0);
        b.pt(u1 + 1, vW * 0.5, h0);
      } }, { tag: 'skill', lay: () => {
        b.pt(Lr + 1, vP * 0.3, h0);
        b.pt(u0 + 0.5, vP, h0);
        for (const p of pads) {
          b.pt(p.take - 0.35, vP, h0, { act: { type: 'jump', lead: 0.25 } });
          b.pt(p.u0 + Math.min(1, (p.u1 - p.u0) / 2), vP, h0);
        }
        b.pt(u - 0.35, vP, h0, { act: { type: 'jump', lead: 0.25 } });
        b.pt(padEnd + 1.2, vP, h0);
        b.pt(u1 + 1, vP * 0.5, h0);
      } }]);
      b.slabC(u1, u1 + 4, W, h0);   // apron out
      k.exit(u1 + 4, q(r, 3, 4, 0.5), h0, { cpAt: 0.5 });
    },

    terrace() {
      // a two-level hall. Low lane (main): vault, slide gate, climb at the end. High lane: climb
      // the first block early, then hop block to block across open pits. Miss a hop and you land
      // in the pit: climb the next block and carry on.
      const sd = r.sign();               // high lane side
      const lw = G.lane;
      const Lr = q(r, 4, 5.5, 0.5);
      k.runway(Lr);
      const h0 = b.h;
      const u0 = Lr;
      const climbH = q(r, 2.5, 3, 0.5);
      const hT = h0 + climbH;
      const vL = -sd * lw / 2;           // low lane centre
      const vH = sd * lw / 2;            // high lane centre
      const [ll, lh] = [Math.min(0, -sd * lw), Math.max(0, -sd * lw)];
      const [hl, hh] = [Math.min(0, sd * lw), Math.max(0, sd * lw)];
      // high lane blocks and pits
      const nB = diff > 0.45 ? 3 : 2;
      const blocks = [];
      let u = u0 + 1;
      for (let i = 0; i < nB; i++) {
        const LB = q(r, 3.5, 5, 0.5);
        blocks.push([u, u + LB]);
        u += LB + q(r, 3, 3.5 + diff * 0.5, 0.5);
      }
      const uM = u;                      // merge block front
      b.slabC(u0, u0 + 1, 2 * lw, h0);   // apron
      b.slab(u0 + 1, uM, ll, lh, h0);    // low lane floor
      b.h = h0;
      blocks.forEach(([a0, a1], i) => {
        b.block(a0, a1, hl, hh, hT, { climbFace: true, below: 3 });
        b.climbFace(a0, vH - 0.8, vH + 0.8, h0, hT);
        b.lip(a0, hl, hh, hT);
        b.lip(a1, hl, hh, hT);
        const next = blocks[i + 1]?.[0] ?? uM;
        b.slab(a1, next, hl, hh, h0, { thick: 0.75 });   // pit floor
      });
      // low lane obstacles: vault early, gate under the second block's span
      const uV = u0 + q(r, 3, 4, 0.5);
      k.barrier(uV, ll, lh, h0);
      const [g0, g1] = blocks[1];
      const uG = Math.max(uV + 4, snap((g0 + g1) / 2 - 0.25));
      k.gate(uG, ll, lh, h0, -sd);
      // merge block across both lanes
      const LM = q(r, 4, 5.5, 0.5);
      b.block(uM, uM + LM, -lw, lw, hT, { climbFace: true, below: 3 });
      b.climbFace(uM, vL - 0.8, vL + 0.8, h0, hT);
      b.lip(uM, -lw, lw, hT);
      b.sign(u0 - 0.5, vH, h0 + 3.2, sd, 'alt', 'high');
      b.routes([{ tag: 'main', lay: () => {
        b.pt(u0 - 2, vL * 0.5, h0);
        b.pt(u0 + 1, vL, h0);
        b.pt(uV - 0.5, vL, h0, { act: { type: 'vault' } });
        b.pt(uV + 1, vL, h0);
        b.pt(uG - 2.4, vL, h0, { act: { type: 'slide' } });
        b.pt(uG + 1, vL, h0);
        b.pt(uM - 0.5, vL, h0, { act: { type: 'climb', lead: 1.0 } });
        b.pt(uM + 0.8, vL, hT);
        b.pt(uM + 2, 0, hT);
      } }, { tag: 'high', lay: () => {
        b.pt(u0 - 2, vH * 0.5, h0);
        b.pt(blocks[0][0] - 0.5, vH, h0, { act: { type: 'climb', lead: 1.0 } });
        b.pt(blocks[0][0] + 0.8, vH, hT);
        for (const [, a1] of blocks) {
          b.pt(a1 - 0.3, vH, hT, { act: { type: 'jump', lead: 0.25 } });
          const nx = blocks.find(([c0]) => c0 > a1)?.[0] ?? uM;
          b.pt(nx + 1.2, vH, hT);
        }
        b.pt(uM + 2, 0, hT);
      } }]);
      b.h = hT;
      b.w = lw;
      b.cp(uM + 2.5, 0, hT);
      b.pt(uM + LM, 0, hT);
      b.adv(uM + LM);
    },
  };
}
