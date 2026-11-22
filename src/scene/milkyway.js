// The Milky Way: NASA's all-sky map of its diffuse glow (stars removed, since we
// draw our own), on a sphere in the J2000 frame so it turns with the stars.
//
// Like the stars, its visibility comes from contrast with the sky behind it:
// gone in daylight, washed out by moonlight and twilight, and clearest on a
// dark, moonless night (or with the Sun dimmed).

import * as THREE from "three";

// Brightest parts (Sagittarius star clouds) ≈ 20.3 mag/arcsec² ≈ 8e-4 cd/m².
const PEAK_LUMINANCE = 8e-4;

export function createMilkyWay(shared, glsl, texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter; // no mipmaps: avoids a seam where RA wraps around
  texture.generateMipmaps = false;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uMap: { value: texture },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      ${glsl.PROJECTION}
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vLocal = normalize(position);
        vWorld = normalize(mat3(modelMatrix) * position);
        gl_Position = projectView(viewMatrix * modelMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.SKY_LOOKUP}
      uniform sampler2D uMap;
      uniform float uExtK;
      uniform float uOpacity;
      varying vec3 vLocal;
      varying vec3 vWorld;
      const float PI = 3.14159265359;
      void main() {
        vec3 l = normalize(vLocal);
        vec3 w = normalize(vWorld);
        // NASA's map: equirectangular, RA 0h in the middle, increasing to the left.
        float ra = atan(l.y, l.x);
        float dec = asin(clamp(l.z, -1.0, 1.0));
        vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI);
        vec3 c = pow(texture2D(uMap, uv).rgb, vec3(2.2)); // 0…1, 1 ≈ the brightest parts
        float rel = dot(c, vec3(0.2126, 0.7152, 0.0722));

        // Dimmed near the horizon by the atmosphere (same airmass model as the stars).
        float h = max(degrees(asin(clamp(w.y, -1.0, 1.0))), -1.5);
        float X = 1.0 / (sin(radians(h)) + 0.50572 * pow(h + 6.07995, -1.6364));
        float trans = pow(10.0, -0.4 * uExtK * X);

        // Visible only where it stands out against the sky behind it.
        float sky = max(dot(skyAt(w), vec3(0.2126, 0.7152, 0.0722)), 1e-7);
        float contrast = rel * ${PEAK_LUMINANCE.toExponential()} * trans / sky;
        float vis = smoothstep(0.04, 0.6, contrast);

        // To the dark-adapted eye it's a soft, mostly colourless glow.
        vec3 tint = mix(vec3(rel), c, 0.35);
        vec3 col = tint * pow(max(rel, 1e-4), -0.55) * 0.3 * vis * uOpacity; // lift the fainter arms
        gl_FragColor = vec4(col, 0.0); // additive
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 128, 64), material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return mesh;
}
