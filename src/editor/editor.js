// DEPTHCORE // ROUTE EDITOR
// A level is a list of segments (generator modules, each with its own seed, structure style,
// turn side and optional difficulty) plus free shapes. buildLevel() turns it into the exact course
// the game runs, so what you see here is what you race. Every edit auto-validates with the same
// perfect bot as tools/sim.js (main line and every fork's skill line).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import '../ui/hud.css';
import './editor.css';
import {
  generateTrack, buildLevel, pathAt, MODULE_TYPES, TURN_TYPES, SHAPE_KINDS, diffForSector, lengthForSector,
} from '../game/trackgen.js';
import { STYLES, moveMovers } from '../game/kit.js';
import { Racer } from '../game/racer.js';
import { BotController } from '../game/bot.js';
import { THEMES, themeForSector } from '../world/themes.js';
import { TrackView } from '../world/trackview.js';
import { Sky } from '../world/sky.js';
import { Core } from '../world/core.js';
import { createEnvMap } from '../fx/envmap.js';
import { shared } from '../fx/shared.js';

const KEY = 'depthcore.level.edit';
const hex = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const pad = (n, k = 2) => String(n).padStart(k, '0');
const randSeed = () => (Math.random() * 0x7fffffff) | 1;

/** palette groups and one-line briefs for every module */
const GROUPS = [
  ['flow', ['run', 'gap', 'stairs', 'pads', 'beam', 'vault', 'slide', 'gauntlet']],
  ['vertical', ['ledge', 'climb', 'ascent', 'wallrun', 'wallchain', 'pillarkick', 'kickchain', 'tictac', 'ramp', 'drop', 'cascade']],
  ['turns', ['corner', 'turngap', 'kick', 'climbkick', 'zigzag', 'switchback']],
  ['forks // levels', ['bypass', 'split', 'overunder', 'triple', 'terrace']],
  ['legacy long loops', ['flyover', 'helix', 'dive']],
  ['speed checks', ['speedtrap', 'speedcorner']],
  ['moving // covered', ['shuttle', 'gallery']],
  ['grapple', ['swing', 'pivot']],
  ['shafts // stacked', ['chimney', 'wallclimb', 'plunge', 'mezzanine', 'dropturn', 'vaultturn', 'kickturn']],
  ['rhythm', ['vaultgap', 'slidegap', 'rooftops', 'alley']],
];
const BRIEF = {
  chimney: 'narrow shaft: zig-zag wallruns up to a high ledge',
  wallclimb: 'wallrun across a gap, wall-jump up onto a higher deck',
  plunge: 'two storeys: drop through the slot and run under, or take the strip and stay high',
  mezzanine: 'deck stacked over the lane: run under it, or kick up and run over it',
  dropturn: 'turn and jump off the side onto a leg a storey below',
  vaultturn: 'corner straight into a vault or slide gate',
  kickturn: 'jump at a pillar past the corner, kick off it round onto the new leg',
  vaultgap: 'vault a barrier and jump the gap straight off the landing',
  slidegap: 'slide the gate at the edge, jump out of the slide across a long gap',
  rooftops: 'short rooftops at stepping heights: hop, hop, hop',
  alley: 'wallrun, kick across to the opposite wall, ride it out',
  flyover: 'climb a loop and cross above the approach; jump the marked inside corner to save time',
  helix: 'three-level spiral with stacked return decks, two climbs and a diagonal jump cut',
  dive: 'descend a loop and cross under the approach; jump the marked inside corner',
  run: 'flat runway — breathing room', gap: 'jump to a slab, offset / height change', stairs: 'zig-zag hops up small steps',
  pads: 'floating pillar hops', beam: 'narrow beam balance line', vault: 'vault over a barrier', slide: 'slide under a gate',
  ledge: 'jump + mantle onto a ledge', climb: 'run up a wall', ascent: 'stacked climbs', wallrun: 'wallrun across a gap',
  wallchain: 'alternating wallruns climbing', pillarkick: 'kick off a monolith over a long gap', ramp: 'ramp — fast exit',
  drop: 'big drop — roll it', corner: '90° turn (cut-corner skill line)', turngap: 'turn in mid-jump',
  kick: 'wallrun → leap off at 90°', climbkick: 'climb, kick sideways, turn', bypass: 'fork: climb over / wallrun the flank',
  split: 'fork: vault+slide lane / long-gap lane', shuttle: 'moving platforms', gallery: 'covered passage, wallrun walls + gate',
  swing: 'long gap + anchor node: fire the hook on the run-up, swing over',
  pivot: 'runway ends in the void: line onto the corner post, whip 90° in the air',
  slalom: 'two pivot posts over open void: whip out sideways, whip back',
  switchback: 'turn back on yourself twice — each U-turn a climb-kick or a pivot whip',
  zigzag: 'stairwell: climb + kick sideways, climb + kick back',
  tictac: 'ledge too high: kick off the side monolith for height, climb, mantle',
  cascade: 'downhill hops side to side, then a long drop — roll it',
  gauntlet: 'rhythm corridor: barriers and slide gates spaced to the stride',
  kickchain: 'gap too long for one kick: kick monolith to monolith across it',
  overunder: 'fork: slide under the duct / hop the monolith beside it',
  triple: '3-lane hall: obstacle lane / wallrun lane / pad lane',
  terrace: 'two levels: low lane (vault, gate, climb) / high lane hopping blocks over pits',
  speedtrap: 'speed check: slide the ramp to clear the gap onto the high deck — or drop a level and climb',
  speedcorner: 'speed check: slide the ramp and jump the corner diagonally — or run round it',
};
const DIFF_NAMES = [[0.3, 'EASY'], [0.55, 'MEDIUM'], [0.8, 'HARD'], [2, 'BRUTAL']];
const diffName = (d) => DIFF_NAMES.find(([k]) => d < k)[1];

