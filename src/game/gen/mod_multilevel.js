// Cardinal ribbons may double back in any direction inside a set-piece. Decks cross
// in XZ, but their floors are separated by eight metres. Entry/exit frames stay
// compatible with the smaller parkour modules.
import { yawOf } from './builder.js';

export default function multilevel({ b, r, G }) {
  function ribbon(nodes, cut = false) {
    const sd = r.sign();
    const h = b.h;
    const origin = { x: b.px, z: b.pz, fx: b.fx, fz: b.fz };
    const scaleU = r.pick([1, 1.125, 1.25]);
    const scaleV = r.pick([1, 1.125, 1.25]);
    const points = nodes.map(([u, v, y]) => ({ x: b.X(u * scaleU, v * sd * scaleV), z: b.Z(u * scaleU, v * sd * scaleV), y: h + y }));
    const half = G.lane / 2;
    const line = [];
    const setFrame = (p, fx, fz) => { b.px = p.x; b.pz = p.z; b.setDir(fx, fz); };
    // Flat corner squares and trimmed connecting strips: no overlapping coplanar decks.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      setFrame(p, origin.fx, origin.fz);
      // First/last half squares meet the adjoining module flush.
      b.slab(i === 0 ? 0 : -half, i === points.length - 1 ? 0 : half, -half, half, p.y);
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]; const c = points[i];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      const fx = (c.x - a.x) / L; const fz = (c.z - a.z) / L;
      setFrame(a, fx, fz);
      if (a.y === c.y) b.slabC(half, L - half, G.lane, a.y);
      else b.ramp(half, L - half, G.lane, a.y, c.y);
      if (i === 1) line.push({ ...a, cp: yawOf(fx, fz) });
      line.push({ x: a.x + fx * half, z: a.z + fz * half, y: a.y });
      line.push({ x: c.x - fx * half, z: c.z - fz * half, y: c.y });
      const next = points[i + 1];
      line.push({ ...c, ...(next ? { cp: yawOf(next.x - c.x, next.z - c.z) } : {}) });
      if (i < points.length - 1) {
        const d = points[i + 1];
        const cross = fx * (d.z - c.z) - fz * (d.x - c.x);
        b.sign(L + 1, 0, c.y + 3, cross > 0 ? 1 : -1);
      }
    }
    const main = () => b.path.push(...line.map((p) => ({ ...p })));
    if (cut) {
      // Cut the last inside corner with a diagonal jump, rejoining before the exit.
      const c = points[points.length - 2];
      const a = points[points.length - 3];
      const z = points[points.length - 1];
      const inL = Math.hypot(c.x - a.x, c.z - a.z);
      const outL = Math.hypot(z.x - c.x, z.z - c.z);
      const take = { x: c.x - (c.x - a.x) / inL * 4, z: c.z - (c.z - a.z) / inL * 4, y: c.y, act: { type: 'jump', lead: 0.15 } };
      const land = { x: c.x + (z.x - c.x) / outL * 4, z: c.z + (z.z - c.z) / outL * 4, y: c.y };
      b.routes([{ tag: 'main', lay: main }, { tag: 'skill', lay: () => {
        b.path.push(...line.slice(0, -5).map((p) => ({ ...p })), take, land, { ...z });
      } }]);
      setFrame(take, (c.x - a.x) / inL, (c.z - a.z) / inL);
      b.sign(-2, 0, c.y + 3, 0, 'alt', 'skill');
    } else main();
    const end = points[points.length - 1];
    setFrame(end, origin.fx, origin.fz);
    b.h = end.y;
    b.w = G.lane;
    return { calm: true };
  }
  return {
    flyover: () => ribbon([[0, 0, 0], [32, 0, 0], [32, 28, 8], [12, 28, 8], [12, -16, 8], [52, -16, 8], [52, 0, 8], [64, 0, 8]], true),
    helix: () => ribbon([[0, 0, 0], [36, 0, 0], [36, 28, 8], [12, 28, 8], [12, 0, 8], [36, 0, 8], [36, -28, 16], [12, -28, 16], [12, 44, 16], [56, 44, 16], [56, 0, 16], [68, 0, 16]], true),
    // A descending stack reuses the same footprint on the way down.
    dive: () => ribbon([[0, 0, 0], [32, 0, 0], [32, 28, -8], [12, 28, -8], [12, -16, -8], [52, -16, -8], [52, 0, -8], [64, 0, -8]], true),
  };
}
