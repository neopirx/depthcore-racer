import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { labelTexture, stripeTexture, shared } from '../fx/shared.js';
import { monolithMaterial, accentMaterial } from '../fx/materials.js';
import { makeRng } from '../core/rng.js';
import { HAZARD_COLOR, PIVOT_COLOR } from './themes.js';

const KIND = { slab: 0, rampbase: 0, keel: 0, wall: 1, block: 2, fin: 2, frame: 2, step: 3, pad: 3, pillar: 4, spine: 4, blade: 4 };

/** Box geometry carrying the per-box attributes the building shader needs. */
function infoBox(o, seed, kind) {
  const g = new THREE.BoxGeometry(o.x1 - o.x0, o.y1 - o.y0, o.z1 - o.z0);
  g.translate((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
  return withInfo(g, o.y1, seed, kind, o.y0, o);
}

function withInfo(g, top, seed, kind, y0, o) {
  const n = g.attributes.position.count;
  const info = new Float32Array(n * 4);
  const box = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    info.set([top, seed, kind, y0], i * 4);
    box.set([o.x0, o.z0, o.x1, o.z1], i * 4);
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('aBox', new THREE.BufferAttribute(box, 4));
  return g;
}

/** Solid wedge for a ramp (top slopes from h0 to h1 along its axis). */
function rampGeometry(r) {
  const baseY = Math.min(r.h0, r.h1) - 0.6;
  const A = r.axis === 'x';
  const lo = Math.min(r.c0, r.c1);
  const hi = Math.max(r.c0, r.c1);
  const hLo = r.c0 < r.c1 ? r.h0 : r.h1;
  const hHi = r.c0 < r.c1 ? r.h1 : r.h0;
  const s0 = A ? r.z0 : r.x0;
  const s1 = A ? r.z1 : r.x1;
  // corners in (along, side, y)
  const P = (a, s, y) => (A ? [a, y, s] : [s, y, a]);
  const v = [
    P(lo, s0, hLo), P(hi, s0, hHi), P(hi, s1, hHi), P(lo, s1, hLo), // top
    P(lo, s0, baseY), P(hi, s0, baseY), P(hi, s1, baseY), P(lo, s1, baseY), // bottom
  ];
  const quads = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [2, 6, 7, 3], [1, 5, 6, 2], [3, 7, 4, 0]];
  const pos = [];
  for (const q of quads) {
    for (const i of [q[0], q[1], q[2], q[0], q[2], q[3]]) pos.push(...v[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // make every top normal point up and every side face outward
  const nrm = g.attributes.normal;
  const p = g.attributes.position;
  const c = new THREE.Vector3((r.x0 + r.x1) / 2, (r.h0 + r.h1) / 2, (r.z0 + r.z1) / 2);
  for (let i = 0; i < nrm.count; i += 3) {
    const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const m = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(new THREE.Vector3(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1))).add(new THREE.Vector3(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2))).multiplyScalar(1 / 3);
    if (n.dot(m.sub(c)) < 0) {
      for (let k = 0; k < 3; k++) nrm.setXYZ(i + k, -n.x, -n.y, -n.z);
      // flip winding too
      const ax = p.getX(i + 1); const ay = p.getY(i + 1); const az = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, ax, ay, az);
    }
  }
  return g;
}

/** Quad from a→b at heights y0..y1 pushed out along (nx, nz), with uv and an aSize attribute. */
function facePanel(f, mode, off = 0.04) {
  const ox = f.nx * off;
  const oz = f.nz * off;
  const L = Math.hypot(f.bx - f.ax, f.bz - f.az);
  const H = f.y1 - f.y0;
  const pos = [
    f.ax + ox, f.y0, f.az + oz, f.bx + ox, f.y0, f.bz + oz, f.bx + ox, f.y1, f.bz + oz,
    f.ax + ox, f.y0, f.az + oz, f.bx + ox, f.y1, f.bz + oz, f.ax + ox, f.y1, f.az + oz,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const sz = [];
  for (let i = 0; i < 6; i++) sz.push(L, H, mode);
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 3));
  return g;
}