// ============================================================================ state
let level = load() ?? null;
let track = null;
let sel = null;            // { kind: 'seg' | 'shape', i }
let report = null;         // validation result
const undo = [];
const redo = [];
let genLen = level?.genLen ?? 420;
let genDiff = level?.genDiff ?? level?.diff ?? 0.5;

function load() {
  try {
    const l = JSON.parse(localStorage.getItem(KEY));
    return l && Array.isArray(l.modules) ? l : null;
  } catch {
    return null;
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...level, genLen, genDiff }));
  } catch {
    /* storage unavailable: the level lives for this session */
  }
}
const snapshot = () => JSON.stringify(level);
/** every mutation goes through here: undo point, rebuild, autosave, revalidate */
function edit(fn, { rebuild = true } = {}) {
  undo.push(snapshot());
  if (undo.length > 200) undo.shift();
  redo.length = 0;
  fn();
  if (rebuild) refresh();
  else { persist(); renderUI(); }
}
function restore(json) {
  level = JSON.parse(json);
  if (sel?.kind === 'seg' && sel.i >= level.modules.length) sel = level.modules.length ? { kind: 'seg', i: level.modules.length - 1 } : null;
  if (sel?.kind === 'shape' && sel.i >= level.shapes.length) sel = null;
  refresh();
}

function generate(seed, diff, length, sector) {
  const t = generateTrack(seed >>> 0, sector, { diff, length });
  level = { ...t.level, name: level?.name ?? 'UNTITLED', sector, diff };
  sel = null;
}

// ============================================================================ three
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
camera.position.set(60, 60, 40);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.screenSpacePanning = true;
orbit.maxPolarAngle = Math.PI * 0.95;
const gizmo = new TransformControls(camera, canvas);
gizmo.setTranslationSnap(0.25);
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
scene.add(gizmo.getHelper());

const sky = new Sky();
scene.add(sky.mesh);
const core = new Core(scene);
const trackView = new TrackView(scene);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.35);
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(45, 80, 35);
const fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-40, 30, 100);
scene.add(hemi, key, fill);
const overlay = new THREE.Group();
scene.add(overlay);
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffffff);
selBox.material.depthTest = false;
selBox.material.transparent = true;
selBox.renderOrder = 10;
scene.add(selBox);
const grid = new THREE.GridHelper(2000, 200, 0xffffff, 0xffffff);
grid.material.transparent = true;
grid.material.opacity = 0.05;
grid.material.depthWrite = false;
scene.add(grid);
let env = null;
let themeId = -1;
let theme = null;
const shapeMeshes = [];
const focus = { target: null, dist: 0 };

function setTheme(sector) {
  theme = themeForSector(sector);
  if (themeId === theme.id) return;
  themeId = theme.id;
  env?.dispose();
  env = createEnvMap(renderer, theme);
  scene.environment = env;
  shared.uFogColor.value.set(theme.fog);
  shared.uFogDensity.value = 0.0011;
  renderer.toneMappingExposure = theme.exposure * 1.1;
  sky.setTheme(theme);
  hemi.color.set(theme.glow);
  hemi.groundColor.set(theme.fog);
  key.color.set(theme.glow);
  selBox.material.color.set(theme.hud.accent);
  const h = theme.hud;
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(', ');
  const st = document.documentElement.style;
  st.setProperty('--acid', h.accent);
  st.setProperty('--accent-rgb', rgb(h.accent));
  st.setProperty('--ink', h.ink);
  st.setProperty('--shade-rgb', rgb(h.ink));
  st.setProperty('--white', h.paper);
  st.setProperty('--dim', `rgba(${rgb(h.paper)}, 0.55)`);
  st.setProperty('--faint', `rgba(${rgb(h.paper)}, 0.18)`);
}

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
  });
  g.clear();
}

