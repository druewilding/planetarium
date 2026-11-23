import * as THREE from "three";

import { moonOrientation } from "../astro.js";
import { SAMPLES as SKYLINE_SAMPLES, WATER_ROWS, WATER_SCALE, WATER_SPAN } from "../terrain.js";

export const SUN_DISTANCE = 990;
export const MOON_DISTANCE = 980;

const SUN_LUMINANCE = 1.6e9; // cd/m² at the solar surface, seen from outside the atmosphere
const FULL_MOON_LUMINANCE = 2500; // average cd/m² of the full Moon's disc
const GLOW_RADII = 10; // the Moon's glow reaches this many lunar radii

/**
 * Turn a flat card (Sun disc, glow) to face the viewer at the centre, keeping the
 * camera's "up". Facing the camera's own direction instead squashes the card into
 * a smear near the edge of wide fisheye views, where it's seen nearly edge-on.
 */
function faceViewer(mesh, camera) {
  mesh.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  mesh.lookAt(0, 0, 0);
}

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
      ${glsl.PROJECTION}
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(wp.xyz);
        gl_Position = projectView(viewMatrix * wp);
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), material);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;

  /** sky: computeSky().sun, transmit: RGB, dim: 0..1, exposure: current */
  /** `throughEarth`: seen through see-through ground, as a plain disc with no glare. */
  function update(sun, transmit, dim, exposure, camera, uncovered = 1, scale = 1, throughEarth = false) {
    const angR = sun.angularRadius * scale;
    const discRadius = Math.tan(angR) * SUN_DISTANCE;
    const glareScale = 12; // halo extends this many solar radii
    mesh.position.copy(sun.dir).multiplyScalar(SUN_DISTANCE);
    faceViewer(mesh, camera);
    mesh.scale.setScalar(discRadius * 2 * glareScale);
    uniforms.uDiscFraction.value = 1 / glareScale;
    // Keep a faint disc visible even when the Sun is fully dimmed, so you can still find it.
    const level = Math.max(dim, 2e-9);
    const L = SUN_LUMINANCE * level;
    uniforms.uSunL.value.set(transmit[0] * L, transmit[1] * L, transmit[2] * L);
    uniforms.uDiscExposure.value = Math.min(exposure, 4 / L);
    const E = (sun.illuminance * dim * uncovered * (transmit[0] + transmit[1] + transmit[2])) / 3;
    uniforms.uGlare.value = throughEarth ? 0 : 0.8 * (1 - Math.exp(-E * exposure * 0.02));
    mesh.visible = throughEarth || sun.alt > -2;
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
    uGlowLimb: { value: 0 },
    uGlowTint: { value: new THREE.Vector3(1, 1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${glsl.PROJECTION}
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectView(viewMatrix * wp);
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
      uniform float uGlowLimb;
      uniform vec3 uGlowTint;
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
        vec3 c = linearToSrgb(acesFilm(x + sky));
        // The glow is in the air in front of the Moon, so it veils the dark side too
        // ("screen" blend: fills the dark part without bleaching the lit one).
        vec3 g = linearToSrgb(clamp(uGlowTint * uGlowLimb, 0.0, 1.0));
        gl_FragColor = vec4(c + g * (1.0 - c), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const basis = new THREE.Matrix4();

  // The glow around a bright Moon at night: light scattered by haze and inside
  // the eye. It's what makes the Moon look dazzling, more than the disc itself.
  const glowUniforms = {
    uGlow: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uDiscFraction: { value: 1 / GLOW_RADII },
  };
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 8, 8),
    new THREE.ShaderMaterial({
      uniforms: { ...shared, ...glowUniforms },
      vertexShader: /* glsl */ `
        ${glsl.PROJECTION}
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectView(viewMatrix * modelMatrix * vec4(position, 1.0));
        }
      `,
      fragmentShader: /* glsl */ `
        ${glsl.DISPLAY}
        uniform float uGlow;
        uniform vec3 uTint;
        uniform float uDiscFraction;
        varying vec2 vUv;
        void main() {
          float r = length(vUv) / uDiscFraction; // 1.0 at the Moon's limb
          if (r < 1.0) discard;
          float d = r - 1.0;
          float outer = 1.0 / uDiscFraction;
          float g = uGlow * (0.5 / (1.0 + d * d * 2.0) + 0.12 * exp(-d * 0.5)) * (1.0 - smoothstep(0.5 * outer, outer, r));
          gl_FragColor = vec4(linearToSrgb(clamp(uTint * g, 0.0, 1.0)), 0.0); // additive
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
  );
  glow.renderOrder = 6;
  glow.frustumCulled = false;

  /** `throughEarth`: seen through see-through ground, with no glow around it. */
  function update(moon, sky, transmit, exposure, camera, scale = 1, throughEarth = false) {
    const r = Math.tan(moon.angularRadius * scale) * MOON_DISTANCE;
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
    mesh.visible = throughEarth || moon.alt > -3;

    // Glow: grows with how bright the Moon is compared with what the eye is adapted to,
    // so it's strong on a dark night and gone in daylight.
    const E = (moon.illuminance * (transmit[0] + transmit[1] + transmit[2])) / 3;
    glowUniforms.uGlow.value = 0.45 * (1 - Math.exp(-E * exposure * 12));
    const m = Math.max(transmit[0], transmit[1], transmit[2], 1e-6);
    glowUniforms.uTint.value.set((transmit[0] / m) * 0.95, (transmit[1] / m) * 0.93, (transmit[2] / m) * 0.88);
    glow.position.copy(moon.dir).multiplyScalar(MOON_DISTANCE);
    faceViewer(glow, camera);
    glow.scale.setScalar(r * 2 * GLOW_RADII);
    glow.visible = mesh.visible && !throughEarth && glowUniforms.uGlow.value > 0.002;
    // Same as the glow shader's value at d = 0 (the limb), so the two meet without a seam.
    uniforms.uGlowLimb.value = glow.visible ? glowUniforms.uGlow.value * 0.62 : 0;
    uniforms.uGlowTint.value.copy(glowUniforms.uTint.value);
  }
  return { mesh, glow, update };
}

/** The skyline as a texture: altitude (degrees) every half degree of azimuth. Shared by every sky shader. */
export function createSkylineTexture() {
  const horizon = new THREE.DataTexture(new Uint16Array(SKYLINE_SAMPLES), SKYLINE_SAMPLES, 1);
  horizon.format = THREE.RedFormat;
  horizon.type = THREE.HalfFloatType;
  horizon.magFilter = horizon.minFilter = THREE.LinearFilter;
  horizon.wrapS = THREE.RepeatWrapping;
  horizon.needsUpdate = true;
  return horizon;
}

/**
 * Ground: a dark hemisphere that fades into horizon haze, cut along the real
 * skyline when there's terrain (see terrain.js), with the sea, lakes and rivers
 * mirroring the sky. With solid ground off it's only a faint outline of the
 * skyline, and you see through the earth.
 */
export function createGround(shared, glsl) {
  const horizon = shared.uHorizon.value;
  // Where the water is: columns by azimuth, rows by altitude (see terrain.js).
  let water = new THREE.DataTexture(new Uint8Array(SKYLINE_SAMPLES * WATER_ROWS), SKYLINE_SAMPLES, WATER_ROWS);
  water.format = THREE.RedFormat;
  water.magFilter = water.minFilter = THREE.LinearFilter;
  water.wrapS = THREE.RepeatWrapping;
  water.needsUpdate = true;
  const uniforms = {
    ...shared,
    uGroundL: { value: 0 },
    uWater: { value: water },
    uWaterCols: { value: SKYLINE_SAMPLES },
    uSunDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunLight: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonLight: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${glsl.PROJECTION}
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      ${glsl.LAND}
      uniform float uGroundL;
      uniform sampler2D uWater;
      uniform float uWaterCols;
      uniform vec3 uSunDir;
      uniform vec3 uSunLight;
      uniform vec3 uMoonDir;
      uniform vec3 uMoonLight;
      varying vec3 vDir;

      // How much of the ground this way is water (0 to 1).
      float waterAt(vec3 d, float alt) {
        float az = atan(d.x, -d.z);
        float x = degrees(alt) / ${WATER_SCALE};
        float s = sign(x) * log(abs(x) + sqrt(x * x + 1.0)); // asinh
        float v = 0.5 + 0.5 * s / ${WATER_SPAN.toFixed(6)};
        float w = texture2D(uWater, vec2(fract(az / 6.28318530718 + 0.5 / uWaterCols), v)).r;
        // A crisp shore through the blend between samples, rather than steps.
        return clamp((w - 0.5) / max(fwidth(w), 1e-3) + 0.5, 0.0, 1.0);
      }

      // Fresnel reflectance of water (Schlick).
      float fresnel(float c) {
        return 0.02 + 0.98 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
      }

      // Glitter: sunlight (or moonlight) off the slopes of small waves, with the
      // usual spread of wave slopes on a breezy day (Cox and Munk). Seen from near
      // the water it stretches into a path towards the Sun.
      vec3 glint(vec3 v, vec3 l, vec3 light) {
        if (l.y <= 0.0 || v.y <= 0.0) return vec3(0.0);
        vec3 h = normalize(v + l);
        float t2 = dot(h.xz, h.xz) / (h.y * h.y);
        const float m2 = 0.03;
        float D = exp(-t2 / m2) / (3.14159265 * m2 * h.y * h.y * h.y * h.y);
        return light * fresnel(dot(v, h)) * D / (4.0 * max(v.y, 0.03));
      }

      // Water: the sky (or the hills across it) mirrored, more so at a low angle,
      // over the dim colour of the water itself. Ripples blur and darken the hills'
      // reflection, and the water tints it.
      vec3 waterColour(vec3 d, vec3 land) {
        vec3 m = vec3(d.x, -d.y, d.z);
        bool hills = asin(clamp(m.y, -1.0, 1.0)) < landAlt(m);
        vec3 mirrored = hills ? land * vec3(0.45, 0.55, 0.65) : skyAt(m);
        vec3 body = vec3(0.012, 0.03, 0.04) * uGroundL;
        vec3 c = mix(body, mirrored, fresnel(-d.y) * 0.9);
        return c + glint(-d, uSunDir, uSunLight) + glint(-d, uMoonDir, uMoonLight);
      }

      void main() {
        vec3 d = normalize(vDir);
        // The skyline appears at full height and fades in, rather than growing.
        float hAlt = landAlt(d);
        float alt = asin(clamp(d.y, -1.0, 1.0));

        if (uSeeThrough > 0.5) {
          // Peering through the earth: only a faint grey line along the hills.
          float f = alt - max(hAlt, 0.0);
          float px = abs(f) / max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
          float line = (1.0 - smoothstep(0.6, 1.6, px)) * 0.45 * uTerrain;
          if (line <= 0.001) discard;
          gl_FragColor = vec4(vec3(0.62, 0.64, 0.68), line);
          return;
        }
        // Antialiased skyline. Where it dips below 0° (from up a hill, or flying) the
        // land below eye level shows against the hazy far distance, drawn with the
        // sky's colour at the horizon (the sky texture below 0° isn't meant to be seen).
        float edge = max(fwidth(alt) * 0.75, 1e-5);
        float top = max(hAlt, 0.0);
        float cover = 1.0 - smoothstep(top - edge, top + edge, alt);
        if (cover <= 0.0) discard;
        float distance = smoothstep(hAlt - edge, hAlt + edge, alt);

        // A flat horizon fades into haze; hills and mountains stay solid.
        float hazeAmount = (1.0 - uTerrain) * (1.0 - smoothstep(0.0, 0.025, -d.y));
        hazeAmount = max(hazeAmount, distance);
        vec3 albedo = vec3(0.11, 0.12, 0.09);
        vec3 ground = albedo * uGroundL;
        float wet = waterAt(d, alt) * step(0.001, uTerrain);
        if (wet > 0.0) ground = mix(ground, waterColour(d, ground), wet);
        vec3 haze = skyAt(normalize(vec3(d.x, 0.003, d.z)));
        vec4 c = display(mix(ground, haze, hazeAmount));
        float fadeIn = mix(1.0, uTerrain, smoothstep(-edge, edge, alt));
        gl_FragColor = vec4(c.rgb, cover * fadeIn);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(groundGeometry(1), material);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;

  /** A dome from the nadir up to `topDeg` above the horizon. */
  function groundGeometry(topDeg) {
    const top = (topDeg * Math.PI) / 180;
    return new THREE.SphereGeometry(900, 180, 48, 0, Math.PI * 2, Math.PI / 2 - top, Math.PI / 2 + top);
  }

  /**
   * `illuminance`: horizontal illuminance in lux → ground luminance. `sun` and
   * `moon`: { dir, light: [r, g, b] lux reaching the water } for the glitter.
   */
  function update(illuminance, terrain, sun, moon) {
    uniforms.uGroundL.value = illuminance / Math.PI;
    uniforms.uTerrain.value = terrain;
    uniforms.uSunDir.value.copy(sun.dir);
    uniforms.uSunLight.value.fromArray(sun.light);
    uniforms.uMoonDir.value.copy(moon.dir);
    uniforms.uMoonLight.value.fromArray(moon.light);
  }

  /** Water on the ground (from a profile, see terrain.js: `cols` directions), or null for none. */
  function setWater(data, cols = SKYLINE_SAMPLES) {
    const image = water.image;
    if (!data) {
      image.data.fill(0);
    } else if (image.width !== cols) {
      // A different size: three.js needs a new texture for that.
      water.dispose();
      water = new THREE.DataTexture(data.slice(), cols, WATER_ROWS);
      water.format = THREE.RedFormat;
      water.magFilter = water.minFilter = THREE.LinearFilter;
      water.wrapS = THREE.RepeatWrapping;
      uniforms.uWater.value = water;
      uniforms.uWaterCols.value = cols;
    } else image.data.set(data);
    water.needsUpdate = true;
  }

  let geometryTop = 1;
  /** Skyline altitudes (degrees, one per sample); `topDeg` is the highest the land will reach. */
  function setSkylineAltitudes(altitudes, topDeg) {
    const data = horizon.image.data;
    for (let i = 0; i < SKYLINE_SAMPLES; i++) data[i] = THREE.DataUtils.toHalfFloat(altitudes ? altitudes[i] : 0);
    horizon.needsUpdate = true;
    const top = Math.min(85, Math.max(1, Math.ceil(topDeg + 2)));
    if (top !== geometryTop) {
      geometryTop = top;
      mesh.geometry.dispose();
      mesh.geometry = groundGeometry(top);
    }
  }

  /** Show a skyline (from terrain.js), or null for a flat horizon. */
  function setSkyline(profile) {
    setSkylineAltitudes(profile?.altitude, profile?.max ?? 0);
    setWater(profile?.water, profile?.waterCols);
  }
  return { mesh, update, setSkyline, setSkylineAltitudes, setWater };
}
