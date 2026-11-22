import { makeRng } from '../core/rng.js';
import { pathAt } from './trackgen.js';
import { groundAt } from './world.js';

/**
 * Rival AI. Produces the same input shape as the player and drives an ordinary Racer,
 * so it obeys identical physics. It follows the generator's racing line and fires
 * the actions the generator annotated (jump here, slide here, kick off the wall here...).
 *
 * skill.jitter  — timing noise (metres of lead error)
 * skill.mistake — chance per action of a badly timed / forgotten input
 * skill.noRampSlide — runs ramps instead of sliding them (tools/speedcheck.js)
 */
export class BotController {
  constructor(track, seed, skill) {
    this.track = track;
    this.rng = makeRng(seed ^ 0x9e3779b9);
    this.skill = skill;
    this.plans = new Map();
    this.ai = 0;
    this.lastFails = 0;
    this._p = {};
  }

  plan(a) {
    let p = this.plans.get(a);
    if (p) return p;
    const r = this.rng;
    const mistake = r.chance(this.skill.mistake);
    const noise = r.gauss() * this.skill.jitter;
    p = { mistake, noise, done: false, pressed: false };
    this.plans.set(a, p);
    return p;
  }

  getInput(r) {
    const inp = { fwd: 1, side: 0, yaw: r.yaw, jump: false, jumpHeld: false, slide: false, slideHeld: false, grapple: false, grappleHeld: false };
    if (r.respawnT > 0 || r.finished) { inp.fwd = 0; this.swing = null; this.pivot = null; return inp; }
    // unstick: standing still against something for a while -> try a jump
    this.stillT = r.grounded && r.speed < 1 ? (this.stillT || 0) + 1 / 120 : 0;
    if (this.stillT > 0.5) { inp.jump = true; this.stillT = 0; }
    const acts = this.track.actions;

    // after a fall or impact, retry the obstacles ahead cleanly (like a human would)
    const fails = r.falls + r.stumbles;
    if (fails !== this.lastFails) {
      this.lastFails = fails;
      for (const a of acts) {
        if (a.s < r.s - 2 || a.s > r.s + 40) continue;
        const p = this.plan(a);
        p.done = false; p.pressed = false; p.mistake = false; p.noise = 0;
      }
      while (this.ai > 0 && acts[this.ai - 1].s > r.s - 2) this.ai--;
    }

    // steering: look at the racing line a little ahead
    const sp = r.speed;
    const look = Math.min(3.8, Math.max(2.2, sp * 0.24));
    // between a wallrun takeoff and catching the wall, aim along the wall line, not past it
    if (r.mode !== 'air') this.wallTakeoff = null;
    const tp = pathAt(this.track, r.s + look, this._p);
    inp.yaw = this.wallTakeoff ? this.wallTakeoff.yaw : Math.atan2(-(tp.x - r.x), -(tp.z - r.z));
    if (r.mode === 'wall') inp.yaw = Math.atan2(-r.vx, -r.vz);

    // brace for any big drop: hold slide while falling fast so the landing becomes a roll
    if (!r.grounded && r.vy < -12.5 && r.mode === 'air' && !this.forgetRoll) inp.slideHeld = true;
    if (r.grounded) this.forgetRoll = this.rng.chance(this.skill.mistake * 0.5);

    // air brake: if the jump would carry us past the platform, pull back (like a player tapping S)
    if (r.mode === 'air' && !r.hook) this.airBrake(r, inp);

    while (this.ai < acts.length && acts[this.ai].s < r.s - 12) this.ai++;
    for (let i = this.ai; i < acts.length; i++) {
      const a = acts[i];
      if (a.s > r.s + 25) break;
      const p = this.plan(a);
      if (p.pressed && !r.grounded && a.type !== 'walljump' && a.type !== 'roll') p.done = true;
      if (p.done) continue;
      const d = a.s - r.s;
      switch (a.type) {
        case 'jump':
        case 'climb':
        case 'wallrun': {
          let lead = (a.lead ?? 0.15) + p.noise;
          if (p.mistake && a.type === 'jump') lead += 1.6;   // jumps too early, comes up short
          if (r.grounded && d <= lead && d > -1.5) {
            inp.jump = true;
            p.pressed = true;
            if (a.type === 'wallrun') {
              const wj = acts.find((x) => x.s > a.s && x.type === 'walljump');
              // aim straight down the wall line (takeoff point -> kick point)
              this.wallTakeoff = { yaw: wj ? Math.atan2(-(wj.x - a.x), -(wj.z - a.z)) : inp.yaw };
            }
          }
          break;
        }
        case 'walljump': {
          let early = 0.3 + p.noise * 0.5;
          if (p.mistake) early -= 1.2;                        // hangs on too long
          if (r.mode === 'wall' && d <= early) {
            inp.yaw = Math.atan2(-(a.tx - r.x), -(a.tz - r.z));
            inp.jump = true;
            p.done = true;
          }
          break;
        }
        case 'climbjump': {
          // kick off a climb toward the side ledge, near the top of the climb
          if (r.mode === 'climb' && d < 4 && (r.climbT >= 0.3 + p.noise * 0.05 || r.vy < 3.2)) {
            inp.yaw = Math.atan2(-(a.tx - r.x), -(a.tz - r.z));
            inp.jump = true;
            p.done = true;
          }
          break;
        }
        case 'kick': {
          // UT-style kick off a pillar (or the end of a short wallrun) toward the far side
          if (d < 4 && ((r.mode === 'air' && r.findKickWall()) || (r.mode === 'wall' && d < 0.6))) {
            inp.yaw = Math.atan2(-(a.tx - r.x), -(a.tz - r.z));
            inp.jump = true;
            p.done = true;
          }
          break;
        }
        case 'slide': {
          if (a.hold && this.skill.noRampSlide) { p.done = true; break; }   // speed-check probe: just run it
          let lead = 0.4 + p.noise * 0.5;
          if (p.mistake && !a.hold) lead = -0.6;               // too late: hits the gate
          // speed line: slide once the drop left on the ramp turns the current speed into the
          // target (entered hot, that's late on the ramp; a slide from the top would overshoot)
          let ready = true;
          if (a.ramp) {
            const v = r.speed + 1.1;
            ready = (a.ramp.vT * a.ramp.vT - v * v) / (1.7 * r.stats.gravity) >= r.y - a.ramp.y1 - 0.05;
          }
          if (r.grounded && d <= lead && !p.pressed && ready) { inp.slide = true; p.pressed = true; }
          if (a.hold && p.pressed && r.s < a.s + a.hold) inp.slideHeld = true;
          if (p.pressed && (!a.hold || r.s > a.s + a.hold)) p.done = true;
          break;
        }
        case 'grapple': {
          // fire on the run-up (a sloppy bot fires late: the hook lands with the line long)
          const lead = 0.2 + p.noise * 0.3 + (p.mistake ? -5 : 0);
          if (d <= lead && !p.pressed && !r.hook) {
            inp.yaw = Math.atan2(-(a.ax - r.x), -(a.az - r.z));
            inp.grapple = true;
            p.pressed = true;
            this.swing = a;
          }
          if (p.pressed && !r.grounded) p.done = true;
          break;
        }
        case 'pivot': {
          // line onto the post on the run-up or in the air; the tether does the turning
          const lead = 0.2 + p.noise * 0.3 + (p.mistake ? -3 : 0);
          if (d <= lead && !p.pressed && !r.hook) {
            if (!r.grounded) inp.yaw = Math.atan2(-(a.ax - r.x), -(a.az - r.z));
            inp.grapple = true;
            p.pressed = true;
            p.done = true;
            this.pivot = a;
          }
          break;
        }
        case 'roll': {
          if (!r.grounded && r.vy < 0 && r.y < a.h + 1.1 && d < 10 && !p.mistake) { inp.slide = true; p.done = true; }
          if (r.grounded && d < -2) p.done = true;
          break;
        }
        default:
          break;
      }
    }
    // holding the line: let go once a ballistic flight from here lands on the far platform
    if (this.swing) {
      const a = this.swing;
      inp.grappleHeld = true;
      if (r.hook?.att && !r.grounded && releaseLands(r, a.box)) inp.grappleHeld = false;
      // swinging back the way we came: it isn't going to make it, let go
      const bx = (a.box.x0 + a.box.x1) / 2 - r.x;
      const bz = (a.box.z0 + a.box.z1) / 2 - r.z;
      if (r.swinging && r.vx * bx + r.vz * bz < 0) inp.grappleHeld = false;
      if (!r.hook && (p0(this, a).pressed && (r.grounded ? r.s > a.s + 4 : false))) this.swing = null;
      if (!inp.grappleHeld || r.s > a.s + 60) this.swing = null;
    }
    // pivot: hold the line until we face the exit, then let it fling us off
    if (this.pivot) {
      const a = this.pivot;
      inp.grappleHeld = true;
      const h = r.hook;
      if (h?.taut) {
        const sp = r.speed || 1;
        if ((r.vx * a.ex + r.vz * a.ez) / sp > 0.995) inp.grappleHeld = false;
      }
      if ((!h && !inp.grapple) || r.s > a.s + 30) inp.grappleHeld = false;
      if (!inp.grappleHeld) this.pivot = null;
    }
    return inp;
  }
}

