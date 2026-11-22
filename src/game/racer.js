import { moveMovers } from './kit.js';
import { query, rampHeight } from './world.js';
import {
  BASE_STATS, BODY_R as R, STAND_H, SLIDE_H, STEP_H,
} from './constants.js';

const EPS = 1e-3;
const IDLE = { fwd: 0, side: 0, yaw: 0, jump: false, jumpHeld: false, slide: false, slideHeld: false, grapple: false, grappleHeld: false };

/**
 * First-person parkour body. Pure kinematics, no rendering.
 * The player and the rival bot both drive this exact class, so the race is fair:
 * the only difference is where the input comes from.
 *
 * input: { fwd, side (-1..1), yaw (absolute, rad; 0 looks down -z), jump, jumpHeld, slide, slideHeld, grapple, grappleHeld }
 * modes: ground · slide · roll · air · wall · climb · mantle   (+ hook: a grapple line, swinging while taut in the air)
 */
export class Racer {
  constructor(track, stats = {}, id = 'racer', spawn = track.spawn) {
    this.track = track;
    this.world = track.world;
    this.id = id;
    this.spawn = spawn;
    this.stats = { ...BASE_STATS, ...stats };
    this.events = [];
    this._near = [];
    this._tmp = [];
    this.reset();
  }

  /**
   * Standing on a mover: get carried by however far it moved since our last tick.
   * Horizontal carry goes through normal collision; vertical motion is picked up by the
   * ground snap in moveV (movers rise/fall far less than STEP_H per tick).
   */
  ride() {
    const G = this.grounded && this.mode !== 'mantle' ? this.ground : null;
    if (G && G.mover && this.carryO === G) {
      const dx = G.x0 - this.carryX;
      const dz = G.z0 - this.carryZ;
      if (dx) this.moveH('x', dx);
      if (dz) this.moveH('z', dz);
    }
    this.carryO = G && G.mover ? G : null;
    if (this.carryO) { this.carryX = G.x0; this.carryZ = G.z0; }
  }

  reset() {
    this.world.moverT = -1;
    this.carryO = null;
    const sp = this.spawn;
    Object.assign(this, {
      x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw,
      vx: 0, vy: 0, vz: 0,
      grounded: true, mode: 'ground',
      gsx: 0, gsz: 0,
      slideT: 0, rollT: 0, stunT: 0, respawnT: 0,
      coyoteT: 0, jumpBufT: 0, slideBufT: 0, rollBufT: 0, slideBoostCD: 0,
      wallT: 0, wallCD: 0, wall: null, lastWall: null,
      climbT: 0, climbUsed: false, climb: null, kicks: 0,
      mantle: null,
      slidUnder: false,
      airT: 0, peakY: sp.y, lastGroundY: sp.y, lastSafeS: 0,
      flow: 0, s: 0, pi: 0, pathDist: 0,
      finished: false, finishTime: 0, time: 0,
      falls: 0, stumbles: 0, cleans: 0,
      wishX: 0, wishZ: 0,
      hook: null, swinging: false, swingT: 0, tuckT: 0, grappleBufT: 0, lastAnchor: null, lastAnchorT: 0,
    });
    this.updateProgress();
  }

  /** Begin from a mid-course checkpoint (editor playtest): progress resumes from there. */
  startFrom(cp) {
    this.pi = cp.pi;
    this.lastSafeS = cp.s;
    this.updateProgress();
  }