function labelSprite(text, color, sub = '') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 8, 54, 40);
  g.fillStyle = '#000';
  g.font = '28px Akira, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 2), 6, 30);
  g.fillStyle = color;
  g.font = '15px Futurist, monospace';
  g.fillText(text.slice(3), 62, 22);
  g.globalAlpha = 0.6;
  g.font = '11px Futurist, monospace';
  g.fillText(sub, 62, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // fixed screen size (no attenuation): readable at any zoom, never fills the view
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.11, 0.0275, 1);
  s.center.set(0, 0);
  s.renderOrder = 20;
  return s;
}

function polyline(pts, color, opacity, dashed = false) {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y + 0.15, p.z)));
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity, depthTest: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const l = new THREE.Line(g, m);
  if (dashed) l.computeLineDistances();
  l.renderOrder = 5;
  return l;
}

/** rebuild the course from the level and redraw everything */
function refresh() {
  persist();
  setTheme(level.sector ?? 1);
  try {
    track = buildLevel(level);
  } catch (err) {
    console.error(err);
    toast(`BUILD FAILED // ${err.message}`, 'r');
    return;
  }
  trackView.build(track, theme, env);
  core.build(track, theme, env, track.seed);
  disposeGroup(overlay);
  shapeMeshes.length = 0;
  const accent = theme.hud.accent;
  overlay.add(polyline(track.path, theme.hud.paper, 0.75));
  for (const alt of track.alts) overlay.add(polyline(alt, accent, 0.9, true));
  for (const seg of track.segments) {
    if (!Number.isFinite(seg.s0)) continue;
    const p = pathAt(track, seg.s0);
    const s = labelSprite(`${pad(seg.i + 1)} ${seg.type.toUpperCase()}`, accent, `${seg.style} · ${seg.heading}`);
    s.position.set(p.x, p.y + 3.2, p.z);
    s.userData.seg = seg.i;
    overlay.add(s);
  }
  // free shapes: invisible pick volumes (the solid itself is drawn by the track view)
  level.shapes.forEach((sh, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sh.w, sh.h, sh.d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(sh.x, sh.kind === 'anchor' ? sh.y : sh.y - sh.h / 2, sh.z);
    m.userData.shape = i;
    overlay.add(m);
    shapeMeshes.push(m);
  });
  grid.position.y = track.minY + 6;
  scheduleValidate();
  syncGen();
  renderUI();
  updateSelection();
}

function updateSelection() {
  gizmo.detach();
  selBox.visible = false;
  if (!track || !sel) return;
  if (sel.kind === 'seg') {
    const b = track.segments[sel.i]?.box;
    if (!b) return;
    selBox.box.min.set(b.x0, b.y0, b.z0);
    selBox.box.max.set(b.x1, b.y1, b.z1);
    selBox.visible = true;
  } else if (sel.kind === 'shape' && shapeMeshes[sel.i]) {
    gizmo.attach(shapeMeshes[sel.i]);
    selBox.box.setFromObject(shapeMeshes[sel.i]);
    selBox.visible = true;
  }
}

function focusOn(box) {
  const c = new THREE.Vector3((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
  const r = Math.max(8, Math.hypot(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0) * 0.9);
  focus.target = c;
  focus.dist = r * 1.6;
}
function focusSel() {
  if (sel?.kind === 'seg' && track.segments[sel.i]?.box) focusOn(track.segments[sel.i].box);
  else if (sel?.kind === 'shape') {
    const s = level.shapes[sel.i];
    focusOn({ x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y - s.h, y1: s.y, z0: s.z - s.d / 2, z1: s.z + s.d / 2 });
  } else if (track) {
    let b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (const p of track.path) {
      b = { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), z0: Math.min(b.z0, p.z), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y), z1: Math.max(b.z1, p.z) };
    }
    focusOn(b);
    focus.dist *= 0.7;
  }
}

gizmo.addEventListener('objectChange', () => {
  const m = gizmo.object;
  if (!m || m.userData.shape === undefined) return;
  selBox.box.setFromObject(m);
});
gizmo.addEventListener('mouseUp', () => {
  const m = gizmo.object;
  if (!m || m.userData.shape === undefined) return;
  const i = m.userData.shape;
  edit(() => {
    const s = level.shapes[i];
    s.x = m.position.x;
    s.z = m.position.z;
    s.y = s.kind === 'anchor' ? m.position.y : m.position.y + s.h / 2;
  });
});

// picking: click (not drag) selects a shape, else the nearest segment volume under the cursor
const ray = new THREE.Raycaster();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo.dragging || !track) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(shapeMeshes, false)[0];
  let best = null;
  let bestD = hit ? hit.distance : Infinity;
  if (hit) best = { kind: 'shape', i: hit.object.userData.shape };
  const v = new THREE.Vector3();
  const B = new THREE.Box3();
  for (const seg of track.segments) {
    if (!seg.box) continue;
    B.min.set(seg.box.x0, seg.box.y0, seg.box.z0);
    B.max.set(seg.box.x1, seg.box.y1, seg.box.z1);
    if (ray.ray.intersectBox(B, v)) {
      const d = v.distanceTo(ray.ray.origin) + 0.5;   // shapes win ties
      if (d < bestD) { bestD = d; best = { kind: 'seg', i: seg.i }; }
    }
  }
  select(best);
});