const p0 = (bot, a) => bot.plan(a);

/**
 * Would letting go now land on the box top? Steps a ballistic flight: it must not enter the
 * footprint below the top (that's a face), and must come down inside it with room to spare.
 */
function releaseLands(r, b) {
  const g = r.stats.gravity;
  const h = 1 / 60;
  let x = r.x; let y = r.y; let z = r.z; let vy = r.vy;
  const m = 1.2;
  for (let t = 0; t < 3; t += h) {
    x += r.vx * h; z += r.vz * h; vy -= g * h; y += vy * h;
    const inOuter = x > b.x0 - 0.35 && x < b.x1 + 0.35 && z > b.z0 - 0.35 && z < b.z1 + 0.35;
    if (vy < 0 && y <= b.y) return x > b.x0 + m && x < b.x1 - m && z > b.z0 + m && z < b.z1 - m;
    if (inOuter && y < b.y) return false;
  }
  return false;
}

/** Where a ballistic fall from the racer's state meets height y (null if it never does). */
function landingXZ(r, y, k = 1) {
  const g = r.stats.gravity;
  const dy = r.y - y;
  const vy = r.vy;
  const disc = vy * vy + 2 * g * dy;
  if (disc < 0) return null;
  const t = (vy + Math.sqrt(disc)) / g;
  return { x: r.x + r.vx * k * t, z: r.z + r.vz * k * t };
}

