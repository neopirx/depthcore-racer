import * as THREE from 'three';
import { Input } from './core/input.js';
import { shared } from './fx/shared.js';
import { createEnvMap } from './fx/envmap.js';
import { createPost } from './fx/post.js';
import { Audio } from './fx/audio.js';
import { Sky } from './world/sky.js';
import { Backdrop } from './world/backdrop.js';
import { Core } from './world/core.js';
import { TrackView } from './world/trackview.js';
import { themeForSector, RIVAL_COLOR, PLAYER_BODY_COLOR } from './world/themes.js';
import { buildLevel, pathAt } from './game/trackgen.js';
import { Racer } from './game/racer.js';
import { BotController } from './game/bot.js';
import { Avatar } from './game/avatar.js';
import { RivalCharacter, PlayerBody, loadRivalAssets } from './world/rival.js';
import { COURSES, buildCourse } from './game/campaign.js';
import { GhostReplay, RACE_STEP, MAX_TICKS, packInput } from './game/replay.js';
import { competition, normalizeName, validName } from './core/competition.js';
import { BASE_STATS } from './game/constants.js';
import { FPCamera } from './fp/camera.js';
import { beat, updateBeat } from './fx/beat.js';
import { Hud } from './ui/hud.js';

// ---------------------------------------------------------------- save / params
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'depthcore.time-trials.v1';
function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable — progress lives for this session only */
  }
}
const freshSave = () => ({ sector: 1, calm: false, name: '' });
let save = loadSave() || freshSave();
if (params.has('sector')) save.sector = +params.get('sector');
save.sector = Math.min(6, Math.max(1, Math.floor(Number(save.sector) || 1)));
if (params.has('calm')) save.calm = true;
const LQ = params.has('lq');
const FREEZE_ON = params.get('freezeon')?.split(',');
const HQ = params.has('hq');
// custom level from the map editor: ?level=edit (the editor's working copy) or ?level=<slot>
const LEVEL_KEY = 'depthcore.level.';
function loadLevel(name) {
  try {
    return JSON.parse(localStorage.getItem(LEVEL_KEY + name));
  } catch {
    return null;
  }
}
// Editor previews never enter the public competition. The editor itself is server protected.
const LEVEL = params.has('level') ? loadLevel(params.get('level') || 'edit') : null;
const FROM_S = params.has('from') ? +params.get('from') : 0;

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, HQ ? 2 : LQ ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !LQ;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 6000);
const post = createPost(renderer, scene, camera);
post.setSize(innerWidth, innerHeight);
const fpcam = new FPCamera(camera);
fpcam.calm = !!save.calm;

const sky = new Sky();
scene.add(sky.mesh);
const backdrop = new Backdrop(scene);
const core = new Core(scene);
const trackView = new TrackView(scene);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.2);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.castShadow = !LQ;
keyLight.shadow.mapSize.set(HQ ? 4096 : 2048, HQ ? 4096 : 2048);
Object.assign(keyLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.04;
scene.add(keyLight, keyLight.target);
const KEY_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-0.4, 0.3, 1).multiplyScalar(100);
scene.add(fillLight);

const hud = new Hud(document.getElementById('hud'));
const input = new Input(canvas);
const audio = new Audio();
hud.settings({ sens: input.sens, calm: fpcam.calm });

// ---------------------------------------------------------------- game state
const STEP = RACE_STEP;
const g = {
  state: 'loading',
  stateT: 0,
  track: null, theme: null, seed: 0,
  player: null, rival: null, bot: null, autopilot: null,
  rivalAv: null, env: null,
  raceTime: 0, acc: 0, pendJump: false, pendSlide: false, pendHook: false,
  ghostData: null, ghost: null, recording: [], runToken: 0, ranked: false, profile: null, boardToken: 0,
  win: false, paused: false,
  look: { yaw: 0, pitch: 0 },
  prevP: { x: 0, y: 0, z: 0 }, prevR: { x: 0, y: 0, z: 0 },
  fx: { glitch: 0, flash: 0, desat: 0, ascii: 0 },
  lastCount: 4,
};
window.__dc = g;
g.hud = hud;   // debug handle (screenshots / console)
Object.assign(g, { scene, camera, post, trackView, backdrop, core, sky });
g.renderer = renderer;
const fmtSec = (s) => String(s).padStart(2, '0');

