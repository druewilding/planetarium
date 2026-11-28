// Deep-sky objects as soft glows on the sky: an oval each, true to size and tilt,
// brightest in the middle. Whether you can see one, and how much of it, comes from
// how bright it is against the sky behind it, worked out the same way as in
// deepsky.js (which the labels and the info panel use): so like the Milky Way they
// show on dark nights, fade in moonlight and twilight, and wash out over a city.
// Zoomed in, the small ones show better, as through binoculars or a telescope.

import * as THREE from "three";

import { deepSkyTint, SEEING_GLSL } from "../deepsky.js";

const f = (v) => v.toExponential(6);

export function createDeepSky(shared, glsl, objects, radius = 1000) {
  const drawn = objects.filter((o) => o.glow != null);
  const n = drawn.length;
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const shape = new Float32Array(n * 4 * 3);
  const light = new Float32Array(n * 4 * 2);
  const tint = new Float32Array(n * 4 * 3);
  const index = [];
  const D2R = Math.PI / 180;
  drawn.forEach((o, i) => {
    const a = o.ra * D2R;
    const d = o.dec * D2R;
    const c = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
    const area = (Math.PI / 4) * o.major * o.minor * 3600; // square arcseconds
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      pos.set(c, v * 3);
      corner.set([k & 1 ? 1 : -1, k & 2 ? 1 : -1], v * 2);
      shape.set([(o.major / 120) * D2R, (o.minor / 120) * D2R, o.pa * D2R], v * 3);
      light.set([10 ** (-0.4 * o.glow), area], v * 2);
      tint.set(deepSkyTint(o.type), v * 3);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  geom.setAttribute("aShape", new THREE.BufferAttribute(shape, 3));
  geom.setAttribute("aLight", new THREE.BufferAttribute(light, 2));
  geom.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));
  geom.setIndex(index);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uRadius: { value: radius },
      uMinRadius: { value: 0.001 }, // radians: the smallest oval drawn (a few pixels)
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      ${glsl.SKY_LOOKUP}
      ${glsl.LAND}
      ${glsl.REFRACTION}
      ${glsl.PROJECTION}
      ${glsl.SEEING}
      uniform float uExtK;
      uniform float uBoost;
      uniform float uRadius;
      uniform float uMinRadius;
      attribute vec2 aCorner;
      attribute vec3 aShape; // half its length and width (radians), its tilt (radians, north through east)
      attribute vec2 aLight; // its glow's light (relative to magnitude 0), its area (square arcseconds)
      attribute vec3 aTint;
      varying vec2 vUv;
      varying float vSeen;
      varying float vContrast;
      varying vec3 vTint;

      void main() {
        vec3 c = normalize(position);
        // North and east on the sky, there (the frame is J2000's: z is the north pole).
        vec3 east = cross(vec3(0.0, 0.0, 1.0), c);
        east = length(east) < 1e-6 ? vec3(0.0, 1.0, 0.0) : normalize(east);
        vec3 north = cross(c, east);
        vec3 along = north * cos(aShape.z) + east * sin(aShape.z);
        vec3 across = -north * sin(aShape.z) + east * cos(aShape.z);
        vec2 size = max(aShape.xy, vec2(uMinRadius));
        vec3 p = c + along * aCorner.y * size.x + across * aCorner.x * size.y;

        // How easily you'd see its middle (see seeing() in deepsky.js): 1 is only just.
        vec3 d0 = refractDir(normalize(mat3(modelMatrix) * c));
        float X = airmass(degrees(asin(clamp(d0.y, -1.0, 1.0))));
        float te = throughEarth(d0);
        float trans = pow(10.0, -0.4 * uExtK * mix(X, 1.0, te));
        vec3 behind = mix(skyAt(d0), THROUGH_EARTH_SKY, te);
        float L = max(dot(behind, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
        float mLim = limitingMag(L);
        float g = pow(10.0, 0.4 * uBoost);
        float spread = min(1.0, ${f(SEEING_GLSL.PEAK * SEEING_GLSL.RICCO)} / (aLight.y * g));
        vSeen = aLight.x * trans * g * spread / pow(10.0, -0.4 * mLim);
        // How much brighter its middle is than the sky there (cd/m² from magnitudes per square arcsecond).
        vContrast = 1.08e5 * aLight.x * trans * ${f(SEEING_GLSL.PEAK)} / aLight.y / L;
        vUv = aCorner;
        vTint = aTint;
        if (vSeen < 0.3) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // nowhere near: skip it
          return;
        }
        vec3 d = refractDir(normalize(mat3(modelMatrix) * normalize(p)));
        gl_Position = projectView(viewMatrix * vec4(d * uRadius, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeen;
      varying float vContrast;
      varying vec3 vTint;
      void main() {
        float r2 = dot(vUv, vUv);
        if (r2 > 1.0) discard;
        // Brightest in the middle, fading out towards its edge: you see as far out as
        // it's still bright enough against the sky.
        float profile = exp(-4.0 * r2);
        float q = vSeen * profile;
        float above = 2.5 * log(max(q, 1e-6)) / log(10.0); // magnitudes above the limit
        float vis = smoothstep(-0.4, 1.0, above) * (1.0 - smoothstep(0.55, 1.0, r2));
        // To the dark-adapted eye it's a soft, almost colourless glow, as bright as it is
        // against the sky: a big faint one stays faint however far you zoom in.
        float i = vis * min(0.4, 0.15 * sqrt(vContrast * profile)) * uOpacity;
        gl_FragColor = vec4(mix(vec3(1.0), vTint, 0.4) * i, 0.0); // additive
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.DoubleSide, // (seen from inside the sky, whichever way round the corners go)
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.5; // over the Milky Way, under the stars
  return {
    mesh,
    /** pxPerRad: how many pixels a radian is, in the middle of the view. */
    update(pxPerRad) {
      material.uniforms.uMinRadius.value = 3 / pxPerRad;
    },
  };
}
