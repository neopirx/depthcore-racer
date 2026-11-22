// Speed-check audit: every speed check (a gap only a slid ramp clears) must be
//  1) makeable: the perfect bot racing the speed lines stays above the check height, and
//  2) a real check: the same bot running the ramps instead of sliding them drops below it.
// Usage: bun tools/speedcheck.js [--n 20] [--v]
import { generateTrack } from '../src/game/trackgen.js';
import { Racer } from '../src/game/racer.js';
import { BotController } from '../src/game/bot.js';

const args = process.argv.slice(2);
const N = args.includes('--n') ? +args[args.indexOf('--n') + 1] : 20;
const V = args.includes('--v');
const DT = 1 / 120;

/** race the course; for each check, the lowest y between the jump before it and the check point */
function probe(track, skill) {
  const r = new Racer(track, {});
  const bot = new BotController(track, track.seed, skill);
  const low = track.checks.map(() => Infinity);
  let t = 0;
  while (!r.finished && t < 200) {
    r.step(DT, bot.getInput(r));
    r.events.length = 0;
    track.checks.forEach((c, i) => {
      if (r.s > c.s - 30 && r.s < c.s + 1 && Math.hypot(r.x - c.x, r.z - c.z) < 25) low[i] = Math.min(low[i], r.y);
    });
    t += DT;
  }
  return low;
}

const tally = { checks: 0, missed: 0, leaky: 0, unreached: 0 };
for (const only of [['speedtrap'], ['speedcorner']]) {
  for (let sector = 1; sector <= 8; sector += 1) {
    for (let i = 1; i <= N; i++) {
      const seed = i * 7919 + sector * 104729;
      const track = generateTrack(seed, sector, { only, length: 160, alt: 1 });
      if (!track.checks.length) continue;
      const fast = probe(track, { speedMul: 1, jitter: 0, mistake: 0 });
      const slow = probe(track, { speedMul: 1, jitter: 0, mistake: 0, noRampSlide: true });
      track.checks.forEach((c, k) => {
        tally.checks++;
        const made = fast[k] >= c.y;
        // a runner who keeps falling short never reaches the later checks: that's the check working
        const leaked = Number.isFinite(slow[k]) && slow[k] >= c.y;
        if (!Number.isFinite(slow[k])) tally.unreached++;
        if (!made) tally.missed++;
        if (leaked) tally.leaky++;
        if (V || !made || leaked) console.log(only[0], seed, sector, `check y ${c.y.toFixed(1)}`, `slid low ${fast[k].toFixed(2)}`, `ran low ${slow[k].toFixed(2)}`, !made ? 'MISSED' : '', leaked ? 'LEAKY' : '');
      });
    }
  }
}
console.log(tally);
console.log(tally.missed || tally.leaky ? 'speed checks need work' : 'every speed check is makeable when slid and out of reach when run');
