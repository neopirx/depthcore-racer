import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * One blade: a lens/diamond cross-section swept along a curved spine, tapering to
 * points at both ends and twisting along its length. Smooth normals + mirror chrome
 * give the liquid-metal Y2K look.
 */
function pushBlade(out, rng, o) {
  const {
    origin, dir, length, width, thickness, bend, twist, segs = 26, ring = 8, pinch = 0.6, skew = 0,
  } = o;
  const T = new THREE.Vector3();
  const W = new THREE.Vector3();
  const N = new THREE.Vector3();
  // bend direction perpendicular to dir
  const tmp = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(dir, tmp).normalize();
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  const bendDir = side.clone().multiplyScalar(Math.cos(o.bendAngle)).addScaledVector(up, Math.sin(o.bendAngle));

  const spine = (t, target) => target.copy(origin)
    .addScaledVector(dir, length * t)
    .addScaledVector(bendDir, length * bend * t * t)
    .addScaledVector(up, length * skew * Math.sin(t * Math.PI));

  const base = out.pos.length / 3;
  const p = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    spine(t, p);
    spine(Math.min(1, t + 0.01), p2);
    if (t >= 1) { spine(t - 0.01, p2); T.subVectors(p, p2).normalize(); } else T.subVectors(p2, p).normalize();
    W.crossVectors(T, up).normalize();
    if (W.lengthSq() < 0.1) W.copy(side);
    const a = twist * t;
    N.crossVectors(T, W).normalize();
    const Wt = _v.copy(W).multiplyScalar(Math.cos(a)).addScaledVector(N, Math.sin(a));
    const Nt = new THREE.Vector3().crossVectors(T, Wt).normalize();
    // blade profile: pointed at both ends, fat nearer the base
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, pinch)), 0.8) * (1 - 0.35 * t);
    const w = width * prof;
    const th = thickness * prof;
    for (let k = 0; k < ring; k++) {
      const ang = (k / ring) * Math.PI * 2;
      const cx = Math.cos(ang);
      const sy = Math.sin(ang);
      // lens shape: sharp edges at cx=±1
      const lens = Math.sign(sy) * Math.pow(Math.abs(sy), 0.7);
      out.pos.push(
        p.x + Wt.x * cx * w + Nt.x * lens * th,
        p.y + Wt.y * cx * w + Nt.y * lens * th,
        p.z + Wt.z * cx * w + Nt.z * lens * th,
      );
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < ring; k++) {
      const a = base + i * ring + k;
      const b = base + i * ring + ((k + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      out.idx.push(a, c, b, b, c, d);
    }
  }
}

function randomDir(rng, bias, biasAmt) {
  const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
  if (bias) v.lerp(bias, biasAmt).normalize();
  return v;
}

/**
 * A cluster of blades. Variants:
 *  - burst:  radial explosion of short-to-mid blades (kaliparts-style)
 *  - swept:  long curved blades flowing in one direction (storm/expression)
 *  - ribbon: few wide twisted ribbons (angel/downfall)
 */
export function shardBloomGeometry(rng, variant = 'burst', detail = 1) {
  const out = { pos: [], idx: [] };
  const segs = Math.max(10, Math.round(26 * detail));
  const ring = detail < 0.6 ? 6 : 8;
  const flow = randomDir(rng);

  if (variant === 'burst') {
    const n = rng.int(14, 22);
    for (let i = 0; i < n; i++) {
      const dir = randomDir(rng);
      pushBlade(out, rng, {
        origin: dir.clone().multiplyScalar(rng.range(0, 0.15)),
        dir,
        length: rng.range(0.5, 1.4),
        width: rng.range(0.1, 0.26),
        thickness: rng.range(0.025, 0.06),
        bend: rng.range(-0.5, 0.5),
        bendAngle: rng.range(0, Math.PI * 2),
        twist: rng.range(-1.5, 1.5),
        pinch: rng.range(0.4, 0.8),
        segs, ring,
      });
    }
  } else if (variant === 'swept') {
    const n = rng.int(14, 22);
    for (let i = 0; i < n; i++) {
      const dir = randomDir(rng, flow, 0.75);
      pushBlade(out, rng, {
        origin: new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)),
        dir,
        length: rng.range(0.9, 2.0),
        width: rng.range(0.14, 0.36),
        thickness: rng.range(0.025, 0.07),
        bend: rng.range(0.15, 0.6) * rng.sign(),
        bendAngle: rng.range(0, Math.PI * 2),
        twist: rng.range(-0.8, 0.8),
        pinch: rng.range(0.5, 1.1),
        skew: rng.range(-0.1, 0.1),
        segs, ring,
      });
    }
  } else {
    const n = rng.int(6, 10);
    for (let i = 0; i < n; i++) {
      const dir = randomDir(rng, flow, 0.4);
      pushBlade(out, rng, {
        origin: new THREE.Vector3(rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)),
        dir,
        length: rng.range(1.2, 2.4),
        width: rng.range(0.15, 0.32),
        thickness: rng.range(0.008, 0.02),
        bend: rng.range(0.3, 0.9) * rng.sign(),
        bendAngle: rng.range(0, Math.PI * 2),
        twist: rng.range(2, 5) * rng.sign(),
        pinch: rng.range(0.7, 1.0),
        skew: rng.range(-0.25, 0.25),
        segs: Math.round(segs * 1.6), ring,
      });
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A single small shard (used for debris and avatar fins). */
export function singleBladeGeometry(rng, opts = {}) {
  const out = { pos: [], idx: [] };
  pushBlade(out, rng, {
    origin: new THREE.Vector3(),
    dir: opts.dir ?? new THREE.Vector3(0, 1, 0),
    length: opts.length ?? 1,
    width: opts.width ?? 0.15,
    thickness: opts.thickness ?? 0.03,
    bend: opts.bend ?? 0.2,
    bendAngle: opts.bendAngle ?? 0,
    twist: opts.twist ?? 0.5,
    pinch: opts.pinch ?? 0.6,
    segs: opts.segs ?? 12,
    ring: opts.ring ?? 6,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  return g;
}
