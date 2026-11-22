import { test, expect } from 'bun:test';
import { generateTrack, buildLevel } from '../src/game/trackgen.js';
import { Racer } from '../src/game/racer.js';
import { BotController } from '../src/game/bot.js';
import { STYLES } from '../src/game/kit.js';

const TYPES = ['flyover', 'helix', 'dive'];
const skill = { speedMul: 1, jitter: 0, mistake: 0 };
function level(type, seed, style = 'tiered', turn = false) {
  return { seed, sector: 1, diff: 0.5, modules: [
    ...(turn ? [{ type: 'corner', seed: 9, style, td: seed % 2 ? 1 : -1 }] : []),
    { type, seed, style },
  ] };
}

for (const type of TYPES) {
  test(`${type}: deterministic editor rebuild and actual stacked geometry`, () => {
    const track = generateTrack(53, 1, { only: [type], length: 160 });
    const rebuilt = buildLevel(track.level);
    expect(rebuilt.path).toEqual(track.path);
    expect(rebuilt.solids).toEqual(track.solids);
    const decks = track.solids.filter((o) => !o.deco && o.kind === 'slab' && o.seg === 0);
    expect(decks.some((a) => decks.some((b) => a !== b && Math.abs(a.y1 - b.y1) >= 8
      && a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0))).toBe(true);
    // A deck or a ramp base must never enter the body envelope of its own route.
    for (const p of track.path.filter((p) => p.seg === 0)) {
      for (const o of track.solids.filter((o) => !o.deco && o.seg === 0)) {
        const inside = p.x > o.x0 + 0.05 && p.x < o.x1 - 0.05 && p.z > o.z0 + 0.05 && p.z < o.z1 - 0.05;
        expect(inside && o.y1 > p.y + 0.3 && o.y0 < p.y + 1.8).toBe(false);
      }
    }
  });

  test(`${type}: main and skill routes finish cleanly across styles and entry headings`, () => {
    for (const style of STYLES) for (const seed of [1, 2, 3, 4]) for (const alt of [0, 1]) {
      const track = buildLevel(level(type, seed, style, seed > 2), { alt });
      const racer = new Racer(track);
      const bot = new BotController(track, seed, skill);
      for (let tick = 0; tick < 120 * 120 && !racer.finished; tick++) {
        racer.step(1 / 120, bot.getInput(racer));
        racer.events.length = 0;
      }
      expect({ type, style, seed, alt, finished: racer.finished, falls: racer.falls, stumbles: racer.stumbles })
        .toEqual({ type, style, seed, alt, finished: true, falls: 0, stumbles: 0 });
    }
  });

  test(`${type}: a player taking the cut advances along the canonical main route`, () => {
    const spec = level(type, 1);
    const track = buildLevel(spec);
    const alternate = buildLevel(spec, { alt: 1 });
    const racer = new Racer(track);
    let previous = 0;
    for (const p of alternate.path) {
      Object.assign(racer, { x: p.x, y: p.y, z: p.z });
      racer.updateProgress();
      expect(racer.s).toBeGreaterThanOrEqual(previous - 0.01);
      expect(racer.pathDist).toBeLessThan(3);
      previous = racer.s;
    }
    expect(racer.s).toBeGreaterThanOrEqual(track.finishS);
  });
}

test('mixed generated tracks preserve all segment joins and rebuilds', () => {
  for (let sector = 1; sector <= 8; sector++) for (let i = 1; i <= 20; i++) {
    const track = generateTrack(i * 7919 + sector * 104729, sector);
    expect(track.segments.length).toBeGreaterThan(0);
    expect(buildLevel(track.level).path).toEqual(track.path);
  }
});

test('passing below the finish gate does not finish the race', () => {
  const track = buildLevel(level('helix', 1));
  const racer = new Racer(track);
  const p = track.path.findIndex((p) => p.finish);
  Object.assign(racer, { pi: p - 1, x: track.finishGate.x, z: track.finishGate.z, y: track.finishGate.y - 6 });
  const idle = { fwd: 0, side: 0, yaw: racer.yaw };
  racer.step(1 / 120, idle);
  expect(racer.finished).toBe(false);
  racer.y = track.finishGate.y;
  racer.step(1 / 120, idle);
  expect(racer.finished).toBe(true);
});
