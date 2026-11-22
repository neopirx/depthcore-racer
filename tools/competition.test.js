import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COURSES, CAMPAIGN_VERSION, buildCourse } from '../src/game/campaign.js';
import { Racer } from '../src/game/racer.js';
import { BotController } from '../src/game/bot.js';
import { RACE_STEP, GhostReplay, packInput, unpackInput, verifyRun, validateReplay } from '../src/game/replay.js';
import { createApp } from '../server/index.js';
import { isAdmin } from '../server/admin.js';

function record(course, delay = 0) {
  const track = buildCourse(course.id);
  const racer = new Racer(track);
  const bot = new BotController(track, course.level.seed, { jitter: 0, mistake: 0 });
  const inputs = [];
  for (let tick = 0; tick < 120 * 180 && !racer.finished; tick++) {
    const input = tick < delay ? { fwd: 0, side: 0, yaw: track.spawn.yaw } : bot.getInput(racer);
    inputs.push(packInput(input));
    racer.step(RACE_STEP, input);
    racer.events.length = 0;
  }
  expect(racer.finished).toBe(true);
  expect(racer.falls).toBe(0);
  expect(racer.stumbles).toBe(0);
  return { racer, inputs };
}
const recorded = new Map();
for (const course of COURSES) test(`${course.id}: fixed course finishes and its recorded ghost matches every tick`, () => {
  const { racer, inputs } = record(course);
  recorded.set(course.id, inputs);
  const ghost = new GhostReplay(buildCourse(course.id), inputs);
  const player = new Racer(ghost.racer.track);
  for (const row of inputs) {
    player.step(RACE_STEP, unpackInput(row));
    ghost.step();
    expect([ghost.racer.x, ghost.racer.y, ghost.racer.z, ghost.racer.mode, ghost.racer.s])
      .toEqual([player.x, player.y, player.z, player.mode, player.s]);
    player.events.length = ghost.racer.events.length = 0;
  }
  expect(ghost.racer.finishTime).toBe(racer.finishTime);
  expect(verifyRun(buildCourse(course.id), inputs).time).toBe(racer.finishTime);
});

test('replays reject invalid input, impossible finishes and trailing ticks', () => {
  for (const inputs of [[], [[2, 0, 0, 0]], [[0, 0, NaN, 0]], [[0, 0, 0, 64]], [[0, 0, 0, 1.5]]]) expect(() => validateReplay(inputs)).toThrow();
  expect(() => verifyRun(buildCourse('level-1'), [[0, 0, 0, 0]])).toThrow('finish');
  const inputs = recorded.get('level-1');
  expect(() => verifyRun(buildCourse('level-1'), [...inputs, inputs[0]])).toThrow('after the finish');
});

test('shared API: identity, verified scores, best ghost, per-level isolation, restart persistence and private editor', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'dcr-scores-'));
  const config = { dbPath: join(temp, 'scores.sqlite'), env: { ADMIN_USER: 'owner', ADMIN_PASSWORD: 'test-secret', PUBLIC_ORIGIN: 'https://racer.example.com' } };
  let app = createApp(config);
  const call = (path, { method = 'GET', payload, cookie, headers = {} } = {}) => app.fetch(new Request(`http://localhost${path}`, {
    method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: payload ? JSON.stringify(payload) : undefined,
  }));
  try {
    const profile = await call('/api/profile', { method: 'POST', payload: { name: '  Runner One  ' } });
    expect(profile.status).toBe(200);
    const cookie = profile.headers.get('set-cookie').split(';')[0];
    expect(await profile.json()).toEqual({ name: 'Runner One' });
    expect(await (await call('/api/profile', { cookie })).json()).toEqual({ name: 'Runner One' });
    expect((await call('/api/profile', { method: 'POST', payload: { name: 'runner one' } })).status).toBe(409);
    expect((await call('/api/profile', { method: 'POST', payload: { name: '<script>' } })).status).toBe(400);
    expect((await call('/api/profile', { method: 'POST', payload: { name: 'Intruder' }, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/api/profile', { method: 'POST', payload: { name: 'Runner One' }, cookie, headers: { Origin: 'https://racer.example.com' } })).status).toBe(200);
    const url = `/api/levels/level-1/`;
    const version = `?version=${CAMPAIGN_VERSION}`;
    expect((await (await call(url + 'ghost' + version)).json()).ghost).toBeNull();
    expect((await call(url + 'runs', { method: 'POST', payload: { version: CAMPAIGN_VERSION, inputs: [[0, 0, 0, 0]] } })).status).toBe(401);
    const inputs = recorded.get('level-1');
    const submitted = await call(url + 'runs', { method: 'POST', cookie, payload: { version: CAMPAIGN_VERSION, inputs, time: 0.1 } });
    const result = await submitted.json();
    expect(submitted.status).toBe(200);
    expect(result.record).toBe(true);
    expect(result.time).toBeGreaterThan(20); // Client-supplied time is ignored.
    expect(result.personal.rank).toBe(1);
    const ghost = (await (await call(url + 'ghost' + version)).json()).ghost;
    expect(ghost.name).toBe('Runner One');
    expect(ghost.inputs).toEqual(inputs);
    expect((await (await call(url + 'leaderboard' + version, { cookie })).json()).entries[0].mine).toBe(true);
    expect((await (await call('/api/levels/level-2/leaderboard' + version)).json()).entries).toEqual([]);
    expect((await call(url + 'leaderboard?version=old')).status).toBe(409);
    expect((await call('/editor.html')).status).toBe(404);
    for (const path of ['/admin/editor.html', '/admin/assets/editor.js']) expect((await call(path)).status).toBe(401);
    const auth = { Authorization: `Basic ${Buffer.from('owner:test-secret').toString('base64')}` };
    expect((await call('/admin/editor.html', { headers: auth })).status).toBe(200);
    expect((await call('/admin/%2e%2e%2fserver/index.js', { headers: auth })).status).toBe(404);
    app.close();
    app = createApp(config);
    const restored = await (await call(url + 'leaderboard' + version, { cookie })).json();
    expect(restored.personal.time).toBe(result.time);
    const slower = record(COURSES[0], 120).inputs;
    const worse = await (await call(url + 'runs', { method: 'POST', cookie, payload: { version: CAMPAIGN_VERSION, inputs: slower } })).json();
    expect(worse.improved).toBe(false);
    expect(worse.record).toBe(false);
    expect((await (await call(url + 'ghost' + version)).json()).ghost.time).toBe(result.time);
  } finally { app.close(); rmSync(temp, { recursive: true, force: true }); }
}, 30000);

test('admin access fails closed when credentials are not configured', () => {
  expect(isAdmin(new Headers(), {})).toBe(false);
  expect(isAdmin(new Headers({ authorization: 'Basic abc' }), { ADMIN_USER: 'admin' })).toBe(false);
});
