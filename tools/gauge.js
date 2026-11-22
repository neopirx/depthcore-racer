// Gauge audit: how much does the walkway width jump from one platform to the next along the
// racing line? Width = the platform's extent across the direction of travel.
// Usage: bun tools/gauge.js [path/to/trackgen.js]
const mod = await import(process.argv[2] ?? '../src/game/trackgen.js');
const widths = {};
let jumps = 0; let pairs = 0; let big = 0; let sum = 0;
for (let sector = 1; sector <= 8; sector++) {
  for (let i = 1; i <= 20; i++) {
    const t = mod.generateTrack(i * 7919 + sector * 104729, sector);
    const walk = t.solids.filter((o) => (o.kind === 'slab' || o.kind === 'step' || o.kind === 'pad') && !o.start && !o.final && !o.deco);
    let prev = null;
    for (let k = 1; k < t.path.length; k++) {
      const p = t.path[k];
      const dx = p.x - t.path[k - 1].x; const dz = p.z - t.path[k - 1].z;
      const o = walk.find((s) => p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1 && Math.abs(s.y1 - p.y) < 0.3);
      if (!o || o === prev) continue;
      const w = Math.abs(dx) > Math.abs(dz) ? o.z1 - o.z0 : o.x1 - o.x0;
      widths[w] = (widths[w] || 0) + 1;
      if (prev) {
        const d = Math.abs(w - prev.w);
        pairs++; sum += d;
        if (d > 0.01) jumps++;
        if (d >= 1) big++;
      }
      prev = o; prev.w = w;
    }
  }
}
const top = Object.entries(widths).sort((a, b) => b[1] - a[1]);
console.log('distinct widths', top.length, '| most common', top.slice(0, 8).map(([w, n]) => `${w}m×${n}`).join(' '));
console.log(`consecutive platforms: ${pairs} | width changes ${(100 * jumps / pairs).toFixed(0)}% | ≥1 m changes ${(100 * big / pairs).toFixed(0)}% | mean |Δw| ${(sum / pairs).toFixed(2)} m`);