function select(s, focusIt = false) {
  sel = s;
  updateSelection();
  renderUI();
  if (focusIt) focusSel();
  if (s?.kind === 'seg') ui.list.querySelector(`[data-i="${s.i}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ============================================================================ validation
let vTimer = 0;
function scheduleValidate() {
  clearTimeout(vTimer);
  ui.status.className = 'status run';
  ui.status.innerHTML = '<b>SCANNING</b><span class="lbl">perfect-bot run in progress</span>';
  vTimer = setTimeout(validate, 350);
}

function race(alt) {
  const t = alt ? buildLevel(level, { alt }) : track;
  const r = new Racer(t, {});
  const bot = new BotController(t, t.seed, { speedMul: 1, jitter: 0, mistake: 0 });
  const fails = [];
  let time = 0;
  const DT = 1 / 120;
  while (!r.finished && time < 400) {
    r.step(DT, bot.getInput(r));
    for (const e of r.events) {
      if (e.type === 'fall' || e.type === 'hardland' || e.type === 'bonk' || e.type === 'climbfail') {
        // which segment: the one whose stretch of racing line holds this spot
        const s = e.type === 'fall' ? r.lastSafeS + 2 : r.s;
        let seg = -1;
        for (const g of t.segments) if (g.s0 - 1 <= s) seg = g.i;
        fails.push({ type: e.type, s, seg, x: r.x, y: r.y, z: r.z, alt });
      }
    }
    r.events.length = 0;
    time += DT;
  }
  return { finished: r.finished, time: r.finishTime, fails, length: t.finishS };
}

function validate() {
  if (!track) return;
  const main = race(false);
  // race every route index the level has (3-lane forks have two alternates)
  const alts = [];
  for (let k = 1; k < (track.maxRoutes ?? (track.alts.length ? 2 : 1)); k++) alts.push(race(k));
  const alt = alts.length ? { finished: alts.every((a) => a.finished), time: Math.min(...alts.map((a) => a.time)), fails: alts.flatMap((a) => a.fails) } : null;
  const fails = [...main.fails, ...(alt?.fails ?? [])];
  report = { main, alt, fails, bad: new Set(fails.map((f) => f.seg)) };
  // fail markers in the scene
  for (const f of fails) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshBasicMaterial({ color: 0xff2d55, depthTest: false, transparent: true, opacity: 0.9 }));
    m.position.set(f.x, f.y + 1, f.z);
    m.renderOrder = 30;
    m.userData.fail = true;
    overlay.add(m);
  }
  renderUI();
}

// ============================================================================ ui
const root = document.getElementById('ed');
root.innerHTML = /* html */ `
  <aside class="left">
    <header>
      <span class="blk">DCR</span><span class="t">ROUTE<i>.</i>EDIT</span><span class="lbl">segments // shapes</span>
    </header>
    <section class="gen">
      <div class="sh"><span class="k">01</span>generate</div>
      <label><span class="lbl">name</span><input class="g-name" maxlength="24" spellcheck="false"></label>
      <label><span class="lbl">seed</span><input class="g-seed" spellcheck="false"><button class="g-dice" title="random seed">⚄</button></label>
      <label><span class="lbl">difficulty</span><input type="range" class="g-diff" min="0" max="1" step="0.05"><b class="g-diffv"></b></label>
      <label><span class="lbl">length</span><input type="range" class="g-len" min="120" max="720" step="20"><b class="g-lenv"></b></label>
      <label><span class="lbl">zone</span><select class="g-zone"></select></label>
      <div class="row"><button class="btn acid g-go">GENERATE ▸</button><button class="btn g-sector" title="difficulty + length of a campaign sector">SECTOR PRESET</button></div>
    </section>
    <section class="segs">
      <div class="sh"><span class="k">02</span>segments <span class="lbl s-count"></span></div>
      <div class="list s-list"></div>
    </section>
  </aside>
  <aside class="right">
    <section class="insp">
      <div class="sh"><span class="k">03</span><span class="i-title">inspector</span></div>
      <div class="i-body"></div>
    </section>
    <section class="pal">
      <div class="sh"><span class="k">04</span>insert segment <span class="lbl p-where"></span></div>
      <div class="p-body"></div>
      <div class="sh sub"><span class="k">05</span>free shapes <span class="lbl">bot ignores these</span></div>
      <div class="shapes"></div>
    </section>
  </aside>
  <footer>
    <div class="status"></div>
    <div class="stats"></div>
    <div class="acts">
      <button class="btn f-undo" title="Ctrl+Z">UNDO</button>
      <button class="btn f-redo" title="Ctrl+Shift+Z">REDO</button>
      <button class="btn f-import">IMPORT</button>
      <button class="btn f-export">EXPORT</button>
      <button class="btn acid f-play">PLAY ▸</button>
    </div>
    <input type="file" class="f-file" accept=".json,application/json" hidden>
  </footer>
  <div class="hint lbl">LMB select · drag orbit · RMB pan · wheel zoom · F focus · DEL delete · R reroll · ↑↓ step · CTRL+D duplicate</div>
  <div class="toasts"></div>
`;
const $ = (s) => root.querySelector(s);
const ui = {
  name: $('.g-name'), seed: $('.g-seed'), diff: $('.g-diff'), diffv: $('.g-diffv'), len: $('.g-len'), lenv: $('.g-lenv'),
  zone: $('.g-zone'), list: $('.s-list'), count: $('.s-count'), ititle: $('.i-title'), ibody: $('.i-body'),
  pal: $('.p-body'), where: $('.p-where'), shapes: $('.shapes'), status: $('.status'), stats: $('.stats'), file: $('.f-file'),
};
ui.zone.innerHTML = THEMES.map((t, i) => `<option value="${i + 1}">${pad(i + 1)} ${t.label}</option>`).join('');
ui.pal.innerHTML = GROUPS.map(([g, types]) => `
  <div class="grp"><span class="lbl">${g}</span><div class="chips">${types.map((t) => `<button class="chip" data-t="${t}" title="${BRIEF[t]}">${t}</button>`).join('')}</div></div>`).join('');
ui.shapes.innerHTML = SHAPE_KINDS.map((k) => `<button class="chip" data-k="${k}">+ ${k}</button>`).join('');

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  $('.toasts').appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function syncGen() {
  ui.name.value = level.name ?? 'UNTITLED';
  ui.seed.value = hex(level.seed);
  ui.diff.value = genDiff;
  ui.diffv.textContent = `${genDiff.toFixed(2)} ${diffName(genDiff)}`;
  ui.len.value = genLen;
  ui.lenv.textContent = `${genLen} M`;
  ui.zone.value = String(((level.sector ?? 1) - 1) % THEMES.length + 1);
}

function renderUI() {
  if (!level) return;
  // ---- segment list
  const segs = track?.segments ?? [];
  ui.count.textContent = `${level.modules.length} · ${Math.round(track?.finishS ?? 0)} m`;
  ui.list.innerHTML = level.modules.map((m, i) => {
    const sg = segs[i];
    const bad = report?.bad.has(i);
    const h = sg ? Math.round(sg.h) : 0;
    return `<div class="seg${sel?.kind === 'seg' && sel.i === i ? ' sel' : ''}${bad ? ' bad' : ''}" data-i="${i}">
      <span class="i">${pad(i + 1)}</span><span class="t">${m.type}</span>
      <span class="tags">${TURN_TYPES.has(m.type) ? `<em>${m.td ? (m.td < 0 ? 'L' : 'R') : 'A'}</em>` : ''}${m.diff !== undefined ? `<em>D${Math.round(m.diff * 10)}</em>` : ''}</span>
      <span class="st">${m.style.slice(0, 4)}</span><span class="hd">${sg?.heading ?? ''}</span><span class="h">${h >= 0 ? '+' : '−'}${pad(Math.abs(h))}</span>
    </div>`;
  }).join('') + '<div class="seg end"><span class="i">◆</span><span class="t">core approach</span></div>';

  // ---- inspector
  ui.where.textContent = sel?.kind === 'seg' ? `after ${pad(sel.i + 1)}` : 'at the end';
  if (sel?.kind === 'seg' && level.modules[sel.i]) {
    const m = level.modules[sel.i];
    const sg = segs[sel.i];
    ui.ititle.textContent = `segment ${pad(sel.i + 1)}`;
    ui.ibody.innerHTML = `
      <div class="big">${m.type}</div>
      <div class="brief">${BRIEF[m.type]}</div>
      <label><span class="lbl">type</span><select class="i-type">${MODULE_TYPES.map((t) => `<option${t === m.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label><span class="lbl">style</span><span class="seg4">${STYLES.map((s) => `<button class="chip${s === m.style ? ' on' : ''}" data-style="${s}">${s}</button>`).join('')}</span></label>
      ${TURN_TYPES.has(m.type) ? `<label><span class="lbl">turn</span><span class="seg4">${[[0, 'AUTO'], [-1, '◂ LEFT'], [1, 'RIGHT ▸']].map(([v, n]) => `<button class="chip${(m.td ?? 0) === v ? ' on' : ''}" data-td="${v}">${n}</button>`).join('')}</span></label>
        <div class="note">only honoured on a north leg — east/west legs always turn back north</div>` : ''}
      <label><span class="lbl">difficulty</span><select class="i-diff"><option value="">level (${level.diff.toFixed(2)})</option>${[0.2, 0.4, 0.6, 0.8, 1].map((d) => `<option value="${d}"${m.diff === d ? ' selected' : ''}>${d.toFixed(1)} ${diffName(d)}</option>`).join('')}</select></label>
      <label><span class="lbl">seed</span><input class="i-seed" value="${hex(m.seed)}" spellcheck="false"><button class="i-reroll" title="R">⟳</button></label>
      <div class="meta"><span>heading out <b>${sg?.heading ?? '-'}</b></span><span>floor <b>${sg ? sg.h.toFixed(1) : '-'} m</b></span><span>at <b>${sg && Number.isFinite(sg.s0) ? Math.round(sg.s0) : '-'} m</b></span></div>
      ${report?.bad.has(sel.i) ? `<div class="warn">${report.fails.filter((f) => f.seg === sel.i).map((f) => `${f.alt ? 'SKILL LINE' : 'MAIN LINE'} // ${f.type.toUpperCase()} @ ${Math.round(f.s)} M`).join('<br>')}</div>` : ''}
      <div class="grid2">
        <button class="btn i-up">▲ MOVE UP</button><button class="btn i-down">▼ MOVE DOWN</button>
        <button class="btn i-dup">DUPLICATE</button><button class="btn r i-del">DELETE</button>
        <button class="btn i-regen" title="keep everything up to this segment, generate the rest">REGEN AFTER ▸</button><button class="btn acid i-play">PLAY FROM HERE ▸</button>
      </div>`;
  } else if (sel?.kind === 'shape' && level.shapes[sel.i]) {
    const s = level.shapes[sel.i];
    ui.ititle.textContent = `shape ${pad(sel.i + 1)}`;
    const num = (k, step = 0.25) => `<label class="n"><span class="lbl">${k}</span><input type="number" step="${step}" data-k="${k}" value="${+s[k].toFixed(2)}"></label>`;
    ui.ibody.innerHTML = `
      <div class="big">${s.kind}</div>
      <div class="brief">${s.kind === 'anchor' ? 'grapple node · y = node height · hook range 30 m, must be above the runner' : 'free solid · drag the gizmo or type values · y = top surface'}</div>
      <label><span class="lbl">kind</span><select class="s-kind">${SHAPE_KINDS.map((k) => `<option${k === s.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      ${s.kind === 'slab' ? `<label><span class="lbl">style</span><span class="seg4">${STYLES.map((st) => `<button class="chip${st === (s.style ?? 'tiered') ? ' on' : ''}" data-sstyle="${st}">${st}</button>`).join('')}</span></label>` : ''}
      <div class="nums">${num('x')}${num('y')}${num('z')}${num('w', 0.5)}${num('h', 0.5)}${num('d', 0.5)}</div>
      <div class="grid2"><button class="btn s-dup">DUPLICATE</button><button class="btn r s-del">DELETE</button></div>`;
  } else {
    ui.ititle.textContent = 'inspector';
    ui.ibody.innerHTML = `<div class="empty"><div class="big">NO SELECTION</div><div class="brief">click a segment in the list or in the view.<br>palette inserts after the selection (or at the end).</div></div>`;
  }

  // ---- footer stats
  if (track) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of track.path) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    const turns = level.modules.filter((m) => TURN_TYPES.has(m.type)).length;
    ui.stats.innerHTML = `<span><b>${Math.round(track.finishS)}</b> m</span><span><b>${level.modules.length}</b> segs</span><span><b>${track.alts.length}</b> forks</span><span><b>${turns}</b> turns</span><span><b>${track.movers.length}</b> movers</span><span>alt <b>${Math.round(lo)}…${Math.round(hi)}</b></span>`;
  }
  if (report) {
    const ok = !report.fails.length && report.main.finished && (!report.alt || report.alt.finished);
    ui.status.className = `status ${ok ? 'ok' : 'bad'}`;
    ui.status.innerHTML = ok
      ? `<b>CLEAN</b><span class="lbl">par ${report.main.time.toFixed(2)} s${report.alt ? ` · skill lines ${report.alt.time.toFixed(2)} s` : ''}</span>`
      : `<b>${report.fails.length} FAULT${report.fails.length === 1 ? '' : 'S'}</b><span class="lbl">${report.main.finished ? `par ${report.main.time.toFixed(2)} s` : 'NOT FINISHABLE'} · segs ${[...report.bad].filter((i) => i >= 0).map((i) => pad(i + 1)).join(' ') || '—'}</span>`;
  }
  $('.f-undo').disabled = !undo.length;
  $('.f-redo').disabled = !redo.length;
}

// ---- events: generate
ui.name.addEventListener('change', () => edit(() => { level.name = ui.name.value.trim().toUpperCase() || 'UNTITLED'; }, { rebuild: false }));
ui.diff.addEventListener('input', () => { genDiff = +ui.diff.value; ui.diffv.textContent = `${genDiff.toFixed(2)} ${diffName(genDiff)}`; });
ui.len.addEventListener('input', () => { genLen = +ui.len.value; ui.lenv.textContent = `${genLen} M`; });
$('.g-dice').addEventListener('click', () => { ui.seed.value = hex(randSeed()); });
ui.zone.addEventListener('change', () => edit(() => { level.sector = +ui.zone.value; }));
const readSeed = (v) => (/^[0-9a-f]{1,8}$/i.test(v.trim()) ? parseInt(v.trim(), 16) >>> 0 : (hashStr(v) >>> 0));
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h;
}
$('.g-go').addEventListener('click', () => {
  edit(() => {
    const keepName = level.name;
    generate(readSeed(ui.seed.value), genDiff, genLen, level.sector ?? 1);
    level.name = keepName;
  });
  focusSel();
  toast(`GENERATED // ${level.modules.length} SEGMENTS`);
});
$('.g-sector').addEventListener('click', () => {
  const s = level.sector ?? 1;
  genDiff = diffForSector(s);
  genLen = lengthForSector(s);
  syncGen();
  toast(`SECTOR ${pad(s)} PRESET // DIFF ${genDiff.toFixed(2)} · ${genLen} M`);
});

// ---- segment list
ui.list.addEventListener('click', (e) => {
  const row = e.target.closest('.seg[data-i]');
  if (row) select({ kind: 'seg', i: +row.dataset.i }, true);
});

// ---- inspector (delegated)
ui.ibody.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !sel) return;
  const i = sel.i;
  if (sel.kind === 'seg') {
    const M = level.modules;
    if (b.dataset.style) edit(() => { M[i].style = b.dataset.style; });
    else if (b.dataset.td !== undefined) edit(() => { const v = +b.dataset.td; if (v) M[i].td = v; else delete M[i].td; });
    else if (b.classList.contains('i-reroll')) reroll();
    else if (b.classList.contains('i-up') && i > 0) edit(() => { [M[i - 1], M[i]] = [M[i], M[i - 1]]; sel.i = i - 1; });
    else if (b.classList.contains('i-down') && i < M.length - 1) edit(() => { [M[i + 1], M[i]] = [M[i], M[i + 1]]; sel.i = i + 1; });
    else if (b.classList.contains('i-dup')) duplicate();
    else if (b.classList.contains('i-del')) remove();
    else if (b.classList.contains('i-regen')) regenAfter();
    else if (b.classList.contains('i-play')) play(track.segments[i]?.s0 ?? 0);
  } else {
    if (b.dataset.sstyle) edit(() => { level.shapes[i].style = b.dataset.sstyle; });
    else if (b.classList.contains('s-dup')) duplicate();
    else if (b.classList.contains('s-del')) remove();
  }
});
ui.ibody.addEventListener('change', (e) => {
  if (!sel) return;
  const t = e.target;
  const i = sel.i;
  if (t.classList.contains('i-type')) edit(() => { level.modules[i].type = t.value; });
  else if (t.classList.contains('i-diff')) edit(() => { if (t.value === '') delete level.modules[i].diff; else level.modules[i].diff = +t.value; });
  else if (t.classList.contains('i-seed')) edit(() => { level.modules[i].seed = readSeed(t.value) || 1; });
  else if (t.classList.contains('s-kind')) edit(() => { level.shapes[i].kind = t.value; });
  else if (t.dataset.k) edit(() => { const v = +t.value; if (Number.isFinite(v)) level.shapes[i][t.dataset.k] = ['w', 'h', 'd'].includes(t.dataset.k) ? Math.max(0.25, v) : v; });
});