function setupSector() {
  const course = COURSES[save.sector - 1];
  const sector = LEVEL ? LEVEL.sector ?? 1 : course.number;
  const theme = themeForSector(sector);
  const seed = LEVEL ? LEVEL.seed >>> 0 : course.level.seed;
  const track = LEVEL ? buildLevel(LEVEL) : buildCourse(course.id);
  // editor playtest from a segment: start at the last checkpoint at or before ?from=<metres>
  g.fromCp = null;
  if (LEVEL && FROM_S > 0) for (const c of track.checkpoints) if (c.s <= FROM_S && c.s < track.finishS - 10) g.fromCp = c;

  if (g.env) g.env.dispose();
  g.env = createEnvMap(renderer, theme);
  scene.environment = g.env;
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  shared.uFogColor.value.set(theme.fog);
  shared.uFogDensity.value = theme.fogDensity;
  renderer.toneMappingExposure = theme.exposure;
  sky.setTheme(theme);
  hemi.color.set(theme.glow);
  hemi.groundColor.set(theme.fog);
  keyLight.color.set(theme.glow);
  post.uniforms.uTint.value.set(theme.line).lerp(new THREE.Color(0xffffff), 0.6);
  post.uniforms.uLightColor.value.set(theme.glow);
  audio.setTheme([55, 49, 58.27, 41.2, 65.4][(sector - 1) % 5]);
  audio.setSector(sector);

  trackView.build(track, theme, g.env);
  backdrop.build(track, theme, g.env, seed);
  core.build(track, theme, g.env, seed);

  if (g.rivalAv) {
    scene.remove(g.rivalAv.root);
    scene.remove(g.rivalAv.trail.mesh);
    // the character's geometry is shared between sectors (clones); only drop materials then
    g.rivalAv.root.traverse((o) => { if (!(g.rivalAv instanceof RivalCharacter)) o.geometry?.dispose(); o.material?.dispose(); });
  }
  // first-person body (legs while sliding), rebuilt per sector for the sector's env map
  if (g.body) {
    scene.remove(g.body.root);
    g.body.root.traverse((o) => o.material?.dispose());
  }
  g.body = g.rivalAssets ? new PlayerBody(scene, g.rivalAssets, PLAYER_BODY_COLOR, g.env) : null;
  const rc = g.rivalAssets ? new RivalCharacter(scene, g.rivalAssets, RIVAL_COLOR, g.env) : null;
  if (rc?.ok) g.rivalAv = rc;
  else {
    g.rivalAv = new Avatar(scene, RIVAL_COLOR, g.env, { dark: true });
    g.rivalAv.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  Object.assign(g, { track, theme, seed, sector, course, ghostData: null });
  hud.setInfo({
    sector, theme, seed, length: track.finishS, custom: LEVEL ? LEVEL.name || 'CUSTOM' : null,
    courseName: course.name,
  });
  hud.levels(COURSES, save.sector, selectLevel, !!LEVEL);
  resetRacers();
  refreshCompetition();
}

function spawnAt(track, side) {
  const sp = g.fromCp ?? track.spawn;
  const rx = Math.cos(sp.yaw);
  const rz = -Math.sin(sp.yaw);
  return { x: sp.x + rx * side * 1.3, y: sp.y, z: sp.z + rz * side * 1.3, yaw: sp.yaw };
}

function resetRacers() {
  const { track, seed } = g;
  g.player = new Racer(track, BASE_STATS, 'player', spawnAt(track, 0));
  g.ghost = g.ghostData && !LEVEL ? new GhostReplay(track, g.ghostData.inputs) : null;
  g.rival = g.ghost?.racer ?? new Racer(track, BASE_STATS, 'ghost', spawnAt(track, 0));
  g.bot = null;
  g.autopilot = params.has('autopilot') ? new BotController(track, seed + 1, { jitter: 0, mistake: 0 }) : null;
  if (g.fromCp) g.player.startFrom(g.fromCp);
  g.ranked = !!g.profile?.registered && !LEVEL && !g.autopilot && !params.has('skip') && !params.has('freezeat') && !FREEZE_ON;
  g.recording = [];
  g.runToken++;
  g.pendJump = g.pendSlide = g.pendHook = false;
  g.paused = false;
  g.freeze = false;
  g.freezeDelay = undefined;
  g.flowMaxed = false;
  g.raceTime = 0;
  g.acc = 0;
  g.look.yaw = (g.fromCp ?? track.spawn).yaw;
  g.look.pitch = -0.04;
  hud.ghostInfo(g.ghostData, !!g.ghost);
  snapInterp();
  fpcam.reset();
  g.rivalAv.trail.reset();
}

function selectLevel(number) {
  if (g.state !== 'title' || LEVEL || number === save.sector) return;
  save.sector = number;
  writeSave();
  runLoading(() => { setupSector(); setState('title'); });
}

async function refreshCompetition() {
  const token = ++g.boardToken;
  const course = g.course.id;
  if (LEVEL) { g.competitionLoading = false; hud.board(null, 'Editor preview — times are not submitted.'); return; }
  g.competitionLoading = true;
  hud.board(null, 'Connecting to leaderboard…');
  try {
    const [board, data] = await Promise.all([competition.board(course), competition.ghost(course)]);
    if (token !== g.boardToken) return;
    g.ghostData = data.ghost;
    hud.board(board);
    if (g.state === 'title') hud.ghostInfo(data.ghost, !!data.ghost);
  } catch (error) {
    if (token !== g.boardToken) return;
    hud.board(null, error.message);
  } finally { if (token === g.boardToken) g.competitionLoading = false; }
}

function snapInterp() {
  for (const [r, p] of [[g.player, g.prevP], [g.rival, g.prevR]]) { p.x = r.x; p.y = r.y; p.z = r.z; }
}

function setState(s) {
  g.state = s;
  g.stateT = 0;
  if (s === 'title') { hud.show('title'); input.unlock(); if (g.track) refreshCompetition(); }
  if (s === 'countdown') { hud.show('count'); g.lastCount = 4; }
  if (s === 'race') hud.show('race');
  if (s === 'results') { hud.show('results'); input.unlock(); }
}

function startCountdown() {
  if (!g.profile) { hud.focusName(); return; }
  if (g.competitionLoading) { hud.pop('CONNECTING TO LEADERBOARD…', 'ghost'); return; }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (!params.has('autopilot')) {
    audio.start();
    input.lock();
  }
  resetRacers();
  setState('countdown');
}

function showResults() {
  const rivalTime = g.ghost ? g.ghostData.time : null;
  g.win = rivalTime === null || g.player.finishTime < rivalTime;
  hud.results({ win: g.win, custom: !!LEVEL, player: g.player, rivalTime, sector: g.sector, seed: g.seed });
  setState('results');
  submitResult();
}

async function submitResult() {
  if (g.submitting === g.runToken) return;
  if (!g.ranked) { hud.submission('Practice run — times are not submitted.'); return; }
  if (g.recording.length > MAX_TICKS) { hud.submission('Run exceeded the 10-minute leaderboard limit.'); return; }
  const token = g.runToken;
  const course = g.course.id;
  const inputs = g.recording.slice();
  g.submitting = token;
  hud.submission('Verifying your run…');
  try {
    if (!g.profile.registered) {
      await competition.register(g.profile.name);
      g.profile.registered = true;
    }
    const result = await competition.submit(course, inputs);
    if (token !== g.runToken) return;
    hud.board(result);
    hud.submission(`${result.record ? 'New course record! ' : result.improved ? 'Personal best! ' : 'Time recorded. '}Your rank: #${result.personal.rank}`);
    await refreshCompetition();
  } catch (error) {
    if (token === g.runToken) hud.submission(error.message, () => submitResult());
  } finally { if (g.submitting === token) g.submitting = null; }
}

function runLoading(fn) {
  const el = document.getElementById('loading');
  el.style.opacity = 1;
  el.style.display = 'flex';
  el.textContent = `LOADING // LEVEL ${fmtSec(save.sector)} OF 06`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fn();
    el.style.opacity = 0;
    setTimeout(() => { el.style.display = 'none'; }, 600);
  }));
}

