// Vertical set-pieces: shafts and wall climbs that gain a storey fast, stacked two-level forks
// (a lane running under another), and the turns that change level on the way round a corner.
// Every piece keeps the lane gauge on its entry and exit, so it drops in anywhere a plain
// module would — including inside the planner's spirals, which fold the route over itself.
import { DATUM, q } from '../kit.js';
import { jumpReach } from './builder.js';

export default function vertical(k) {
  const { b, r, diff, G } = k;
  return {
    chimney() {
      // a narrow shaft between two tall walls over the void: wallrun one side, kick across to
      // the other, kick again and mantle a ledge a storey and a half up. Zig-zag up the shaft.
      const w = G.lane;
      const c = 1.5;                          // inner faces at ±c: a 3 m shaft
      const Lr = q(r, 3.5, 4.5, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const n = diff > 0.5 && r.chance(0.6) ? 3 : 2;
      const seg = 4.5;
      const sd = r.sign();
      const uL = Lr + seg * n + 1;            // ledge face
      const hL = h0 + (n === 3 ? 5.5 : 4.25);
      const top = hL + q(r, 2, 3, 0.5);
      for (const s of [-1, 1]) {
        b.box(Lr, uL, s > 0 ? c : -c - 1, s > 0 ? c + 1 : -c, h0 - DATUM, top, 'wall', { runSide: -s, refY: h0 });
        b.runFace(s * c, Lr + 0.1, uL - 0.2, h0 + 0.6, hL - 0.4, -s);
      }
      b.lip(Lr, -w / 2, w / 2, h0);
      b.pt(Lr - 3, 0, h0);
      b.pt(Lr - 0.4, sd * (c - 0.6), h0, { act: { type: 'wallrun' } });
      let side = sd;
      for (let i = 0; i < n; i++) {
        const u0 = Lr + seg * i;
        const y = h0 + 1.3 + 1.35 * i;
        b.pt(u0 + 1, side * (c - 0.35), y);
        const last = i === n - 1;
        const tu = last ? uL + 1.5 : u0 + seg + 1;
        const tv = last ? 0 : -side * (c - 0.4);
        b.pt(u0 + 2.4, side * (c - 0.35), y + 0.3, { act: b.tgt({ type: 'walljump' }, tu, tv) });
        side = -side;
      }
      const L2 = q(r, 4, 5.5, 0.5);
      b.block(uL, uL + L2, -w / 2, w / 2, hL, { below: 2, climbFace: true });
      b.lip(uL, -w / 2, w / 2, hL);
      b.pt(uL + 1, 0, hL);
      b.h = hL;
      b.w = w;
      b.cp(uL + 1.6, 0, hL);
      b.pt(uL + L2, 0, hL);
      b.adv(uL + L2);
    },

    wallclimb() {
      // the deck ahead is a storey up over a gap: wallrun the flank wall across and wall-jump up
      // off it onto the high deck (Mirror's Edge wallrun-to-ledge)
      const w = G.lane;
      const Lr = q(r, 4.5, 5.5, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const sd = r.sign();
      const g = q(r, 4.5, 5.5, 0.5);
      const dh = q(r, 2.5, 3 + 0.5 * diff, 0.5);
      const h2 = h0 + dh;
      const wb = 1.5;
      b.box(Lr - 1.75, Lr + g, sd > 0 ? w / 2 : -w / 2 - wb, sd > 0 ? w / 2 + wb : -w / 2, h0 - DATUM, h2 + q(r, 2.5, 3.5, 0.5), 'wall', { runSide: -sd, refY: h0 });
      b.runFace(sd * w / 2, Lr - 1.7, Lr + g - 0.2, h0 + 0.5, h0 + 3.2, -sd);
      b.lip(Lr, -w / 2, w / 2, h0);
      const lineV = sd * (w / 2 - 0.55);
      b.pt(Lr - 4, 0, h0);
      b.pt(Lr - 2.5, lineV, h0);
      b.pt(Lr - 0.4, lineV, h0, { act: { type: 'wallrun' } });
      b.pt(Lr + g * 0.4, sd * (w / 2 - 0.35), h0 + 1.4);
      b.pt(Lr + g - 1.4, sd * (w / 2 - 0.35), h0 + 1.6, { act: b.tgt({ type: 'walljump' }, Lr + g + 2.5, -sd * 0.4) });
      const L2 = q(r, 4, 5.5, 0.5);
      b.block(Lr + g, Lr + g + L2, -w / 2, w / 2, h2, { below: 2, climbFace: true });
      b.climbFace(Lr + g, -0.8, 0.8, h0 - 1, h2);
      b.lip(Lr + g, -w / 2, w / 2, h2);
      b.pt(Lr + g + 1.2, 0, h2);
      b.h = h2;
      b.w = w;
      b.cp(Lr + g + 1.6, 0, h2);
      b.pt(Lr + g + L2, 0, h2);
      b.adv(Lr + g + L2);
    },

    plunge() {
      // two storeys on one footprint. A slot is cut in the deck: drop through it (roll), run the
      // lower deck under the upper one (vault, slide gate) — or keep to the narrow strip beside
      // the slot and stay high (HIGH LINE), then drop off the end of the upper deck.
      const w = G.lane;
      const Lr = q(r, 3, 4, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const sd = r.sign();                    // strip side
      const depth = 4.5;
      const hL = h0 - depth;
      const strip = diff > 0.5 ? 1.25 : 1.5;
      const uH0 = Lr + q(r, 1.5, 2, 0.5);
      const uH1 = uH0 + q(r, 6.5, 7.5, 0.5);
      const uV = uH0 + 8.5;
      const uE = Math.max(uH1 + q(r, 4, 5, 0.5), uV + 6);
      const uG = uE - 1;
      const uX = uE + 6.5;
      const [s0, s1] = [Math.min(sd * (w / 2 - strip), sd * w / 2), Math.max(sd * (w / 2 - strip), sd * w / 2)];
      b.slabC(Lr, uH0, w, h0);
      b.slab(uH0, uH1, s0, s1, h0, { kind: 'step', thick: 0.75 });
      b.slabC(uH1, uE, w, h0, { thick: 0.75 });
      b.lip(uH0, -w / 2, w / 2, h0);
      b.lip(uE, -w / 2, w / 2, h0);
      // lower deck: under the slot, the upper deck and on past its end
      b.slabC(uH0 - 0.5, uX, w, hL);
      k.barrier(uV, -w / 2, w / 2, hL, 0.75);
      k.gate(uG, -w / 2, w / 2, hL);
      const vS = sd * (w / 2 - strip / 2);
      const vH = -sd * (w / 2 - strip) / 2;
      b.sign(uH0 - 1.5, vS, h0 + 2.6, 0, 'alt', 'high');
      b.routes([{ tag: 'main', lay: () => {
        b.pt(uH0 - 1.5, vH, h0);
        b.pt(uH0 + 0.5, vH, h0);
        b.pt(uH0 + 3.5, vH * 0.5, hL + 1.2, { act: { type: 'roll', h: hL } });
        b.pt(uH0 + 5.5, 0, hL);
        b.cp(uH0 + 6, 0, hL);
        b.pt(uV - 0.5, 0, hL, { act: { type: 'vault' } });
        b.pt(uV + 1, 0, hL);
        b.pt(uG - 2.4, 0, hL, { act: { type: 'slide' } });
        b.pt(uG + 1, 0, hL);
        b.pt(uX - 1, 0, hL);
      } }, { tag: 'high', lay: () => {
        b.pt(uH0 - 2, vS * 0.6, h0);
        b.pt(uH0, vS, h0);
        b.pt(uH1, vS, h0);
        b.pt(uH1 + 2, 0, h0);
        b.pt(uE - 0.2, 0, h0);
        b.pt(uE + 3, 0, hL + 1.2, { act: { type: 'roll', h: hL } });
        b.pt(uX - 1, 0, hL);
      } }]);
      k.exit(uX, q(r, 3, 4, 0.5), hL, { cpAt: 0.5 });
    },

    mezzanine() {
      // a lane with a deck stacked over it. Low lane (main): vault and slide under the deck.
      // HIGH LINE: kick off a pillar up onto the deck, jump its hole, drop back down at the end.
      const w = G.lane;
      const Lr = q(r, 3, 4, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const sd = r.sign();
      const hU = h0 + 4.25;
      const uA = Lr + 4;                      // upper deck front
      const uh0 = uA + q(r, 3, 3.5, 0.5);
      const uh1 = uh0 + q(r, 2.5, 3, 0.5);
      const uB = uh1 + q(r, 3.5, 4.5, 0.5);   // upper deck end
      const uM = uB + 7;
      b.slabC(Lr, uM, w, h0);                 // low lane
      b.slabC(uA, uh0, w, hU, { thick: 0.75 });
      b.slabC(uh1, uB, w, hU, { thick: 0.75 });
      b.lip(uA, -w / 2, w / 2, hU);
      b.lip(uh0, -w / 2, w / 2, hU);
      b.lip(uB, -w / 2, w / 2, hU);
      // kick pillar beside the low lane, short of the deck
      const pu0 = uA - 3;
      const pu1 = uA - 0.25;
      const pv = sd * (w / 2 + 0.25);
      b.box(pu0, pu1, Math.min(pv, pv + sd * 1.5), Math.max(pv, pv + sd * 1.5), h0 - DATUM, hU + 2.5, 'pillar');
      b.runFace(pv, pu0, pu1, h0 + 0.8, h0 + 3.2, -sd);
      const uV = uA + 1.5;
      k.barrier(uV, -w / 2, w / 2, h0, 0.75);
      const uG = uB - 1.5;
      k.gate(uG, -w / 2, w / 2, h0);
      b.sign(pu0 - 1, sd * (w / 2 - 0.5), h0 + 3, sd, 'alt', 'high');
      const av = sd * (w / 2 - 0.6);
      b.routes([{ tag: 'main', lay: () => {
        b.pt(uV - 0.5, 0, h0, { act: { type: 'vault' } });
        b.pt(uV + 1, 0, h0);
        b.pt(uG - 2.4, 0, h0, { act: { type: 'slide' } });
        b.pt(uG + 1, 0, h0);
        b.pt(uM - 1, 0, h0);
      } }, { tag: 'high', lay: () => {
        b.pt(pu0 - 3, av * 0.5, h0);
        b.pt(pu0 - 0.6, av, h0, { act: { type: 'jump', lead: 0.2 } });
        // kick late on the pillar: the higher the kick, the higher the grab on the deck's edge
        b.pt(pu0 + 1.7, pv - sd * 0.5, h0 + 1.4, { act: b.tgt({ type: 'kick' }, uA + 2, -sd * 0.5) });
        b.pt(uA + 0.8, 0, hU);
        b.pt(uh0 - 0.3, 0, hU, { act: { type: 'jump', lead: 0.25 } });
        b.pt(uh1 + 1.2, 0, hU);
        b.pt(uB - 0.2, 0, hU);
        b.pt(uB + 4.5, 0, h0);
        b.pt(uM - 1, 0, h0);
      } }]);
      k.exit(uM, q(r, 3, 4, 0.5), h0, { cpAt: 0.5 });
    },

    // -------------------------------------------------------------------------- turns
    dropturn(tdIn) {
      // the deck ends at a corner over a drop: turn and jump off the side onto the new leg a
      // storey below (roll the big ones)
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const L = q(r, 3, 5, 0.5);
      b.slabC(0, L + w, w, b.h);
      b.cp(Math.min(1, L * 0.3), 0, b.h);
      const dd = q(r, 3, Math.min(5, 3.5 + 1.5 * diff), 0.5);
      const g = q(r, 1, 2, 0.5);
      const uc = L + w / 2;
      const h2 = b.h - dd;
      b.sign(L + w + 0.3, 0, b.h + 2.8, td);
      b.lipAlong(td * w / 2, L, L + w, b.h);
      b.pt(L - 0.5, 0, b.h);
      b.pt(uc - 0.6, td * 0.4, b.h);
      b.pt(uc, td * (w / 2 - 0.35), b.h, { act: { type: 'jump', lead: 0.25 } });
      b.pt(uc, td * (w / 2 + g + 2), h2 + 1.1, dd >= 3.5 ? { act: { type: 'roll', h: h2 } } : {});
      b.pivot(uc, td * (w / 2 + g), td);
      const len = Math.ceil(Math.max(q(r, 5.5, 7, 0.5), jumpReach(-dd, 10.5) - g + 3) * 2) / 2;
      b.h = h2;
      b.w = G.lane;
      b.slabC(0, len, G.lane, h2);
      b.cp(len * 0.6, 0, h2);
      b.pt(len, 0, h2);
      b.adv(len);
      return { turned: true };
    },

    vaultturn(tdIn) {
      // round the corner and straight into an obstacle: vault a barrier or slide a gate
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const L = q(r, 2.5, 4, 0.5);
      const h = b.h;
      b.slabC(0, L + w, w, h);
      b.sign(L + w + 0.3, -td * w * 0.15, h + 3, td);
      b.cp(Math.min(1, L * 0.3), 0, h);
      b.pt(L, 0, h);
      b.pt(L + w * 0.5, td * w * 0.2, h);
      b.pivot(L + w / 2, td * w / 2, td);
      const Ln = q(r, 7, 8.5, 0.5);
      b.slabC(0, Ln, w, h);
      const uO = q(r, 3, 3.5, 0.5);
      if (r.chance(0.55)) {
        k.barrier(uO, -w / 2, w / 2, h, q(r, 0.75, 1, 0.25));
        b.pt(uO - 0.5, 0, h, { act: { type: 'vault' } });
      } else {
        k.gate(uO + 1, -w / 2, w / 2, h, r.sign());
        b.pt(uO - 1.4, 0, h, { act: { type: 'slide' } });
      }
      b.pt(uO + 2, 0, h);
      b.pt(Ln, 0, h);
      b.adv(Ln);
      return { turned: true };
    },

    kickturn(tdIn) {
      // a pillar stands past the end of the deck on the outside of the corner: jump at it, kick
      // off and fly round onto the new leg (UT-style air turn, keeps the speed)
      const td = k.turnDir(tdIn);
      const sd = -td;
      const w = G.lane;
      const Lr = q(r, 4.5, 6, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const pu0 = Lr + 0.5;
      const pu1 = pu0 + q(r, 2, 2.5, 0.5);
      const pv = sd * w / 2;
      b.box(pu0, pu1, Math.min(pv, pv + sd * 1.5), Math.max(pv, pv + sd * 1.5), h0 - DATUM - r.pick([2, 6]), h0 + q(r, 5, 7, 0.5), 'pillar');
      b.runFace(pv, pu0, pu1, h0 + 0.8, h0 + 3, -sd);
      b.lip(Lr, -w / 2, w / 2, h0);
      const hC = h0 + Number(r.weighted({ 0: 2, '-1': 1.2 }));
      const wC = G.lane;
      const uC0 = pu1 + 1;
      const vNear = td * (w / 2 - 1);
      const LC = q(r, 7.5, 9, 0.5);
      b.slab(uC0, uC0 + wC, Math.min(vNear, vNear + td * LC), Math.max(vNear, vNear + td * LC), hC);
      b.lip(uC0, vNear, vNear + td * 5, hC);
      b.sign(uC0 + wC + 0.4, td * (w / 2 + 2.5), hC + 3, td);
      const tu = uC0 + wC * 0.5;
      const tv = td * (w / 2 + 2.2);
      const av = sd * (w / 2 - 0.5);
      b.pt(Lr - 3, av * 0.5, h0);
      b.pt(Lr - 0.3, av, h0, { act: { type: 'jump', lead: 0.2 } });
      b.pt((pu0 + pu1) / 2, pv - sd * 0.5, h0 + 1.2, { act: b.tgt({ type: 'kick' }, tu, tv) });
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
  };
}
