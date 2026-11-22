// Rhythm and skill checks: two moves chained so tightly the second has to be lined up during
// the first (vault into a jump, slide into a jump, wallrun into wallrun), and rooftop hop runs.
// Short, dense, no dead straights: each one is a few seconds of inputs.
import { DATUM, q } from '../kit.js';
import { jumpReach } from './builder.js';

export default function skill(k) {
  const { b, r, diff, G } = k;
  return {
    vaultgap() {
      // a barrier just short of the edge: vault it and jump straight off the landing
      const w = G.lane;
      const Lr = q(r, 6.5, 7, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const uB = Lr - 4.5;
      k.barrier(uB, -w / 2, w / 2, h0, 0.75);
      const dh = Number(r.weighted({ 0: 2, '-1': 1.5, 1: 0.6 }));
      const g = q(r, 2, 2.5 + diff * 0.5, 0.5);
      b.lip(Lr, -w / 2, w / 2, h0);
      b.pt(uB - 0.5, 0, h0, { act: { type: 'vault' } });
      b.pt(uB + 1, 0, h0);
      b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.2 } });
      k.exit(Lr + g, q(r, 3.5, 5, 0.5), h0 + dh, { cpAt: 1.2 });
    },

    slidegap() {
      // slide under a gate right at the edge and jump out of the slide: the slide boost is what
      // carries the long gap behind it
      const w = G.lane;
      const Lr = q(r, 6.5, 7.5, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const uG = Lr - 2.5;
      k.gate(uG, -w / 2, w / 2, h0, r.sign());
      const dh = Number(r.weighted({ 0: 2, '-1': 1.2 }));
      const g = q(r, 3, 3.5 + diff * 0.5, 0.5);
      b.lip(Lr, -w / 2, w / 2, h0);
      b.pt(uG - 2.4, 0, h0, { act: { type: 'slide' } });
      b.pt(uG + 0.8, 0, h0);
      b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.2 } });
      k.exit(Lr + g, q(r, 3.5, 5, 0.5), h0 + dh, { cpAt: 1.2 });
    },

    rooftops() {
      // a run of short lane-wide rooftops at stepping heights: hop, hop, hop — no run-up between
      const w = G.lane;
      const Lr = q(r, 2.5, 3.5, 0.5);
      k.runway(Lr, w);
      const n = r.int(3, 3 + Math.round(diff * 1.5));
      let u = Lr;
      let h = b.h;
      let v = 0;
      for (let i = 0; i < n; i++) {
        const dh = Number(r.weighted({ 0: 1, 0.5: 1.2, 1: 0.8, '-1': 1, '-1.5': 0.6 }));
        const nv = Math.max(-1.5, Math.min(1.5, v + (r.chance(0.4) ? r.sign() * 1 : 0)));
        const g = Math.max(1.5, q(r, 1.5, Math.max(1.5, jumpReach(dh, 7) * 0.62), 0.5));
        const L = i === n - 1 ? 0 : q(r, 3, 4, 0.5);
        b.lip(u, v - w / 2, v + w / 2, h);
        b.pt(u - 0.3, v, h, { act: { type: 'jump', lead: 0.25 } });
        if (i === n - 1) {
          k.exit(u + g, q(r, 3.5, 5, 0.5), h + dh, { v: nv, cpAt: 1.2 });
          return;
        }
        b.slab(u + g, u + g + L, nv - w / 2, nv + w / 2, h + dh, { thick: r.pick([1, 3, 5]) });
        b.pt(u + g + 1.2, nv, h + dh);
        u += g + L;
        h += dh;
        v = nv;
      }
    },

    alley() {
      // a long gap between two staggered walls: wallrun the first, kick across to the second,
      // ride it out onto the far deck. Same level the whole way: a speed piece, not a climb.
      const w = G.lane;
      const c = w / 2;
      const Lr = q(r, 5, 6, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const sd = r.sign();
      const seg = 6;
      const top = h0 + q(r, 4.5, 6, 0.5);
      const wall = (u0, u1, side) => {
        b.box(u0, u1, side > 0 ? c : -c - 1.25, side > 0 ? c + 1.25 : -c, h0 - DATUM, top, 'wall', { runSide: -side, refY: h0 });
        b.runFace(side * c, u0 + 0.1, u1 - 0.3, h0 + 0.5, h0 + 3.2, -side);
      };
      wall(Lr - 1.75, Lr + 5, sd);
      wall(Lr + seg - 1.5, Lr + seg + 5.5, -sd);
      const g = seg + 5.5 - 1;
      b.lip(Lr, -c, c, h0);
      b.pt(Lr - 4, 0, h0);
      b.pt(Lr - 2.5, sd * (c - 0.55), h0);
      b.pt(Lr - 0.4, sd * (c - 0.55), h0, { act: { type: 'wallrun' } });
      b.pt(Lr + 1.6, sd * (c - 0.35), h0 + 1.3);
      b.pt(Lr + 3.6, sd * (c - 0.35), h0 + 1.5, { act: b.tgt({ type: 'walljump' }, Lr + seg + 1, -sd * (c - 0.5)) });
      b.pt(Lr + seg + 1.6, -sd * (c - 0.35), h0 + 1.5);
      b.pt(Lr + seg + 4, -sd * (c - 0.35), h0 + 1.2);
      const dh = Number(r.weighted({ 0: 2, '-1': 1 }));
      k.exit(Lr + g, q(r, 4.5, 5.5, 0.5), h0 + dh, { cpAt: 2 });
    },
  };
}