/**
 * Turn sign art; dir +1 draws arrows pointing right, -1 left (drawn, never mirrored, so text
 * reads). dir 0: the skill-line marker, chevrons pointing up (= straight ahead).
 */
/** soft radial glow with a crisp inner ring: the halo every grapple node wears */
let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(64, 64, 40, 0, Math.PI * 2);
  g.stroke();
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** vertical light sheet: bright core line, soft sides, fading out toward the top */
let _beam = null;
function beamTexture() {
  if (_beam) return _beam;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    // canvas y runs down: row 0 is the top of the sheet (faded out), row 255 its foot (bright)
    const up = 1 - y / 255;
    const fy = (1 - up) * (1 - up);
    for (let x = 0; x < 64; x++) {
      const dx = Math.abs(x - 31.5) / 31.5;
      const fx = Math.exp(-dx * dx * 18) + 0.25 * Math.exp(-dx * dx * 3);
      const k = (y * 64 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, 255 * fx * fy);
    }
  }
  g.putImageData(img, 0, 0);
  _beam = new THREE.CanvasTexture(c);
  return _beam;
}

function arrowTexture(color, dir = 1, label = 'SKILL LINE') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  g.strokeRect(6, 6, 500, 244);
  if (dir === 0) {
    for (let i = 0; i < 3; i++) {
      const y = 196 - i * 52;
      g.globalAlpha = 0.45 + i * 0.27;
      g.beginPath();
      g.moveTo(176, y); g.lineTo(256, y - 56); g.lineTo(336, y); g.lineTo(336, y + 26); g.lineTo(256, y - 30); g.lineTo(176, y + 26);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
    g.font = '22px "Share Tech Mono", monospace';
    g.fillText(`ALT // ${label}`, 22, 36);
    g.fillText('FAST', 430, 236);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const X = (x) => (dir > 0 ? x : 512 - x);
  for (let i = 0; i < 3; i++) {
    const x = 120 + i * 100;
    g.globalAlpha = 0.45 + i * 0.27;   // brightest arrow leads in the turn direction
    g.beginPath();
    g.moveTo(X(x), 50); g.lineTo(X(x + 70), 128); g.lineTo(X(x), 206); g.lineTo(X(x + 30), 206); g.lineTo(X(x + 100), 128); g.lineTo(X(x + 30), 50);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  g.font = '22px "Share Tech Mono", monospace';
  g.fillText(dir > 0 ? 'ROUTE // RIGHT' : 'ROUTE // LEFT', 22, 36);
  g.fillText(dir > 0 ? '>>>' : '<<<', 440, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class TrackView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.stripes = stripeTexture();
    this.stripes.repeat.set(4, 1);
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.group.clear();
  }

  build(track, theme, envMap) {
    this.dispose();
    const rng = makeRng(track.seed ^ 0x1234);
    const hazard = new THREE.Color(HAZARD_COLOR);

    // ---- buildings (roofs, wallrun walls, ramp bases, props)
    const bGeos = [];
    const hazGeos = [];
    const beamGeos = [];
    for (const o of track.solids) {
      if (o.mover) continue;   // moving parts get their own meshes (buildMovers)
      const k = KIND[o.kind];
      if (k !== undefined) {
        bGeos.push(infoBox(o, rng.range(0, 100), k));
      } else if (o.kind === 'beam') {
        const g = new THREE.CylinderGeometry(0.22, 0.22, 1, 10, 1);
        const len = Math.max(o.x1 - o.x0, o.z1 - o.z0);
        g.scale(1, len, 1);
        if (o.x1 - o.x0 > o.z1 - o.z0) g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
        g.translate((o.x0 + o.x1) / 2, o.y1 - 0.22, (o.z0 + o.z1) / 2);
        beamGeos.push(g);
        // flanges under the pipe
        const fl = new THREE.BoxGeometry(o.x1 - o.x0 > o.z1 - o.z0 ? len : 0.06, 0.5, o.x1 - o.x0 > o.z1 - o.z0 ? 0.06 : len);
        fl.translate((o.x0 + o.x1) / 2, o.y1 - 0.6, (o.z0 + o.z1) / 2);
        beamGeos.push(fl);
      } else {
        const g = new THREE.BoxGeometry(o.x1 - o.x0, o.y1 - o.y0, o.z1 - o.z0);
        g.translate((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
        hazGeos.push(g);
      }
    }
    for (const r of track.ramps) {
      const g = rampGeometry(r);
      bGeos.push(withInfo(g, Math.max(r.h0, r.h1), rng.range(0, 100), 0, Math.min(r.h0, r.h1) - 0.6, r));
    }
    const bMat = monolithMaterial(theme);
    const flat = bGeos.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      n.deleteAttribute('uv');
      return n;
    });
    const buildings = new THREE.Mesh(mergeGeometries(flat), bMat);
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    this.group.add(buildings);
    bGeos.forEach((g) => g.dispose());

    if (hazGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(hazGeos), new THREE.MeshStandardMaterial({
        color: 0x0c0c0e, metalness: 0.7, roughness: 0.3, envMap,
        emissive: hazard, emissiveMap: this.stripes, emissiveIntensity: 1.6,
      }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      const edges = hazGeos.map((g) => new THREE.EdgesGeometry(g));
      this.group.add(new THREE.LineSegments(mergeGeometries(edges), new THREE.LineBasicMaterial({ color: hazard.clone().multiplyScalar(2.6) })));
      edges.forEach((e) => e.dispose());
      hazGeos.forEach((g) => g.dispose());
    }
    if (beamGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(beamGeos), new THREE.MeshPhysicalMaterial({
        color: theme.chrome, metalness: 1, roughness: 0.08, clearcoat: 1, envMap, envMapIntensity: 1.4,
      }));
      m.castShadow = true;
      this.group.add(m);
      beamGeos.forEach((g) => g.dispose());
    }

    // ---- runner vision: takeoff lips, wallrun bands, climb faces
    const lips = [];
    for (const l of track.lips) {
      const len = Math.hypot(l.x1 - l.x0, l.z1 - l.z0);
      const g = new THREE.BoxGeometry(len, 0.035, 0.05);
      g.rotateY(-Math.atan2(l.z1 - l.z0, l.x1 - l.x0));
      g.translate((l.x0 + l.x1) / 2, l.y + 0.03, (l.z0 + l.z1) / 2);
      lips.push(g);
    }
    if (lips.length) {
      // takeoff lips: bright from a distance, fading right under the nose so a climb never blooms out
      const lipMat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uColor: { value: hazard.clone().multiplyScalar(1.7) } },
        vertexShader: 'varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 uColor; uniform float uKick; varying float vD; void main(){ gl_FragColor = vec4(uColor * (0.85 + uKick * 0.4) * mix(0.08, 1.0, smoothstep(0.6, 3.5, vD)), 1.0); }',
      });
      this.group.add(new THREE.Mesh(mergeGeometries(lips), lipMat));
      lips.forEach((g) => g.dispose());
    }
    const panels = track.faces.map((f) => facePanel(f, f.kind === 'climb' ? 1 : 0));
    if (panels.length) {
      const m = new THREE.Mesh(mergeGeometries(panels), accentMaterial(HAZARD_COLOR));
      m.renderOrder = 3;
      this.group.add(m);
      panels.forEach((g) => g.dispose());
    }
    // ramp chevrons
    const rampPanels = track.ramps.map((r) => {
      const A = r.axis === 'x';
      const mid = A ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      const yOff = 0.03;
      const p0 = A ? [r.c0, r.h0 + yOff, mid] : [mid, r.h0 + yOff, r.c0];
      const p1 = A ? [r.c1, r.h1 + yOff, mid] : [mid, r.h1 + yOff, r.c1];
      const half = r.w / 2 - 0.3;
      const sx = A ? 0 : half; const sz = A ? half : 0;
      const pos = [
        p0[0] - sx, p0[1], p0[2] - sz, p1[0] - sx, p1[1], p1[2] - sz, p1[0] + sx, p1[1], p1[2] + sz,
        p0[0] - sx, p0[1], p0[2] - sz, p1[0] + sx, p1[1], p1[2] + sz, p0[0] + sx, p0[1], p0[2] + sz,
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      const L = Math.hypot(r.c1 - r.c0, r.h1 - r.h0);
      const sz3 = [];
      for (let i = 0; i < 6; i++) sz3.push(L, half * 2, 0);
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz3, 3));
      return g;
    });
    if (rampPanels.length) {
      const m = new THREE.Mesh(mergeGeometries(rampPanels), accentMaterial(theme.line));
      m.renderOrder = 3;
      this.group.add(m);
    }

    // ---- turn signs
    // One texture per direction, front side only: seen from behind (after the turn, or looking
    // back) a double-sided plane shows the arrow mirrored, i.e. pointing the wrong way.
    const sideMat = (dir) => new THREE.MeshBasicMaterial({
      map: arrowTexture('#' + hazard.getHexString(), dir), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.FrontSide,
    });
    const signMat = { 1: sideMat(1), '-1': sideMat(-1) };
    const pivMat = (dir) => new THREE.MeshBasicMaterial({
      map: arrowTexture('#' + new THREE.Color(PIVOT_COLOR).getHexString(), dir), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.FrontSide,
    });
    const pivSignMat = { 1: pivMat(1), '-1': pivMat(-1) };
    // route markers use the level's own accent so they read apart from turn signs; one material
    // per label (SKILL / SPEED / HIGH LINE)
    const altMats = new Map();
    const altMat = (label = 'SKILL LINE') => {
      if (!altMats.has(label)) {
        altMats.set(label, new THREE.MeshBasicMaterial({
          map: arrowTexture('#' + new THREE.Color(theme.line).getHexString(), 0, label), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, color: new THREE.Color(2.4, 2.4, 2.4), side: THREE.FrontSide,
        }));
      }
      return altMats.get(label);
    };
    for (const s of track.signs) {
      const alt = s.kind === 'alt';
      const mat = alt ? altMat(s.label) : (s.kind === 'pivot' ? pivSignMat : signMat)[s.td > 0 ? 1 : -1];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(alt ? 2.4 : 4, alt ? 1.2 : 2), mat);
      m.position.set(s.x, s.y, s.z);
      m.rotation.y = s.yaw;   // plane normal faces back down the approach; its +x is the racer's right
      this.group.add(m);
    }

    this.buildGates(track, theme);
    this.buildMovers(track, theme, envMap);
    this.buildAnchors(track, theme);
  }

  /**
   * Moving platforms: one mesh each, built at the base position and offset every frame from
   * the live collision box (the sim moves them; the view only follows). Bright hazard edges and
   * a direction rail underneath show which way each one travels.
   */
  buildMovers(track, theme, envMap) {
    this.movers = [];
    const mat = monolithMaterial(theme);
    const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HAZARD_COLOR).multiplyScalar(1.1) });
    const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.line).multiplyScalar(1.6), transparent: true, opacity: 0.2, depthWrite: false });
    for (const o of track.movers ?? []) {
      const B = o.base;
      const g = infoBox(B, 7, 0);
      g.deleteAttribute('uv');
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const box = new THREE.BoxGeometry(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0);
      box.translate((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMat));
      box.dispose();
      this.group.add(mesh);
      // guide rail: a thin bar under the platform spanning its whole travel
      const S = o.sweep;
      const m = o.mover;
      const cx = (B.x0 + B.x1) / 2;
      const cz = (B.z0 + B.z1) / 2;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(
        m.ax ? S.x1 - S.x0 : 0.12, m.ay ? S.y1 - S.y0 + 1.5 : 0.12, m.az ? S.z1 - S.z0 : 0.12,
      ), railMat);
      rail.position.set(cx, m.ay ? (S.y0 + S.y1) / 2 - 0.75 : B.y0 - 0.5, cz);
      this.group.add(rail);
      this.movers.push({ o, mesh });
    }
  }

  /**
   * Grapple anchors. They have to read from far off against the void, and the two kinds must
   * never be confused, so they differ in colour, shape and motion:
   *  - swing nodes (overhead pendulum) wear the hazard acid: a hot octahedron in gimbal rings that
   *    stand upright in the plane you swing through, a beacon beaming up, a plumb line down.
   *  - pivot posts (horizontal whip turns) wear their own orange: a tall light pole with collars
   *    riding it, a flat spinning crown, and the whip itself drawn in the air: a faint ring at the
   *    radius you will be carried round, the arc you fly lit, with chevrons racing along it the
   *    way it turns you.
   * Every node carries a soft halo that never shrinks below a few degrees of view. The node a
   * press would fire at (or the one the line is on) flares: see setTarget().
   */
  buildAnchors(track, theme) {
    this.anchors = [];
    this.target = null;
    const glow = glowTexture();
    const beam = beamTexture();
    const coreGeo = new THREE.OctahedronGeometry(0.7, 0);
    const spikeGeo = new THREE.OctahedronGeometry(0.5, 0);
    spikeGeo.scale(1, 2.2, 1);
    const ringGeo = new THREE.TorusGeometry(1.5, 0.07, 6, 48);
    const ring2Geo = new THREE.TorusGeometry(2.2, 0.035, 4, 64);
    const crownGeo = new THREE.TorusGeometry(1.15, 0.09, 4, 6);   // hexagonal: reads apart from the round swing rings
    crownGeo.rotateX(Math.PI / 2);
    const collarGeo = new THREE.TorusGeometry(0.75, 0.06, 4, 32);
    collarGeo.rotateX(Math.PI / 2);
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.13, 1, 8, 1, true);
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.translate(0, 0.5, 0);
    const chevGeo = new THREE.BufferGeometry();
    // upright chevron pointing along +x (turned onto the arc's tangent): it has to read from the
    // run-up, where anything lying flat at foot height is seen edge-on
    chevGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.55, 0, 0, -0.25, -0.5, 0, 0, 0, 0,
      0.55, 0, 0, 0, 0, 0, -0.25, 0.5, 0,
    ], 3));
    for (const a of track.anchors ?? []) {
      const piv = a.kind === 'pivot';
      const acc = new THREE.Color(piv ? PIVOT_COLOR : HAZARD_COLOR);
      const hot = (k) => acc.clone().multiplyScalar(k);
      const g = new THREE.Group();
      g.position.set(a.x, a.y, a.z);
      const core = new THREE.Mesh(piv ? spikeGeo : coreGeo, new THREE.MeshBasicMaterial({ color: hot(2.4) }));
      const ring = new THREE.Mesh(piv ? crownGeo : ringGeo, new THREE.MeshBasicMaterial({ color: hot(2) }));
      ring.rotation.order = 'YXZ';
      const ring2 = new THREE.Mesh(ring2Geo, new THREE.MeshBasicMaterial({ color: hot(1.2), transparent: true, opacity: 0.75 }));
      // swing rings stand upright in the swing plane (facing across the heading)
      const yaw = a.dir ? Math.atan2(a.dir.x, a.dir.z) : 0;
      if (piv) ring2.visible = false;
      else ring2.rotation.set(0, yaw + Math.PI / 2, 0);
      // halo: additive sprite, kept a minimum on-screen size by update()
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: hot(0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
      }));
      halo.renderOrder = 4;
      g.add(core, ring, ring2, halo);
      // beacon: two crossed additive sheets fading upward
      const beamMat = new THREE.MeshBasicMaterial({
        map: beam, color: hot(piv ? 0.9 : 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      for (const ry of [0, Math.PI / 2]) {
        const sh = new THREE.Mesh(beamGeo, beamMat);
        sh.scale.set(piv ? 0.9 : 1.4, piv ? 9 : 46, 1);
        sh.position.y = piv ? 0.3 : 1.2;
        sh.rotation.y = ry + Math.PI / 4;
        g.add(sh);
      }
      const collars = [];
      const chevs = [];
      let whipMat = null;
      if (piv) {
        // light pole: from deep below to above head height, with collars riding up it
        const pole = new THREE.Mesh(poleGeo, new THREE.MeshBasicMaterial({ color: hot(1.8) }));
        pole.scale.set(1, 22, 1);
        pole.position.y = -3;
        g.add(pole);
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(collarGeo, new THREE.MeshBasicMaterial({ color: hot(2.2), transparent: true, opacity: 0.9 }));
          g.add(c);
          collars.push(c);
        }
        if (a.arc) {
          // the whip, drawn where your feet will fly: the full circle faint, the arc you ride lit
          const { r: R, a0, sweep } = a.arc;
          const yA = a.arc.y - a.y - 0.15;
          const circ = [];
          for (let k = 0; k <= 96; k++) {
            const t = (k / 96) * Math.PI * 2;
            circ.push(new THREE.Vector3(Math.cos(t) * R, yA, Math.sin(t) * R));
          }
          const ringMat = new THREE.LineDashedMaterial({ color: hot(1.4), dashSize: 0.35, gapSize: 0.35, transparent: true, opacity: 0.55, depthWrite: false });
          const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circ), ringMat);
          ringLine.computeLineDistances();
          g.add(ringLine);
          const arcPts = [];
          const n = Math.max(8, Math.round(Math.abs(sweep) * 16));
          for (let k = 0; k <= n; k++) {
            const t = a0 + (sweep * k) / n;
            arcPts.push(new THREE.Vector3(Math.cos(t) * R, yA, Math.sin(t) * R));
          }
          // an upright ribbon fence along the arc you ride (fading downward), lit along its top
          const band = [];
          const top = [];
          const hb = 1.0;
          for (let k = 0; k < n; k++) {
            const p0 = arcPts[k]; const p1 = arcPts[k + 1];
            band.push(p0.x, yA - hb, p0.z, p0.x, yA, p0.z, p1.x, yA, p1.z, p0.x, yA - hb, p0.z, p1.x, yA, p1.z, p1.x, yA - hb, p1.z);
          }
          for (const p of arcPts) top.push(p.x, yA, p.z);
          const bandGeo = new THREE.BufferGeometry();
          bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
          const fade = [];
          for (let k = 0; k < n; k++) fade.push(0, 1, 1, 0, 1, 0);
          bandGeo.setAttribute('color', new THREE.Float32BufferAttribute(fade.flatMap((v) => [v, v, v]), 3));
          whipMat = new THREE.MeshBasicMaterial({ color: hot(1.8), vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
          g.add(new THREE.Mesh(bandGeo, whipMat));
          const topLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(top, 3)),
            new THREE.LineBasicMaterial({ color: hot(2.4), transparent: true, opacity: 0.95, depthWrite: false }));
          g.add(topLine);
          const chevMat = new THREE.MeshBasicMaterial({ color: hot(2.4), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
          const nc = Math.max(3, Math.round(Math.abs(sweep) * R * 0.45));
          for (let k = 0; k < nc; k++) {
            const m = new THREE.Mesh(chevGeo, chevMat.clone());
            m.scale.setScalar(1.4);
            m.position.y = yA + 0.35;
            g.add(m);
            chevs.push(m);
          }
        }
      } else {
        // plumb hairline down through the void: where the pendulum will carry you
        const pg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, -22, 0)]);
        g.add(new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: acc, transparent: true, opacity: 0.4, depthWrite: false })));
      }
      this.group.add(g);
      this.anchors.push({ a, g, core, ring, ring2, halo, collars, chevs, whipMat, beamMat, piv, yaw, flare: 0, ph: (a.x * 0.37 + a.z * 0.11) % 6.28 });
    }
  }

  /** The anchor a grapple press would fire at (or the one the line is on), or null. */
  setTarget(a) {
    this.target = a;
  }

  /** Follow the simulation: place each moving platform at its live collision box; spin anchors. */
  update(time = performance.now() / 1000, camera = null, dt = 1 / 60) {
    for (const { o, mesh } of this.movers ?? []) {
      mesh.position.set(o.x0 - o.base.x0, o.y0 - o.base.y0, o.z0 - o.base.z0);
    }
    for (const A of this.anchors ?? []) {
      const t = time + A.ph;
      const on = this.target === A.a;
      A.flare += ((on ? 1 : 0) - A.flare) * Math.min(1, dt * 10);
      const f = A.flare;
      const spin = 1 + f * 2.5;
      const k = (1 + Math.sin(t * 4) * 0.08) * (1 + f * 0.25);
      if (A.piv) {
        // the post spins flat, round the vertical: the axis it will turn you about
        A.core.rotation.set(0, t * 1.6 * spin, 0);
        A.ring.rotation.set(0, -t * 0.9 * spin, 0);
        A.core.scale.setScalar(k);
      } else {
        // the node tumbles in its upright rings, which rock in the swing plane
        A.core.rotation.set(t * 0.9 * spin, t * 1.3 * spin, 0);
        A.ring.rotation.set(Math.sin(t * 1.1) * 0.35, A.yaw + Math.PI / 2, 0);
        A.ring2.rotation.set(0, A.yaw + Math.PI / 2, t * 0.4 * spin);
        A.core.scale.setScalar(k);
      }
      if (A.chevs.length) {
        const { r: R, a0, sweep } = A.a.arc;
        const n = A.chevs.length;
        const dirS = Math.sign(sweep);
        for (let c = 0; c < n; c++) {
          const u = (c / n + time * (0.35 + f * 0.5)) % 1;
          const ang = a0 + sweep * u;
          const ch = A.chevs[c];
          ch.position.x = Math.cos(ang) * R;
          ch.position.z = Math.sin(ang) * R;
          // tangent of the travel direction (x/z plane; three's y-rotation turns +x toward -z)
          const tx = -Math.sin(ang) * dirS;
          const tz = Math.cos(ang) * dirS;
          ch.rotation.y = Math.atan2(-tz, tx);
          ch.material.opacity = Math.sin(u * Math.PI) * (0.55 + f * 0.45);
        }
        A.whipMat.opacity = 0.5 + f * 0.4;
      }
      for (let c = 0; c < A.collars.length; c++) {
        const y = (t * 0.6 + c / A.collars.length) % 1;
        A.collars[c].position.y = -2 + y * 3.6;
        A.collars[c].material.opacity = Math.sin(y * Math.PI) * (0.6 + f * 0.4);
      }
      // halo: at least ~4° of view wide wherever the node is, bigger and hotter when locked
      const d = camera ? camera.position.distanceTo(A.g.position) : 20;
      const sz = Math.max(A.piv ? 2.4 : 3.4, d * 0.06) * (1 + f * 0.5 + Math.sin(t * 3) * 0.05);
      A.halo.scale.set(sz, sz, 1);
      // close up the node itself carries it: the halo fades so it never washes out the view
      const near = Math.min(1, Math.max(0, (d - 6) / 14));
      A.halo.material.opacity = (0.12 + 0.45 * near) * (1 + f * 0.6);
      A.beamMat.opacity = 0.6 + f * 0.4;
    }
  }

  buildGates(track, theme) {
    const glow = new THREE.Color(theme.glow);
    const mk = (x, y, z, yaw, W, label, sub, color) => {
      const g = new THREE.Group();
      const H = 7;
      const frameMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8) });
      for (const sx of [-W / 2, W / 2]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, H + 2, 0.14), frameMat);
        p.position.set(sx, H / 2 - 1, 0);
        g.add(p);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 0.14), frameMat);
      top.position.set(0, H, 0);
      g.add(top);
      const tex = labelTexture([label, sub], { color: '#' + color.getHexString(), w: 1024, h: 160, size: 54, align: 'center', bar: false });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, W * 0.8 * (160 / 1024)),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(2, 2, 2), depthWrite: false, side: THREE.DoubleSide }));
      lbl.position.set(0, H + 1.1, 0);
      g.add(lbl);
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      this.group.add(g);
    };
    const sp = track.spawn;
    mk(sp.x - Math.sin(sp.yaw) * 6, sp.y, sp.z - Math.cos(sp.yaw) * 6, sp.yaw, 9.5, 'JACK.IN', 'sector link established  //  run', new THREE.Color(HAZARD_COLOR));
    const f = track.finishGate;
    mk(f.x, f.y, f.z, f.yaw, f.w + 1, 'CORE ACCESS', 'first process through takes the core', glow);
  }
}
