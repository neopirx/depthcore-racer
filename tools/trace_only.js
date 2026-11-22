// bun tools/trace_only.js module seed sector — trace one course built only from the given modules
import { generateTrack } from '../src/game/trackgen.js';
import { Racer } from '../src/game/racer.js';
import { BotController } from '../src/game/bot.js';
const [mods, seed = 1, sector = 3, maxT = 30] = process.argv.slice(2);
const track = generateTrack(+seed, +sector, { only: mods.split(','), length: 160 });
const r = new Racer(track);
const bot = new BotController(track, +seed, { speedMul: 1, jitter: 0, mistake: 0 });
let t = 0;
let lastLog = -1;
while (!r.finished && t < +maxT) {
  const inp = bot.getInput(r);
  r.step(1 / 120, inp);
  const ev = r.events.filter((e) => e.type !== 'land' || true).map((e) => e.type + (e.label ? ':' + e.label : '')).join(',');
  if (ev || (process.env.V && t - lastLog > 0.05)) {
    lastLog = t;
    const a = track.actions.find((x) => x.s > r.s - 1);
    console.log(t.toFixed(2), (ev || '').padEnd(16), 's', r.s.toFixed(1), 'pos', r.x.toFixed(2), r.y.toFixed(2), r.z.toFixed(2), 'v', r.vx.toFixed(1), r.vy.toFixed(1), r.vz.toFixed(1), r.mode, a ? `next ${a.type}@${a.s.toFixed(1)}` : '');
  }
  r.events.length = 0;
  t += 1 / 120;
}
console.log('finished', r.finished, r.finishTime.toFixed(2), 'falls', r.falls);
