import * as THREE from 'three';
import { EYE_H, SLIDE_EYE_H } from '../game/constants.js';

/** Damped spring (semi-implicit Euler). Impulses add velocity; the spring pulls back to 0. */
class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  kick(v) { this.v += v; }
  update(dt) {
    // substep so big frame times stay stable
    const n = Math.ceil(dt / 0.012);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;

/**
 * First-person camera rig. Everything here is presentation only — it never feeds back
 * into the simulation, so player and rival physics stay identical.
 *
 *  - eye height eases between stand / slide / roll
 *  - step-synced head bob (dip on every footfall, half-rate sway), scaled by speed
 *  - spring landing dip + nod scaled by impact (capped), heavy version for hard landings
 *  - wallrun tilt away from the wall, starting *before* contact when flying at a wall
 *  - roll = a fast forward somersault of the view
 *  - speed FOV, slide/walljump FOV kicks, turn-rate roll, high-speed micro shake
 *
 * Tuned after DICE's notes on Mirror's Edge: a head-locked camera made people sick and a
 * look-ahead camera was dull, so they animated the *perception* of each move: a short, strong
 * cue that resolves fast (takeoff push, wall impact, landing compress) over a calm baseline.
 * Leans engage quickly and release slowly; nothing lags behind the mouse.
 */
export class FPCamera {
  constructor(camera) {
    this.camera = camera;
    this.calm = false;
    this.reset();
  }

  reset() {
    this.eye = EYE_H;
    this.dipY = new Spring(150, 15);
    this.nod = new Spring(120, 13);       // pitch offset (rad), + = look down
    this.sway = new Spring(90, 11);       // roll offset from impacts
    this.lat = new Spring(70, 10);        // sideways head offset (m) — wall kicks, vault hops
    this.pitchOff = 0;
    this.mantleRoll = 0;
    this.prevV = null;
    this.accLean = 0;
    this.slideShake = 0;
    this.phase = 0;
    this.lastStep = 0;
    this.roll = 0;
    this.tilt = 0;
    this.fov = 70;
    this.fovKick = 0;
    this.flip = -1;           // roll somersault progress (−1 = none)
    this.shake = 0;
    this.climbPhase = 0;
    this.yawPrev = null;
    this.turnRate = 0;
    this.bobY = 0; this.bobX = 0; this.bobRoll = 0;
    this.out = { footstep: false, foot: 1 };
  }

  /** React to simulation events (called once per rendered frame with the batch). */
  onEvent(e) {
    const m = this.calm ? 0.5 : 1;
    switch (e.type) {
      case 'land': {
        const k = Math.min(1, e.impact / 15);
        this.dipY.kick(-k * 2.6 * m);
        this.nod.kick(k * 0.55 * m);
        break;
      }
      case 'hardland':
        this.dipY.kick(-4.8 * m);
        this.nod.kick(1.3 * m);
        this.sway.kick((Math.random() - 0.5) * 0.6 * m);
        this.shake = 0.9;
        break;
      case 'roll':
        this.dipY.kick(-2.2 * m);
        if (!this.calm) this.flip = 0;
        break;
      case 'jump':
        if (e.swing) {
          // let go of a swing: thrown up and forward
          this.fovKick = Math.max(this.fovKick, 5);
          this.dipY.kick(1.0 * m);
          this.nod.kick(-0.3 * m);
          break;
        }
        // push-off: legs load (a quick compress) and the head lifts as they extend
        this.dipY.kick(-0.45 * m);
        this.nod.kick(-0.14 * m);
        break;
      case 'tuck':
        // coil: knees come up to the chest, the view tips down over them
        this.nod.kick(0.3 * m);
        this.dipY.kick(0.5 * m);
        break;
      case 'hookfire':
        this.sway.kick(-0.25 * m);
        this.lat.kick(-0.15 * m);
        break;
      case 'hookattach':
        this.nod.kick(-0.15 * m);
        break;
      case 'ropesnap':
        // the line takes the weight: a heavy tug down, then the swing throws the head forward
        this.dipY.kick(-2.4 * e.k * m);
        this.nod.kick(0.45 * e.k * m);
        this.fovKick = Math.max(this.fovKick, 6 * e.k);
        this.shake = Math.max(this.shake, 0.3 * e.k);
        break;
      case 'hookrelease':
        if (e.swung) this.fovKick = Math.max(this.fovKick, 3);
        break;
      case 'walljump': {
        // roll hard away from the wall we kicked off, head thrown out with it
        this.fovKick = Math.max(this.fovKick, e.kick ? 7 : 5);
        this.dipY.kick(0.6 * m);
        this.nod.kick(-0.35 * m);
        const side = this.sideOf(e.nx ?? 0, e.nz ?? 0);
        this.sway.kick(side * 1.5 * m);
        this.lat.kick(side * 0.9 * m);
        break;
      }
      case 'slide':
        this.fovKick = Math.max(this.fovKick, 4);
        this.nod.kick(0.12 * m);
        break;
      case 'vault':
        this.nod.kick(0.7 * m);
        this.dipY.kick(-0.9 * m);
        this.sway.kick((this.vaultSide = -(this.vaultSide || 1)) * 1.1 * m);
        this.fovKick = Math.max(this.fovKick, 3);
        break;
      case 'mantle':
        this.nod.kick(0.5 * m);
        this.dipY.kick(-0.8 * m);
        break;
      case 'bonk':
        this.nod.kick(-1.1 * m);
        this.sway.kick((Math.random() - 0.5) * 1.2 * m);
        this.shake = 0.7;
        break;
      case 'wallrun': {
        // camera impact on the wall: the head knocks toward it, then leans out
        const side = this.sideOf(e.nx ?? 0, e.nz ?? 0);
        this.dipY.kick(-0.6 * m);
        this.sway.kick(-side * 0.7 * m);
        this.lat.kick(-side * 0.45 * m);
        break;
      }
      case 'climb':
        this.nod.kick(-0.5 * m);
        this.dipY.kick(0.4 * m);
        break;

      case 'fall':
        this.reset();
        break;
    }
  }

  /** +1 if a wall normal (nx, nz) points to our right (the wall is on our left), −1 otherwise */
  sideOf(nx, nz) {
    const rx = Math.cos(this.yawNow ?? 0);
    const rz = -Math.sin(this.yawNow ?? 0);
    const d = nx * rx + nz * rz;
    return Math.abs(d) < 0.2 ? 0 : Math.sign(d);
  }

  /**
   * r: racer (simulation state), pos: interpolated feet position, look: {yaw, pitch}
   * Returns footstep info for audio.
   */
  update(dt, r, pos, look) {
    const cam = this.camera;
    const m = this.calm ? 0.45 : 1;
    this.yawNow = look.yaw;
    const sp = r.speed;
    const speedF = THREE.MathUtils.clamp((sp - 3) / 7, 0, 1);
    this.out.footstep = false;

    // ---- eye height
    let eyeT = EYE_H;
    if (r.mode === 'slide') eyeT = SLIDE_EYE_H;
    if (r.mode === 'roll') eyeT = 0.9;
    if (r.stunT > 0) eyeT = EYE_H - 0.35;
    if (r.mode === 'air' && r.tuckT > 0) eyeT = EYE_H + 0.12;
    let mk = 0;
    if (r.mode === 'mantle' && r.mantle) {
      // mantle arc: head ducks low over the lip, then rises as the legs come through
      mk = Math.min(1, r.mantle.t / r.mantle.dur);
      eyeT = EYE_H - (r.mantle.kind === 'vault' ? 0.45 : 0.6) * Math.sin(mk * Math.PI);
    }
    this.eye = damp(this.eye, eyeT, r.mode === 'slide' || r.mode === 'mantle' ? 18 : 10, dt);

    // ---- head bob (only while feet are on something)
    const onFeet = r.grounded && (r.mode === 'ground' || r.mode === 'roll');
    const onWall = r.mode === 'wall';
    let bobAmt = 0;
    if ((onFeet || onWall) && sp > 0.5) {
      // cadence, not fixed stride: a runner lengthens the step as they speed up, so footfalls
      // go from ~2.2/s at a jog to ~3.3/s flat out (≈200 per minute), wallrun a touch quicker
      const cadence = onWall ? Math.min(3.8, 2.6 + sp * 0.12) : Math.min(3.4, 1.6 + sp * 0.18);
      this.phase += cadence * Math.PI * dt;      // one footfall per π
      bobAmt = Math.min(1, sp / 9);
    }
    const stepPhase = Math.floor(this.phase / Math.PI);
    if (stepPhase !== this.lastStep && bobAmt > 0) {
      this.lastStep = stepPhase;
      this.out.footstep = true;
      this.out.foot = stepPhase % 2 ? 1 : -1;
      this.dipY.kick(-0.22 * bobAmt * m);
    }
    const target = bobAmt * m;
    this.bobAmtS = damp(this.bobAmtS ?? 0, target, 8, dt);
    const ba = this.bobAmtS;
    this.bobY = -Math.abs(Math.sin(this.phase)) * 0.055 * ba + 0.03 * ba;
    this.bobX = Math.sin(this.phase * 0.5) * 0.035 * ba * (onWall ? 0.3 : 1);
    this.bobRoll = Math.sin(this.phase * 0.5) * 0.008 * ba;

    // climb: hand-over-hand rhythm — heave up, slight roll from arm to arm
    let climbRoll = 0;
    if (r.mode === 'climb') {
      this.climbPhase += dt * 13;
      this.bobY += (Math.abs(Math.sin(this.climbPhase)) - 0.5) * 0.08 * m;
      climbRoll = Math.sin(this.climbPhase * 0.5) * 0.035 * m;
    }
    // slide: grinding micro-vibration
    this.slideShake = damp(this.slideShake, r.mode === 'slide' ? Math.min(1, sp / 10) : 0, 12, dt);

    // ---- tilt (roll)
    const fx = -Math.sin(look.yaw);
    const fz = -Math.cos(look.yaw);
    const rx = Math.cos(look.yaw);
    const rz = -Math.sin(look.yaw);
    let tiltT = 0;
    if (r.mode === 'wall' && r.wall) {
      // wall on our right (normal pointing left) → lean left, and vice versa
      const nX = r.wall.axis === 'x' ? r.wall.n : 0;
      const nZ = r.wall.axis === 'z' ? r.wall.n : 0;
      const sideDot = nX * rx + nZ * rz;   // +1: normal points right → wall is on the left
      tiltT = -sideDot * 0.21;             // +roll leans left: always lean away from the wall
      this.wallLean = -sideDot;
    } else if (r.mode === 'air' && r.swinging && r.hook) {
      // swinging: bank with the arc, away from the side the line pulls
      const hx = r.hook.a.x - r.x;
      const hz = r.hook.a.z - r.z;
      // a pivot whip leans hard into the post, like taking a corner on a bike
      tiltT = r.hook.pivot
        ? THREE.MathUtils.clamp(-(hx * rx + hz * rz) * 0.09, -0.24, 0.24)
        : THREE.MathUtils.clamp(-(hx * rx + hz * rz) * 0.03, -0.12, 0.12);
    } else if (r.mode === 'air') {
      // anticipation: lean before contact when flying close along a wall
      const lean = this.anticipateWall(r, rx, rz);
      tiltT = lean * 0.12;
    } else if (r.mode === 'slide') {
      tiltT = 0.1;
    } else if (r.mode === 'mantle' && r.mantle) {
      tiltT = Math.sin(mk * Math.PI) * 0.07 * (this.vaultSide || 1);
    }
    if (r.mode !== 'wall') this.wallLean = damp(this.wallLean ?? 0, 0, 6, dt);
    // turn-rate roll (bank into turns) + strafe roll
    if (this.yawPrev !== null) {
      let dy = look.yaw - this.yawPrev;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.turnRate = damp(this.turnRate, dy / Math.max(dt, 1e-4), 10, dt);
    }
    this.yawPrev = look.yaw;
    const lateral = (r.vx * rx + r.vz * rz);
    tiltT += THREE.MathUtils.clamp(this.turnRate * 0.012 * speedF, -0.05, 0.05);   // bank into turns
    tiltT += THREE.MathUtils.clamp(-lateral * 0.008, -0.04, 0.04);
    tiltT += climbRoll;
    // engage fast, release slower: the lean reads at once and settles without a snap
    const engaging = Math.abs(tiltT * m) > Math.abs(this.tilt);
    this.tilt = damp(this.tilt, tiltT * m, engaging ? (r.mode === 'wall' ? 14 : 10) : 6, dt);

    // ---- springs
    const dipY = this.dipY.update(dt);
    const nod = this.nod.update(dt);
    const sway = this.sway.update(dt);
    const lat = this.lat.update(dt);

    // momentum: braking / accelerating tips the head (eased, never fights the mouse much)
    if (this.prevV) {
      const ax = (r.vx - this.prevV.x) / Math.max(dt, 1e-3);
      const az = (r.vz - this.prevV.z) / Math.max(dt, 1e-3);
      const fwdA = ax * fx + az * fz;
      this.accLean = damp(this.accLean, THREE.MathUtils.clamp(fwdA * 0.004, -0.05, 0.05), 6, dt);
    }
    this.prevV = { x: r.vx, z: r.vz };

    // ---- roll somersault
    let flipPitch = 0;
    let flipDrop = 0;
    if (this.flip >= 0) {
      this.flip += dt / 0.52;
      if (this.flip >= 1) this.flip = -1;
      else {
        const e = this.flip < 0.5 ? 2 * this.flip * this.flip : 1 - Math.pow(-2 * this.flip + 2, 2) / 2;
        flipPitch = e * TAU;
        flipDrop = Math.sin(this.flip * Math.PI) * 0.45;
      }
    }

    // ---- shake
    this.shake *= Math.exp(-dt * 6);
    const hiSpeed = THREE.MathUtils.clamp((sp - 9.5) / 3, 0, 1) * 0.25 * m;
    const sh = (this.shake + hiSpeed * 0.15 + this.slideShake * 0.12) * m;
    const t = performance.now() * 0.001;
    const shX = sh * (Math.sin(t * 61.3) * 0.5 + Math.sin(t * 37.1) * 0.5) * 0.03;
    const shY = sh * (Math.sin(t * 53.7) * 0.5 + Math.sin(t * 29.3) * 0.5) * 0.03;

    // ---- compose
    // pitch offsets: look up the wall while climbing, look down over the lip while mantling,
    // a touch down while falling fast, up at the start of a slide
    let pT = 0;
    // (+ = look up)
    if (r.mode === 'climb') pT = 0.2;
    else if (r.mode === 'mantle') pT = -Math.sin(mk * Math.PI) * 0.22;
    else if (r.mode === 'air' && r.tuckT > 0) pT = -0.12;    // coil: looking over the knees
    else if (r.mode === 'air' && r.swinging) pT = THREE.MathUtils.clamp(r.vy * 0.008, -0.05, 0.07);
    // a long fall looks down for the landing spot (Mirror's Edge's landing read)
    else if (r.mode === 'air') pT = THREE.MathUtils.clamp(r.vy * 0.008, -0.11, 0.03);
    else if (r.mode === 'slide') pT = -0.11;   // glance down the slide: your legs come into view
    this.pitchOff = damp(this.pitchOff, pT * m, r.mode === 'mantle' ? 14 : 8, dt);
    // head offset away from a wall we run on
    const leanOut = (this.wallLean ?? 0) * 0.14 * m;
    const latOff = lat * 0.1 + leanOut;
    cam.position.set(
      pos.x + rx * (this.bobX + latOff) + shX,
      pos.y + this.eye + this.bobY + dipY * 0.1 - flipDrop + shY,
      pos.z + rz * (this.bobX + latOff),
    );
    const pitch = THREE.MathUtils.clamp(look.pitch + this.pitchOff - nod * 0.1 + this.accLean * m, -1.55, 1.55) - flipPitch;
    // stride: the shoulders turn the head a hair each step (yaw), never enough to fight aim
    const strideYaw = Math.sin(this.phase * 0.5) * 0.006 * ba;
    cam.rotation.set(pitch, look.yaw + strideYaw, this.tilt + this.bobRoll + sway * 0.1, 'YXZ');

    // ---- FOV
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    // swinging: the full 3D speed drives the FOV (the drop through the arc is the rush)
    const sp3 = r.swinging ? Math.hypot(sp, r.vy) : sp;
    const speedF3 = THREE.MathUtils.clamp((sp3 - 3) / 7, 0, 1);
    const fovT = 70 + speedF3 * 12 + (r.mode === 'slide' ? 4 : 0) + Math.min(6, Math.max(0, sp3 - 10) * 1.5);
    this.fov = damp(this.fov, fovT + this.fovKick, 5, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    // forward unit vector for consumers
    this.fwd = { x: fx, z: fz };
    return this.out;
  }

  /** −1..1 lean toward a nearby wall while airborne (Titanfall-style anticipation). */
  anticipateWall(r, rx, rz) {
    if (r.speed < 5) return 0;
    const w = r.world;
    if (!w) return 0;
    for (const side of [-1, 1]) {
      const px = r.x + rx * side * 1.2;
      const pz = r.z + rz * side * 1.2;
      for (const o of r.track.solids) {
        if (o.kind !== 'wall' && o.kind !== 'pillar' && o.kind !== 'block') continue;
        if (px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1 && r.y + 1 > o.y0 && r.y + 1 < o.y1) return side;
      }
    }
    return 0;
  }
}