// ---- palette
ui.pal.addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]')?.dataset.t;
  if (!t) return;
  edit(() => {
    const at = sel?.kind === 'seg' ? sel.i + 1 : level.modules.length;
    const prev = level.modules[at - 1];
    level.modules.splice(at, 0, { type: t, seed: randSeed(), style: prev?.style ?? 'tiered' });
    sel = { kind: 'seg', i: at };
  });
  focusSel();
});
ui.shapes.addEventListener('click', (e) => {
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (!k || !track) return;
  // drop it beside the selected segment's end (or the course end), to the right of the line
  const s = sel?.kind === 'seg' && track.segments[sel.i] ? track.segments[sel.i].s1 : track.finishS - 40;
  const p = pathAt(track, s);
  const size = { slab: [4, 1, 4], block: [3, 5, 3], wall: [0.75, 6, 6], pillar: [1, 10, 1], pad: [2, 1, 2], anchor: [1.5, 1.5, 1.5] }[k];
  const snap = (v) => Math.round(v * 4) / 4;
  edit(() => {
    level.shapes.push({ kind: k, x: snap(p.x - p.dz * 7), y: snap(p.y + (k === 'anchor' ? 8 : k === 'slab' || k === 'pad' ? 0 : size[1] - 1)), z: snap(p.z + p.dx * 7), w: size[0], h: size[1], d: size[2], ...(k === 'slab' ? { style: 'tiered' } : {}) });
    sel = { kind: 'shape', i: level.shapes.length - 1 };
  });
  focusSel();
});

