import * as THREE from 'three';
import { shared, noiseGLSL } from '../fx/shared.js';

/** Infinite backdrop: storm-cloud fbm, light rays radiating from the core, horizon flare. */
export class Sky {
  constructor() {
    this.uniforms = {
      ...shared,
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uCloud: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGlowDir: { value: new THREE.Vector3(0, 0.05, -1).normalize() },
      uGlowPower: { value: 1 },
      uFlash: { value: 0 },
      uNebula: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBottom, uCloud, uGlow, uGlowDir, uNebula;
        uniform float uTime, uGlowPower, uFlash, uKick, uBeat;
        varying vec3 vDir;
        ${noiseGLSL}
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
          col = mix(col, uBottom, smoothstep(0.0, -0.45, h));

          // storm clouds: two fbm layers, stretched horizontally
          vec3 q = d * vec3(2.2, 4.5, 2.2);
          float n = fbm(q + vec3(uTime * 0.008, 0.0, uTime * 0.004));
          float n2 = fbm(q * 2.7 - vec3(uTime * 0.015, 0.0, 0.0) + n);
          float cloud = smoothstep(0.35, 0.85, n * 0.65 + n2 * 0.5);
          float band = 1.0 - smoothstep(0.0, 0.7, abs(h - 0.08));
          col += uCloud * cloud * band * 0.55;
          // lightning lights the storm from inside
          col += uCloud * cloud * uFlash * 2.2 + uGlow * uFlash * 0.05;

          // deep-space nebula filaments + star field (an abstract void, not a sky)
          vec3 nq = d * 3.1 + vec3(7.0, 1.0, 3.0);
          float neb = fbm(nq + fbm(nq * 1.7 + uTime * 0.004));
          float fil = pow(max(1.0 - abs(neb - 0.55) * 3.0, 0.0), 6.0);
          col += uNebula * clamp(fil, 0.0, 1.0) * 0.35 * (0.6 + 0.4 * smoothstep(-0.3, 0.6, h));
          vec3 sc = floor(d * 420.0);
          float st = hash13(sc);
          float tw = 0.6 + 0.4 * sin(uTime * (2.0 + st * 5.0) + st * 50.0);
          col += vec3(0.85, 0.9, 1.0) * step(0.9975, st) * tw * (1.0 - cloud) * 0.9;

          // vast slow sweeping scan plane through the void, pulsing on the beat
          float sw = fract(atan(d.z, d.x) / 6.2832 - uTime * 0.01) - 0.5;
          float sweep = exp(-sw * sw * 4000.0);
          col += uGlow * sweep * 0.03 * (1.0 + uKick);

          // core glow + god rays
          float g = max(dot(d, uGlowDir), 0.0);
          col += uGlow * (pow(g, 8.0) * 0.05 + pow(g, 60.0) * 0.3 + pow(g, 900.0) * 3.0) * uGlowPower;
          vec3 rel = normalize(d - uGlowDir * dot(d, uGlowDir) + 1e-5);
          vec3 ax = normalize(cross(uGlowDir, vec3(0.0, 1.0, 0.0)));
          vec3 ay = cross(ax, uGlowDir);
          float ang = atan(dot(rel, ay), dot(rel, ax));
          float rays = vnoise(vec3(ang * 9.0, uTime * 0.05, 0.0)) * vnoise(vec3(ang * 23.0, -uTime * 0.03, 3.0));
          col += uGlow * pow(rays, 2.0) * pow(g, 6.0) * 0.3 * uGlowPower * (0.6 + cloud);

          // horizontal anamorphic flare band through the core
          float horiz = exp(-abs(dot(d, ay)) * 70.0) * pow(g, 3.0);
          col += uGlow * horiz * 0.35 * uGlowPower;

          // faint lat/long hairlines (sky is a "display")
          float lat = abs(fract(h * 18.0) - 0.5);
          col += uHorizon * smoothstep(0.49, 0.5, 1.0 - lat) * (0.04 + uKick * 0.03);

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setTheme(t) {
    const u = this.uniforms;
    u.uTop.value.set(t.skyTop);
    u.uHorizon.value.set(t.skyHorizon);
    u.uBottom.value.set(t.skyBottom);
    u.uCloud.value.set(t.cloud);
    u.uGlow.value.set(t.glow);
    u.uNebula.value.set(t.nebula ?? t.line);
  }

  update(camera, corePos) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uGlowDir.value.copy(corePos).sub(camera.position).normalize();
  }
}
