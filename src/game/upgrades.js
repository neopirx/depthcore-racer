import { BASE_STATS } from './constants.js';

// PLACEHOLDER upgrade pool — real design TBD. Each upgrade mutates racer stats and can stack.
// Keep the shape {id, name, tag, desc, apply(stats)} and the rest of the game will pick them up.
export const UPGRADES = [
  { id: 'overclock', name: 'OVERCLOCK', tag: 'SPD', desc: '+5% top speed', apply: (s) => { s.maxSpeed *= 1.05; } },
  { id: 'kinetic', name: 'KINETIC.CACHE', tag: 'ACC', desc: '+18% acceleration', apply: (s) => { s.accel *= 1.18; } },
  { id: 'grip', name: 'GRIP.DAEMON', tag: 'WLL', desc: '+0.3s wallrun duration', apply: (s) => { s.wallrunTime += 0.3; } },
  { id: 'surge', name: 'SURGE.HOOK', tag: 'WLL', desc: '+0.8 m/s on wall catch', apply: (s) => { s.wallBoost += 0.8; } },
  { id: 'failsafe', name: 'FAILSAFE', tag: 'DEF', desc: 'keep +20% speed on a hard landing', apply: (s) => { s.hardLandKeep = Math.min(0.8, s.hardLandKeep + 0.2); } },
  { id: 'flowstate', name: 'FLOWSTATE', tag: 'FLW', desc: '+30% flow gain per clean move', apply: (s) => { s.flowGain *= 1.3; } },
  { id: 'resonance', name: 'RESONANCE', tag: 'FLW', desc: '+6% max flow speed bonus', apply: (s) => { s.flowBonus += 0.06; } },
];

export function statsWithUpgrades(ids) {
  const s = { ...BASE_STATS };
  for (const id of ids) UPGRADES.find((u) => u.id === id)?.apply(s);
  return s;
}

export function rollUpgradeChoices(rng, n = 3) {
  const pool = [...UPGRADES];
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(rng.next() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