BotController.prototype.airBrake = function airBrake(r, inp) {
  const tmp = this._g || (this._g = []);
  // the surface under the racing line a little ahead is where we mean to land
  const tp = pathAt(this.track, r.s + 2.5, this._p);
  const gy0 = groundAt(r.world, tp.x, tp.z, Math.max(r.y, tp.y) + 0.5, tmp);
  const y = gy0 > tp.y - 1.5 ? gy0 : tp.y;
  const sp = Math.hypot(r.vx, r.vz) || 1;
  const ok = (x, z) => Math.abs(groundAt(r.world, x, z, y + 0.3, tmp) - y) < 0.35;
  // a good landing has ground under the touchdown point and a little room past it
  const hits = (k) => {
    const p = landingXZ(r, y, k);
    return !!p && ok(p.x, p.z) && ok(p.x + (r.vx / sp) * 0.6, p.z + (r.vz / sp) * 0.6);
  };
  if (hits(1)) return;
  if (hits(0.85) || hits(0.7) || hits(0.55)) {
    inp.fwd = -1;
    inp.side = 0;
  }
};

export function botSkillForSector(sector) {
  const t = Math.min(1, (sector - 1) / 7);
  return {
    speedMul: 0.86 + 0.17 * t,       // 0.86 → 1.03
    jitter: 0.5 - 0.4 * t,
    mistake: 0.2 - 0.16 * t,         // 20% → 4%
  };
}