// ---------------------------------------------------------------- simulation
function stepRace(dt) {
  if (g.freeze) return;
  let pin;
  if (g.autopilot) {
    pin = g.autopilot.getInput(g.player);
    let dy = pin.yaw - g.look.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.look.yaw += dy * Math.min(1, dt * 14);
    g.look.pitch += (-0.06 - g.look.pitch) * Math.min(1, dt * 3);
    pin.yaw = g.player.mode === 'wall' ? pin.yaw : g.look.yaw;
  } else {
    pin = { ...input.racer(), yaw: g.look.yaw };
  }
  g.pendJump ||= pin.jump;
  g.pendSlide ||= pin.slide;
  g.pendHook ||= !!pin.grapple;
  g.acc += dt;
  while (g.acc >= STEP) {
    snapInterp();
    const inP = { ...pin, jump: g.pendJump, slide: g.pendSlide, grapple: g.pendHook };
    g.pendJump = g.pendSlide = g.pendHook = false;
    const wasFinished = g.player.finished;
    if (!wasFinished && g.recording.length <= MAX_TICKS) g.recording.push(packInput(inP));
    g.player.step(STEP, inP);
    // debug: ?freezeon=climb stops the sim the moment the player enters that mode (screenshots)
    if (FREEZE_ON && FREEZE_ON.includes(g.player.mode) && (g.freezeDelay = (g.freezeDelay ?? 0.12) - STEP) <= 0) { g.freeze = true; break; }
    g.ghost?.step();
    g.acc -= STEP;
    handleEvents();
  }
  g.raceTime = g.player.finished ? g.player.finishTime : g.player.time;
  if (params.has('freezeat') && g.raceTime >= +params.get('freezeat')) g.freeze = true;
}