// ---- actions
function reroll() {
  if (sel?.kind !== 'seg') return;
  edit(() => { level.modules[sel.i].seed = randSeed(); });
}
function duplicate() {
  if (!sel) return;
  if (sel.kind === 'seg') edit(() => { level.modules.splice(sel.i + 1, 0, { ...level.modules[sel.i], seed: randSeed() }); sel.i += 1; });
  else edit(() => { const s = { ...level.shapes[sel.i] }; s.x += s.w + 1; level.shapes.push(s); sel.i = level.shapes.length - 1; });
}
function remove() {
  if (!sel) return;
  if (sel.kind === 'seg') {
    edit(() => {
      level.modules.splice(sel.i, 1);
      sel = level.modules.length ? { kind: 'seg', i: Math.min(sel.i, level.modules.length - 1) } : null;
    });
  } else edit(() => { level.shapes.splice(sel.i, 1); sel = null; });
}
function regenAfter() {
  if (sel?.kind !== 'seg') return;
  edit(() => {
    const keep = { ...level, modules: level.modules.slice(0, sel.i + 1) };
    const t = buildLevel(keep, { extend: true, extendSeed: randSeed(), length: Math.max(genLen, (track?.segments[sel.i]?.s1 ?? 0) + 60) });
    level.modules = t.level.modules;
  });
  toast(`REGENERATED AFTER ${pad(sel.i + 1)}`);
}
function play(from = 0) {
  persist();
  location.href = `/?level=edit${from > 0 ? `&from=${Math.round(from)}` : ''}`;
}
$('.f-play').addEventListener('click', () => play());
$('.f-undo').addEventListener('click', doUndo);
$('.f-redo').addEventListener('click', doRedo);
function doUndo() { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } }
function doRedo() { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } }
$('.f-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ...level, genLen, genDiff }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(level.name || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.dcr.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('.f-import').addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', async () => {
  const f = ui.file.files[0];
  ui.file.value = '';
  if (!f) return;
  try {
    const l = JSON.parse(await f.text());
    if (!Array.isArray(l.modules)) throw new Error('no segment list');
    edit(() => {
      level = { version: 1, name: 'IMPORTED', seed: 1, sector: 1, diff: 0.5, shapes: [], ...l };
      level.modules = level.modules.filter((m) => MODULE_TYPES.includes(m.type)).map((m) => ({ ...m, style: STYLES.includes(m.style) ? m.style : 'tiered', seed: (m.seed ?? randSeed()) >>> 0 }));
      genLen = l.genLen ?? genLen;
      sel = null;
    });
    focusSel();
    toast(`IMPORTED // ${level.name}`);
  } catch (err) {
    toast(`IMPORT FAILED // ${err.message}`, 'r');
  }
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  if (k === 'Delete' || k === 'Backspace') remove();
  else if (k === 'r' || k === 'R') reroll();
  else if (k === 'f' || k === 'F') focusSel();
  else if (k === 'Escape') select(null);
  else if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    const n = level.modules.length;
    if (!n) return;
    const i = sel?.kind === 'seg' ? sel.i + (k === 'ArrowDown' ? 1 : -1) : 0;
    select({ kind: 'seg', i: Math.max(0, Math.min(n - 1, i)) }, true);
  }
});

