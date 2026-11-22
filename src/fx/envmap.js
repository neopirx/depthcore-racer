import * as THREE from 'three';

/**
 * Builds a synthetic "studio" environment for liquid-chrome reflections:
 * a dark gradient dome with hard, bright softbox strips. The strips are what make
 * Y2K chrome read as chrome — long sharp highlights rather than a blurry sky.
 */
export function createEnvMap(renderer, theme) {
  const scene = new THREE.Scene();
  const [c0, c1, c2] = theme.env.map((c) => new THREE.Color(c));

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(theme.env[0]).multiplyScalar(0.55) },
        hor: { value: new THREE.Color(theme.env[2]).multiplyScalar(1.6) },
        mid: { value: new THREE.Color(theme.skyHorizon).multiplyScalar(0.5) },
        bot: { value: new THREE.Color(theme.fog).multiplyScalar(0.3) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, hor, mid, bot; varying vec3 vP;
        void main(){ float h = normalize(vP).y;
          // sky fades from top down to a bright horizon line, then a hard cut to dark ground
          vec3 c = mix(hor, top, smoothstep(0.0, 0.7, h));
          vec3 g = mix(mid, bot, smoothstep(-0.02, -0.5, h));
          c = h > 0.0 ? c : g;
          gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(dome);

  const strip = (w, h, color, intensity, pos, lookAt = new THREE.Vector3()) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(lookAt);
    scene.add(m);
  };

  // Overhead key softbox
  strip(60, 5, c0, 2.5, new THREE.Vector3(0, 30, 0));
  // Ring of horizontal light bars at horizon
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const y = (i % 3) * 6 - 4;
    strip(28, 0.6 + (i % 2) * 0.6, i % 3 === 1 ? c1 : c0, 2 + (i % 2) * 1.5,
      new THREE.Vector3(Math.cos(a) * 38, y, Math.sin(a) * 38));
  }
  // Tall vertical strips — give long vertical highlights on blades
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    strip(0.8, 60, c2, 2.5, new THREE.Vector3(Math.cos(a) * 32, 0, Math.sin(a) * 32));
  }
  // Coloured bounce from below
  strip(70, 70, c1, 0.08, new THREE.Vector3(0, -30, 0));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.015);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}
