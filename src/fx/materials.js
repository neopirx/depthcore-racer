import * as THREE from 'three';
import { shared, fogGLSL } from './shared.js';

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float aaLine(float x, float w) {
  float d = abs(fract(x + 0.5) - 0.5);
  float fw = max(fwidth(x), 1e-4);
  return 1.0 - smoothstep(w * fw, (w + 1.2) * fw, d);
}
`;

/**
 * Course material: abstract digital monoliths. A MeshPhysicalMaterial (env reflections, clearcoat,
 * shadows) with world-space detail injected — no windows, no facades, nothing from the real world:
 *  - every box edge is a crisp glowing hairline, so the silhouette of every platform reads at speed
 *  - tops: a fine digital grid, a bright perimeter + inset dashed line, sparse data cells on the beat
 *  - sides: thin scan bands, falling data columns, a light wash that dissolves into the void below
 *  - wallrun panels (kind 1): holographic glass ribs; pillars/pads (3, 4): ringed light bands
 * Per-box data: aInfo = (top, seed, kind, y0), aBox = (x0, z0, x1, z1).
 */
export function monolithMaterial(theme) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0b0d12,
    metalness: 0.85,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.38,
  });
  const line = new THREE.Color(theme.line);
  const u = {
    uTime: shared.uTime,
    uKick: shared.uKick,
    uBeat: shared.uBeat,
    uLine: { value: line.clone().multiplyScalar(1.5) },
    uGlow: { value: new THREE.Color(theme.glow).multiplyScalar(2.4) },
    uEdge: { value: line.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(2.2) },
    uDeck: { value: new THREE.Color(theme.chromeDark).multiplyScalar(0.55) },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aInfo; attribute vec4 aBox;
        varying vec3 vWP; varying vec3 vWN; varying vec4 vInfo; varying vec4 vBox;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vInfo = aInfo; vBox = aBox;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uKick, uBeat; uniform vec3 uLine, uGlow, uEdge, uDeck;
        varying vec3 vWP; varying vec3 vWN; varying vec4 vInfo; varying vec4 vBox;
        ${HASH}
        float edgeLine(float d, float w) { float f = max(fwidth(d), 1e-4); return 1.0 - smoothstep(w, w + f * 1.5, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float top = vInfo.x; float seed = vInfo.y; float kind = vInfo.z; float y0 = vInfo.w;
        float depth = top - vWP.y;
        float H = max(top - y0, 0.01);
        vec3 an = abs(vWN);
        // distance to every box edge on this face
        float dx = min(vWP.x - vBox.x, vBox.z - vWP.x);
        float dz = min(vWP.z - vBox.y, vBox.w - vWP.z);
        float dy = min(vWP.y - y0, top - vWP.y);
        float eD = max(an.x > 0.5 ? min(dy, dz) : (an.y > 0.5 ? min(dx, dz) : min(dx, dy)), 0.0);
        float edge = edgeLine(eD, 0.025);
        float halo = exp(-eD * 9.0);
        vec3 pEmis = vec3(0.0); float pRough = 1.0; float pDark = 1.0;
        // lines right in front of the eyes (climbing a lip, hugging a wall) would bloom out the view
        float near = smoothstep(0.5, 3.5, length(cameraPosition - vWP));
        float pulse = (0.65 + 0.7 * uKick) * mix(0.12, 1.0, near);
        edge *= mix(0.15, 1.0, near);
        halo *= near;
        if (vWN.y > 0.5) {
          // ---- deck: digital grid
          vec2 p = vWP.xz;
          float minor = max(aaLine(p.x * 2.0, 0.25), aaLine(p.y * 2.0, 0.25));
          float major = max(aaLine(p.x / 2.0, 0.5), aaLine(p.y / 2.0, 0.5));
          vec2 cell = floor(p * 2.0);
          float h = hash12(cell + seed * 11.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDeck, 0.5);
          pDark = mix(0.85, 1.15, h) * (1.0 - major * 0.4);
          pRough = mix(0.6, 1.4, h);
          // data cells blinking on the beat
          float blink = step(0.985, hash12(cell + floor(uBeat) * 0.37 + seed));
          pEmis += uLine * (minor * 0.035 + major * 0.11) * pulse;
          pEmis += uLine * blink * 0.25 * (1.0 - fract(uBeat));
          // inset dashed guide 0.35 m in from the edge
          float inset = edgeLine(abs(eD - 0.35), 0.012) * step(0.5, fract((p.x + p.y) * 1.5));
          pEmis += uEdge * inset * 0.35;
          pEmis += uEdge * (edge * 1.4 + halo * 0.18) * pulse;
          // a sweep runs along the platforms
          float rq = fract((p.x - p.y) * 0.03 - uTime * 0.25) - 0.5;
          float run = exp(-rq * rq * 260.0);
          pEmis += uEdge * edge * run * 2.0;
        } else if (vWN.y < -0.5) {
          // ---- underside: faint grid glow, lit from below by the void
          vec2 p = vWP.xz;
          float g = max(aaLine(p.x, 0.4), aaLine(p.y, 0.4));
          pDark = 0.5;
          pEmis += uLine * g * 0.08 + uEdge * edge * 0.9;
        } else {
          // ---- sides
          float u = an.x > an.z ? vWP.z : vWP.x;
          float band = edgeLine(abs(fract(vWP.y * 0.5 + seed) - 0.5) * 2.0, 0.015);
          float colId = floor(u / 0.75);
          float colh = hash12(vec2(colId, seed * 3.0));
          float stream = (1.0 - smoothstep(0.0, 0.04, abs(fract(u / 0.75) - 0.5))) * step(0.86, colh);
          float dash = step(0.6, fract(vWP.y * 0.35 + uTime * (0.5 + colh * 1.6) + colh * 9.0));
          pRough = 0.5;
          pDark = 1.0;
          pEmis += uLine * band * 0.05;
          pEmis += uGlow * stream * dash * 0.5 * step(0.4, depth);
          if (kind > 0.5 && kind < 1.5) {
            // wallrun panels: holographic ribs, bright when the beat lands
            float rib = aaLine(u / 0.5, 0.5);
            float hrib = aaLine(vWP.y / 0.5, 0.3);
            pEmis += uLine * (rib * 0.22 + hrib * 0.06) * pulse;
            pRough = 0.12;
            pDark = 0.7;
          } else if (kind > 2.5) {
            // pillars / pads: rings of light sliding down
            float rg = fract(vWP.y * 0.25 + uTime * 0.6 + seed) - 0.5;
            float ring = exp(-rg * rg * 400.0);
            pEmis += uGlow * ring * 0.6;
          }
          pEmis += uEdge * (edge * 1.3 + halo * 0.12) * pulse;
          // dissolve into the void below
          float fade = clamp((vWP.y - y0) / min(H, 8.0), 0.0, 1.0);
          pDark *= mix(0.25, 1.0, fade);
          pEmis += uLine * pow(1.0 - fade, 3.0) * 0.12;
          // glow line just under the top lip
          pEmis += uEdge * edgeLine(abs(depth - 0.12), 0.012) * 0.8;
        }
        diffuseColor.rgb *= pDark;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * pRough, 0.04, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += clamp(pEmis, 0.0, 30.0);`);
  };
  mat.customProgramCacheKey = () => 'dc-monolith';
  return mat;
}

