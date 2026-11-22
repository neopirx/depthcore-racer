import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { shared, fogGLSL, holoMaterial, labelTexture } from '../fx/shared.js';
import { beat } from '../fx/beat.js';
import { shardBloomGeometry } from './shards.js';
import { pathAt } from '../game/trackgen.js';
import { query } from '../game/world.js';

const LABELS = [
  ['DEPTHCORE.SYS', 'process 0x3F // routing to core'],
  ['node::7734', 'link stable  ·  latency 0.04ms'],
  ['halo.protocol', 'handshake :: accepted'],
  ['data.bloom', 'pattern set  v3.0'],
  ['neural::cache', 'sector buffer 88%'],
  ['SYS.OVERRIDE', 'trace countermeasure armed'],
  ['kernel.drift', 'entropy 0.0172'],
  ['<<< CORE', 'descend'],
  ['ice.wall', 'firewall layer 04 // open'],
  ['ghost.signal', 'rival process detected'],
  ['mem.leak', 'ignore // keep running'],
];

/**
 * Scenery is placed relative to the racing line and every placement is tested against the
 * actual course geometry: nothing decorative is allowed within a clearance radius of any
 * platform, wall or the racing line itself — the view of the route always stays clean.
 */
class Field {
  constructor(track) {
    this.track = track;
    this.cell = 16;
    this.grid = new Map();
    // the main line plus every alternate (shortcut) line must stay clear of decoration
    for (const p of [track.path, ...(track.alts ?? [])].flat()) {
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(p);
    }
    this.tmp = {};
    this.near = [];
    this.L = track.path[track.path.length - 1].s;
  }

  key(i, j) { return i * 100003 + j; }

  /** min 3D distance from (x,y,z) to the racing line, capped */
  pathDist(x, y, z, cap = 48) {
    const c = this.cell;
    const r = Math.ceil(cap / c);
    const i0 = Math.floor(x / c);
    const j0 = Math.floor(z / c);
    let best = cap;
    for (let i = i0 - r; i <= i0 + r; i++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        const list = this.grid.get(this.key(i, j));
        if (!list) continue;
        for (const p of list) best = Math.min(best, Math.hypot(p.x - x, (p.y + 1.5 - y) * 0.8, p.z - z));
      }
    }
    return best;
  }

  /** true if a sphere of radius r at (x,y,z) is clear of all course solids and the racing line */
  free(x, y, z, r) {
    const w = this.track.world;
    query(w, x - r, z - r, x + r, z + r, this.near);
    for (const n of this.near) {
      const o = n.sweep ?? n;   // a moving platform claims everything it sweeps through
      const top = o.ramp ? Math.max(o.h0, o.h1) + 4 : o.y1 + 4;   // + head room above every surface
      const bot = o.ramp ? Math.min(o.h0, o.h1) - 2 : o.y0;
      const dx = Math.max(o.x0 - x, 0, x - o.x1);
      const dy = Math.max(bot - y, 0, y - top);
      const dz = Math.max(o.z0 - z, 0, z - o.z1);
      if (dx * dx + dy * dy + dz * dz < r * r) return false;
    }
    return this.pathDist(x, y, z, r + 6) >= r + 6;
  }

  /** point on the line at s (extrapolated beyond the ends), with its side normal */
  at(s) {
    const L = this.L;
    const q = pathAt(this.track, Math.min(Math.max(s, 0), L), this.tmp);
    const out = { x: q.x, y: q.y, z: q.z, dx: q.dx ?? 0, dz: q.dz ?? -1 };
    if (s < 0 || s > L) {
      const e = s < 0 ? s : s - L;
      out.x += out.dx * e;
      out.z += out.dz * e;
    }
    out.nx = -out.dz;
    out.nz = out.dx;
    return out;
  }

  /** place at s, `side`*`lat` metres off the line, `dy` above it; null if not clear by `clear` */
  off(s, side, lat, dy, clear) {
    const p = this.at(s);
    const x = p.x + p.nx * side * lat;
    const z = p.z + p.nz * side * lat;
    const y = p.y + dy;
    if (clear && !this.free(x, y, z, clear)) return null;
    return { x, y, z, p };
  }
}

