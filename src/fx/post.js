import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final "print" pass. Order: glitch slicing → speed edge-blur → chromatic split → god rays
// from the core → anamorphic streaks → lens dirt over bloom → speed lines → grade → grain.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uAberr: { value: 0.002 },
    uGrain: { value: 0.065 },
    uStreak: { value: 0.22 },
    uFlash: { value: 0 },
    uGlitch: { value: 0 },
    uTint: { value: new THREE.Color(0xdde8ff) },
    uVignette: { value: 0.5 },
    uSpeed: { value: 0 },
    uLight: { value: new THREE.Vector3(0.5, 0.5, 0) },   // xy screen uv of the core, z = visibility
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uDesat: { value: 0 },
    uDirt: { value: 0.18 },
    uFlow: { value: 0 },
    uAscii: { value: 0 },       // 0..1: impact "terminal" mode — the frame collapses into glyphs
    tGlyph: { value: null },
    uGlyphN: { value: 16 },
        uKick: { value: 0 },
    uSky: { value: 0 },         // lightning flash
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tBloom;
    uniform vec2 uRes;
    uniform float uTime, uAberr, uGrain, uStreak, uFlash, uGlitch, uVignette, uSpeed, uDesat, uDirt, uFlow;
    uniform float uAscii, uGlyphN, uKick, uSky;
    uniform sampler2D tGlyph;
    uniform vec3 uTint, uLight, uLightColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    vec3 bright(vec2 uv, float th) { vec3 c = texture2D(tDiffuse, uv).rgb; return max(c - th, 0.0); }
    void main() {
      vec2 uv = vUv;
      if (uGlitch > 0.0) {
        float t = floor(uTime * 24.0);
        float band = floor(uv.y * 36.0);
        float r = hash(vec2(band, t));
        if (r < uGlitch * 0.6) uv.x += (hash(vec2(band, t + 1.0)) - 0.5) * 0.12 * uGlitch;
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float aspect = uRes.x / uRes.y;

      // speed: radial blur that leaves the centre sharp (tunnel focus at speed)
      vec3 col = vec3(0.0);
      float edge = smoothstep(0.03, 0.25, r2) * uSpeed;
      vec2 off = c * uAberr * (0.6 + r2 * 5.0);
      const int BS = 8;
      for (int i = 0; i < BS; i++) {
        float k = 1.0 - float(i) / float(BS) * edge * 0.09;
        vec2 suv = 0.5 + c * k;
        col.r += texture2D(tDiffuse, suv + off).r;
        col.g += texture2D(tDiffuse, suv).g;
        col.b += texture2D(tDiffuse, suv - off * 1.4).b;
      }
      col /= float(BS);

      // god rays from the core
      if (uLight.z > 0.001) {
        vec2 d = (uLight.xy - uv) / 36.0;
        vec2 p = uv;
        float dec = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 36; i++) {
          p += d;
          acc += bright(p, 0.75) * dec;
          dec *= 0.955;
        }
        col += acc / 36.0 * uLight.z * uLightColor * 1.4;
      }

      // anamorphic horizontal streaks from bright points
      vec3 s = vec3(0.0);
      float px = 1.0 / uRes.x;
      for (int i = 1; i <= 12; i++) {
        float fi = float(i);
        float w = 1.0 - fi / 13.0;
        vec2 o = vec2(fi * fi * 1.8 * px, 0.0);
        s += (bright(uv + o, 0.9) + bright(uv - o, 0.9)) * w * w;
      }
      col += s * uStreak * vec3(0.55, 0.75, 1.0);

      // lens dirt lit by bloom
      vec3 bl = texture2D(tBloom, uv).rgb;
      float dirt = vnoise(uv * vec2(aspect, 1.0) * 7.0) * 0.6 + vnoise(uv * vec2(aspect, 1.0) * 23.0 + 4.0) * 0.4;
      dirt = smoothstep(0.45, 0.95, dirt) + smoothstep(0.985, 1.0, hash(floor(uv * uRes / 3.0))) * 0.6;
      col += bl * dirt * uDirt;

      // speed lines: thin radial streaks in the periphery
      if (uSpeed > 0.01) {
        float ang = atan(c.y, c.x * aspect);
        float bin = floor(ang * 90.0);
        float h = hash(vec2(bin, 1.0));
        float rr = length(c * vec2(aspect, 1.0));
        float lane = fract(rr * 1.6 - uTime * (1.4 + h * 2.0) - h * 9.0);
        float thin = 1.0 - smoothstep(0.0, 0.35, abs(fract(ang * 90.0) - 0.5) * 2.0);
        float line = step(0.8, h) * smoothstep(0.0, 0.2, lane) * (1.0 - smoothstep(0.35, 0.6, lane)) * thin;
        col += vec3(0.75, 0.85, 1.0) * line * smoothstep(0.25, 0.6, rr) * uSpeed * 0.35;
      }

      // grade: cool steel highlights, flow warms toward the acid accent
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, lum * uTint, 0.16);
      col = mix(col, vec3(lum), uDesat);
      col += vec3(0.04, 0.05, 0.0) * uFlow * smoothstep(0.2, 0.8, r2 * 2.0);
      col = col * 0.97 + 0.012;

      // scanlines + vignette (tightens with speed)
      col *= 0.985 + 0.015 * sin(uv.y * uRes.y * 3.14159);
      float vig = smoothstep(0.85 - uSpeed * 0.12, 0.2, length(c * vec2(1.0, 0.9)));
      col *= mix(1.0 - uVignette - uSpeed * 0.15, 1.0, vig);

      // beat: the frame breathes with the kick
      col *= 1.0 + uKick * 0.06;
      col += uLightColor * uSky * 0.05 * smoothstep(0.0, 0.6, vUv.y);

      // ---- ASCII impact: a light glyph overlay in the scene's own colours (no tint, no grade
      // change) — only edges and bright areas pick up characters, and it tears in by bands.
      if (uAscii > 0.001) {
        float scale = uRes.y / 720.0;
        vec2 cellPx = vec2(7.0, 11.0) * max(scale, 0.75);
        vec2 px = vUv * uRes;
        vec2 cell = floor(px / cellPx);
        vec2 cuv = (cell + 0.5) * cellPx / uRes;
        vec3 src = texture2D(tDiffuse, cuv).rgb;
        float l = 1.0 - exp(-dot(src, vec3(0.3, 0.55, 0.15)) * 1.3);
        vec3 srcR = texture2D(tDiffuse, cuv + vec2(cellPx.x / uRes.x, 0.0)).rgb;
        vec3 srcU = texture2D(tDiffuse, cuv + vec2(0.0, cellPx.y / uRes.y)).rgb;
        float ed = clamp((length(src - srcR) + length(src - srcU)) * 1.5, 0.0, 1.0);
        float w = max(ed, smoothstep(0.35, 0.8, l) * 0.6);
        float jitter = (hash(cell + floor(uTime * 18.0)) - 0.5) * 0.1;
        float gi = floor(clamp(l * 0.7 + ed * 0.3 + jitter, 0.0, 0.999) * uGlyphN);
        vec2 inCell = fract(px / cellPx);
        float glyph = texture2D(tGlyph, vec2((gi + inCell.x) / uGlyphN, inCell.y)).r;
        // glyphs carry the source hue, lifted slightly so they read over it
        vec3 gc = normalize(src + 0.02) * (0.45 + l);
        float band = hash(vec2(floor(px.y / (cellPx.y * 3.0)), floor(uTime * 12.0)));
        float on = step(band, uAscii * 0.9) * uAscii;
        col = mix(col, col * 0.82 + glyph * gc * 0.55, on * w * 0.55);
      }

      float g = hash(uv * uRes + fract(uTime * 7.13) * 431.0) - 0.5;
      col += g * uGrain * (0.6 + 0.6 * (1.0 - lum));
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Glyph atlas for the ASCII mode: 16 cells ordered from empty to dense. */
function glyphAtlas() {
  const chars = ' .·:-=+*/<>#%&@█';
  const W = 24;
  const H = 40;
  const c = document.createElement('canvas');
  c.width = W * chars.length;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, H);
  g.fillStyle = '#fff';
  g.font = `bold ${H * 0.82}px "Share Tech Mono", ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...chars].forEach((ch, i) => g.fillText(ch, i * W + W / 2, H / 2 + 1));
  const t = new THREE.CanvasTexture(c);
  t.flipY = true;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return { tex: t, n: chars.length };
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.5, 1.45);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);

  const u = final.uniforms;
  u.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
  const atlas = glyphAtlas();
  u.tGlyph.value = atlas.tex;
  u.uGlyphN.value = atlas.n;
  return {
    composer,
    bloom,
    uniforms: u,
    setSize(w, h) {
      composer.setSize(w, h);
      const p = renderer.getPixelRatio();
      u.uRes.value.set(w * p, h * p);
      u.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
    },
    render(time) {
      u.uTime.value = time;
      composer.render();
    },
  };
}
