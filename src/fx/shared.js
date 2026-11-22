import * as THREE from 'three';

// Uniforms shared by every custom shader (same object references => one update per frame).
export const shared = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0x000000) },
  uFogDensity: { value: 0.004 },
  uBeat: { value: 0 },     // music clock in beats (fx/beat.js)
  uKick: { value: 0 },     // kick-drum envelope
  uEnergy: { value: 0.4 }, // musical intensity
};

export const fogGLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 col, float dist) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
float fogAlpha(float dist) {
  return exp(-uFogDensity * uFogDensity * dist * dist);
}
`;

export const noiseGLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

/** Hologram / glass panel: hairline border, scan lines, travelling scan band. */
export function holoMaterial({
  color = 0xffffff, opacity = 0.5, lines = 24, vertical = false, fill = 0.06, scanSpeed = 0.15, intensity = 1.6,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uOpacity: { value: opacity },
      uLines: { value: lines },
      uFill: { value: fill },
      uScan: { value: scanSpeed },
      uVertical: { value: vertical ? 1 : 0 },
      uSeed: { value: Math.random() * 10 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uLines, uFill, uScan, uVertical, uSeed, uTime;
      varying vec2 vUv; varying float vDist;
      ${fogGLSL}
      void main() {
        vec2 uv = vUv;
        vec2 fw = fwidth(uv);
        vec2 e = min(uv, 1.0 - uv) / max(fw, vec2(1e-5));
        float border = 1.0 - clamp(min(e.x, e.y) - 0.5, 0.0, 1.0);
        float axis = mix(uv.y, uv.x, uVertical);
        float faxis = mix(fw.y, fw.x, uVertical);
        float l = fract(axis * uLines);
        float lines = 1.0 - clamp(min(l, 1.0 - l) / max(faxis * uLines, 1e-4) - 0.5, 0.0, 1.0);
        float bq = (fract(axis - uTime * uScan + uSeed) - 0.5) * 9.0;
        float band = exp(-bq * bq);
        float grad = mix(0.6, 1.0, 1.0 - uv.y);
        float a = uFill * grad + border * 0.9 + lines * 0.18 + band * 0.12;
        a *= uOpacity * fogAlpha(vDist);
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}

/** Canvas texture with small Y2K tech typography. */
export function labelTexture(lines, { color = '#ffffff', w = 512, h = 128, size = 26, align = 'left', bar = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.textAlign = align;
  g.textBaseline = 'top';
  const x = align === 'left' ? 8 : align === 'right' ? w - 8 : w / 2;
  let y = 8;
  lines.forEach((ln, i) => {
    const sz = i === 0 ? size : size * 0.5;
    g.font = `${i === 0 ? 400 : 400} ${sz}px Michroma, "Share Tech Mono", monospace`;
    g.fillText(ln, x, y);
    y += sz * 1.35;
  });
  if (bar) {
    g.fillRect(8, h - 10, w * 0.35, 2);
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.38 + i * 12, h - 12, 8, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Diagonal hazard stripe texture used as emissive map on hurdles. */
export function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 14, 0);
    g.lineTo(i + 14 + 128, 128);
    g.lineTo(i + 128, 128);
    g.closePath();
    g.fill();
  }
  g.fillRect(0, 0, 128, 6);
  g.fillRect(0, 122, 128, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