const POPS = {
  WALLJUMP: ['WALL.JUMP', 'w'],
  'KICK.OFF': ['KICK.OFF', 'w'],
  'WALL.KICK': ['WALL.KICK', 'w'],
  CLIMB: ['CLIMB', 'ghost'],
  MANTLE: ['MANTLE', 'ghost'],
  VAULT: ['VAULT', 'ghost'],
  ROLL: ['ROLL // SPEED KEPT', ''],
  'SLIDE.UNDER': ['SLIDE', 'ghost'],
  SWING: ['SWING // MOMENTUM KEPT', ''],
};

function handleEvents() {
  const fx = g.fx;
  for (const e of g.player.events) {
    fpcam.onEvent(e);
    audio.event(e);
    switch (e.type) {
      case 'land':
        // a long fall slams the frame into terminal mode for a beat
        if (e.impact > 14) { fx.ascii = Math.max(fx.ascii, Math.min(0.45, 0.3 + (e.impact - 14) * 0.05)); fpcam.shake = Math.max(fpcam.shake, 0.55); }
        break;
      case 'roll':
        if (e.impact > 15) fx.ascii = Math.max(fx.ascii, 0.35);
        fpcam.shake = Math.max(fpcam.shake, 0.5);
        break;
      case 'hardland':
        fx.ascii = 0.55;
        fx.glitch = 0.15;
        hud.pop('HARD LANDING // ROLL IT', 'r');
        break;
      case 'hookmiss':
        hud.pop('NO ANCHOR IN SIGHT', 'ghost');
        break;
      case 'hookattach':
        hud.pop('LINE // LOCKED', 'w');
        break;
      case 'bonk':
        fx.glitch = 0.2;
        hud.pop('IMPACT // FLOW LOST', 'r');
        break;
      case 'fall':
        fx.glitch = 0.6; fx.ascii = 0.5;
        hud.pop('SIGNAL LOST // RESYNC', 'r');
        g.look.yaw = e.yaw;
        g.look.pitch = -0.04;
        snapInterp();
        break;
      case 'clean': {
        if (g.player.flow >= 1 && !g.flowMaxed) {
          g.flowMaxed = true;
          hud.pop('FLOW // MAX', '');
          audio.event({ type: 'flowmax' });
        } else if (POPS[e.label]) hud.pop(...POPS[e.label]);
        break;
      }
      case 'finish':
        fx.flash = 0.4;
        hud.pop(g.ghost && g.rival.finished ? 'RUN COMPLETE' : 'CORE REACHED', '');
        setState('finish');
        hud.show('race');
        break;
    }
    if (g.player.flow < 1) g.flowMaxed = false;
  }
  for (const e of g.rival.events) {
    if (e.type === 'finish' && !g.player.finished) hud.pop('RECORD GHOST FINISHED', 'r');
  }
  g.player.events.length = 0;
  g.rival.events.length = 0;
}

