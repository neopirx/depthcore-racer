// Wall moves and turns: wallruns, wall chains, pillar / UT kicks, climb-kicks and the 90° turns.
import { DATUM, q } from '../kit.js';

export default function walls(k) {
  const { b, r, diff, G } = k;
  return {
    wallrun() {
      const Lr = q(r, 5, 6.5, 0.5);
      const w = G.lane;
      k.runway(Lr, w);
      const sd = r.sign();
      const dh = Number(r.weighted({ 1: 1.2, 0: 2, '-1': 1.2 }));
      // a long wallrun can't also climb: an upward landing keeps the gap inside one wall's ride
      const g = q(r, 6, (dh > 0 ? 6.5 : 7.5) + diff * (dh > 0 ? 0.5 : 1.5), 0.5);
      const top = b.h + q(r, 4.5, 7, 0.5);
      const wb = q(r, 1, 2.5, 0.5);
      const lineV = sd * (w / 2 - 0.55);
      b.box(Lr - 1.75, Lr + g + 3, sd > 0 ? w / 2 : -w / 2 - wb, sd > 0 ? w / 2 + wb : -w / 2, b.h - DATUM, top, 'wall', { runSide: -sd, refY: b.h });
      b.lip(Lr, -w / 2, w / 2, b.h);
      b.runFace(sd * w / 2, Lr - 1.7, Lr + g + 2.5, b.h + 0.5, b.h + 3.2, -sd);
      b.pt(Lr - 4, 0, b.h);
      b.pt(Lr - 2.5, lineV, b.h);
      b.pt(Lr - 0.4, lineV, b.h, { act: { type: 'wallrun' } });
      b.pt(Lr + g * 0.5, sd * (w / 2 - 0.35), b.h + 1.4);
      // ride the wall past the gap and drop onto the landing deck, which is on the same lane as
      // the runway and runs well past the wall's end (players can also jump off early)
      b.pt(Lr + g + 1.5, sd * (w / 2 - 0.35), b.h + 1.3);
      k.exit(Lr + g, q(r, 5.5, 6.5, 0.5), b.h + dh, { cpAt: 2 });
    },

    wallchain() {
      // two or three wallruns, alternating sides, climbing — then a jump onto a high ledge
      const c = G.lane / 2;
      const Lr = q(r, 5, 6.5, 0.5);
      k.runway(Lr);
      let sd = r.sign();
      const n = diff > 0.55 && r.chance(0.5) ? 3 : 2;
      const seg = 6.4;
      b.pt(Lr - 4, 0, b.h);
      b.pt(Lr - 2.5, sd * (c - 0.55), b.h);
      b.pt(Lr - 0.4, sd * (c - 0.55), b.h, { act: { type: 'wallrun' } });
      b.lip(Lr, -c, c, b.h);
      const h0 = b.h;
      for (let i = 0; i < n; i++) {
        const u0 = i === 0 ? Lr - 1.75 : Lr + seg * i - 1.5;
        const u1 = Lr + seg * i + 5;
        const top = h0 + 5 + 1.75 * i;
        b.box(u0, u1, sd > 0 ? c : -c - 1.25, sd > 0 ? c + 1.25 : -c, h0 - DATUM, top, 'wall', { runSide: -sd, refY: h0 });
        b.runFace(sd * c, u0 + 0.1, u1 - 0.5, h0 + 0.6 + 1.4 * i, h0 + 3.4 + 1.6 * i, -sd);
        const ku = u1 - 1.4;
        const lastW = i === n - 1;
        const nu = lastW ? u1 + 3 : Lr + seg * (i + 1) + 1;
        const nv = lastW ? 0 : -sd * (c - 0.5);
        b.pt(Lr + seg * i + 1.6, sd * (c - 0.35), h0 + 1.3 + 1.3 * i);
        b.pt(ku, sd * (c - 0.35), h0 + 1.6 + 1.3 * i, { act: b.tgt({ type: 'walljump' }, nu, nv) });
        sd = -sd;
      }
      const uEnd = Lr + seg * (n - 1) + 5;
      const hL = h0 + 2.25 + 1.5 * (n - 1);
      b.lip(uEnd + 1.25, -G.lane / 2, G.lane / 2, hL);
      b.pt(uEnd + 3, 0, hL);
      k.exit(uEnd + 1.25, q(r, 4, 5.5, 0.5), hL, { extra: { thick: 1.25 }, cpAt: 2 });
    },

    pillarkick() {
      // a gap too long to jump, with a monolith standing off to one side: kick off it (or run it)
      const Lr = q(r, 4, 6, 0.5);
      const w = G.lane;
      k.runway(Lr, w);
      const sd = r.sign();
      const g = q(r, 5.5, 6.5, 0.5);
      const pu0 = Lr + q(r, 1.25, 1.75, 0.25);
      const pu1 = pu0 + q(r, 1.5, 2.5, 0.5);
      const pv = sd * (w / 2 + q(r, 0.5, 1, 0.25));
      const top = b.h + q(r, 4.5, 7, 0.5);
      b.box(pu0, pu1, Math.min(pv, pv + sd * 1.5), Math.max(pv, pv + sd * 1.5), b.h - DATUM - r.pick([2, 6, 10]), top, 'pillar');
      b.runFace(pv, pu0, pu1, b.h + 0.8, b.h + 3, -sd);
      b.lip(Lr, -w / 2, w / 2, b.h);
      const dh = Number(r.weighted({ 0: 2, 1: 1 }));
      const av = sd * (w / 2 - 0.5);
      b.pt(Lr - 2.5, av * 0.5, b.h);
      b.pt(Lr - 0.3, av, b.h, { act: { type: 'jump', lead: 0.2 } });
      b.pt((pu0 + pu1) / 2, pv - sd * 0.5, b.h + 1.2, { act: b.tgt({ type: 'kick' }, Lr + g + 2, 0) });
      k.exit(Lr + g, q(r, 4, 5.5, 0.5), b.h + dh, { cpAt: 1.4 });
    },

    tictac() {
      // a ledge too high and too far for a jump, with a monolith standing beside the gap:
      // jump, kick off its face for the extra height, and mantle onto the ledge
      const Lr = q(r, 5, 7, 0.5);
      const w = G.lane;
      k.runway(Lr, w);
      const sd = r.sign();
      const g = q(r, 3, 3.5, 0.5);
      const pu0 = Lr + 0.5;
      const pu1 = Lr + g - 0.5;
      const pv = sd * (w / 2 + 0.25);
      const top = b.h + q(r, 6, 8, 0.5);
      b.box(pu0, pu1, Math.min(pv, pv + sd * 1.5), Math.max(pv, pv + sd * 1.5), b.h - DATUM - r.pick([2, 6]), top, 'pillar');
      b.runFace(pv, pu0, pu1, b.h + 0.8, b.h + 3.2, -sd);
      b.lip(Lr, -w / 2, w / 2, b.h);
      // above jump + climb reach from the gap: only the kick's extra height gets you to the top
      const dh = q(r, 4.5, 5, 0.25);
      const h2 = b.h + dh;
      const L2 = q(r, 4, 5.5, 0.5);
      b.block(Lr + g, Lr + g + L2, -w / 2, w / 2, h2, { below: 2, climbFace: true });
      b.climbFace(Lr + g, -0.8, 0.8, b.h, h2);
      b.lip(Lr + g, -w / 2, w / 2, h2);
      const av = sd * (w / 2 - 0.6);
      b.pt(Lr - 3, av * 0.5, b.h);
      b.pt(Lr - 0.3, av, b.h, { act: { type: 'jump', lead: 0.2 } });
      b.pt(pu0 + 0.6, pv - sd * 0.5, b.h + 1.2, { act: b.tgt({ type: 'kick' }, Lr + g + 2, -sd * 0.5) });
      b.pt(Lr + g + 0.8, 0, h2);
      b.h = h2;
      b.w = w;
      b.cp(Lr + g + 1.4, 0, h2);
      b.pt(Lr + g + L2, 0, h2);
      b.adv(Lr + g + L2);
    },

    kickchain() {
      // a gap far too long for one kick: two monoliths stand off alternate sides of it. Jump,
      // kick off the first across to the second, kick off that onto the far deck (UT style)
      const Lr = q(r, 4.5, 6, 0.5);
      const w = G.lane;
      k.runway(Lr, w);
      const h0 = b.h;
      const sd = r.sign();
      const off = q(r, 0.5, 1, 0.25);
      const pillar = (u0, u1, side, top) => {
        const pv = side * (w / 2 + off);
        b.box(u0, u1, Math.min(pv, pv + side * 1.5), Math.max(pv, pv + side * 1.5), h0 - DATUM - r.pick([2, 6, 10]), top, 'pillar');
        b.runFace(pv, u0, u1, h0 + 0.8, h0 + 3.2, -side);
        return pv;
      };
      const a0 = Lr + q(r, 1.25, 1.75, 0.25);
      const a1 = a0 + 2;
      const pvA = pillar(a0, a1, sd, h0 + q(r, 5, 7, 0.5));
      const b0 = a1 + q(r, 2.5, 3, 0.25);
      const b1 = b0 + 2;
      const pvB = pillar(b0, b1, -sd, h0 + q(r, 6, 8, 0.5));
      const g = b1 + q(r, 2.5, 3, 0.5) - Lr;
      b.lip(Lr, -w / 2, w / 2, h0);
      const dh = Number(r.weighted({ 0: 2, 1: 1.2 }));
      const h2 = h0 + dh;
      b.lip(Lr + g, -w / 2, w / 2, h2);
      const av = sd * (w / 2 - 0.5);
      b.pt(Lr - 2.5, av * 0.5, h0);
      b.pt(Lr - 0.3, av, h0, { act: { type: 'jump', lead: 0.2 } });
      b.pt((a0 + a1) / 2, pvA - sd * 0.5, h0 + 1.2, { act: b.tgt({ type: 'kick' }, b0 + 0.6, pvB + sd * 0.5) });
      b.pt((b0 + b1) / 2, pvB + sd * 0.5, h0 + 1.6, { act: b.tgt({ type: 'kick' }, Lr + g + 2, 0) });
      k.exit(Lr + g, q(r, 4.5, 6, 0.5), h2, { cpAt: 1.4 });
      return { calm: true };
    },

    // ------------------------------------------------------------------------------- turns
    climbkick(tdIn) {
      // wall too tall to top: climb it, then kick off sideways onto a ledge and run off at 90°
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const Lr = q(r, 4, 6, 0.5);
      k.runway(Lr, w);
      const top = b.h + q(r, 7.5, 10, 0.5);
      b.block(Lr, Lr + q(r, 2.5, 4, 0.5), -w / 2 - 0.5, w / 2 + 0.5, top);
      b.climbFace(Lr, -0.9, 0.9, b.h, b.h + 4.2);
      const hp = b.h + 3;
      const near = w / 2 + 1;
      const LC = q(r, 5.5, 7.5, 0.5);
      // the ledge is one lane deep (u), so the new leg runs on the gauge
      const pu0 = Lr - G.lane;
      b.slab(pu0, Lr, Math.min(td * near, td * (near + LC)), Math.max(td * near, td * (near + LC)), hp, { thick: 0.75 });
      b.lipAlong(td * near, pu0, Lr, hp);
      b.sign(Lr - 0.05, td * 0.2, b.h + 5.2, td);
      b.pt(Lr - 0.5, 0, b.h, { act: { type: 'climb', lead: 1.0 } });
      const tu = Lr - G.lane / 2;
      const tv = td * (near + 2.2);
      b.pt(Lr - 0.35, 0, b.h + 2.2, { act: b.tgt({ type: 'climbjump' }, tu, tv) });
      b.pt(tu, tv, hp);
      b.pivot(tu, td * near, td);
      b.h = hp;
      b.w = G.lane;
      b.cp(2.2, 0, hp);
      b.pt(LC, 0, hp);
      b.adv(LC);
      return { turned: true };
    },

    zigzag(tdIn) {
      // a stairwell: climb, kick off sideways onto a ledge, run it into another wall, climb and
      // kick back the other way. Two climbs, two 90° turns, back on the original heading.
      const td = k.turnDir(tdIn);
      this.climbkick(td);
      this.climbkick(-td);
      return { turned: true };
    },

    kick(tdIn) {
      // wallrun along a monolith, kick off it sideways onto a ledge that leads off at 90°
      const td = k.turnDir(tdIn);
      const sd = -td;
      const w = G.lane;
      const Lr = q(r, 5, 6.5, 0.5);
      k.runway(Lr, w);
      const top = b.h + q(r, 5, 8, 0.5);
      b.box(Lr - 1.75, Lr + 9, sd > 0 ? w / 2 : -w / 2 - 1.5, sd > 0 ? w / 2 + 1.5 : -w / 2, b.h - DATUM, top, 'wall', { runSide: td, refY: b.h });
      b.lip(Lr, -w / 2, w / 2, b.h);
      b.runFace(sd * w / 2, Lr - 1.7, Lr + 4.5, b.h + 0.5, b.h + 3.2, -sd);
      const lineV = sd * (w / 2 - 0.55);
      b.pt(Lr - 4, 0, b.h);
      b.pt(Lr - 2.5, lineV, b.h);
      b.pt(Lr - 0.4, lineV, b.h, { act: { type: 'wallrun' } });
      const hC = b.h + Number(r.weighted({ 1: 1.2, 0: 1.5, '-1': 1 }));
      const wC = G.wide;
      const LC = q(r, 7.5, 9.5, 0.5);
      const uC0 = Lr + 4.5;
      const vNear = td * (w / 2 - 1);
      b.slab(uC0, uC0 + wC, Math.min(vNear, vNear + td * LC), Math.max(vNear, vNear + td * LC), hC);
      b.lip(uC0, vNear, vNear + td * 5, hC);
      b.sign(uC0 + wC + 0.4, td * (w / 2 + 2.5), hC + 3, td);
      const tu = uC0 + wC * 0.5;
      const tv = td * (w / 2 + 2.2);
      b.pt(Lr + 1.8, sd * (w / 2 - 0.35), b.h + 1.3, { act: b.tgt({ type: 'walljump' }, tu, tv) });
      b.pt(tu, tv, hC);
      b.pivot(tu, td * (w / 2 + 1), td);
      b.h = hC;
      b.w = wC;
      b.cp(2.5, 0, hC);
      const rest = LC - (w / 2 + 1) + (w / 2 - 1);
      b.pt(rest, 0, hC);
      b.adv(rest);
      return { turned: true };
    },

    corner(tdIn) {
      const td = k.turnDir(tdIn);
      // cut variant: a diagonal hop across the inside of the corner, over one floating pad
      const cut = tdIn === undefined && r.chance(0.5);
      const w = G.lane;
      const L = cut ? q(r, 7, 9, 0.5) : q(r, 2, 5, 0.5);
      b.slabC(0, L + w, w, b.h);
      b.sign(L + w + 0.3, -td * w * 0.15, b.h + 3, td);
      b.cp(Math.min(1, L * 0.3), 0, b.h);
      if (!cut) {
        b.pt(L, 0, b.h);
        // cut the corner on the racing line
        b.pt(L + w * 0.5, td * w * 0.2, b.h);
        b.pivot(L + w / 2, td * w / 2, td);
        b.w = w;
        return { turned: true };
      }
      // the new leg's first slab is laid here, so the shortcut has somewhere to land
      const Ln = q(r, 10, 12, 0.5);
      const vN0 = td * w / 2;
      const vN1 = td * (w / 2 + Ln);
      b.slab(L, L + w, Math.min(vN0, vN1), Math.max(vN0, vN1), b.h);
      const uA = L - 6;
      const vA = td * (w / 2 - 0.5);
      const uP = L - 2;
      const vP = td * (w / 2 + 2.75);
      b.slab(uP - G.pad / 2, uP + G.pad / 2, vP - G.pad / 2, vP + G.pad / 2, b.h, { kind: 'pad', thick: 6 });
      const vB = td * (w / 2 + 6.5);
      b.lipAlong(td * w / 2, uA - 1.5, uA + 1, b.h);
      b.sign(uA + 1.5, td * (w / 2 + 1.5), b.h + 2.4, td, 'alt', 'skill');
      b.routes([{ tag: 'main', lay: () => {
        b.pt(uA, 0, b.h);
        b.pt(L, 0, b.h);
        b.pt(L + w * 0.5, td * w * 0.2, b.h);
        b.pt(L + w / 2, td * (w / 2 + 1), b.h);
        b.pt(L + w / 2, vB, b.h);
      } }, { tag: 'skill', lay: () => {
        b.pt(uA - 2.5, td * 0.6, b.h);
        b.pt(uA, vA, b.h, { act: { type: 'jump', lead: 0.25 } });
        b.pt(uP, vP, b.h, { act: { type: 'jump', lead: 0.05 } });
        b.pt(L + w / 2, vB, b.h);
      } }]);
      b.pivot(L + w / 2, vB, td);
      b.w = w;
      const rest = Ln - 6.5;
      b.cp(0.5, 0, b.h);
      b.pt(rest, 0, b.h);
      b.adv(rest);
      return { turned: true };
    },

    turngap(tdIn) {
      // platform ends; the next one is off to the side: turn 90° and jump across
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const L = q(r, 3, 6, 0.5);
      b.slabC(0, L + w, w, b.h);
      b.cp(Math.min(1, L * 0.3), 0, b.h);
      const dh = Number(r.weighted({ 0: 2, 1: 1.2, '-1': 1 }));
      const g = q(r, 2, 2.5 + diff, 0.5);
      const uc = L + w / 2;
      b.sign(L + w + 0.3, 0, b.h + 2.8, td);
      b.lipAlong(td * w / 2, L, L + w, b.h);
      b.pt(L - 0.5, 0, b.h);
      b.pt(uc - 0.6, td * 0.4, b.h);
      b.pt(uc, td * (w / 2 - 0.35), b.h, { act: { type: 'jump', lead: 0.25 } });
      b.pivot(uc, td * (w / 2 + g), td);
      const len = q(r, 4, 6, 0.5);
      b.h += dh;
      b.w = G.lane;
      b.slabC(0, len, G.lane, b.h);
      b.cp(1.2, 0, b.h);
      b.pt(len, 0, b.h);
      b.adv(len);
      return { turned: true };
    },
  };
}
