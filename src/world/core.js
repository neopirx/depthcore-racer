import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { shardBloomGeometry } from './shards.js';
import { shared } from '../fx/shared.js';

/** The DEPTHCORE: white-hot singularity wrapped in rotating chrome and hairline orbits. */
export class Core {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spin = [];
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.group.clear();
    this.spin = [];
  }

  build(track, theme, envMap, seed) {
    this.dispose();
    const rng = makeRng(seed ^ 0xc0de);
    const g = this.group;
    g.position.set(track.core.x, track.core.y, track.core.z);
    const glow = new THREE.Color(theme.glow);

    // singularity — fresnel shell, HDR bright so bloom eats it
    const coreMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uColor: { value: glow.clone() } },
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = 1.0 - abs(dot(vN, vV));
          float pulse = 0.85 + 0.15 * sin(uTime * 2.4);
          vec3 c = uColor * (2.5 * pulse) + uColor * pow(f, 2.0) * 4.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(9, 5), coreMat));

    // geodesic wire shell
    const shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(16, 1)),
      new THREE.LineBasicMaterial({ color: glow.clone().multiplyScalar(2.2), fog: false, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
    );
    g.add(shell);
    this.spin.push({ obj: shell, axis: new THREE.Vector3(0.3, 1, 0.1).normalize(), speed: 0.15 });

    // chrome orbit rings
    const chrome = new THREE.MeshStandardMaterial({ color: theme.chrome, metalness: 1, roughness: 0.05, envMap, envMapIntensity: 2, fog: false });
    for (let i = 0; i < 4; i++) {
      const r = 22 + i * 7;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35 + rng.range(0, 0.4), 8, 160, Math.PI * rng.range(1.2, 2)), chrome);
      ring.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      g.add(ring);
      this.spin.push({ obj: ring, axis: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(), speed: rng.range(0.1, 0.3) * rng.sign() });
    }

    // hairline orbits with ticks
    const pos = [];
    for (let k = 0; k < 6; k++) {
      const R = 30 + k * 9;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.5, 0.5) + Math.PI / 2, rng.range(-0.5, 0.5), 0));
      const pt = (a) => new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0).applyQuaternion(q);
      for (let i = 0; i < 180; i++) {
        const a = pt((i / 180) * Math.PI * 2);
        const b = pt(((i + 1) / 180) * Math.PI * 2);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if (i % 15 === 0) {
          const c = a.clone().multiplyScalar(1.05);
          pos.push(a.x, a.y, a.z, c.x, c.y, c.z);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const orbits = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: glow.clone().multiplyScalar(1.2), fog: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending,
    }));
    g.add(orbits);
    this.spin.push({ obj: orbits, axis: new THREE.Vector3(0, 1, 0), speed: 0.05 });

    // chrome bloom crown
    const dark = new THREE.MeshStandardMaterial({ color: theme.chromeDark, metalness: 1, roughness: 0.1, envMap, envMapIntensity: 2.2, fog: false });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(shardBloomGeometry(rng, ['burst', 'swept', 'ribbon'][i], 1), i === 1 ? chrome : dark);
      m.scale.setScalar(38 + i * 10);
      m.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      g.add(m);
      this.spin.push({ obj: m, axis: new THREE.Vector3(rng.range(-1, 1), 1, rng.range(-1, 1)).normalize(), speed: 0.03 * rng.sign() });
    }

    // vertical beam
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 1600, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(2), fog: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(beam);

    this.light = new THREE.PointLight(theme.glow, 600, 500, 1.6);
    g.add(this.light);
  }

  update(dt) {
    for (const s of this.spin) s.obj.rotateOnAxis(s.axis, s.speed * dt);
  }
}
