// Headless race simulation: validates every generated course is finishable
// by a perfect bot and reports how a sector-skilled bot performs.
// Usage: bun tools/sim.js [--only MODULE[,MODULE]] [--alt [N]] [--trace seed sector]
//   --alt N races route N of every fork (1 = first alternate, 2 = the third lane of a 3-way fork;
//   forks with fewer routes race their last one)
import { generateTrack } from '../src/game/trackgen.js';
import { Racer } from '../src/game/racer.js';
import { BotController, botSkillForSector } from '../src/game/bot.js';
import { BASE_STATS } from '../src/game/constants.js';

const DT = 1 / 120;
const args = process.argv.slice(2);

const onlyI = args.indexOf('--only');
const ONLY = onlyI >= 0 ? args[onlyI + 1].split(',') : null;
const genOpts = ONLY ? { only: ONLY, length: 160 } : {};
if (process.env.ALT) genOpts.alt = +process.env.ALT;
// --alt: race every fork's alternate (skill) line instead of the main one
const altI = args.indexOf('--alt');
if (altI >= 0) genOpts.alt = /^\d+$/.test(args[altI + 1] ?? '') ? +args[altI + 1] : 1;

function race(seed, sector, skill, trace = false) {
  const track = generateTrack(seed, sector, genOpts);
  const r = new Racer(track, { maxSpeed: BASE_STATS.maxSpeed * (skill.speedMul ?? 1) });
  const bot = new BotController(track, seed, skill);
  let t = 0;
  const fails = [];
  while (!r.finished && t < 400) {
    r.step(DT, bot.getInput(r));
    for (const e of r.events) {
      if (trace && e.type !== 'land') {
        const a = track.actions.find((x) => x.s > r.s - 3);
        console.log(t.toFixed(2), e.type.padEnd(9), e.label ?? '', 's', r.s.toFixed(1), 'pos', r.x.toFixed(1), r.y.toFixed(2), r.z.toFixed(1), 'v', r.speed.toFixed(1), r.vy.toFixed(1), 'mode', r.mode, a ? `next ${a.type}@${a.s.toFixed(1)}` : '');
      }
      if (e.type === 'fall' || e.type === 'hardland' || e.type === 'bonk' || e.type === 'climbfail') {
        const a = track.actions.find((x) => x.s > r.s - 6);
        fails.push(`${e.type}@${r.s.toFixed(0)}${a ? `(${a.type})` : ''}`);
      }
    }
    r.events.length = 0;
    t += DT;
  }
  return { track, r, t, fails };
}

if (args.includes('--trace')) {
  const res = race(+args[args.indexOf('--trace') + 1], +args[args.indexOf('--trace') + 2] || 1, { speedMul: 1, jitter: 0, mistake: 0 }, true);
  console.log('finished', res.r.finished, 'time', res.r.finishTime.toFixed(2), 'fails', res.fails.join(' '));
  process.exit(0);
}

const perfect = { speedMul: 1, jitter: 0, mistake: 0 };
let bad = 0;
const failKinds = {};
for (let sector = 1; sector <= 8; sector++) {
  let sum = 0; let falls = 0; let stumbles = 0; let sumB = 0; let fallsB = 0; let len = 0;
  const n = 30;
  for (let i = 1; i <= n; i++) {
    const seed = i * 7919 + sector * 104729;
    const p = race(seed, sector, perfect);
    len += p.track.finishS;
    if (!p.r.finished || p.r.falls || p.r.stumbles) {
      bad++;
      for (const f of p.fails) { const k = f.replace(/@\d+/, ''); failKinds[k] = (failKinds[k] || 0) + 1; }
      if (bad < 12) console.log('perfect bot failed', { seed, sector, finished: p.r.finished, s: p.r.s.toFixed(0), fails: p.fails.slice(0, 4).join(' ') });
    }
    sum += p.r.finishTime;
    falls += p.r.falls;
    stumbles += p.r.stumbles;
    const b = race(seed, sector, botSkillForSector(sector));
    sumB += b.r.finished ? b.r.finishTime : 400;
    if (!b.r.finished) console.log("skilled bot stuck", { seed, sector, s: b.r.s.toFixed(0), fails: b.fails.slice(-4).join(" ") });
    fallsB += b.r.falls;
  }
  console.log(`sector ${sector}: len ${(len / n).toFixed(0)}m  perfect ${(sum / n).toFixed(1)}s (${(len / sum).toFixed(1)} m/s)  bot ${(sumB / n).toFixed(1)}s  bot falls/race ${(fallsB / n).toFixed(2)}`);
}
console.log('fail kinds', failKinds);
console.log(bad ? `${bad} perfect runs failed` : 'all courses completed cleanly by perfect bot');