// ---------------------------------------------------------------- cameras
const lerpPos = (a, r, t, out) => {
  out.x = a.x + (r.x - a.x) * t;
  out.y = a.y + (r.y - a.y) * t;
  out.z = a.z + (r.z - a.z) * t;
  return out;
};
const pPos = { x: 0, y: 0, z: 0 };
const rPos = { x: 0, y: 0, z: 0 };
const titleP = {};
const titleQ = {};
const lookV = new THREE.Vector3();

function updateTitleCamera() {
  const t = g.stateT;
  const L = g.track.finishS;
  const s = (t * 9) % L;
  pathAt(g.track, s, titleP);
  pathAt(g.track, Math.min(L, s + 30), titleQ);
  camera.position.set(titleP.x + Math.sin(t * 0.13) * 6, titleP.y + 6 + Math.sin(t * 0.21) * 2.5, titleP.z + Math.cos(t * 0.11) * 3);
  lookV.set(titleQ.x, titleQ.y + 1, titleQ.z);
  camera.lookAt(lookV);
  camera.rotateZ(Math.sin(t * 0.17) * 0.06);
  camera.fov = 66;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- grapple lines
/** Line from the hand to the hook: pays out while the hook flies, then holds to the anchor. */
const ropes = {
  // a hairline cylinder (unit length along +y, stretched per frame): glows through the bloom
  lines: [0, 1].map((i) => {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i ? RIVAL_COLOR : 0xffffff }));
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  }),
  hand: new THREE.Vector3(),
  tip: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  dir: new THREE.Vector3(),
  update(i, r, pos, cam, fp) {
    const l = this.lines[i];
    const h = r.hook;
    l.visible = !!h;
    if (!h) return;
    // first person: leaves the wrist just below-right of the view (no hands drawn)
    if (fp) this.hand.set(0.3, -0.38, -0.55).applyQuaternion(cam.quaternion).add(cam.position);
    else this.hand.set(pos.x, pos.y + 1.45, pos.z);
    const k = h.att ? 1 : Math.max(0, 1 - h.t / h.dur);
    this.tip.set(h.a.x, h.a.y, h.a.z).sub(this.hand).multiplyScalar(k);
    const len = this.tip.length() || 1e-3;
    this.dir.copy(this.tip).divideScalar(len);
    l.position.copy(this.hand);
    l.quaternion.setFromUnitVectors(this.up, this.dir);
    const w = fp ? 0.008 : 0.03;
    l.scale.set(w, len, w);
    l.material.color.set(i ? RIVAL_COLOR : g.theme?.hud?.accent ?? '#ffffff').multiplyScalar(h.att ? 3 : 1.8);
  },
  hide() { for (const l of this.lines) l.visible = false; },
};

