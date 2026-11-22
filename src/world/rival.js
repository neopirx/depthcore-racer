import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { shared } from '../fx/shared.js';
import { Trail } from '../game/avatar.js';
import characterUrl from '../character_3d.fbx?url';
import ual1Url from '../anims/UAL1_Standard.glb?url';
import ual2Url from '../anims/UAL2_Standard.glb?url';

// UAL (UE-style skeleton) → Mixamo bone names
const MAP = {
  pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head',
  clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder', upperarm_r: 'RightArm', lowerarm_r: 'RightForeArm', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', calf_l: 'LeftLeg', foot_l: 'LeftFoot', ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', calf_r: 'RightLeg', foot_r: 'RightFoot', ball_r: 'RightToeBase',
};

let assets = null;

/** Load the character + animation libraries once. Resolves to null if anything fails. */
export function loadRivalAssets() {
  if (assets) return assets;
  const mgr = new THREE.LoadingManager();
  // the FBX references a texture that isn't shipped; the rival uses its own material anyway
  const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  mgr.setURLModifier((u) => (/\.(png|jpe?g|tga)$/i.test(u) ? blank : u));
  const fbx = new FBXLoader(mgr);
  const gltf = new GLTFLoader(mgr);
  assets = Promise.all([fbx.loadAsync(characterUrl), gltf.loadAsync(ual1Url), gltf.loadAsync(ual2Url)])
    .then(([character, a1, a2]) => ({ character, src: a1.scene, clips: [...a1.animations, ...a2.animations] }))
    .catch((e) => { console.warn('rival assets failed', e); return null; });
  return assets;
}

const strip = (n) => n.replace(/^mixamorig:?/, '');

