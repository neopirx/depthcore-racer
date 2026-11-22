// Flow audit: how straight / flat / samey are generated courses?
// Usage: bun tools/flow.js [--n 20] [--only MODULE[,MODULE]] [--v]
//  - straight:  longest stretch of racing line with no event (action, turn > 30°, height change)
//  - dull%:     share of the course spent in stretches longer than 12 m without an event
//  - turns/100: cardinal heading changes per 100 m
//  - stacked:   segment pairs where one racing line passes ≥ 3.5 m over another
//  - headings:  share of distance run N / E / W / S
//  - routes:    alternate lines per 100 m
import { generateTrack } from '../src/game/trackgen.js';

const args = process.argv.slice(2);
const N = args.includes('--n') ? +args[args.indexOf('--n') + 1] : 20;
const onlyI = args.indexOf('--only');
const ONLY = onlyI >= 0 ? args[onlyI + 1].split(',') : null;
const V = args.includes('--v');

const tot = { len: 0, straight: 0, maxStraight: 0, dull: 0, turns: 0, stacked: 0, routes: 0, rise: 0, types: new Set(), segs: 0, hd: { N: 0, E: 0, W: 0, S: 0 }, courses: 0, segLen: 0 };
for (let sector = 1; sector <= 8; sector++) {
  for (let i = 1; i <= N; i++) {
    const seed = i * 7919 + sector * 104729;
    const t = generateTrack(seed, sector, ONLY ? { only: ONLY, length: 220 } : {});
    // the finish straight is a finish straight: measure the course up to the last segment
    const endS = Math.max(...t.segments.map((g) => g.s1).filter(Number.isFinite));
    const P = t.path.filter((p) => p.s <= endS);
    const actS = t.actions.map((a) => a.s);
    let run = 0; let longest = 0; let dull = 0; let turns = 0; let lastHd = null; let ai = 0;
    let prevDir = null;
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1]; const c = P[k];
      const dx = c.x - a.x; const dz = c.z - a.z;
      const d = Math.hypot(dx, dz);
      const L = c.s - a.s;
      let event = Math.abs(c.y - a.y) > 0.6;
      while (ai < actS.length && actS[ai] <= c.s) { if (actS[ai] > a.s - 0.01) event = true; ai++; }
      if (d > 0.2) {
        const dir = Math.atan2(dx, dz);
        if (prevDir !== null) {
          let da = Math.abs(dir - prevDir); if (da > Math.PI) da = 2 * Math.PI - da;
          if (da > 0.5) event = true;
        }
        prevDir = dir;
        const hd = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz < 0 ? 'N' : 'S');
        if (d > 1.5) {
          tot.hd[hd] += d;
          if (lastHd && hd !== lastHd) turns++;
          lastHd = hd;
        }
      }
      if (event) {
        if (run > 12) dull += run;
        run = 0;
      } else run += L;
      longest = Math.max(longest, run);
    }
    if (run > 12) dull += run;
    // stacking: pairs of segments with lines over one another
    const pairs = new Set();
    const S = P.filter((p, j) => j % 2 === 0 && p.seg !== undefined);
    for (let p = 0; p < S.length; p++) for (let q = p + 1; q < S.length; q++) {
      const A = S[p]; const B = S[q];
      if (Math.abs(A.seg - B.seg) < 1) continue;
      if (Math.abs(A.x - B.x) < 2 && Math.abs(A.z - B.z) < 2 && Math.abs(A.y - B.y) >= 3.5) pairs.add(`${Math.min(A.seg, B.seg)}:${Math.max(A.seg, B.seg)}`);
    }
    const len = endS;
    tot.len += len; tot.maxStraight = Math.max(tot.maxStraight, longest); tot.straight += longest;
    tot.dull += dull; tot.turns += turns; tot.stacked += pairs.size; tot.routes += t.alts.length;
    tot.rise += t.maxY - (t.minY + 26);
    tot.segs += t.segments.length;
    for (const s of t.segments) tot.types.add(s.type);
    tot.courses++;
    if (V) console.log(seed, sector, `len ${len.toFixed(0)} straight ${longest.toFixed(1)} dull ${(100 * dull / len).toFixed(0)}% turns ${turns} stacked ${pairs.size} routes ${t.alts.length}`);
  }
}
const n = tot.courses;
const hdT = Object.values(tot.hd).reduce((a, b) => a + b, 0);
console.log({
  courses: n,
  meanLen: +(tot.len / n).toFixed(0),
  meanSegLen: +(tot.len / tot.segs).toFixed(1),
  meanLongestStraight: +(tot.straight / n).toFixed(1),
  worstStraight: +tot.maxStraight.toFixed(1),
  dullPct: +(100 * tot.dull / tot.len).toFixed(1),
  turnsPer100m: +(100 * tot.turns / tot.len).toFixed(2),
  stackedPairsPerCourse: +(tot.stacked / n).toFixed(2),
  routesPer100m: +(100 * tot.routes / tot.len).toFixed(2),
  heightRange: +(tot.rise / n).toFixed(1),
  headings: Object.fromEntries(Object.entries(tot.hd).map(([k, v]) => [k, +(100 * v / hdT).toFixed(0)])),
  typesUsed: tot.types.size,
});