// ---------------------------------------------------------------- frame
let last = performance.now();
let time = 0;
const projV = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  shared.uTime.value = time;
  updateBeat(dt);
  hud.beat(beat.kick);
  input.pollPad();
  const fx = g.fx;
  if (g.state !== 'loading') g.stateT += dt;

  // settings
  if (input.wasPressed('BracketLeft')) { input.setSens(input.sens - 0.1); hud.settings({ sens: input.sens, calm: fpcam.calm }); }
  if (input.wasPressed('BracketRight')) { input.setSens(input.sens + 0.1); hud.settings({ sens: input.sens, calm: fpcam.calm }); }
  if (input.wasPressed('KeyM')) {
    fpcam.calm = !fpcam.calm;
    save.calm = fpcam.calm;
    writeSave();
    hud.settings({ sens: input.sens, calm: fpcam.calm });
    hud.pop(fpcam.calm ? 'REDUCED MOTION // ON' : 'REDUCED MOTION // OFF', 'ghost');
  }

  // mouse / stick look (only while playing)
  const playing = g.state === 'countdown' || g.state === 'race' || g.state === 'finish';
  const look = input.consumeLook(dt);
  if (playing && !g.paused && !g.autopilot) {
    g.look.yaw += look.yaw;
    g.look.pitch = THREE.MathUtils.clamp(g.look.pitch + look.pitch, -1.45, 1.45);
  }
  const needLock = playing && !g.autopilot && !input.locked && !input.pad;

  switch (g.state) {
    case 'title':
      updateTitleCamera();
      if (input.confirm()) startCountdown();
      if (!LEVEL) for (let n = 1; n <= 6; n++) if (input.wasPressed(`Digit${n}`)) selectLevel(n);
      break;
    case 'countdown': {
      const left = 3 - g.stateT;
      const n = Math.ceil(left);
      hud.countdown(n);
      if (n !== g.lastCount) { g.lastCount = n; audio.event({ type: 'count', go: n <= 0 }); }
      if (left <= 0) stepRace(dt);
      if (left <= -0.4) setState('race');
      break;
    }
    case 'race':
      if (g.paused) {
        if (input.confirm() || input.wasPressed('Mouse0')) { g.paused = false; input.lock(); hud.show('race'); }
        if (input.wasPressed('KeyR')) { g.paused = false; startCountdown(); }
        if (input.wasPressed('KeyQ')) { g.paused = false; setState('title'); }
        break;
      }
      if (input.back() || (g.wasLocked && needLock && g.stateT > 0.5)) { g.paused = true; input.unlock(); hud.show('pause'); break; }
      if (input.wasPressed('KeyR')) { startCountdown(); break; }
      stepRace(dt);
      break;
    case 'finish':
      stepRace(dt);
      if (g.stateT > 2.6) showResults();
      break;
    case 'results':
      if (input.confirm()) startCountdown();
      if (input.back()) setState('title');
      if (!LEVEL && input.wasPressed('KeyN')) {
        save.sector = save.sector % 6 + 1;
        writeSave();
        runLoading(() => { setupSector(); setState('title'); });
      }
      if (LEVEL && input.wasPressed('KeyE')) location.href = '/admin/editor.html';
      break;
  }
  g.wasLocked = input.locked;
  hud.lockHint(needLock && !g.paused && g.state !== 'results');

  // ---- visuals
  if (g.track) {
    const racing = ['countdown', 'race', 'finish', 'results'].includes(g.state);
    const alpha = g.acc / STEP;
    const P = g.player;
    lerpPos(g.prevP, P, alpha, pPos);
    lerpPos(g.prevR, g.rival, alpha, rPos);

    g.rivalAv.setVisible(racing && !!g.ghost);
    if (racing) {
      const step = fpcam.update(dt, P, pPos, g.look);
      if (step.footstep) audio.footstep(step.foot, P.speed, P.mode === 'wall');
      if (g.ghost) g.rivalAv.update(g.rival, rPos, dt, time);
      if (g.body?.ok) g.body.updateFP(P, pPos, dt, camera, fpcam.calm, g.look.yaw);
      // debug: ?rivalcam orbits the rival (to check its animation)
      if (params.has('rivalcam')) {
        const ang = (+params.get('rivalcam') || 0) + time * 0.15;
        // &camr / &camh pull the orbit out to frame a whole segment
        const cr = +(params.get('camr') ?? 3.6);
        camera.position.set(rPos.x + Math.sin(ang) * cr, rPos.y + +(params.get('camh') ?? 1.2), rPos.z + Math.cos(ang) * cr);
        camera.lookAt(rPos.x, rPos.y + 0.95, rPos.z);
      }
      // don't let the ghost fill the screen when overlapping the player
      const dRival = Math.hypot(rPos.x - pPos.x, rPos.y - pPos.y, rPos.z - pPos.z);
      if (dRival < 1.4 && !params.has('rivalcam')) g.rivalAv.root.visible = false;
    } else {
      updateTitleCamera();
      if (g.body) g.body.root.visible = false;
    }
    audio.update(P, racing && g.state !== 'results');

    // shadow frustum follows the player
    const c = racing ? pPos : camera.position;
    keyLight.target.position.set(c.x, c.y, c.z);
    keyLight.position.set(c.x + KEY_DIR.x * 120, c.y + KEY_DIR.y * 120, c.z + KEY_DIR.z * 120);

    backdrop.update(dt, camera, racing ? P.speed : 0, (racing ? pPos.y : camera.position.y - 7));
    core.update(dt);
    sky.update(camera, core.group.position);

    // rival tag (clamped to the screen border when off-screen)
    if (racing && g.state !== 'results') {
      projV.set(rPos.x, rPos.y + 2.3, rPos.z).project(camera);
      const behind = projV.z > 1;
      let x = projV.x;
      let y = projV.y;
      if (behind) { x = -x; y = -1; }
      const on = !behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.95;
      let edge = null;
      if (!on) {
        const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
        x /= m; y /= m;
        x *= 0.92; y = THREE.MathUtils.clamp(y * 0.92, -0.1, 0.75);   // keep clear of the HUD corners
        edge = Math.abs(x) > 0.85 ? (x < 0 ? 'l' : 'r') : 'b';
      }
      hud.rivalTag(g.ghost ? { x: (x * 0.5 + 0.5) * innerWidth, y: (-y * 0.5 + 0.5) * innerHeight, edge } : null, g.rival.s - P.s);
      hud.update({ player: P, rival: g.rival, track: g.track, raceTime: g.raceTime });
      // grapple lock-on: the anchor a press would fire at, or the one the line is on
      const hk = P.hook;
      const tgt = hk ? hk.a : P.respawnT > 0 ? null : P.grappleTarget();
      trackView.setTarget(tgt);
      if (tgt) {
        projV.set(tgt.x, tgt.y, tgt.z).project(camera);
        const vis = projV.z < 1 && Math.abs(projV.x) < 1.1 && Math.abs(projV.y) < 1.1;
        const d = Math.hypot(tgt.x - pPos.x, tgt.y - pPos.y - 1.2, tgt.z - pPos.z);
        hud.anchor(vis ? { x: (projV.x * 0.5 + 0.5) * innerWidth, y: (-projV.y * 0.5 + 0.5) * innerHeight } : null,
          { d, pivot: tgt.kind === 'pivot', state: !hk ? 'ready' : hk.att ? (P.swinging ? 'swing' : 'locked') : 'flying', k: hk && !hk.att ? 1 - hk.t / hk.dur : 1 });
      } else hud.anchor(null);
    } else {
      hud.rivalTag(null);
      hud.anchor(null);
      trackView.setTarget(null);
    }
    if (racing) {
      ropes.update(0, P, pPos, camera, true);
      if (g.ghost) ropes.update(1, g.rival, rPos, camera, false);
      else ropes.lines[1].visible = false;
    } else ropes.hide();

    // post fx
    fx.glitch *= Math.exp(-dt * 4);
    fx.flash *= Math.exp(-dt * 6);
    fx.desat *= Math.exp(-dt * 3);
    fx.ascii = Math.max(0, fx.ascii - dt);
    // the music follows the run: speed and flow raise the energy (arp, open filters, brighter pulses)
    const eT = racing && g.state !== 'results' ? 0.35 + THREE.MathUtils.clamp((P.speed - 4) / 6, 0, 1) * 0.3 + P.flow * 0.35 : 0.3;
    beat.energy += (eT - beat.energy) * Math.min(1, dt * 1.5);
    const speedF = racing ? THREE.MathUtils.clamp((P.speed - 6.5) / 4, 0, 1) : 0;
    const u = post.uniforms;
    u.uSpeed.value = speedF * (fpcam.calm ? 0.5 : 1);
    u.uAberr.value = 0.0016 + speedF * 0.003 + fx.glitch * 0.004;
    u.uGlitch.value = fx.glitch + (P?.respawnT > 0 ? 0.6 : 0);
    u.uFlash.value = fx.flash;
    u.uDesat.value = fx.desat;
    u.uFlow.value = racing ? P.flow : 0;
    // ascii: full-on for the first part of the window, then tears back out
    u.uAscii.value = THREE.MathUtils.clamp(fx.ascii / 0.25, 0, 1) * (fpcam.calm ? 0.5 : 1);
    u.uKick.value = shared.uKick.value;
    u.uSky.value = backdrop.flash;
    sky.uniforms.uFlash.value = backdrop.flash;
    hemi.intensity = 0.2 + backdrop.flash * 0.6;
    projV.copy(core.group.position).project(camera);
    const vis = projV.z < 1 ? THREE.MathUtils.clamp(1.4 - Math.max(Math.abs(projV.x), Math.abs(projV.y)), 0, 1) : 0;
    u.uLight.value.set(projV.x * 0.5 + 0.5, projV.y * 0.5 + 0.5, vis);
    trackView.update(time, camera, dt);
    post.render(time);
  }
  input.endFrame();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- identity
