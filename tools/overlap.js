// Segment-alignment audit: how often does one segment's geometry run into another's?
// Usage: bun tools/overlap.js [--only MODULE[,MODULE]] [--n 30] [--v]
//  - clash: solids of two different segments overlap in volume (interpenetrating geometry)
//  - zfight: two slab tops at the same height overlap (flickering, a seam that reads as a bug)
//  - intrude: a solid from another segment sits inside a racing line's body envelope
import { generateTrack } from '../src/game/trackgen.js';

const args = process.argv.slice(2);
const onlyI = args.indexOf('--only');
const ONLY = onlyI >= 0 ? args[onlyI + 1].split(',') : null;
const N = args.includes('--n') ? +args[args.indexOf('--n') + 1] : 30;
const V = args.includes('--v');

const box = (o) => o.sweep ?? o;
const ov = (a, b, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m && a.y0 < b.y1 - m && a.y1 > b.y0 + m;

const tally = { clash: 0, zfight: 0, intrude: 0, courses: 0, bad: 0 };
const byType = {};
for (let sector = 1; sector <= 8; sector++) {
  for (let i = 1; i <= N; i++) {
    const seed = i * 7919 + sector * 104729;
    const t = generateTrack(seed, sector, ONLY ? { only: ONLY, length: 220 } : {});
    tally.courses++;
    const S = t.solids.filter((o) => !o.deco && o.seg !== undefined);
    let bad = false;
    const note = (kind, a, b) => {
      tally[kind]++;
      bad = true;
      const k = `${kind}:${t.segments[a.seg].type}>${t.segments[b.seg].type}`;
      byType[k] = (byType[k] || 0) + 1;
      if (V) console.log(seed, sector, k, a.kind, b.kind, a.seg, b.seg);
    };
    for (let p = 0; p < S.length; p++) {
      for (let q = p + 1; q < S.length; q++) {
        const a = S[p]; const b = S[q];
        if (a.seg === b.seg) continue;
        const A = box(a); const B = box(b);
        if (ov(A, B, 0.01)) note('clash', a.seg < b.seg ? a : b, a.seg < b.seg ? b : a);
        else if (Math.abs(A.y1 - B.y1) < 0.01 && A.x0 < B.x1 - 0.01 && A.x1 > B.x0 + 0.01 && A.z0 < B.z1 - 0.01 && A.z1 > B.z0 + 0.01) note('zfight', a, b);
      }
    }
    // racing line body envelope vs solids of other segments
    for (const p of t.path) {
      if (p.seg === undefined) continue;
      for (const o of S) {
        if (o.seg === p.seg || o.kind === 'slab' || o.kind === 'step' || o.kind === 'pad') continue;
        const B = box(o);
        if (p.x > B.x0 - 0.35 && p.x < B.x1 + 0.35 && p.z > B.z0 - 0.35 && p.z < B.z1 + 0.35 && B.y1 > p.y + 0.5 && B.y0 < p.y + 1.8) {
          note('intrude', o, { seg: p.seg });
          break;
        }
      }
    }
    if (bad) tally.bad++;
  }
}
console.log(tally);
console.log(Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 30));