/** Holographic chrome "ghost process" skin: dark chrome, red fresnel rim, sliding scan bands. */
function ghostMaterial(color, envMap, { base = 0x111216, key = 'dc-ghost', env = 1.4, rough = 0.18, rim = 3 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: base, metalness: 1, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: env,
  });
  const u = { uRim: { value: new THREE.Color(color).multiplyScalar(rim) }, uTime: shared.uTime, uKick: shared.uKick, uFlow: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uTime, uKick, uFlow; varying vec3 vGW;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
        float band = smoothstep(0.92, 1.0, fract(vGW.y * 3.0 - uTime * 1.6));
        float glitch = step(0.97, fract(sin(floor(vGW.y * 24.0) * 91.7 + floor(uTime * 14.0)) * 4375.5));
        totalEmissiveRadiance += uRim * (fr * (1.1 + uKick * 0.8 + uFlow) + band * 0.35 + glitch * 0.5);`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/**
 * The rival: the user's rigged character driven by the UAL animation library through a
 * runtime retarget (UAL → Mixamo) — world-space rest-pose deltas per bone, hips height scaled.
 * Same interface as the old procedural Avatar.
 */
export class RivalCharacter {
  constructor(scene, a, color, envMap, opts = {}) {
    this.color = new THREE.Color(color);
    this.root = new THREE.Group();
    scene.add(this.root);

    // ---- target (character)
    const model = cloneSkinned(a.character);
    this.model = model;
    model.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMaterial(color, envMap, opts);
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    this.mat = null;
    model.traverse((o) => { if (o.isMesh && !this.mat) this.mat = o.material; });
    // normalise from the skeleton (mesh bounds of a skinned FBX are unreliable): stand it up if
    // the rig is Z-up, scale to 1.78 m head-top, feet on the ground
    const bones = {};
    model.traverse((o) => { if (o.isBone) bones[strip(o.name)] = o; });
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    model.updateMatrixWorld(true);
    const top = bones.HeadTop_End || bones.Head;
    const d = wp(top).sub(wp(bones.Hips));
    if (Math.abs(d.z) > Math.abs(d.y)) model.rotation.x += d.z > 0 ? -Math.PI / 2 : Math.PI / 2;
    model.updateMatrixWorld(true);
    const footY = Math.min(wp(bones.LeftToeBase || bones.LeftFoot).y, wp(bones.LeftFoot).y);
    const h = wp(top).y - footY;
    const s = 1.78 / Math.max(0.01, h);
    model.scale.multiplyScalar(s);
    model.updateMatrixWorld(true);
    model.position.y -= Math.min(wp(bones.LeftToeBase || bones.LeftFoot).y, wp(bones.LeftFoot).y) - 0.02;
    model.updateMatrixWorld(true);
    this.inner = new THREE.Group();     // turned so the character faces −z (the racer's forward)
    this.inner.add(model);
    this.root.add(this.inner);

    // ---- source (UAL skeleton, never rendered)
    this.src = cloneSkinned(a.src);
    this.src.traverse((o) => { if (o.isMesh) o.visible = false; });
    this.mixer = new THREE.AnimationMixer(this.src);
    this.clips = Object.fromEntries(a.clips.map((c) => [c.name, c]));

    const sb = {};
    this.src.traverse((o) => { if (o.isBone || MAP[o.name]) sb[o.name] = o; });
    const tb = {};
    model.traverse((o) => { if (o.isBone) tb[strip(o.name)] = o; });
    this.pairs = [];
    for (const [sn, tn] of Object.entries(MAP)) if (sb[sn] && tb[tn]) this.pairs.push({ s: sb[sn], t: tb[tn] });
    this.ok = this.pairs.length >= 16;
    if (!this.ok) { console.warn('rival retarget: bones missing', this.pairs.length); return; }

    // reference pose: UAL's T-pose clip vs. the Mixamo bind pose
    const tpose = this.clips.A_TPose;
    if (tpose) {
      const act = this.mixer.clipAction(tpose);
      act.play();
      this.mixer.update(0);
      act.stop();
    }
    this.src.updateMatrixWorld(true);
    // facing check: toes ahead of the feet tells which way each rig looks
    const fwdZ = (foot, ball) => Math.sign(ball.getWorldPosition(new THREE.Vector3()).z - foot.getWorldPosition(new THREE.Vector3()).z);
    model.updateMatrixWorld(true);
    const sF = fwdZ(sb.foot_l, sb.ball_l);
    const tF = fwdZ(tb.LeftFoot, tb.LeftToeBase);
    // both rigs must look down −z (the racer's forward) in their reference frames
    if (sF > 0) { this.src.rotation.y = Math.PI; this.src.updateMatrixWorld(true); }
    this.inner.rotation.y = tF > 0 ? Math.PI : 0;
    this.root.updateMatrixWorld(true);

    const rootQinv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const relQ = (o) => rootQinv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    for (const p of this.pairs) {
      p.rs = p.s.getWorldQuaternion(new THREE.Quaternion());
      p.rsInv = p.rs.clone().invert();
      p.rt = relQ(p.t);
      p.cur = new THREE.Quaternion();
    }
    this.byT = new Map(this.pairs.map((p) => [p.t, p]));
    const hips = this.pairs[0];
    this.hipsParentQ = relQ(hips.t.parent);
    this.hipsParentInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(hips.t.parent.matrixWorld).invert();
    const srcHipY = hips.s.getWorldPosition(new THREE.Vector3()).y;
    this.hipRestY = new THREE.Vector3().setFromMatrixPosition(hips.t.matrixWorld).y - this.root.position.y;
    this.hipScale = this.hipRestY / Math.max(0.01, srcHipY);

    this.actions = {};
    this.cur = null;
    this.play('Idle_Loop', 0);

    this.trail = opts.trail === false ? null : new Trail(scene, this.color);
    this.yaw = 0;
    this.roll = 0;
    this.lastMode = '';
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  play(name, fade = 0.14, { once = false, speed = 1 } = {}) {
    const clip = this.clips[name];
    if (!clip) return;
    let a = this.actions[name];
    if (!a) {
      a = this.mixer.clipAction(clip);
      this.actions[name] = a;
    }
    a.timeScale = speed;
    if (this.cur === a) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = a;
    this.curName = name;
  }

  setVisible(v) {
    this.root.visible = v;
    if (this.trail) this.trail.mesh.visible = v;
  }

  /** choose the clip from the racer's state */
  pick(r) {
    const sp = r.speed;
    const changed = r.mode !== this.lastMode;
    this.lastMode = r.mode;
    if (r.stunT > 0) return this.play('Hit_Chest', 0.08, { once: true });
    switch (r.mode) {
      case 'slide':
        if (changed) return this.play('Slide_Start', 0.08, { once: true, speed: 1.5 });
        if (this.curName === 'Slide_Start' && this.cur.isRunning()) return;
        return this.play('Slide_Loop', 0.12);
      case 'roll': return this.play('Roll', 0.06, { once: true, speed: 1.6 });
      case 'climb': return this.play('ClimbUp_1m', 0.08, { once: true, speed: 1.8 });
      case 'mantle': return r.mantle?.kind === 'vault'
        ? this.play('NinjaJump_Start', 0.05, { once: true, speed: 2.2 })
        : this.play('ClimbUp_1m', 0.06, { once: true, speed: 2.6 });
      case 'wall': return this.play('Sprint_Loop', 0.1, { speed: sp / 7.5 });
      case 'air': return this.play(r.vy > 1 ? 'NinjaJump_Start' : 'NinjaJump_Idle_Loop', 0.12, { once: r.vy > 1, speed: 1.4 });
      default:
        if (this.curName === 'Slide_Start' && !this.cur.isRunning()) return this.play('Slide_Exit', 0.08, { once: true });
        if (sp > 5.5) return this.play('Sprint_Loop', 0.14, { speed: sp / 8 });
        if (sp > 0.8) return this.play('Jog_Fwd_Loop', 0.14, { speed: sp / 4 });
        return this.play('Idle_Loop', 0.25);
    }
  }

  retarget() {
    this.src.updateMatrixWorld(true);
    for (const p of this.pairs) {
      // world delta from the reference pose, applied on top of the target's rest
      const ws = p.s.getWorldQuaternion(this._q);
      p.cur.copy(ws).multiply(p.rsInv).multiply(p.rt);
      const parent = this.byT.get(p.t.parent);
      const pq = parent ? parent.cur : this.hipsParentQ;
      p.t.quaternion.copy(pq).invert().multiply(p.cur);
    }
    // hips height from the animation (horizontal root motion is owned by the simulation)
    const hips = this.pairs[0];
    const hp = hips.s.getWorldPosition(this._v);
    this._v.set(0, hp.y * this.hipScale, 0).applyMatrix4(this.hipsParentInv);
    hips.t.position.copy(this._v);
  }

  /** r: racer, pos: interpolated feet position */
  update(r, pos, dt, time) {
    if (!this.ok) return;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    this.root.position.set(pos.x, pos.y, pos.z);
    const sp = r.speed;
    let faceT = sp > 1 ? Math.atan2(-r.vx, -r.vz) : r.yaw;
    if (r.mode === 'climb' && r.climb) faceT = Math.atan2(r.climb.axis === 'x' ? r.climb.n : 0, r.climb.axis === 'z' ? r.climb.n : 0);
    let dyaw = faceT - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * k(14);
    // lean into the wall on a wallrun
    let rollT = 0;
    if (r.mode === 'wall' && r.wall) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const nX = r.wall.axis === 'x' ? r.wall.n : 0;
      const nZ = r.wall.axis === 'z' ? r.wall.n : 0;
      rollT = (nX * -fz + nZ * fx) > 0 ? -0.45 : 0.45;
    }
    this.roll += (rollT - this.roll) * k(10);
    this.root.rotation.set(0, this.yaw, this.roll, 'YXZ');

    const resync = r.respawnT > 0;
    this.root.visible = !resync || Math.floor(time * 20) % 2 === 0;

    this.pick(r);
    this.mixer.update(dt);
    this.retarget();
    if (this.mat) this.mat.userData.u.uFlow.value = r.flow;
    this.trail?.push(this.root.position, sp, dt, resync);
  }
}

/**
 * Where the first-person viewpoint sits relative to the neck while sliding (metres, in the view's
 * frame): + back = the neck further behind the lens, + right = the neck further left of the lens
 * (negative shifts the body to the right of the view).
 */
export const FP_VIEW = { back: 0.24, right: -0.17 };

/**
 * The runner's own legs for first person, in the player colour: shown only on a slide (legs out in
 * front of you, Mirror's Edge style). Head, neck and both arms are collapsed (scaled to nothing at
 * their joints, behind the lens) so no hands ever reach the frame; the body is slid under the
 * camera every frame so the neck stays just behind the lens whatever the clip does.
 */
export class PlayerBody extends RivalCharacter {
  constructor(scene, a, color, envMap) {
    super(scene, a, color, envMap, { trail: false, base: 0x123a8c, key: 'dc-ghost-player', env: 0.45, rough: 0.3, rim: 1.6 });
    if (!this.ok) return;
    this.head = null;
    this.model.traverse((o) => {
      if (!o.isBone) return;
      const n = strip(o.name);
      if (n === 'Head') { this.head = o; o.scale.setScalar(0.001); }
      if (n === 'Neck') o.scale.setScalar(0.35);
      if (n === 'LeftShoulder' || n === 'RightShoulder') o.scale.setScalar(0.001);
    });
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.lastFP = '';
    this.root.visible = false;
    this._h = new THREE.Vector3();
  }

  /** clip for the slide (start, then loop) */
  pickFP(r) {
    const changed = this.lastFP !== 'slide';
    this.lastFP = 'slide';
    if (changed) return this.play('Slide_Start', 0.05, { once: true, speed: 1.6 });
    if (this.curName === 'Slide_Start' && this.cur.isRunning()) return;
    this.play('Slide_Loop', 0.12);
  }

  /** r: player racer, pos: interpolated feet, cam: the first-person camera (already updated), yaw: look yaw */
  updateFP(r, pos, dt, cam, calm, yaw) {
    if (!this.ok) return;
    const show = r.mode === 'slide' && r.respawnT <= 0 && !r.finished;
    this.root.visible = show;
    if (!show) { this.lastFP = ''; return; }
    this.pickFP(r);

    // a slide follows its velocity, turned slightly side-on
    const faceT = r.speed > 1 ? Math.atan2(-r.vx, -r.vz) + 0.38 : yaw;
    let dyaw = faceT - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * (1 - Math.exp(-16 * dt));
    this.root.position.set(pos.x, pos.y, pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.mixer.update(dt);
    this.retarget();

    // neck under and behind the lens, offset by FP_VIEW in the view's frame
    this.root.updateMatrixWorld(true);
    this.head.getWorldPosition(this._h);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    this.root.position.x += cam.position.x - this._h.x - fx * FP_VIEW.back - rx * FP_VIEW.right;
    this.root.position.z += cam.position.z - this._h.z - fz * FP_VIEW.back - rz * FP_VIEW.right;
    this.root.position.y += THREE.MathUtils.clamp(cam.position.y - 0.12 - this._h.y, -0.35, 0.1);
    this.root.updateMatrixWorld(true);
    if (this.mat) this.mat.userData.u.uFlow.value = r.flow * (calm ? 0.5 : 1);
  }
}
