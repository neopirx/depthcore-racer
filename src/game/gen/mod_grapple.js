// Grapple set-pieces: pendulum swings over long gaps and pivot posts that whip you round.
import { q } from '../kit.js';

export default function grapple(k) {
  const { b, r, diff, G } = k;
  return {
    swing() {
      // grapple swing: a gap far beyond any jump with an anchor node hanging over it. The hook
      // flies at hookSpeed, so it is fired on the run-up; the line reels in to the takeoff, then
      // the pendulum carries you over. Entry speed is energy: faster in = higher, longer flight.
      const Lr = q(r, 9, 12, 0.5);
      k.runway(Lr);
      const G2 = q(r, 12, 14 + diff * 5, 0.5);
      const H = q(r, 7, 8.5, 0.5);
      // the node sits short of mid-gap: the far edge is further from it than the lip, so the
      // circle crosses the far edge higher than it left the lip
      let ua = Lr + G2 * q(r, 0.4, 0.46, 0.01);
      // ...but the far edge must stay well inside the rope's reach (radius = lip distance)
      while (Lr + G2 - ua > 0.88 * Math.hypot(ua - Lr, H - 1.2)) ua += 0.25;
      const dh = Number(r.weighted({ 0: 2, '-1': 1.4, '-2': 0.7 }));
      const h0 = b.h;
      const h2 = h0 + dh;
      const A = b.anchor(ua, 0, h0 + H);
      const L2 = q(r, 7, 9, 0.5);
      const w2 = G.wide;
      // fire point: well before the lip, the node a comfortable shot ahead
      const uf = Math.max(1, Lr - 7);
      const land = b.slab(Lr + G2, Lr + G2 + L2, -w2 / 2, w2 / 2, h2);
      const box = { x0: land.x0, x1: land.x1, z0: land.z0, z1: land.z1, y: h2 };
      b.pt(uf, 0, h0, { act: { type: 'grapple', ax: A.x, ay: A.y, az: A.z, box } });
      b.lip(Lr, -b.w / 2, b.w / 2, h0);
      b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.25 } });
      const R = Math.hypot(ua - Lr, H - 1.2);
      b.pt(ua, 0, h0 + H - R - 1.2, { fly: 4.5 });
      b.h = h2;
      b.w = w2;
      b.cp(Lr + G2 + 2, 0, h2);
      b.pt(Lr + G2 + L2, 0, h2);
      b.adv(Lr + G2 + L2);
      return { calm: true };
    },

    pivot(tdIn) {
      // horizontal grapple: the runway ends in the void with a pivot post off the inside corner.
      // Jump out, line onto the post, let it whip you round 90° and fly off onto the new leg.
      const td = k.turnDir(tdIn);
      const w = G.lane;
      const Lr = q(r, 8, 10, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const R = k.whipR(2.5);
      const uc = Lr + q(r, 3, 3.5, 0.5) + (R - 3) * 0.25;
      const ex = td * b.rx;
      const ez = td * b.rz;
      const A = b.anchor(uc, td * R, h0 + 2.75, 'pivot');
      b.whip(A, R, -td * Math.PI / 2, td * Math.PI / 2, h0 + 1.3);
      b.lip(Lr, -w / 2, w / 2, h0);
      b.sign(Lr - 0.2, td * (w / 2 - 0.4), h0 + 2.6, td, 'pivot');
      b.pt(Lr - 4.5, 0, h0, { act: { type: 'pivot', ax: A.x, ay: A.y, az: A.z, ex, ez } });
      b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.25 } });
      b.pt(uc, 0, h0 + 1.2);
      k.arc(uc, td * R, R, -td * Math.PI / 2, td * Math.PI / 2, h0 + 1.3);
      b.pivot(uc + R, td * R, td);
      const dh = Number(r.weighted({ 0: 1.5, '-1': 1.5, '-2': 0.8 }));
      const g = dh < -1 ? 3 : 2.5;
      b.lip(g, -G.wide / 2, G.wide / 2, h0 + dh);
      k.exit(g, q(r, 7, 9, 0.5), h0 + dh, { w: G.wide });
      return { turned: true };
    },

    slalom() {
      // two pivot posts across open void: whip 90° off the runway, fly, catch the second post and
      // whip back onto the original heading. Two sharp air turns, nothing to stand on between.
      const sd = k.sideDir();
      const w = G.lane;
      const Lr = q(r, 8, 10, 0.5);
      k.runway(Lr, w);
      const h0 = b.h;
      const R1 = k.whipR(2.5);
      const u1 = Lr + 3;
      const A1 = b.anchor(u1, sd * R1, h0 + 2.75, 'pivot');
      b.whip(A1, R1, -sd * Math.PI / 2, sd * Math.PI / 2, h0 + 1.3);
      b.lip(Lr, -w / 2, w / 2, h0);
      b.sign(Lr - 0.2, sd * (w / 2 - 0.4), h0 + 2.6, sd, 'pivot');
      b.pt(Lr - 4.5, 0, h0, { act: { type: 'pivot', ax: A1.x, ay: A1.y, az: A1.z, ex: sd * b.rx, ez: sd * b.rz } });
      b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.25 } });
      b.pt(u1, 0, h0 + 1.2);
      k.arc(u1, sd * R1, R1, -sd * Math.PI / 2, sd * Math.PI / 2, h0 + 1.3, 4);
      // straight flight sideways, then the second post (to the north of the line) turns us back
      const D = q(r, 3, 4, 0.5);
      const R2 = k.whipR(2.5);
      const e1u = u1 + R1;
      const v2 = sd * (R1 + D);
      const A2 = b.anchor(e1u + R2, v2, h0 + 1.75, 'pivot');
      b.whip(A2, R2, Math.PI, -sd * Math.PI / 2, h0 + 0.9);
      b.pt(e1u, sd * (R1 + 0.6), h0 + 1.3, { act: { type: 'pivot', ax: A2.x, ay: A2.y, az: A2.z, ex: b.fx, ez: b.fz } });
      b.pt(e1u, v2, h0 + 1.0);
      k.arc(e1u + R2, v2, R2, Math.PI, -sd * Math.PI / 2, h0 + 0.9, 4);
      const ve = v2 + sd * R2;
      const ue = e1u + R2;
      // the flight between posts loses height: the far deck sits well below the runway
      const dh = Number(r.weighted({ '-2.5': 1.5, '-3': 1 }));
      const g = 2.5;
      b.lip(ue + g, ve - G.wide / 2, ve + G.wide / 2, h0 + dh);
      k.exit(ue + g, q(r, 7, 9, 0.5), h0 + dh, { v: ve, w: G.wide });
    },

    switchback() {
      // turn back on yourself, twice: lane 0 runs ahead into a dead end, lane 1 runs back beside
      // it, lane 2 runs ahead again. Each U-turn is either a climb + kick back off the wall (gains
      // height) or a pivot post whipping you round the end of a divider wall (keeps speed).
      const sd = k.sideDir();
      const turnA = r.chance(0.5) ? 'climb' : 'pivot';
      let turnB = r.chance(0.5) ? 'climb' : 'pivot';
      if (turnA === 'pivot') turnB = 'climb';   // at most one pivot whip per segment
      const w0 = G.lane;
      const lw = G.lane;
      const h0 = b.h;
      const L1 = q(r, 7, 9, 0.5);
      // lane 1 must end far enough ahead of the module start for turn B's wall / arc
      const S1min = turnB === 'pivot' ? 7.5 : 4;
      const Lr = L1 + S1min + (turnA === 'pivot' ? 0 : 0.5);
      k.runway(Lr, w0);
      let c1;                              // lane 1 centre (v)
      let h1;
      let n1;                              // lane 1 north end (u)
      // ---- turn A: lane 0 (ahead) -> lane 1 (back)
      if (turnA === 'climb') {
        const top = h0 + q(r, 8, 10, 0.5);
        b.block(Lr, Lr + 3, -w0 / 2 - 0.5, w0 / 2 + 0.5, top);
        b.climbFace(Lr, -0.9, 0.9, h0, h0 + 4.2);
        const near = w0 / 2 + 1;
        c1 = sd * (near + lw / 2);
        h1 = h0 + 3.5;
        n1 = Lr;
        b.sign(Lr - 0.05, sd * 0.2, h0 + 5.2, sd);
        b.pt(Lr - 0.5, 0, h0, { act: { type: 'climb', lead: 1.0 } });
        b.pt(Lr - 0.35, 0, h0 + 2.2, { act: b.tgt({ type: 'climbjump' }, Lr - 2.25, c1) });
        b.pt(Lr - 2.25, c1, h1);
      } else {
        const R = Math.min(3.5, k.whipR(2.75));
        c1 = sd * 2 * R;
        h1 = h0;
        const uc = Lr + 3;
        n1 = Lr + 0.5;
        const A = b.anchor(uc, sd * R, h0 + 2.75, 'pivot');
        b.whip(A, R, -sd * Math.PI / 2, sd * Math.PI, h0 + 1.3);
        // divider: no sidestep from lane 0 to lane 1, the way round is the post
        k.divider(sd * R, n1 - L1, Lr, h0);
        b.lip(Lr, -w0 / 2, w0 / 2, h0);
        b.sign(Lr - 0.2, sd * (w0 / 2 - 0.4), h0 + 2.6, sd, 'pivot');
        b.pt(Lr - 4.5, 0, h0, { act: { type: 'pivot', ax: A.x, ay: A.y, az: A.z, ex: -b.fx, ez: -b.fz } });
        b.pt(Lr - 0.3, 0, h0, { act: { type: 'jump', lead: 0.25 } });
        b.pt(uc, 0, h0 + 1.2);
        k.arc(uc, sd * R, R, -sd * Math.PI / 2, sd * Math.PI, h0 + 1.3, 8);
        b.pt(n1 - 1, c1, h1);
      }
      const S1 = n1 - L1;
      b.slab(S1, n1, c1 - lw / 2, c1 + lw / 2, h1);
      b.cp(n1 - 2.5, c1, h1);
      // ---- turn B: lane 1 (back) -> lane 2 (ahead)
      let c2;
      let h2;
      let s2;                              // lane 2 south end
      if (turnB === 'climb') {
        const top = h1 + q(r, 8, 10, 0.5);
        b.block(S1 - 3, S1, c1 - lw / 2 - 0.5, c1 + lw / 2 + 0.5, top);
        // the climb face looks north (back up lane 1)
        b.climbFace(S1, c1 - 0.9, c1 + 0.9, h1, h1 + 4.2, true);
        const near = Math.abs(c1) + lw / 2 + 1;
        c2 = sd * (near + lw / 2);
        h2 = h1 + 3.5;
        s2 = S1;
        b.pt(S1 + 0.5, c1, h1, { act: { type: 'climb', lead: 1.0 } });
        b.pt(S1 + 0.35, c1, h1 + 2.2, { act: b.tgt({ type: 'climbjump' }, S1 + 2.25, c2) });
        b.pt(S1 + 2.25, c2, h2);
      } else {
        const R = Math.min(3.5, k.whipR(2.75));
        c2 = c1 + sd * 2 * R;
        h2 = h1;
        const uc = S1 - 3;
        s2 = S1 - 0.5;
        const A = b.anchor(uc, c1 + sd * R, h1 + 2.75, 'pivot');
        b.whip(A, R, -sd * Math.PI / 2, -sd * Math.PI, h1 + 1.3);
        k.divider(c1 + sd * R, S1, n1 + 1, h1);
        b.lip(S1, c1 - lw / 2, c1 + lw / 2, h1);
        b.pt(S1 + 4.5, c1, h1, { act: { type: 'pivot', ax: A.x, ay: A.y, az: A.z, ex: b.fx, ez: b.fz } });
        b.pt(S1 + 0.3, c1, h1, { act: { type: 'jump', lead: 0.25 } });
        b.pt(uc, c1, h1 + 1.2);
        k.arc(uc, c1 + sd * R, R, -sd * Math.PI / 2, -sd * Math.PI, h1 + 1.3, 8);
        b.pt(s2 + 1, c2, h2);
      }
      const L2 = Math.max(Lr + 6, n1 + 5) - s2;
      b.slab(s2, s2 + L2, c2 - lw / 2, c2 + lw / 2, h2);
      b.cp(s2 + 2.5, c2, h2);
      b.pt(s2 + L2, c2, h2);
      b.h = h2;
      b.w = lw;
      b.adv(s2 + L2, c2);
    },
  };
}