const lineMat = (color, opacity = 0.9) => new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { ...shared, uColor: { value: color }, uOpacity: { value: opacity } },
  vertexShader: /* glsl */ `
    attribute float aI;
    varying float vI; varying float vDist;
    void main() {
      vI = aI;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uOpacity, uKick;
    varying float vI; varying float vDist;
    ${fogGLSL}
    void main() {
      float a = vI * uOpacity * (0.75 + uKick * 0.6) * (0.35 + 0.65 * fogAlpha(vDist * 0.5));
      gl_FragColor = vec4(uColor, a);
    }`,
});

export class Backdrop {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spinners = [];
    this.pulsers = [];
    this.bolts = [];
    this.flash = 0;
    this.nextBolt = 3;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.group.clear();
    this.spinners = [];
    this.pulsers = [];
    this.bolts = [];
  }

  build(track, theme, envMap, seed) {
    this.dispose();
    const rng = makeRng(seed ^ 0x5bd1e995);
    const F = new Field(track);
    this.F = F;
    this.rng = makeRng(seed ^ 0x77);
    const S0 = -150;
    const S1 = F.L + 260;
    this.lineColor = new THREE.Color(theme.line);
    this.glowColor = new THREE.Color(theme.glow);

    this.buildSculptures(rng, F, theme, envMap, S0, S1);
    this.buildPolyhedra(rng, F, S0, S1);
    this.buildHalos(rng, F, S0, S1);
    this.buildVoxels(rng, F, theme, envMap, S0, S1);
    this.buildRain(rng, F, S0, S1);
    this.buildCrosshairs(rng, F, S0, S1);
    this.buildPanels(rng, F, theme, S0, S1);
    this.buildBolts();
    this.buildDust();
    this.buildDeepGrid();
  }

  spin(obj, rng, speed) {
    this.spinners.push({
      obj,
      axis: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(),
      speed: speed * rng.sign(),
    });
  }

  // ------------------------------------------------------------ chrome sculptures — far only
  buildSculptures(rng, F, theme, envMap, S0, S1) {
    const chrome = new THREE.MeshPhysicalMaterial({
      color: theme.chrome, metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 1.1,
    });
    const dark = new THREE.MeshPhysicalMaterial({
      color: theme.chromeDark, metalness: 1, roughness: 0.1, clearcoat: 1, envMap, envMapIntensity: 1.5,
    });
    const variants = ['burst', 'swept', 'ribbon'];
    const big = [];
    for (let i = 0; i < 6; i++) big.push(shardBloomGeometry(rng, variants[i % 3], 1));

    const place = (geo, mat, q, scale, spin) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(q.x, q.y, q.z);
      m.scale.setScalar(scale);
      m.rotation.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      this.group.add(m);
      this.spin(m, rng, spin);
    };
    // colossal far layer: always well outside the course
    for (let s = S0; s < S1 + 300; s += rng.range(90, 150)) {
      const sc = rng.range(45, 95);
      const q = F.off(s, rng.sign(), rng.range(230, 380), rng.range(-60, 110), sc * 0.9);
      if (q) place(rng.pick(big), rng.chance(0.5) ? chrome : dark, q, sc, rng.range(0.008, 0.02));
    }
    // the abyss: deep below the route
    for (let s = S0; s < S1; s += rng.range(70, 120)) {
      const sc = rng.range(22, 40);
      const q = F.off(s, rng.sign(), rng.range(30, 80), -rng.range(120, 170), sc * 1.8);
      if (q) place(rng.pick(big), dark, q, sc, rng.range(0.01, 0.03));
    }
  }

  // ------------------------------------------------------------ wireframe polyhedra (far, slow)
  buildPolyhedra(rng, F, S0, S1) {
    const shapes = [
      () => new THREE.IcosahedronGeometry(1, 1),
      () => new THREE.OctahedronGeometry(1, 0),
      () => new THREE.DodecahedronGeometry(1, 0),
      () => new THREE.TorusGeometry(1, 0.32, 6, 18),
    ];
    for (let s = S0; s < S1 + 200; s += rng.range(70, 120)) {
      const R = rng.range(25, 70);
      const q = F.off(s, rng.sign(), rng.range(110, 240), rng.range(-40, 120), R * 1.1);
      if (!q) continue;
      const g = rng.pick(shapes)();
      const e = new THREE.EdgesGeometry(g);
      const m = new THREE.LineSegments(e, lineMat(this.lineColor.clone().multiplyScalar(1.4), rng.range(0.25, 0.6)));
      const n = e.attributes.position.count;
      e.setAttribute('aI', new THREE.Float32BufferAttribute(new Array(n).fill(1), 1));
      m.position.set(q.x, q.y, q.z);
      m.scale.setScalar(R);
      m.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      this.group.add(m);
      this.spin(m, rng, rng.range(0.02, 0.06));
      g.dispose();
    }
  }

  // ------------------------------------------------------------ halo rings, far around the route
  buildHalos(rng, F, S0, S1) {
    const pos = [];
    const ints = [];
    const seg = (ax, ay, az, bx, by, bz, i) => { pos.push(ax, ay, az, bx, by, bz); ints.push(i, i); };
    for (let s = 40; s < F.L + 200; s += rng.range(90, 150)) {
      const p = F.at(s);
      const R = rng.range(70, 130);
      const cx = p.x + p.dx * rng.range(-20, 20);
      const cy = p.y + rng.range(-10, 25);
      const cz = p.z + p.dz * rng.range(-20, 20);
      // tilted ring facing along the route; test samples so the hairline never cuts the course
      const tilt = rng.range(-0.5, 0.5);
      const pt = (a, r) => [
        cx + p.nx * Math.cos(a) * r + p.dx * Math.cos(a) * r * tilt,
        cy + Math.sin(a) * r,
        cz + p.nz * Math.cos(a) * r + p.dz * Math.cos(a) * r * tilt,
      ];
      let ok = true;
      for (let i = 0; i < 48 && ok; i++) { const [x, y, z] = pt((i / 48) * Math.PI * 2, R); if (!F.free(x, y, z, 12)) ok = false; }
      if (!ok) continue;
      const N = 160;
      for (let i = 0; i < N; i++) {
        const a = pt((i / N) * Math.PI * 2, R);
        const b = pt(((i + 1) / N) * Math.PI * 2, R);
        seg(...a, ...b, 0.5);
        if (i % 4 === 0) { const c = pt((i / N) * Math.PI * 2, R * (i % 20 === 0 ? 1.06 : 1.025)); seg(...a, ...c, 0.7); }
      }
      for (let k = 0; k < 3; k++) {
        const r = R * rng.range(0.88, 0.97);
        const a0 = rng.range(0, Math.PI * 2);
        const len = rng.range(0.5, 1.8);
        for (let i = 0; i < 40; i++) seg(...pt(a0 + (i / 40) * len, r), ...pt(a0 + ((i + 1) / 40) * len, r), 0.35);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aI', new THREE.Float32BufferAttribute(ints, 1));
    const m = new THREE.LineSegments(g, lineMat(this.lineColor.clone().multiplyScalar(1.6), 0.8));
    m.frustumCulled = false;
    this.group.add(m);
  }

  // ------------------------------------------------------------ voxel debris (mid distance parallax)
  buildVoxels(rng, F, theme, envMap, S0, S1) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshPhysicalMaterial({
      color: theme.chrome, metalness: 1, roughness: 0.08, clearcoat: 1, envMap, envMapIntensity: 1.3,
    });
    const glow = new THREE.MeshBasicMaterial({ color: this.lineColor.clone().multiplyScalar(2.2) });
    const items = [];
    for (let s = S0; s < S1; s += rng.range(4, 9)) {
      const sz = rng.range(0.6, 4.5);
      const q = F.off(s, rng.sign(), rng.range(22, 90), rng.range(-30, 40), sz + 9);
      if (q) items.push({ q, sz, lit: rng.chance(0.12) });
    }
    const make = (list, m) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, m, list.length);
      const o = new THREE.Object3D();
      list.forEach((it, i) => {
        o.position.set(it.q.x, it.q.y, it.q.z);
        o.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
        o.scale.setScalar(it.sz);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      this.group.add(im);
      this.voxels = im;
    };
    make(items.filter((i) => !i.lit), mat);
    make(items.filter((i) => i.lit).map((i) => ({ ...i, sz: i.sz * 0.35 })), glow);
  }

  // ------------------------------------------------------------ vertical data rain (far)
  buildRain(rng, F, S0, S1) {
    const pos = [];
    const ints = [];
    for (let i = 0; i < 700; i++) {
      const lat = rng.range(45, 340);
      const q = F.off(rng.range(S0, S1), rng.sign(), lat, 0, lat < 80 ? 20 : 0);
      if (!q) continue;
      const bright = rng.chance(0.08) ? rng.range(0.8, 1.6) : rng.range(0.06, 0.3);
      pos.push(q.x, q.y + rng.range(-260, -60), q.z, q.x, q.y + rng.range(60, 420), q.z);
      ints.push(bright, bright);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aI', new THREE.Float32BufferAttribute(ints, 1));
    const m = new THREE.LineSegments(g, lineMat(this.lineColor.clone().multiplyScalar(1.4), 0.9));
    m.frustumCulled = false;
    this.group.add(m);
  }

  // ------------------------------------------------------------ crosshair "+" lattice
  buildCrosshairs(rng, F, S0, S1) {
    const pos = [];
    for (let s = S0; s < S1; s += 14) {
      for (const lat of [-110, -60, 60, 110]) {
        for (let y = -28; y <= 56; y += 14) {
          if (rng.chance(0.35)) continue;
          const q = F.off(s, 1, lat, y, 10);
          if (!q) continue;
          pos.push(Math.round(q.x / 14) * 14, Math.round(q.y / 14) * 14, Math.round(q.z / 14) * 14);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...shared, uColor: { value: this.lineColor.clone().multiplyScalar(1.4) } },
      vertexShader: /* glsl */ `
        varying float vDist;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_PointSize = clamp(1400.0 / vDist, 3.0, 40.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uKick; varying float vDist;
        ${fogGLSL}
        void main() {
          vec2 p = abs(gl_PointCoord - 0.5);
          float arm = step(min(p.x, p.y), 0.035) * step(max(p.x, p.y), 0.5) * step(0.14, max(p.x, p.y));
          float a = arm * (0.5 + uKick * 0.5) * fogAlpha(vDist);
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  // ------------------------------------------------------------ hologram glass panels + labels
  buildPanels(rng, F, theme, S0, S1) {
    const holos = [
      holoMaterial({ color: theme.line, opacity: 0.35, lines: 30 }),
      holoMaterial({ color: theme.line, opacity: 0.25, lines: 8, vertical: true, fill: 0.12 }),
      holoMaterial({ color: theme.glow, opacity: 0.3, lines: 0, fill: 0.18 }),
    ];
    for (let s = S0 + 60; s < S1 - 150; s += rng.range(16, 30)) {
      const w = rng.range(3, 16);
      const h = rng.range(1.5, 9);
      const q = F.off(s, rng.sign(), rng.range(26, 70), rng.range(-4, 22), Math.max(w, h) / 2 + 10);
      if (!q) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), rng.pick(holos));
      m.position.set(q.x, q.y, q.z);
      m.rotation.y = Math.atan2(q.p.dx, q.p.dz) + rng.range(-1.2, 1.2);
      if (rng.chance(0.15)) m.rotation.set(-Math.PI / 2, 0, rng.range(0, 1));
      this.group.add(m);

      if (rng.chance(0.4)) {
        const [a, b] = rng.pick(LABELS);
        const tex = labelTexture([a, b], { color: '#' + new THREE.Color(theme.line).getHexString() });
        const lm = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 1.5),
          new THREE.MeshBasicMaterial({
            map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
            color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide,
          }),
        );
        lm.position.copy(m.position).add(new THREE.Vector3(0, h / 2 + 1, 0));
        lm.rotation.copy(m.rotation);
        this.group.add(lm);
      }
    }
  }

  // ------------------------------------------------------------ lightning
  buildBolts() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
      g.setAttribute('aI', new THREE.Float32BufferAttribute(new Float32Array(600), 1));
      g.setDrawRange(0, 0);
      const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: this.glowColor.clone().multiplyScalar(4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      m.frustumCulled = false;
      this.group.add(m);
      this.bolts.push({ mesh: m, life: 0 });
    }
  }

  /** Strike a jagged branching bolt somewhere in the far field, in front of the camera. */
  strike(camera) {
    const r = this.rng;
    const b = this.bolts.find((x) => x.life <= 0) || this.bolts[0];
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const ang = r.range(-1.1, 1.1);
    const dist = r.range(160, 380);
    const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const base = camera.position.clone().addScaledVector(dir, dist);
    const pos = b.mesh.geometry.attributes.position.array;
    let n = 0;
    const walk = (x, y, z, len, steps, depth) => {
      for (let i = 0; i < steps && n < 598; i++) {
        const nx = x + r.range(-1, 1) * len * 0.6;
        const ny = y - len * r.range(0.6, 1.1);
        const nz = z + r.range(-1, 1) * len * 0.6;
        pos.set([x, y, z, nx, ny, nz], n * 3);
        n += 2;
        if (depth < 2 && r.chance(0.12)) walk(nx, ny, nz, len * 0.6, Math.floor(steps * 0.4), depth + 1);
        x = nx; y = ny; z = nz;
      }
    };
    walk(base.x, camera.position.y + r.range(160, 260), base.z, r.range(9, 16), 34, 0);
    b.mesh.geometry.setDrawRange(0, n);
    b.mesh.geometry.attributes.position.needsUpdate = true;
    b.life = 1;
    this.flash = Math.max(this.flash, r.range(0.6, 1));
  }

  // ------------------------------------------------------------ camera-relative particles
  buildDust() {
    const N = 1800;
    const pos = new Float32Array(N * 3);
    const r = makeRng(77);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = r.range(-50, 50);
      pos[i * 3 + 1] = r.range(-30, 30);
      pos[i * 3 + 2] = r.range(-70, 70);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustU = { uCam: { value: new THREE.Vector3() } };
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shared, ...this.dustU, uColor: { value: this.lineColor.clone().lerp(new THREE.Color(1, 1, 1), 0.6) } },
      vertexShader: /* glsl */ `
        uniform vec3 uCam; uniform float uTime, uKick;
        varying float vA;
        void main() {
          vec3 box = vec3(100.0, 60.0, 140.0);
          vec3 p = position + vec3(sin(uTime * 0.3 + position.z) * 0.5, uTime * 0.4, 0.0);
          p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(70.0, 10.0, d) * smoothstep(0.5, 3.0, d) * (0.7 + uKick * 0.6);
          gl_PointSize = clamp(60.0 / d, 1.0, 6.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * 0.8;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  buildDeepGrid() {
    this.gridU = { uCam: { value: new THREE.Vector3() } };
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shared, ...this.gridU, uColor: { value: this.lineColor.clone().multiplyScalar(0.8) } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uCam; uniform float uKick, uBeat; varying vec3 vW;
        void main() {
          vec2 g = vW.xz / 24.0;
          vec2 f = abs(fract(g - 0.5) - 0.5) / fwidth(g);
          float line = 1.0 - min(min(f.x, f.y), 1.0);
          vec2 g2 = vW.xz / 120.0;
          vec2 f2 = abs(fract(g2 - 0.5) - 0.5) / fwidth(g2);
          float line2 = 1.0 - min(min(f2.x, f2.y), 1.0);
          float r = length(vW.xz - uCam.xz);
          float fade = smoothstep(900.0, 100.0, r);
          // a pulse ring expands from under the runner on every beat
          float wr = r - fract(uBeat) * 420.0;
          float wave = exp(-wr * wr / 900.0);
          float a = (line * 0.25 + line2 * 0.6) * fade * (0.7 + uKick * 0.5 + wave * 1.6);
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.deepGrid = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), m);
    this.deepGrid.rotation.x = -Math.PI / 2;
    this.deepGrid.frustumCulled = false;
    this.group.add(this.deepGrid);
  }

  update(dt, camera, speed, trackY) {
    for (const sp of this.spinners) sp.obj.rotateOnAxis(sp.axis, sp.speed * dt * (1 + beat.kick * 0.6));
    const c = camera.position;
    this.dustU.uCam.value.copy(c);
    this.gridU.uCam.value.copy(c);
    this.deepGrid.position.set(c.x, trackY - 140, c.z);

    // lightning: random, more often as the music intensifies, always on a phrase drop
    this.nextBolt -= dt * (0.6 + beat.energy);
    if (this.nextBolt <= 0 || (beat.drop > 0.98 && !this.dropFired)) {
      this.strike(camera);
      if (this.rng.chance(0.4)) this.strike(camera);
      this.nextBolt = this.rng.range(3, 9);
    }
    this.dropFired = beat.drop > 0.98;
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt * 2.2;
      // flicker: lightning re-strikes a couple of times in its life
      const fl = b.life > 0 ? (Math.sin(b.life * 40) > -0.2 ? 1 : 0.2) : 0;
      b.mesh.material.opacity = Math.max(0, b.life) * fl;
    }
    this.flash *= Math.exp(-dt * 7);
  }
}
