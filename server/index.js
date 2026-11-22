import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { CAMPAIGN_VERSION, COURSES, courseById } from '../src/game/campaign.js';
import { validateReplay } from '../src/game/replay.js';
import { normalizeName, validName } from '../src/core/competition.js';
import { isAdmin, adminChallenge } from './admin.js';

const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
const LIMIT = 8 * 1024 * 1024;
export function createApp({ dbPath = process.env.DATABASE_PATH || './data/leaderboards.sqlite', publicDir = './dist', adminDir = './dist-admin', env = process.env } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS scores (version TEXT, course TEXT, player TEXT REFERENCES players(id), time REAL NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY(version, course, player));
    CREATE TABLE IF NOT EXISTS ghosts (version TEXT, course TEXT, player TEXT REFERENCES players(id), time REAL NOT NULL, inputs TEXT NOT NULL,
      PRIMARY KEY(version, course));
    CREATE INDEX IF NOT EXISTS score_order ON scores(version, course, time);`);
  let activeChecks = 0;
  const lastSubmit = new Map();
  const busyPlayers = new Set();
  const board = (course, player) => {
    const entries = db.query(`SELECT p.name, s.time, s.player, s.created FROM scores s JOIN players p ON p.id=s.player
      WHERE version=? AND course=? ORDER BY s.time, s.created, s.player LIMIT 20`).all(CAMPAIGN_VERSION, course)
      .map((entry, i, all) => ({ rank: all.findIndex((other) => other.time === entry.time) + 1, name: entry.name, time: entry.time, mine: entry.player === player }));
    const personal = player && db.query('SELECT time FROM scores WHERE version=? AND course=? AND player=?').get(CAMPAIGN_VERSION, course, player);
    if (personal) personal.rank = 1 + db.query(`SELECT COUNT(*) AS count FROM scores WHERE version=? AND course=? AND time<?`)
      .get(CAMPAIGN_VERSION, course, personal.time).count;
    return { version: CAMPAIGN_VERSION, entries, personal: personal || null };
  };
  function session(request) {
    const id = request.headers.get('cookie')?.match(/(?:^|;\s*)dcr_player=([a-f0-9-]{36})(?:;|$)/)?.[1];
    return id ? db.query('SELECT * FROM players WHERE id=?').get(id) : null;
  }
  function verify(course, inputs) {
    return new Promise((accept, reject) => {
      const worker = new Worker(new URL('./verify-worker.js', import.meta.url).href);
      const end = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : accept(result); };
      const timer = setTimeout(() => end(new Error('Run verification timed out.')), 15000);
      worker.onmessage = ({ data }) => end(data.error ? new Error(data.error) : null, data.result);
      worker.onerror = () => end(new Error('Run verification failed.'));
      worker.postMessage({ course, inputs });
    });
  }
  async function body(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Expected JSON.');
    if (+request.headers.get('content-length') > LIMIT) throw new Error('Run is too large.');
    // Also bound chunked requests, which need not supply Content-Length.
    let length = 0;
    const chunks = [];
    for await (const chunk of request.body || []) {
      length += chunk.length;
      if (length > LIMIT) throw new Error('Run is too large.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const saveRun = db.transaction((course, player, result, inputs) => {
    const previous = db.query('SELECT time FROM scores WHERE version=? AND course=? AND player=?').get(CAMPAIGN_VERSION, course, player);
    const improved = !previous || result.time < previous.time;
    if (improved) db.query(`INSERT INTO scores VALUES(?,?,?,?,?) ON CONFLICT(version,course,player)
      DO UPDATE SET time=excluded.time, created=excluded.created`).run(CAMPAIGN_VERSION, course, player, result.time, Date.now());
    const ghost = db.query('SELECT time FROM ghosts WHERE version=? AND course=?').get(CAMPAIGN_VERSION, course);
    const record = !ghost || result.time < ghost.time;
    if (record) db.query(`INSERT INTO ghosts VALUES(?,?,?,?,?) ON CONFLICT(version,course)
      DO UPDATE SET player=excluded.player, time=excluded.time, inputs=excluded.inputs`).run(CAMPAIGN_VERSION, course, player, result.time, JSON.stringify(inputs));
    return { improved, record, time: result.time, ...board(course, player) };
  });
  async function fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        if (request.method === 'POST') {
          const origin = request.headers.get('origin');
          if (origin && origin !== (env.PUBLIC_ORIGIN || url.origin)) return json({ error: 'Cross-origin writes are disabled.' }, 403);
        }
        const player = session(request);
        if (path === '/api/profile') {
          if (request.method === 'GET') return json({ name: player?.name || null });
          if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
          const payload = await body(request);
          const name = typeof payload.name === 'string' ? normalizeName(payload.name) : '';
          if (!validName(name)) return json({ error: 'Use 2–20 letters, numbers, spaces, underscores or hyphens.' }, 400);
          const nameKey = name.toLowerCase();
          const owner = db.query('SELECT id FROM players WHERE name_key=?').get(nameKey);
          if (owner && owner.id !== player?.id) return json({ error: 'That name is taken. Choose another.' }, 409);
          const id = player?.id || crypto.randomUUID();
          db.query(`INSERT INTO players VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key`).run(id, name, nameKey);
          const secure = env.COOKIE_SECURE === 'true' || url.protocol === 'https:';
          return json({ name }, 200, { 'Set-Cookie': `dcr_player=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}` });
        }
        if (path === '/api/levels' && request.method === 'GET') return json({ version: CAMPAIGN_VERSION, levels: COURSES.map(({ id, name, number }) => ({ id, name, number })) });
        const match = path.match(/^\/api\/levels\/(level-[1-6])\/(leaderboard|ghost|runs)$/);
        if (!match || !courseById(match[1])) return json({ error: 'Unknown endpoint.' }, 404);
        const [, course, action] = match;
        if (request.method === 'GET' && action !== 'runs') {
          if (url.searchParams.get('version') !== CAMPAIGN_VERSION) return json({ error: 'Game updated. Please refresh.' }, 409);
          if (action === 'leaderboard') return json(board(course, player?.id));
          const ghost = db.query(`SELECT p.name,g.time,g.inputs FROM ghosts g JOIN players p ON p.id=g.player WHERE g.version=? AND g.course=?`).get(CAMPAIGN_VERSION, course);
          return json({ version: CAMPAIGN_VERSION, ghost: ghost ? { ...ghost, inputs: JSON.parse(ghost.inputs) } : null });
        }
        if (request.method !== 'POST' || action !== 'runs') return json({ error: 'Method not allowed.' }, 405);
        if (!player) return json({ error: 'Enter your name before posting a time.' }, 401);
        if (activeChecks >= 2 || busyPlayers.has(player.id)) return json({ error: 'Score server busy. Retry in a moment.' }, 429);
        const payload = await body(request);
        if (payload.version !== CAMPAIGN_VERSION) return json({ error: 'Game updated. Please refresh before racing.' }, 409);
        validateReplay(payload.inputs);
        // Recheck after reading the body: concurrent uploads can arrive together.
        if (activeChecks >= 2 || busyPlayers.has(player.id) || Date.now() - (lastSubmit.get(player.id) || 0) < 3000) return json({ error: 'Please wait a moment, then retry.' }, 429);
        activeChecks++;
        busyPlayers.add(player.id);
        lastSubmit.set(player.id, Date.now());
        if (lastSubmit.size > 10000) for (const [id, time] of lastSubmit) if (Date.now() - time > 60000) lastSubmit.delete(id);
        try {
          const result = await verify(course, payload.inputs);
          return json(saveRun(course, player.id, result, payload.inputs));
        } finally { activeChecks--; busyPlayers.delete(player.id); }
      }
      // Private editor HTML and its entire asset tree require real server-side credentials.
      const admin = path === '/admin' || path.startsWith('/admin/');
      if (admin && !isAdmin(request.headers, env)) return adminChallenge();
      if (path === '/admin' || path === '/admin/') return new Response(null, { status: 302, headers: { Location: '/admin/editor.html' } });
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const root = resolve(admin ? adminDir : publicDir);
      const relative = decodeURIComponent(admin ? path.slice('/admin/'.length) : path === '/' ? 'index.html' : path.slice(1));
      if (relative.split('/').some((part) => part.startsWith('.') || part === 'server' || part === 'src')) return new Response('Not found', { status: 404 });
      const target = resolve(root, relative);
      if (!target.startsWith(root + sep)) return new Response('Not found', { status: 404 });
      const file = Bun.file(target);
      if (!await file.exists()) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : file, { headers: { 'Content-Type': file.type, 'Cache-Control': admin ? 'no-store' : relative.endsWith('.html') ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      console.error(error.message);
      return json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Run could not be accepted. Check your connection and retry.' }, 400);
    }
  }
  return { fetch, close: () => db.close() };
}
if (import.meta.main) {
  const app = createApp();
  const server = Bun.serve({ hostname: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3001), maxRequestBodySize: LIMIT, fetch: app.fetch });
  console.log(`DEPTHCORE game + scores: ${server.url}`);
  console.log(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD ? 'Admin editor: /admin/editor.html' : 'Admin editor disabled (set ADMIN_USER and ADMIN_PASSWORD to enable).');
}