  get height() {
    return this.mode === 'slide' ? SLIDE_H : STAND_H;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get topSpeed() {
    return this.stats.maxSpeed * (1 + this.stats.flowBonus * this.flow);
  }

  /** HUD label */
  get state() {
    if (this.respawnT > 0) return 'RESYNC';
    if (this.finished) return 'CORE';
    if (this.stunT > 0) return 'IMPACT';
    if (this.swinging) return this.hook?.pivot ? 'WHIP' : 'SWING';
    switch (this.mode) {
      case 'wall': return 'WALL';
      case 'climb': return 'CLIMB';
      case 'mantle': return this.mantle?.kind === 'vault' ? 'VAULT' : 'CLIMB';
      case 'slide': return 'SLIDE';
      case 'roll': return 'ROLL';
      case 'air': return 'AIR';
      default: return 'RUN';
    }
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  clean(label, mul = 1) {
    this.flow = Math.min(1, this.flow + this.stats.flowGain * mul);
    this.cleans++;
    this.emit('clean', { label });
  }

  dirty() {
    this.flow = 0;
  }

  // ------------------------------------------------------------------ main step
  step(dt, inp) {
    const st = this.stats;
    if (!this.finished) this.time += dt;
    // moving parts follow race time (shared by every racer: the first to reach a time moves them)
    moveMovers(this.world, this.time);
    this.ride();
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      return;
    }
    if (this.finished) inp = { ...IDLE, yaw: inp.yaw };
    this.yaw = inp.yaw;

    // timers & buffers
    this.jumpBufT = inp.jump ? st.jumpBuffer : Math.max(0, this.jumpBufT - dt);
    this.slideBufT = inp.slide ? 0.15 : Math.max(0, this.slideBufT - dt);
    this.rollBufT = inp.slide && !this.grounded ? st.rollWindow : Math.max(0, this.rollBufT - dt);
    this.coyoteT = this.grounded ? st.coyote : Math.max(0, this.coyoteT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.wallCD = Math.max(0, this.wallCD - dt);
    this.slideBoostCD = Math.max(0, this.slideBoostCD - dt);
    this.tuckT = this.grounded ? 0 : Math.max(0, this.tuckT - dt);

    // wish direction from look yaw
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wx = fx * inp.fwd + rx * inp.side;
    let wz = fz * inp.fwd + rz * inp.side;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    this.wishX = wx;
    this.wishZ = wz;
    this.side = inp.side;

    this.stepHook(dt, inp, fx, fz);

    if (this.mode === 'mantle') {
      this.stepMantle(dt);
      this.updateProgress();
      return;
    }

    if (this.mode === 'climb') this.stepClimb(dt, inp, fx, fz);
    else if (this.mode === 'wall') this.stepWall(dt, inp, fx, fz, wx, wz);
    else if (this.grounded) this.stepGround(dt, inp, wx, wz, Math.min(1, wl));
    else this.stepAir(dt, wx, wz, wl);
    if (this.mode === 'mantle') { this.updateProgress(); return; }

    // ground jump
    if (this.jumpBufT > 0 && (this.grounded || this.coyoteT > 0) && this.stunT <= 0
      && (this.mode === 'ground' || this.mode === 'slide' || this.mode === 'roll' || this.mode === 'air')
      && (this.mode !== 'slide' || this.headroom(STAND_H))) {
      // on a taut-able line a jump is a hop into the swing: a full jump would only add slack
      this.vy = this.hook?.att && !this.hook.pivot ? st.jumpV * 0.45 : st.jumpV;
      this.grounded = false;
      this.mode = 'air';
      this.coyoteT = 0;
      this.jumpBufT = 0;
      this.climbUsed = false;
      this.peakY = this.y;
      this.emit('jump');
    }

    // UT-style wall kick: jump while airborne next to any wall
    if (this.jumpBufT > 0 && this.mode === 'air' && !this.grounded && this.stunT <= 0 && this.kicks < st.maxKicks) {
      const k = this.findKickWall();
      if (k) this.wallKick(k, fx, fz, wx, wz);
    }

    // coil: slide pressed in the air while still rising (or near the apex) tucks the legs up
    if (inp.slide && this.mode === 'air' && !this.grounded && this.vy > -4 && this.tuckT <= 0) {
      this.tuckT = st.tuckTime;
      this.emit('tuck');
    }

    // re-pressing slide mid-slide keeps it going (e.g. a gate right after a rolled landing)
    if (this.slideBufT > 0 && this.mode === 'slide') {
      this.slideT = Math.max(this.slideT, st.slideTime * 0.7);
      this.slideBufT = 0;
    }
    // slide start
    if (this.slideBufT > 0 && this.grounded && (this.mode === 'ground' || this.mode === 'roll') && this.stunT <= 0 && this.speed > 5) {
      this.mode = 'slide';
      this.slideT = st.slideTime;
      this.slideBufT = 0;
      this.slidUnder = false;
      if (this.slideBoostCD <= 0) {
        const sp = this.speed;
        const k = (sp + 1.1) / sp;
        this.vx *= k; this.vz *= k;
        this.slideBoostCD = 1.4;
      }
      this.emit('slide');
    }

    // gravity
    if (this.mode === 'wall') {
      this.vy -= st.gravity * st.wallrunGravity * (0.45 + 1.3 * this.wallT / st.wallrunTime) * dt;
    } else if (this.mode !== 'climb') {
      this.vy -= st.gravity * dt;
    }

    this.ropeConstraint(dt);

    // ---- integrate with collision
    const vxB = this.vx;
    const vzB = this.vz;
    const spB = Math.hypot(vxB, vzB);
    const vyB = this.vy;
    const wasG = this.grounded;
    const hx = this.moveH('x', this.vx * dt);
    const nxHit = this.hitN;
    const hz = this.moveH('z', this.vz * dt);
    const nzHit = this.hitN;
    this.moveV(this.vy * dt, wasG);

    // ---- wall contacts: vault / mantle / climb / bonk
    if (this.mode !== 'wall' && this.mode !== 'climb') {
      const hits = [];
      if (hx) hits.push({ o: hx, axis: 'x', n: nxHit, into: Math.abs(vxB) });
      if (hz) hits.push({ o: hz, axis: 'z', n: nzHit, into: Math.abs(vzB) });
      hits.sort((a, b) => b.into - a.into);
      const h = hits[0];
      if (h && spB > 0.05) this.onWallHit(h, inp, vxB, vzB, spB);
    }
    if (this.mode === 'mantle') { this.updateProgress(); return; }

    // ---- landing
    if (!wasG && this.grounded) this.onLand(-vyB, inp);

    if (this.grounded && this.mode === 'air') this.mode = 'ground';
    if (!this.grounded && (this.mode === 'ground' || this.mode === 'slide' || this.mode === 'roll')) {
      this.mode = 'air';
      this.peakY = this.y;
    }

    // ---- wallrun catch
    if (this.mode === 'air' && this.wallCD <= 0 && !this.finished && inp.fwd > 0.2) this.tryWallrun(wx, wz);
    if (this.mode === 'wall' && !this.grounded) {
      if (!this.probeWall(this.wall)) this.leaveWall(0);
    }
    if (this.mode === 'wall' && this.grounded) { this.wall = null; this.mode = 'ground'; }

    // ---- bookkeeping
    if (this.grounded) {
      this.climbUsed = false;
      this.kicks = 0;
      this.lastWall = null;
      this.airT = 0;
      this.lastGroundY = this.y;
      this.peakY = this.y;
    } else {
      this.airT += dt;
      this.peakY = Math.max(this.peakY, this.y);
    }
    if (this.mode === 'slide' && !this.slidUnder && !this.headroom(STAND_H)) {
      this.slidUnder = true;
      this.clean('SLIDE.UNDER');
    }

    this.updateProgress();
    if (this.grounded && this.pathDist < 6) this.lastSafeS = Math.max(this.lastSafeS, this.s);

    if (this.y < this.lastGroundY - 22 || this.y < this.track.minY) this.respawn();

    const gate = this.track.finishGate;
    const atFinishHeight = !gate || Math.abs(this.y - gate.y) < 2.5;
    if (!this.finished && this.s >= this.track.finishS && this.pathDist < 8 && atFinishHeight) {
      this.finished = true;
      this.finishTime = this.time;
      this.emit('finish', { time: this.time });
    }
  }

  // ------------------------------------------------------------------ locomotion modes
  stepGround(dt, inp, wx, wz, wl) {
    const st = this.stats;
    let sp = this.speed;
    let dx, dz;
    if (sp > 0.3) { dx = this.vx / sp; dz = this.vz / sp; } else if (wl > 0.1) { dx = wx / wl; dz = wz / wl; } else { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); }
    // acceleration from the ground slope along the travel direction (+ = downhill)
    const slopeA = -(this.gsx * dx + this.gsz * dz) * st.gravity;

    if (this.mode === 'slide') {
      if (wl > 0.1) [dx, dz] = turnToward(dx, dz, wx / wl, wz / wl, 2.4 * dt);
      sp += (slopeA * 0.85 - (slopeA > 0.5 ? 0 : st.slideFriction)) * dt;
      this.slideT -= dt;
      const downhill = slopeA > 1;
      if (((this.slideT <= 0 && !(downhill && inp.slideHeld)) || sp < 3.5) && this.headroom(STAND_H)) this.mode = 'ground';
    } else {
      if (this.mode === 'roll') {
        this.rollT -= dt;
        if (this.rollT <= 0) this.mode = 'ground';
      }
      if (this.stunT > 0) {
        sp = Math.max(0, sp - 16 * dt);
      } else if (wl > 0.1) {
        const tx = wx / wl;
        const tz = wz / wl;
        if (dx * tx + dz * tz < -0.35 && sp > 2) {
          sp = Math.max(0, sp - 32 * dt); // reversing: brake first
        } else {
          [dx, dz] = turnToward(dx, dz, tx, tz, st.turnRate * dt);
          const want = this.topSpeed * wl + Math.max(0, slopeA) * 0.25;
          if (sp < want) sp = Math.min(want, sp + (st.accel * (1 + 1.6 * (1 - sp / want)) + Math.max(0, slopeA) * 0.4) * dt);
          else sp = Math.max(want, sp - 3.2 * dt); // overspeed bleeds off slowly: momentum is kept
        }
      } else {
        sp = Math.max(0, sp - 30 * dt);
      }
    }
    this.vx = dx * sp;
    this.vz = dz * sp;
  }

  stepAir(dt, wx, wz, wl) {
    if (wl < 0.1) return;
    const sp0 = this.speed;
    this.vx += wx * this.stats.airControl * dt;
    this.vz += wz * this.stats.airControl * dt;
    const sp1 = this.speed;
    const cap = Math.max(sp0, 4.5);
    if (sp1 > cap) { this.vx *= cap / sp1; this.vz *= cap / sp1; }
  }


  // ------------------------------------------------------------------ coil
  /** feet lift while tucked (coil): only in the air */
  get tuck() {
    return !this.grounded && this.tuckT > 0 ? this.stats.tuckLift : 0;
  }

  // ------------------------------------------------------------------ grapple
  /** Best anchor to fire at: in range, above the chest, inside the view cone (smallest angle wins). */
  grappleTarget() {
    const st = this.stats;
    const A = this.track.anchors;
    if (!A?.length) return null;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const cy = this.y + st.hookChest;
    const cosC = Math.cos(st.hookCone);
    let best = null;
    let bestK = Infinity;
    const cosP = Math.cos(st.pivotCone);
    for (const a of A) {
      // the post you just let go of can't be re-grabbed straight away (chained whips go to the next)
      if (a === this.lastAnchor && this.lastAnchorT > 0) continue;
      const dx = a.x - this.x;
      const dz = a.z - this.z;
      const dy = a.y - cy;
      const hd = Math.hypot(dx, dz);
      const d = Math.hypot(hd, dy);
      const piv = a.kind === 'pivot';
      // pivot posts sit beside the line at about head height: wide cone, short range
      if (piv ? d > st.pivotRange || dy < -1.5 || hd < 1 : d > st.hookRange || dy < 1.5 || hd < 0.5) continue;
      const c = (dx * fx + dz * fz) / hd;
      if (c < (piv ? cosP : cosC)) continue;
      // swing nodes: the one you look at; pivot posts sit off to the side: the nearest one
      const k = piv ? d * 0.25 + (1 - c) * 6 : (1 - c) * 40 + d * 0.05;
      if (k < bestK) { bestK = k; best = a; }
    }
    return best;
  }

  stepHook(dt, inp, fx, fz) {
    const st = this.stats;
    if (this.lastAnchorT > 0) this.lastAnchorT -= dt;
    // a press is buffered while held: clicking a beat early (before the next post swings into
    // view, or right as you let go of the last one) fires the moment a target is valid
    if (inp.grapple) this.grappleBufT = st.grappleBuffer;
    else if (!inp.grappleHeld) this.grappleBufT = 0;
    else if (this.grappleBufT > 0) this.grappleBufT -= dt;
    if (this.grappleBufT > 0 && !this.hook && this.stunT <= 0 && this.mode !== 'mantle' && !this.finished) {
      const a = this.grappleTarget();
      if (a) {
        const piv = a.kind === 'pivot';
        const d = Math.hypot(a.x - this.x, a.y - this.y - st.hookChest, a.z - this.z);
        const t = d / (piv ? st.pivotHookSpeed : st.hookSpeed);
        this.hook = { a, t, dur: t, L: Infinity, att: false, pivot: piv, turn: 0 };
        this.grappleBufT = 0;
        this.emit('hookfire', { x: a.x, y: a.y, z: a.z });
      } else if (inp.grapple) this.emit('hookmiss');
    }
    const h = this.hook;
    if (!h) { this.swinging = false; return; }
    if (!inp.grappleHeld || this.finished || this.mode === 'climb' || this.mode === 'wall') { this.releaseHook(true); return; }
    if (!h.att) {
      h.t -= dt;
      if (h.t <= 0) {
        h.att = true;
        h.L = this.ropeDist();
        this.emit('hookattach', { x: h.a.x, y: h.a.y, z: h.a.z, pivot: h.pivot });
      }
      return;
    }
    // jump out of a swing: let go with a kick up (keeps the swing's speed)
    if (this.swinging && this.jumpBufT > 0) {
      this.vy = Math.max(this.vy, 0) + st.swingJumpV;
      this.jumpBufT = 0;
      this.peakY = this.y;
      this.releaseHook(true);
      this.emit('jump', { swing: true });
      return;
    }
    const away = (this.x - h.a.x) * this.vx + (this.z - h.a.z) * this.vz > 0;
    if (h.pivot) {
      // a pivot whips you round once: past a U-turn (or touching down) it lets go by itself
      if (h.turn > st.pivotMaxTurn || (this.grounded && h.turn > 0.2)) this.releaseHook(true);
      return;
    }
    // over the top of the anchor, or landed and running away from it: the line lets go
    const ry = this.y + st.hookChest - h.a.y;
    if (ry > -0.4 || (this.grounded && away && this.ropeDist() > h.L - 0.05)) this.releaseHook(true);
  }

  ropeDist() {
    const a = this.hook.a;
    if (this.hook.pivot) return Math.hypot(this.x - a.x, this.z - a.z);
    return Math.hypot(this.x - a.x, this.y + this.stats.hookChest - a.y, this.z - a.z);
  }

  /**
   * Inextensible line, reeled in while running (L = shortest distance seen on the ground) and
   * fixed once airborne; a hook that lands mid-air sets L where it lands. While taut in the air: strip the outward radial velocity (pendulum) and
   * nudge back onto the sphere.
   */
  ropeConstraint(dt) {
    const h = this.hook;
    this.swinging = false;
    if (!h?.att) return;
    if (h.pivot) { this.pivotConstraint(dt); return; }
    const a = h.a;
    const dx = this.x - a.x;
    const dy = this.y + this.stats.hookChest - a.y;
    const dz = this.z - a.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    // reels in on the run-up only: the length is set at takeoff, so where you jump from shapes the arc
    if (this.grounded && d < h.L) h.L = Math.max(2, d);
    if (this.grounded || this.mode !== 'air' || d < h.L - 0.02) return;
    const nx = dx / d; const ny = dy / d; const nz = dz / d;
    const vr = this.vx * nx + this.vy * ny + this.vz * nz;
    if (vr > 0) {
      // the line snapping taut redirects most of the speed into the swing instead of eating it:
      // entry speed (run-up, a jump's fall) becomes swing energy
      let tx = this.vx - vr * nx;
      let ty = this.vy - vr * ny;
      let tz = this.vz - vr * nz;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 0.5) {
        // falling straight down the line: swing on in the direction we were travelling
        const hx = this.vx - (this.vx * nx + this.vz * nz) * nx;
        const hz = this.vz - (this.vx * nx + this.vz * nz) * nz;
        const hl = Math.hypot(hx, hz) || 1;
        tx = hx / hl; ty = 0; tz = hz / hl; tl = 1;
        tx -= nx * (tx * nx + tz * nz); tz -= nz * (tx * nx + tz * nz);
        tl = Math.hypot(tx, ty, tz) || 1;
      }
      const sp = Math.sqrt((this.vx * this.vx + this.vy * this.vy + this.vz * this.vz) - vr * vr * 0.3);
      this.vx = (tx / tl) * sp; this.vy = (ty / tl) * sp; this.vz = (tz / tl) * sp;
      if (vr > 4) this.emit('ropesnap', { k: Math.min(1, vr / 12) });
    }
    const over = d - h.L;
    if (over > 0) {
      const k = Math.min(over / dt, 6) * 0.5;
      this.vx -= nx * k; this.vy -= ny * k; this.vz -= nz * k;
    }
    this.swinging = true;
    this.swingT += dt;
  }