// ============================================================================ loop
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let time = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  shared.uTime.value = time;
  if (focus.target) {
    // glide the orbit to the focus point, keeping the view direction
    const k = Math.min(1, dt * 6);
    const off = camera.position.clone().sub(orbit.target);
    const len = off.length();
    orbit.target.lerp(focus.target, k);
    off.setLength(len + (focus.dist - len) * k);
    camera.position.copy(orbit.target).add(off);
    if (orbit.target.distanceTo(focus.target) < 0.05 && Math.abs(len - focus.dist) < 0.1) focus.target = null;
  }
  orbit.update();
  // segment labels: only the nearby ones, so a zoomed-out view isn't a wall of tags
  for (const o of overlay.children) if (o.isSprite) o.visible = o.position.distanceTo(camera.position) < 160;
  if (track) {
    track.world.moverT = -1;   // validation runs leave the clock far ahead
    moveMovers(track.world, time);
    trackView.update();
  }
  core.update(dt);
  sky.update(camera, core.group.position);
  renderer.render(scene, camera);
}

// ============================================================================ boot
(document.fonts?.ready ?? Promise.resolve()).then(() => {
  if (!level) {
    level = { name: 'UNTITLED', sector: 1, diff: 0.5 };
    generate(randSeed(), genDiff, genLen, 1);
    level.name = 'UNTITLED';
  }
  level.shapes ??= [];
  refresh();
  focusSel();
  requestAnimationFrame(frame);
});
