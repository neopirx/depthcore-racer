import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { singleBladeGeometry } from '../world/shards.js';

/**
 * Abstract geometric "hacker" — a body of chrome shards with a glowing core,
 * driven by procedural animation from the Racer state. Includes a ribbon light trail.
 */
export class Avatar {
  constructor(scene, color, envMap, { dark = false } = {}) {
    this.color = new THREE.Color(color);
    this.root = new THREE.Group();
    this.root.scale.setScalar(1.08);
    scene.add(this.root);

    const chrome = new THREE.MeshStandardMaterial({
      color: dark ? 0x1c1e24 : 0x5a6474, metalness: 1, roughness: 0.14, envMap, envMapIntensity: 1.3,
    });
    const glow = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(4) });
    this.glowMat = glow;

    const shard = (sx, sy, sz) => {
      const g = new THREE.OctahedronGeometry(0.5, 0);
      g.scale(sx, sy, sz);
      return g;
    };
    const limb = (len, w) => {
      const g = new THREE.OctahedronGeometry(0.5, 0);
      g.scale(w, len, w);
      g.translate(0, -len / 2, 0); // pivot at top
      return g;
    };

    // body hierarchy: hips -> torso -> head/arms ; hips -> legs
    this.body = new THREE.Group();          // whole-body lean/roll
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.hips.add(new THREE.Mesh(shard(0.42, 0.26, 0.3), chrome));

    this.torso = new THREE.Group();
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(shard(0.56, 0.78, 0.36), chrome);
    chest.position.y = 0.42;
    this.torso.add(chest);
    const coreGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), glow);
    coreGem.position.set(0, 0.48, -0.17);
    this.torso.add(coreGem);
    this.coreGem = coreGem;

    const head = new THREE.Mesh(shard(0.24, 0.34, 0.28), chrome);
    head.position.y = 0.98;
    this.torso.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), glow);
    visor.position.set(0, 1.0, -0.13);
    this.torso.add(visor);

    // back fins — chrome blades sweeping back (silhouette read at distance)
    const rng = makeRng(dark ? 3 : 7);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const fin = new THREE.Mesh(singleBladeGeometry(rng, {
          dir: new THREE.Vector3(sx * 0.35, 0.55 - i * 0.5, 1).normalize(),
          length: 0.9 - i * 0.25, width: 0.09, thickness: 0.015, bend: 0.25, bendAngle: sx > 0 ? 0 : Math.PI, twist: 0.6 * sx,
        }), chrome);
        fin.position.set(sx * 0.12, 0.62 - i * 0.12, 0.14);
        this.torso.add(fin);
      }
    }

    const makeArm = (sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.32, 0.72, 0);
      this.torso.add(sh);
      sh.add(new THREE.Mesh(limb(0.36, 0.13), chrome));
      const el = new THREE.Group();
      el.position.y = -0.36;
      sh.add(el);
      el.add(new THREE.Mesh(limb(0.36, 0.11), chrome));
      const hand = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), glow);
      hand.position.y = -0.38;
      el.add(hand);
      return { sh, el };
    };
    const makeLeg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.13, -0.05, 0);
      this.hips.add(hip);
      hip.add(new THREE.Mesh(limb(0.46, 0.17), chrome));
      const kn = new THREE.Group();
      kn.position.y = -0.46;
      hip.add(kn);
      kn.add(new THREE.Mesh(limb(0.46, 0.13), chrome));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.2), glow);
      foot.position.set(0, -0.46, -0.04);
      kn.add(foot);
      return { hip, kn };
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    this.light = new THREE.PointLight(this.color, 6, 7, 2);
    this.light.position.set(0, 1, 0);
    this.root.add(this.light);

    this.phase = 0;
    this.yaw = 0;
    this.lean = 0;
    this.roll = 0;
    this.slideAmt = 0;
    this.airAmt = 0;

    this.trail = new Trail(scene, this.color);
  }

  setVisible(v) {
    this.root.visible = v;
    this.trail.mesh.visible = v;
  }

  /** r: racer, pos: interpolated feet position */
  update(r, pos, dt, time) {
    const k = (rate) => 1 - Math.exp(-rate * dt);
    this.root.position.set(pos.x, pos.y, pos.z);
    const sp = r.speed;
    const faceT = sp > 1 ? Math.atan2(-r.vx, -r.vz) : r.yaw;
    let dyaw = faceT - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * k(12);
    this.root.rotation.y = this.yaw;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);

    const resync = r.respawnT > 0;
    this.root.visible = !resync || Math.floor(time * 20) % 2 === 0;

    const onWall = r.mode === 'wall';
    const climbing = r.mode === 'climb' || r.mode === 'mantle';
    const sliding = r.mode === 'slide' || r.mode === 'roll';
    this.phase += dt * (r.grounded || onWall ? sp * 0.62 : climbing ? 9 : 2);
    const p = this.phase;
    const run = Math.min(1, sp / 8);

    this.slideAmt += ((sliding ? 1 : 0) - this.slideAmt) * k(18);
    this.airAmt += ((!r.grounded && !onWall && !climbing ? 1 : 0) - this.airAmt) * k(10);
    let wallRoll = 0;
    if (onWall && r.wall) {
      const nX = r.wall.axis === 'x' ? r.wall.n : 0;
      const nZ = r.wall.axis === 'z' ? r.wall.n : 0;
      // right = (-fz, fx); wall on the right means the normal points left
      wallRoll = (nX * -fz + nZ * fx) > 0 ? 0.42 : -0.42;
    }
    const lateral = r.vx * -fz + r.vz * fx;
    const targetRoll = onWall ? wallRoll : -lateral * 0.03;
    this.roll += (targetRoll - this.roll) * k(10);
    const targetLean = r.stunT > 0 ? -0.6 : sliding ? 0.75 : climbing ? -0.35 : -0.22 * run;
    this.lean += (targetLean - this.lean) * k(12);

    this.body.rotation.set(this.lean, 0, this.roll);
    this.body.position.y = -this.slideAmt * 0.45 + Math.abs(Math.sin(p)) * 0.06 * run * (1 - this.airAmt);

    // run cycle
    const sw = Math.sin(p) * 0.95 * run;
    const kneeA = Math.max(0, Math.sin(p + 1.2)) * 1.3 * run + 0.15;
    const kneeB = Math.max(0, Math.sin(p + 1.2 + Math.PI)) * 1.3 * run + 0.15;
    // (rotation.x > 0 swings a limb forward; knees bend with negative x)
    let lHip = sw, rHip = -sw, lKn = -kneeA, rKn = -kneeB;
    // air tuck
    lHip = lerp(lHip, 1.0, this.airAmt);
    rHip = lerp(rHip, -0.3, this.airAmt);
    lKn = lerp(lKn, -1.5, this.airAmt);
    rKn = lerp(rKn, -0.7, this.airAmt);
    // slide: legs out forward
    lHip = lerp(lHip, 1.45, this.slideAmt);
    rHip = lerp(rHip, 1.2, this.slideAmt);
    lKn = lerp(lKn, -0.15, this.slideAmt);
    rKn = lerp(rKn, -0.9, this.slideAmt);

    this.legL.hip.rotation.x = lHip;
    this.legR.hip.rotation.x = rHip;
    this.legL.kn.rotation.x = lKn;
    this.legR.kn.rotation.x = rKn;

    const asw = Math.sin(p) * 0.9 * run;
    const ground = 1 - this.airAmt;
    this.armL.sh.rotation.set(-asw * ground + this.airAmt * 1.3 - this.slideAmt * 0.7, 0, -0.15 - this.airAmt * 0.5);
    this.armR.sh.rotation.set(asw * ground + this.airAmt * 0.7 - this.slideAmt * 0.5, 0, 0.15 + this.airAmt * 0.5);
    this.armL.el.rotation.x = 0.9 * run + this.airAmt * 0.4;
    this.armR.el.rotation.x = 0.9 * run + this.airAmt * 0.4;
    if (onWall) {
      // wall-side arm reaches to the wall
      const right = wallRoll < 0;
      const arm = right ? this.armR : this.armL;
      arm.sh.rotation.z = right ? 1.3 : -1.3;
    }
    if (climbing) {
      const s = Math.sin(p);
      this.armL.sh.rotation.set(-2.6 + s * 0.4, 0, -0.2);
      this.armR.sh.rotation.set(-2.6 - s * 0.4, 0, 0.2);
      this.armL.el.rotation.x = 0.3;
      this.armR.el.rotation.x = 0.3;
    }

    const pulse = 3 + Math.sin(time * 8) * 0.6 + r.flow * 4;
    this.glowMat.color.copy(this.color).multiplyScalar(pulse);
    this.light.intensity = 4 + r.flow * 8;

    this.trail.push(this.root.position, sp, dt, resync);
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Vertical ribbon trail following the runner's hips. */
export class Trail {
  constructor(scene, color) {
    this.N = 16;            // max points kept
    this.dtSample = 1 / 60; // seconds between points
    this.maxAge = 0.24;     // trail length in seconds (framerate independent)
    this.acc = 0;
    this.age = 0;
    this.points = [];
    const pos = new Float32Array(this.N * 2 * 3);
    const alpha = new Float32Array(this.N * 2);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color.clone().multiplyScalar(1.6) } },
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA); }',
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  reset() {
    this.points.length = 0;
  }

  push(p, speed, dt, hidden) {
    if (hidden) {
      this.points.length = 0;
    } else {
      this.acc += dt;
      this.age += dt;
      if (!this.points.length || this.acc >= this.dtSample) {
        this.acc = 0;
        this.points.unshift({ x: p.x, y: p.y, z: p.z, t: this.age });
        if (this.points.length > this.N) this.points.pop();
      } else {
        const h = this.points[0];
        h.x = p.x; h.y = p.y; h.z = p.z; h.t = this.age;
      }
      while (this.points.length > 2 && this.age - this.points[this.points.length - 1].t > this.maxAge) this.points.pop();
    }
    const pos = this.geo.attributes.position.array;
    const al = this.geo.attributes.aAlpha.array;
    const n = this.points.length;
    const strength = Math.min(1, Math.max(0, (speed - 6) / 10));
    for (let i = 0; i < this.N; i++) {
      const q = this.points[Math.min(i, n - 1)] || p;
      const t = i / (this.N - 1);
      const half = 0.16 * (1 - t);
      pos.set([q.x, q.y + 1.0 - half, q.z, q.x, q.y + 1.0 + half, q.z], i * 6);
      const a = i < n ? (1 - t) * (1 - t) * 0.35 * strength : 0;
      al[i * 2] = a;
      al[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}