  /**
   * Horizontal grapple: the line to a pivot post is a tether in the ground plane. It reels in
   * while you close on the post (in the air too), so it goes taut at your closest pass and whips
   * you round on that radius at full speed: a sharp air turn. While it carries you the line also
   * holds most of your weight, so a turn keeps its height. Let go when you face the exit.
   */
  pivotConstraint(dt) {
    const st = this.stats;
    const h = this.hook;
    const a = h.a;
    const dx = this.x - a.x;
    const dz = this.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < h.L) h.L = Math.max(st.pivotMinR, d);
    if (this.grounded || this.mode !== 'air' || d < h.L - 0.02) return;
    const nx = dx / d;
    const nz = dz / d;
    const vr = this.vx * nx + this.vz * nz;
    // still closing on the post: keep reeling in, it goes taut at the closest pass
    if (!h.taut && vr <= 0) return;
    let sp = Math.hypot(this.vx, this.vz);
    if (vr > 0 || !h.taut) {
      // all the speed goes into the turn (plus a little whip), none of it is lost to the snap
      let tx = this.vx - vr * nx;
      let tz = this.vz - vr * nz;
      const tl = Math.hypot(tx, tz) || 1;
      if (!h.taut) {
        sp = Math.min(Math.max(sp, st.pivotMinSpeed) + st.pivotBoost, st.maxSpeed * 1.5);
        h.dir = Math.sign(nx * tz - nz * tx) || 1;   // orbit sense
        h.taut = true;
        // the line takes your weight level: a jump's rise is spent, a fall is caught
        this.vy = Math.max(-0.5, Math.min(this.vy, 1.5));
        this.emit('ropesnap', { k: 0.5, pivot: true });
      }
      tx /= tl; tz /= tl;
      this.vx = tx * sp; this.vz = tz * sp;
    }
    const over = d - h.L;
    if (over > 0) {
      const k = Math.min(over / dt, 6) * 0.5;
      this.vx -= nx * k; this.vz -= nz * k;
    }
    // the line takes the weight: cancel most of gravity and settle any fall
    this.vy += st.gravity * (1 - st.pivotGravity) * dt;
    if (this.vy < 0) this.vy *= Math.exp(-st.pivotDamp * dt);
    h.turn += (Math.hypot(this.vx, this.vz) / h.L) * dt;
    this.swinging = true;
    this.swingT += dt;
  }

  releaseHook(credit) {
    const h = this.hook;
    if (!h) return;
    this.hook = null;
    this.lastAnchor = h.a;
    this.lastAnchorT = 0.6;
    const swung = this.swinging || this.swingT > 0.3;
    this.swinging = false;
    this.emit('hookrelease', { swung });
    if (credit && swung && h.pivot && h.turn > 0.9) this.clean(h.turn > 2.4 ? 'U.TURN' : 'PIVOT');
    else if (credit && swung && this.swingT > 0.35) this.clean('SWING');
    this.swingT = 0;
  }

  // ------------------------------------------------------------------ wallrun
  tryWallrun(wx, wz) {
    const sp = this.speed;
    if (sp < 4 || this.vy < -9) return;
    const alongX = Math.abs(this.vx) > Math.abs(this.vz);
    for (const side of [-1, 1]) {
      const w = { axis: alongX ? 'z' : 'x', n: -side };
      const o = this.probeWall(w);
      if (!o || o === this.lastWall) continue;
      const perp = alongX ? this.vz : this.vx;
      if (perp * side < -3) continue;                // moving away from it
      const along = Math.abs(alongX ? this.vx : this.vz);
      if (along / sp < 0.62) continue;               // too head-on: that's a climb
      const nX = w.axis === 'x' ? w.n : 0;
      const nZ = w.axis === 'z' ? w.n : 0;
      if (wx * nX + wz * nZ > 0.8) continue;         // steering hard away (glancing looks still catch)
      const st = this.stats;
      w.o = o;
      w.dir = Math.sign(alongX ? this.vx : this.vz);
      w.speed = Math.min(Math.max(along + st.wallBoost, 7), this.topSpeed * 1.25);
      this.wall = w;
      this.wallT = 0;
      this.mode = 'wall';
      this.vy = this.vy > -3 ? Math.max(Math.min(this.vy, 4.5), st.wallrunLift) : st.wallrunLift * 0.55;
      if (alongX) { this.vz = 0; this.vx = w.dir * w.speed; } else { this.vx = 0; this.vz = w.dir * w.speed; }
      this.emit('wallrun', { nx: nX, nz: nZ });
      return;
    }
  }

  /** Returns the solid next to the racer on the given wall side, if it is tall enough to run on. */
  probeWall(w) {
    const side = -w.n;
    let x0 = this.x - R; let x1 = this.x + R; let z0 = this.z - R; let z1 = this.z + R;
    if (w.axis === 'z') { if (side > 0) { z0 = z1; z1 += 0.85; } else { z1 = z0; z0 -= 0.85; } }
    else if (side > 0) { x0 = x1; x1 += 0.85; } else { x1 = x0; x0 -= 0.85; }
    query(this.world, x0, z0, x1, z1, this._tmp);
    for (const o of this._tmp) {
      if (o.ramp || o.noWall) continue;
      if (o.y0 > this.y + 0.3 || o.y1 < this.y + 1.5) continue;
      return o;
    }
    return null;
  }

  stepWall(dt, inp, fx, fz, wx, wz) {
    const st = this.stats;
    const w = this.wall;
    this.wallT += dt;
    w.speed = w.speed < this.topSpeed ? w.speed + st.accel * 0.25 * dt : w.speed - 1.5 * dt;
    const nX = w.axis === 'x' ? w.n : 0;
    const nZ = w.axis === 'z' ? w.n : 0;
    // along-wall velocity, pressed lightly into the wall
    if (w.axis === 'z') { this.vx = w.dir * w.speed; this.vz = -nZ * 2.5; } else { this.vz = w.dir * w.speed; this.vx = -nX * 2.5; }

    if (this.jumpBufT > 0) {
      // wall jump: off the wall and forward; looking away from the wall aims the kick
      const sp = Math.max(w.speed, 8);
      const ax = w.axis === 'z' ? w.dir : 0;
      const az = w.axis === 'x' ? w.dir : 0;
      let hx = ax * sp * 0.9 + nX * st.wallJumpPush;
      let hz = az * sp * 0.9 + nZ * st.wallJumpPush;
      const m = Math.hypot(hx, hz);
      const look = fx * nX + fz * nZ;
      if (look > 0.1) {
        const k = Math.min(1, look * 1.8) * 0.75;
        hx += (fx * m - hx) * k;
        hz += (fz * m - hz) * k;
        const m2 = Math.hypot(hx, hz);
        hx *= m / m2; hz *= m / m2;
      }
      this.vx = hx;
      this.vz = hz;
      this.vy = st.jumpV * 0.98;
      this.jumpBufT = 0;
      this.lastWall = w.o;
      this.wall = null;
      this.mode = 'air';
      this.wallCD = 0.22;
      this.climbUsed = false;
      this.peakY = this.y;
      this.emit('walljump', { nx: nX, nz: nZ });
      this.clean('WALLJUMP');
      return;
    }
    // looking away from the wall is how you aim the wall jump, so only *strafing* away drops you
    const rx = -fz;
    const rz = fx;
    const strafeOff = (rx * nX + rz * nZ) * inp.side;
    if (this.wallT > st.wallrunTime || strafeOff > 0.5 || inp.fwd < -0.1) this.leaveWall(1.6);
  }

  leaveWall(push) {
    const w = this.wall;
    if (!w) return;
    if (w.axis === 'x') this.vx = w.n * push; else this.vz = w.n * push;
    this.lastWall = w.o;
    this.wall = null;
    this.mode = 'air';
    this.wallCD = 0.25;
    this.emit('walloff');
  }

  // ------------------------------------------------------------------ wall kick
  /** Nearest tall wall within kicking range on any of the 4 sides (null if none). */
  findKickWall() {
    const REACH = 0.5;
    query(this.world, this.x - R - REACH, this.z - R - REACH, this.x + R + REACH, this.z + R + REACH, this._tmp);
    let best = null;
    let bestD = REACH;
    for (const o of this._tmp) {
      if (o.ramp || o.noWall || o === this.lastWall) continue;
      if (o.y0 > this.y + 0.6 || o.y1 < this.y + 1.3) continue;
      const inX = this.x + R > o.x0 && this.x - R < o.x1;
      const inZ = this.z + R > o.z0 && this.z - R < o.z1;
      // gap to each face (only faces we are beside)
      if (inZ) {
        const dl = o.x0 - (this.x + R);
        if (dl >= -0.02 && dl < bestD) { bestD = dl; best = { o, axis: 'x', n: -1 }; }
        const dr = (this.x - R) - o.x1;
        if (dr >= -0.02 && dr < bestD) { bestD = dr; best = { o, axis: 'x', n: 1 }; }
      }
      if (inX) {
        const df = o.z0 - (this.z + R);
        if (df >= -0.02 && df < bestD) { bestD = df; best = { o, axis: 'z', n: -1 }; }
        const db = (this.z - R) - o.z1;
        if (db >= -0.02 && db < bestD) { bestD = db; best = { o, axis: 'z', n: 1 }; }
      }
    }
    return best;
  }

  wallKick(k, fx, fz) {
    const st = this.stats;
    const nX = k.axis === 'x' ? k.n : 0;
    const nZ = k.axis === 'z' ? k.n : 0;
    // keep most of the along-wall speed, add a push away from the wall
    const into = this.vx * nX + this.vz * nZ;
    let hx = (this.vx - into * nX) * 0.9 + nX * st.kickPush;
    let hz = (this.vz - into * nZ) * 0.9 + nZ * st.kickPush;
    const m = Math.max(Math.hypot(hx, hz), st.kickPush);
    // looking away from the wall aims the kick
    const look = fx * nX + fz * nZ;
    if (look > 0.05) {
      const kk = Math.min(1, look * 2) * 0.8;
      hx += (fx * m - hx) * kk;
      hz += (fz * m - hz) * kk;
      const m2 = Math.hypot(hx, hz) || 1;
      hx *= m / m2; hz *= m / m2;
    }
    this.vx = hx;
    this.vz = hz;
    this.vy = st.kickV;
    this.jumpBufT = 0;
    this.kicks++;
    this.lastWall = k.o;
    this.wallCD = 0.12;
    this.peakY = this.y;
    this.emit('walljump', { nx: nX, nz: nZ, kick: true });
    this.clean('WALL.KICK', 0.8);
  }

  // ------------------------------------------------------------------ climb / mantle / vault
  onWallHit(h, inp, vxB, vzB, spB) {
    const st = this.stats;
    const headOn = h.into / spB;
    // probe just past the face we hit
    const dirX = h.axis === 'x' ? -h.n : 0;
    const dirZ = h.axis === 'z' ? -h.n : 0;
    const px = this.x + dirX * (R + 0.3);
    const pz = this.z + dirZ * (R + 0.3);
    const top = this.columnTop(px, pz, h.o.y1);
    const dh = top - this.y;
    const clear = this.clearAt(this.x + dirX * (R + 0.36), this.z + dirZ * (R + 0.36), top);

    if (clear && headOn > 0.35) {
      if (this.grounded && dh <= 1.3 && h.into > 2.5) {
        this.startMantle('vault', dirX, dirZ, top, vxB, vzB, spB);
        return;
      }
      if (!this.grounded && dh > 0 && dh <= st.mantleReach && inp.fwd > 0.1) {
        this.startMantle('mantle', dirX, dirZ, top, vxB, vzB, spB);
        return;
      }
    }
    if (!this.grounded && !this.climbUsed && headOn > 0.7 && inp.fwd > 0.3 && this.vy > -5.5 && dh > st.mantleReach) {
      this.mode = 'climb';
      this.climb = { axis: h.axis, n: h.n, o: h.o };
      this.climbT = 0;
      this.climbUsed = true;
      this.vy = st.climbSpeed;
      this.emit('climb');
      return;
    }
    if (this.grounded && headOn > 0.8 && spB > 6.5 && this.stunT <= 0) {
      this.stunT = 0.3;
      this.stumbles++;
      this.dirty();
      this.emit('bonk', { speed: spB });
    }
  }

  stepClimb(dt, inp, fx, fz) {
    const st = this.stats;
    const c = this.climb;
    this.climbT += dt;
    const nX = c.axis === 'x' ? c.n : 0;
    const nZ = c.axis === 'z' ? c.n : 0;
    this.vy = st.climbSpeed * (1 - 0.55 * this.climbT / st.climbTime);
    this.vx = -nX * 1.5;
    this.vz = -nZ * 1.5;

    // jump while climbing: kick off the wall toward where we look (sideways / back);
    // looking straight into the wall pushes us back off it, UT style
    if (this.jumpBufT > 0) {
      const look = fx * nX + fz * nZ;
      if (look > -0.35) {
        this.vx = fx * 6.4 + nX * 1.6;
        this.vz = fz * 6.4 + nZ * 1.6;
      } else {
        this.vx = nX * st.kickPush;
        this.vz = nZ * st.kickPush;
      }
      this.vy = st.jumpV;
      this.kicks++;
      this.jumpBufT = 0;
      this.mode = 'air';
      this.lastWall = c.o;
      this.emit('walljump', { nx: nX, nz: nZ });
      this.clean('KICK.OFF');
      return;
    }
    const px = this.x - nX * (R + 0.3);
    const pz = this.z - nZ * (R + 0.3);
    const top = this.columnTop(px, pz, c.o.y1);
    const dh = top - this.y;
    if (dh <= st.mantleReach && this.clearAt(this.x - nX * (R + 0.36), this.z - nZ * (R + 0.36), top)) {
      this.startMantle('climb', -nX, -nZ, top, -nX * 4, -nZ * 4, 4);
      return;
    }
    if (this.climbT >= st.climbTime || inp.fwd < 0) {
      this.mode = 'air';
      this.vy = Math.min(this.vy, 0);
      this.vx = nX * 1.2;
      this.vz = nZ * 1.2;
      this.emit('climbfail');
    }
  }

  startMantle(kind, dirX, dirZ, top, vxB, vzB, spB) {
    // exit along the approach direction if it was roughly forward, else straight over the edge
    let ex = vxB / spB;
    let ez = vzB / spB;
    if (ex * dirX + ez * dirZ < 0.5) { ex = dirX; ez = dirZ; }
    const dh0 = top - this.y;
    // a low ledge taken at speed is a step-up (keeps the run); a high one is a real pull-up
    const exit = kind === 'vault' ? Math.max(6, spB * 0.92)
      : kind === 'mantle' ? Math.max(5.5, spB * (dh0 < 0.9 ? 0.9 : 0.78)) : 5.2;
    const dh = top - this.y;
    this.mantle = {
      kind,
      t: 0,
      dur: kind === 'vault' ? 0.17 : 0.2 + 0.07 * Math.max(0, dh),
      x0: this.x, y0: this.y, z0: this.z,
      x1: this.x + dirX * (R + 0.4), y1: top + 0.001, z1: this.z + dirZ * (R + 0.4),
      ex, ez, exit, dh,
    };
    this.mode = 'mantle';
    this.vy = 0;
    this.wall = null;
    this.releaseHook(false);
    this.emit(kind === 'vault' ? 'vault' : 'mantle', { dh });
  }

  stepMantle(dt) {
    const m = this.mantle;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const ky = 1 - (1 - k) * (1 - k);
    const kx = k * k;
    this.x = m.x0 + (m.x1 - m.x0) * kx;
    this.z = m.z0 + (m.z1 - m.z0) * kx;
    this.y = m.y0 + (m.y1 - m.y0) * ky;
    this.vx = m.ex * m.exit * 0.5;
    this.vz = m.ez * m.exit * 0.5;
    if (k >= 1) {
      this.mode = 'ground';
      this.grounded = true;
      this.vx = m.ex * m.exit;
      this.vz = m.ez * m.exit;
      this.vy = 0;
      this.lastGroundY = this.y;
      this.peakY = this.y;
      this.airT = 0;
      this.climbUsed = false;
      this.mantle = null;
      this.clean(m.kind === 'vault' ? 'VAULT' : m.kind === 'climb' ? 'CLIMB' : 'MANTLE', m.kind === 'vault' ? 0.5 : 1);
    }
  }

  /** Top of the stack of solids at (px, pz) starting from a known solid top. */
  columnTop(px, pz, start) {
    let top = start;
    for (let iter = 0; iter < 6; iter++) {
      query(this.world, px - 0.01, pz - 0.01, px + 0.01, pz + 0.01, this._tmp);
      let changed = false;
      for (const o of this._tmp) {
        if (o.ramp) continue;
        if (o.y0 <= top + 0.05 && o.y1 > top + 0.001) { top = o.y1; changed = true; }
      }
      if (!changed) break;
    }
    return top;
  }

  clearAt(px, pz, top) {
    query(this.world, px - R, pz - R, px + R, pz + R, this._tmp);
    for (const o of this._tmp) {
      if (o.ramp) continue;
      if (o.y0 < top + 1.1 && o.y1 > top + 0.05) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ landing
  onLand(impact, inp) {
    const st = this.stats;
    const air = this.airT;
    if (impact > 25.5) {
      this.respawn();
      return;
    }
    if (impact > st.hardLand) {
      if (this.rollBufT > 0 || inp.slideHeld) {
        this.mode = 'roll';
        this.rollT = 0.5;
        const sp = this.speed;
        if (sp > 0.5 && sp < 7.5) { this.vx *= 7.5 / sp; this.vz *= 7.5 / sp; }
        this.emit('roll', { impact });
        this.clean('ROLL');
        return;
      }
      this.vx *= st.hardLandKeep;
      this.vz *= st.hardLandKeep;
      this.stunT = st.stunTime;
      this.stumbles++;
      this.dirty();
      this.emit('hardland', { impact });
      return;
    }
    this.emit('land', { impact, air });
    if (air > 0.5) this.clean('GAP', 0.5);
  }

  // ------------------------------------------------------------------ collision
  overlapsXZ(o) {
    return this.x - R < o.x1 && this.x + R > o.x0 && this.z - R < o.z1 && this.z + R > o.z0;
  }

  headroom(H) {
    query(this.world, this.x - R, this.z - R, this.x + R, this.z + R, this._tmp);
    for (const o of this._tmp) {
      if (o.ramp) continue;
      if (this.y + EPS < o.y1 && this.y + H > o.y0 + EPS && o.y0 > this.y + STEP_H) return false;
    }
    return true;
  }

  moveH(axis, d) {
    this.hitN = 0;
    if (d === 0) return null;
    const yLo = this.y + (this.grounded ? STEP_H : 0.02 + this.tuck);
    const yHi = this.y + this.height - 0.02;
    const isX = axis === 'x';
    const p = isX ? this.x : this.z;
    const np = p + d;
    if (isX) query(this.world, Math.min(p, np) - R, this.z - R, Math.max(p, np) + R, this.z + R, this._near);
    else query(this.world, this.x - R, Math.min(p, np) - R, this.x + R, Math.max(p, np) + R, this._near);
    let lim = np;
    let hit = null;
    for (const o of this._near) {
      if (o.ramp) continue;
      if (o.y1 <= yLo || o.y0 >= yHi) continue;
      if (isX) { if (this.z + R <= o.z0 || this.z - R >= o.z1) continue; }
      else if (this.x + R <= o.x0 || this.x - R >= o.x1) continue;
      const lo = isX ? o.x0 : o.z0;
      const hi = isX ? o.x1 : o.z1;
      if (d > 0) {
        if (p + R <= lo + EPS && np + R > lo) { const c = lo - R - EPS; if (c < lim) { lim = c; hit = o; } }
      } else if (p - R >= hi - EPS && np - R < hi) { const c = hi + R + EPS; if (c > lim) { lim = c; hit = o; } }
    }
    if (isX) this.x = lim; else this.z = lim;
    if (hit) {
      this.hitN = -Math.sign(d);
      if (isX) this.vx = 0; else this.vz = 0;
    }
    return hit;
  }

  moveV(dy, wasG) {
    const H = this.height;
    let ny = this.y + dy;
    query(this.world, this.x - R, this.z - R, this.x + R, this.z + R, this._near);
    if (dy > 0) {
      for (const o of this._near) {
        if (o.ramp) continue;
        if (o.y0 >= this.y + H - EPS && o.y0 < ny + H) { ny = o.y0 - H; this.vy = 0; }
      }
      this.grounded = false;
      this.y = ny;
      return;
    }
    // airborne: a top up to the horizontal skin above the feet still counts as floor. moveH
    // ignores anything that low, so without this a body arriving 0-2 cm under a lip slides
    // into the slab sideways and falls through its corner.
    const limit = this.y + (wasG ? STEP_H : 0.025 + this.tuck);
    let best = -Infinity;
    let bestO = null;
    for (const o of this._near) {
      let top;
      if (o.ramp) {
        if (this.x < o.x0 || this.x > o.x1 || this.z < o.z0 || this.z > o.z1) continue;
        top = rampHeight(o, this.x, this.z);
      } else top = o.y1;
      // a mover may have risen a few mm past the feet since last tick: still ground
      if (top <= limit + (o.mover ? 0.06 : 0) && top > best) { best = top; bestO = o; }
    }
    const snap = wasG && this.mode !== 'air' ? 0.4 : 0;
    if (bestO && best >= ny - snap) {
      this.y = best;
      this.vy = 0;
      this.grounded = true;
      if (bestO.ramp) {
        const g = (bestO.h1 - bestO.h0) / (bestO.c1 - bestO.c0);
        this.gsx = bestO.axis === 'x' ? g : 0;
        this.gsz = bestO.axis === 'z' ? g : 0;
      } else { this.gsx = 0; this.gsz = 0; }
      this.ground = bestO;
    } else {
      this.grounded = false;
      this.y = ny;
    }
  }

  // ------------------------------------------------------------------ progress / respawn
  updateProgress() {
    const P = this.track.path;
    let best = Infinity;
    let bi = this.pi;
    let bt = 0;
    const i0 = Math.max(0, this.pi - 4);
    const i1 = Math.min(P.length - 2, this.pi + 12);
    for (let i = i0; i <= i1; i++) {
      const a = P[i];
      const b = P[i + 1];
      const ex = b.x - a.x; const ey = b.y - a.y; const ez = b.z - a.z;
      const L2 = ex * ex + ey * ey + ez * ez || 1;
      let t = ((this.x - a.x) * ex + (this.y - a.y) * ey + (this.z - a.z) * ez) / L2;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + ex * t - this.x;
      // Height matters as much as horizontal distance at an overpass.
      const dy = a.y + ey * t - this.y;
      const dz = a.z + ez * t - this.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    this.pi = bi;
    this.s = P[bi].s + bt * (P[bi + 1].s - P[bi].s);
    this.pathDist = Math.sqrt(best);
  }

  respawn() {
    const cps = this.track.checkpoints;
    let cp = cps[0];
    for (const c of cps) if (c.s <= this.lastSafeS + 0.5) cp = c;
    Object.assign(this, {
      x: cp.x, y: cp.y, z: cp.z, yaw: cp.yaw,
      vx: 0, vy: 0, vz: 0,
      grounded: true, mode: 'ground', wall: null, climb: null, mantle: null,
      respawnT: 0.9, lastGroundY: cp.y, peakY: cp.y, stunT: 0,
      pi: cp.pi, airT: 0, hook: null, swinging: false, tuckT: 0, grappleBufT: 0, lastAnchor: null, lastAnchorT: 0,
    });
    this.dirty();
    this.falls++;
    this.updateProgress();
    this.emit('fall', { yaw: cp.yaw });
  }
}

/** Rotate unit vector (dx,dz) toward unit (tx,tz) by at most maxA radians. */
function turnToward(dx, dz, tx, tz, maxA) {
  const cross = dx * tz - dz * tx;
  const dot = dx * tx + dz * tz;
  let a = Math.atan2(cross, dot);
  a = Math.max(-maxA, Math.min(maxA, a));
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}