/**
 * Runner vision: additive animated chevron panels (wallrun bands, climb faces).
 * aSize = (length m, height m, mode) — mode 0: chevrons along x, 1: chevrons pointing up.
 */
export function accentMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uColor: { value: new THREE.Color(color).multiplyScalar(1.8) } },
    vertexShader: /* glsl */ `
      attribute vec3 aSize;
      varying vec2 vUv; varying vec3 vSize; varying float vDist;
      void main() {
        vUv = uv; vSize = aSize;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime;
      varying vec2 vUv; varying vec3 vSize; varying float vDist;
      ${fogGLSL}
      float line(float d, float w) { float f = fwidth(d); return 1.0 - smoothstep(w, w + f * 1.5, abs(d)); }
      void main() {
        float L = vSize.x; float H = vSize.y;
        float x = vUv.x * L; float y = vUv.y * H;
        float a = 0.0;
        if (vSize.z < 0.5) {
          // wallrun band: two rails + faint travelling chevrons + a soft wash
          // tip at the band's centre line, furthest along travel (+x): '>' scrolling forward
          float c = fract((x + abs(y - H * 0.5) * 0.9) / 2.2 - uTime * 1.4);
          a += smoothstep(0.0, 0.05, c) * (1.0 - smoothstep(0.08, 0.13, c)) * 0.32;
          a += line(y - 0.03, 0.02) * 1.2 + line(y - H + 0.03, 0.02) * 1.2;
          a += line(y - H * 0.5, 0.006) * 0.35;
          a += 0.012;
        } else {
          // '^' chevrons: tip at the centre, highest point, scrolling up
          float c = fract((y + abs(x - L * 0.5) * 0.6) / 1.1 - uTime * 1.1);
          a += smoothstep(0.0, 0.05, c) * (1.0 - smoothstep(0.1, 0.16, c)) * 0.35 + 0.03;
          a += line(x - 0.03, 0.025) + line(x - L + 0.03, 0.025);
          a += line(y - H + 0.05, 0.035) * 1.5;
        }
        float ends = smoothstep(0.0, 1.2, x) * smoothstep(0.0, 1.2, L - x);
        if (vSize.z > 0.5) ends = 1.0;
        a *= ends * fogAlpha(vDist) * (0.8 + 0.2 * sin(uTime * 6.0)) * smoothstep(0.8, 4.5, vDist);
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}
