// Collision world: axis-aligned solids + ramps in a uniform xz grid. Pure data, no Three.js.

const CELL = 8;
const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

export function buildWorld(solids, ramps) {
  const grid = new Map();
  const add = (o) => {
    // movers register over everything they sweep through; per-tick tests use their live box
    const e = o.sweep ?? o;
    for (let ix = Math.floor(e.x0 / CELL); ix <= Math.floor(e.x1 / CELL); ix++) {
      for (let iz = Math.floor(e.z0 / CELL); iz <= Math.floor(e.z1 / CELL); iz++) {
        const k = key(ix, iz);
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(o);
      }
    }
  };
  solids.forEach((o, i) => { o.id = i; add(o); });
  ramps.forEach((o, i) => { o.id = solids.length + i; o.ramp = true; add(o); });
  const movers = solids.filter((o) => o.mover);
  return { grid, solids, ramps, movers, moverT: -1, stamp: new Uint32Array(solids.length + ramps.length), tick: 0 };
}

/** Collect solids/ramps whose xz footprint touches the given rectangle. */
export function query(world, x0, z0, x1, z1, out) {
  out.length = 0;
  const t = ++world.tick;
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
    for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
      const c = world.grid.get(key(ix, iz));
      if (!c) continue;
      for (const o of c) {
        if (world.stamp[o.id] === t) continue;
        world.stamp[o.id] = t;
        if (o.x1 <= x0 || o.x0 >= x1 || o.z1 <= z0 || o.z0 >= z1) continue;
        out.push(o);
      }
    }
  }
  return out;
}

/** Surface height of a ramp at (x, z), clamped to its ends. */
export function rampHeight(r, x, z) {
  const c = r.axis === 'x' ? x : z;
  const t = Math.min(1, Math.max(0, (c - r.c0) / (r.c1 - r.c0)));
  return r.h0 + (r.h1 - r.h0) * t;
}

/** Highest walkable surface at (x, z) that is at or below yMax. Returns -Infinity if none. */
export function groundAt(world, x, z, yMax, tmp = []) {
  query(world, x - 0.01, z - 0.01, x + 0.01, z + 0.01, tmp);
  let best = -Infinity;
  for (const o of tmp) {
    const top = o.ramp ? rampHeight(o, x, z) : o.y1;
    if (top <= yMax && top > best) best = top;
  }
  return best;
}