async function initIdentity() {
  try {
    const profile = await competition.profile();
    if (profile.name) g.profile = { name: profile.name, registered: true };
  } catch { /* the game remains playable as a practice session */ }
  hud.identity(g.profile?.name || '', save.name || '');
  if (g.profile) { save.name = g.profile.name; writeSave(); }
}
hud.onName = async (raw, practice = false) => {
  const name = normalizeName(raw);
  if (!validName(name)) { hud.nameError('Use 2–20 letters, numbers, spaces, underscores or hyphens.'); return; }
  hud.nameBusy(true);
  try {
    if (!practice) await competition.register(name);
    g.profile = { name, registered: !practice };
    save.name = name;
    writeSave();
    hud.identity(name);
    refreshCompetition();
  } catch (error) { hud.nameError(error.message); }
  finally { hud.nameBusy(false); }
};
hud.onChangeName = () => { g.profile = null; hud.identity('', save.name); hud.focusName(); };
hud.$('.res-replay').addEventListener('click', startCountdown);
hud.$('.res-levels').addEventListener('click', () => setState('title'));
hud.$('.res-next').addEventListener('click', () => {
  if (LEVEL) { location.href = '/admin/editor.html'; return; }
  save.sector = save.sector % 6 + 1;
  writeSave();
  runLoading(() => { setupSector(); setState('title'); });
});

// ---------------------------------------------------------------- boot
Promise.all([initIdentity(), document.fonts?.ready, loadRivalAssets().then((a) => { g.rivalAssets = a; })]).finally(() => {
  runLoading(() => {
    setupSector();
    if (params.has('autopilot')) { resetRacers(); setState('race'); }
    else { setState('title'); if (params.has('autostart') && g.profile) refreshCompetition().then(startCountdown); }
    // debug: ?autopilot&skip=20 fast-forwards the race to inspect later sections
    if (params.has('skip')) {
      setState('race');
      for (let t = 0; t < +params.get('skip'); t += STEP) stepRace(STEP);
      snapInterp();
      fpcam.reset();
    }
  });
  requestAnimationFrame(frame);
});
document.querySelector('#title .go').addEventListener('click', () => {
  if (g.state === 'title') startCountdown();
});
canvas.addEventListener('click', () => {
  if ((g.state === 'race' || g.state === 'countdown') && !g.autopilot) {
    audio.start();
    input.lock();
    if (g.paused) { g.paused = false; hud.show('race'); }
  }
});
document.getElementById('hud').addEventListener('click', () => {
  if (g.state === 'race' && g.paused) { g.paused = false; input.lock(); hud.show('race'); }
});
