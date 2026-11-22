import * as THREE from "three";

import { moonOrientation } from "../astro.js";

export const SUN_DISTANCE = 990;
export const MOON_DISTANCE = 980;

const SUN_LUMINANCE = 1.6e9; // cd/m² at the solar surface, seen from outside the atmosphere
const FULL_MOON_LUMINANCE = 2500; // average cd/m² of the full Moon's disc

/** The Sun: a limb-darkened disc plus a glare halo that scales with how dazzling it is. */
export function createSun(shared, glsl) {
  const uniforms = {
    ...shared,
    uSunL: { value: new THREE.Vector3() },
    uGlare: { value: 0 },
    uDiscFraction: { value: 0.05 },
    uDiscExposure: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      uniform vec3 uSunL;
      uniform float uGlare;
      uniform float uDiscFraction;
      uniform float uDiscExposure;
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        float r = length(vUv) / uDiscFraction; // 1.0 at the solar limb
        vec3 sky = skyAt(normalize(vDir));
        if (r < 1.0) {
          float mu = sqrt(1.0 - r * r);
          vec3 limb = vec3(0.3, 0.2, 0.15) + vec3(0.7, 0.8, 0.85) * mu; // limb darkening (R,G,B)
          // The disc gets its own exposure so a reddened, setting Sun keeps its colour.
          vec3 c = acesFilm(uSunL * limb * uDiscExposure + sky * uExposure);
          float edge = 1.0 - smoothstep(0.9, 1.0, r);
          gl_FragColor = vec4(linearToSrgb(c) * edge, edge);
          return;
        }
        float d = r - 1.0;
        float outer = 1.0 / uDiscFraction;
        float glare = uGlare * (0.45 / (1.0 + d * d * 1.5) + 0.1 * exp(-d * 0.6)) * (1.0 - smoothstep(0.5 * outer, outer, r));
        vec3 tint = normalize(uSunL + 1e-6) * 1.6;
        gl_FragColor = vec4(linearToSrgb(clamp(tint * glare, 0.0, 1.0)), 0.0); // additive
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;

  /** sky: computeSky().sun, transmit: RGB, dim: 0..1, exposure: current */
  function update(sun, transmit, dim, exposure, camera, uncovered = 1) {
    const angR = sun.angularRadius;
    const discRadius = Math.tan(angR) * SUN_DISTANCE;
    const glareScale = 12; // halo extends this many solar radii
    mesh.position.copy(sun.dir).multiplyScalar(SUN_DISTANCE);
    mesh.quaternion.copy(camera.quaternion);
    mesh.scale.setScalar(discRadius * 2 * glareScale);
    uniforms.uDiscFraction.value = 1 / glareScale;
    // Keep a faint disc visible even when the Sun is fully dimmed, so you can still find it.
    const level = Math.max(dim, 2e-9);
    const L = SUN_LUMINANCE * level;
    uniforms.uSunL.value.set(transmit[0] * L, transmit[1] * L, transmit[2] * L);
    uniforms.uDiscExposure.value = Math.min(exposure, 4 / L);
    const E = (sun.illuminance * dim * uncovered * (transmit[0] + transmit[1] + transmit[2])) / 3;
    uniforms.uGlare.value = 0.8 * (1 - Math.exp(-E * exposure * 0.02));
    mesh.visible = sun.alt > -2;
  }
  return { mesh, update };
}

/** The Moon: textured sphere lit from the Sun's true direction, plus earthshine. */
export function createMoon(shared, glsl, texture, textureMean) {
  const uniforms = {
    ...shared,
    uMap: { value: texture },
    uSunDir: { value: new THREE.Vector3() },
    uLit: { value: 0 },
    uEarthshine: { value: 0 },
    uTransmit: { value: new THREE.Vector3(1, 1, 1) },
    uMoonExposure: { value: 1 },
    uTexScale: { value: 1 / textureMean },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uLit;
      uniform float uEarthshine;
      uniform vec3 uTransmit;
      uniform float uMoonExposure;
      uniform float uTexScale;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(-vPos);
        vec3 albedo = texture2D(uMap, vUv).rgb;
        albedo = albedo * albedo * uTexScale; // texture is sRGB-ish; approximate linear
        float ci = max(dot(n, uSunDir), 0.0);
        float ce = max(dot(n, v), 0.0);
        float ls = 2.0 * ci / (ci + ce + 1e-4);        // Lommel–Seeliger: flat-looking full Moon
        float es = ce;                                    // earthshine comes from (roughly) the viewer
        // The eye adapts locally to the bright Moon, so the lit part uses its own exposure.
        vec3 x = albedo * uTransmit * (uLit * ls * uMoonExposure + uEarthshine * es * uExposure * 0.12);
        vec3 sky = skyAt(v * -1.0) * uExposure;
        vec3 c = acesFilm(x + sky);
        gl_FragColor = vec4(linearToSrgb(c), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.renderOrder = 5;
  mesh.matrixAutoUpdate = false;
  const basis = new THREE.Matrix4();

  function update(moon, sky, transmit, exposure) {
    const r = Math.tan(moon.angularRadius) * MOON_DISTANCE;
    moonOrientation(moon.axis, sky.eqjToWorld, basis);
    mesh.matrix
      .copy(basis)
      .scale(new THREE.Vector3(r, r, r))
      .setPosition(moon.dir.clone().multiplyScalar(MOON_DISTANCE));
    mesh.matrixWorldNeedsUpdate = true;
    uniforms.uSunDir.value.copy(moon.sunDir);
    uniforms.uTransmit.value.fromArray(transmit);
    // Luminance of the lit surface scales with the Sun–Moon distance only (phase comes from geometry).
    uniforms.uLit.value = FULL_MOON_LUMINANCE;
    // Earthshine: the Earth as seen from the Moon is "full" when the Moon is new.
    const earthPhase = 1 - moon.phaseFraction;
    uniforms.uEarthshine.value = FULL_MOON_LUMINANCE * 1.2e-4 * earthPhase * earthPhase;
    uniforms.uMoonExposure.value = Math.min(exposure, 0.9 / FULL_MOON_LUMINANCE);
    mesh.visible = moon.alt > -3;
  }
  return { mesh, update };
}

/** Ground: a dark hemisphere that fades into horizon haze. Can be made see-through. */
export function createGround(shared, glsl) {
  const uniforms = {
    ...shared,
    uGroundL: { value: 0 },
    uOpacity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      uniform float uGroundL;
      uniform float uOpacity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float dep = -d.y;                       // sine of depression angle
        vec3 albedo = vec3(0.11, 0.12, 0.09);
        vec3 ground = albedo * uGroundL;
        vec3 haze = skyAt(normalize(vec3(d.x, 0.003, d.z)));
        vec3 L = mix(haze, ground, smoothstep(0.0, 0.025, dep));
        vec4 c = display(L);
        float a = mix(1.0, uOpacity, smoothstep(0.0, 0.03, dep));
        gl_FragColor = vec4(c.rgb, a);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.BackSide,
  });
  const geom = new THREE.SphereGeometry(900, 96, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const mesh = new THREE.Mesh(geom, material);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;

  /** horizontal illuminance in lux → ground luminance */
  function update(illuminance, opaque) {
    uniforms.uGroundL.value = illuminance / Math.PI;
    uniforms.uOpacity.value = opaque ? 1 : 0.35;
  }
  return { mesh, update };
}
