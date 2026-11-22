// Physically based single-scattering atmosphere.
//
// The sky is rendered each frame into a small HDR texture (azimuth × altitude)
// holding luminance in cd/m². Everything else samples it: the sky dome, stars
// (to know how bright the sky behind them is), the Moon and the ground haze.
//
// The same model runs in JavaScript at a handful of points so the "eye" can
// adapt its exposure, and to colour the Sun and Moon by atmospheric extinction.
// Units: kilometres, scattering coefficients per km, light in lux.

import * as THREE from "three";

export const ATMOSPHERES = {
  earth: {
    planetRadius: 6371,
    height: 100,
    observerHeight: 0.01,
    // Coefficients at wavelengths near the sRGB primaries (≈610, 550, 465 nm) rather
    // than the usual 680/550/440, so three colour channels give a blue twilight
    // zenith (ozone absorbs orange–red light) and a less over-saturated noon sky.
    rayleigh: [8.97e-3, 13.558e-3, 26.5e-3],
    rayleighScale: 8.0,
    mie: [2.5e-3, 2.5e-3, 2.5e-3], // fairly clear air
    mieExtinction: 1.11,
    mieScale: 1.2,
    mieG: 0.76,
    ozone: [2.4e-3, 1.881e-3, 0.2e-3],
    ozoneCenter: 25,
    ozoneWidth: 15,
    // Natural night-sky glow (airglow + zodiacal + starlight) ≈ 21.6 mag/arcsec².
    nightGlow: [2.1e-4, 2.5e-4, 3.2e-4],
    extinctionK: 0.2, // magnitudes per airmass, V band
  },
};

export const NONE = {
  ...ATMOSPHERES.earth,
  rayleigh: [0, 0, 0],
  mie: [0, 0, 0],
  ozone: [0, 0, 0],
  extinctionK: 0,
};

const PRIMARY_STEPS = 24;
const LIGHT_STEPS = 8;

const GEN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec3 uLightDir[2];
uniform float uLightE[2];
uniform float uRp;
uniform float uHa;
uniform float uH0;
uniform vec3 uBetaR;
uniform float uHR;
uniform vec3 uBetaM;
uniform float uMieExt;
uniform float uHM;
uniform float uG;
uniform vec3 uBetaO;
uniform float uOzoneC;
uniform float uOzoneW;
uniform vec3 uGlow;
uniform float uAmbient; // lux of skylight, re-scattered isotropically (cheap multiple scattering)

const int N = ${PRIMARY_STEPS};
const int M = ${LIGHT_STEPS};
const float PI = 3.14159265359;

float ozone(float h) { return max(0.0, 1.0 - abs(h - uOzoneC) / uOzoneW); }

// Length of ray from height h (radius r = Rp + h) in direction with cosine mu to the top of the atmosphere.
float toTop(float r, float h, float mu) {
  float c = (h - uHa) * (2.0 * uRp + h + uHa);
  return -r * mu + sqrt(max(0.0, r * r * mu * mu - c));
}

void main() {
  float az = vUv.x * 2.0 * PI;
  float t = vUv.y * 2.0 - 1.0;
  float alt = sign(t) * t * t * 0.5 * PI;
  vec3 dir = vec3(cos(alt) * sin(az), sin(alt), -cos(alt) * cos(az));

  float r0 = uRp + uH0;
  float mu = dir.y;
  float tMax = toTop(r0, uH0, mu);
  if (mu < 0.0) {
    float disc = r0 * r0 * mu * mu - uH0 * (2.0 * uRp + uH0);
    if (disc >= 0.0) tMax = min(tMax, -r0 * mu - sqrt(disc));
  }

  vec3 total = vec3(0.0);
  vec3 od = vec3(0.0); // optical depth so far: rayleigh, mie, ozone (as density·km)
  float prev = 0.0;
  float muL[2];
  float phR[2];
  float phM[2];
  for (int k = 0; k < 2; k++) {
    float c = dot(dir, uLightDir[k]);
    phR[k] = 3.0 / (16.0 * PI) * (1.0 + c * c);
    float g2 = uG * uG;
    phM[k] = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * c, 1.5));
  }

  for (int i = 0; i < N; i++) {
    float f1 = float(i + 1) / float(N);
    float s1 = tMax * f1 * f1;
    float ds = s1 - prev;
    float s = prev + 0.5 * ds;
    prev = s1;

    vec3 p = vec3(0.0, r0, 0.0) + dir * s;
    float r = length(p);
    float h = r - uRp;
    vec3 d = vec3(exp(-h / uHR), exp(-h / uHM), ozone(h)) * ds;
    vec3 odMid = od + 0.5 * d;
    od += d;

    // Multiple scattering, approximated: skylight scattered once more toward the eye.
    vec3 tauView = uBetaR * odMid.x + uBetaM * uMieExt * odMid.y + uBetaO * odMid.z;
    total += uAmbient / (4.0 * PI) * exp(-tauView) * (uBetaR * d.x + uBetaM * d.y);

    for (int k = 0; k < 2; k++) {
      if (uLightE[k] <= 0.0) continue;
      float ml = dot(p, uLightDir[k]) / r;
      // In the planet's shadow?
      if (ml < 0.0 && h * (2.0 * uRp + h) < r * r * ml * ml) continue;
      float tl = toTop(r, h, ml);
      float stepL = tl / float(M);
      vec3 odl = vec3(0.0);
      for (int j = 0; j < M; j++) {
        vec3 q = p + uLightDir[k] * (stepL * (float(j) + 0.5));
        float hl = length(q) - uRp;
        odl += vec3(exp(-hl / uHR), exp(-hl / uHM), ozone(hl));
      }
      odl *= stepL;
      vec3 o = odMid + odl;
      vec3 tau = uBetaR * o.x + uBetaM * uMieExt * o.y + uBetaO * o.z;
      vec3 att = exp(-tau);
      total += uLightE[k] * att * (uBetaR * phR[k] * d.x + uBetaM * phM[k] * d.y);
    }
  }
  gl_FragColor = vec4(total + uGlow, 1.0);
}
`;

const DOME_VERT = (glsl) => /* glsl */ `
${glsl.PROJECTION}
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectView(modelViewMatrix * vec4(position, 1.0));
  // Always at the back: the far plane in perspective, just inside it otherwise.
  gl_Position = uStereo > 0.0 ? vec4(p.xy, p.z > 1.5 ? 2.0 : 0.999, 1.0) : p.xyww;
}
`;

export function createAtmosphere(renderer, { coarse = false } = {}) {
  const width = coarse ? 256 : 512;
  const height = coarse ? 128 : 256;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });

  const genUniforms = {
    uLightDir: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] },
    uLightE: { value: [0, 0] },
    uRp: { value: 0 },
    uHa: { value: 0 },
    uH0: { value: 0 },
    uBetaR: { value: new THREE.Vector3() },
    uHR: { value: 1 },
    uBetaM: { value: new THREE.Vector3() },
    uMieExt: { value: 1 },
    uHM: { value: 1 },
    uG: { value: 0.8 },
    uBetaO: { value: new THREE.Vector3() },
    uOzoneC: { value: 25 },
    uOzoneW: { value: 15 },
    uGlow: { value: new THREE.Vector3() },
    uAmbient: { value: 0 },
  };
  const genMaterial = new THREE.ShaderMaterial({
    uniforms: genUniforms,
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: GEN_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const genScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), genMaterial);
  quad.frustumCulled = false;
  genScene.add(quad);
  const genCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function setParams(p) {
    genUniforms.uRp.value = p.planetRadius;
    genUniforms.uHa.value = p.height;
    genUniforms.uH0.value = p.observerHeight;
    genUniforms.uBetaR.value.fromArray(p.rayleigh);
    genUniforms.uHR.value = p.rayleighScale;
    genUniforms.uBetaM.value.fromArray(p.mie);
    genUniforms.uMieExt.value = p.mieExtinction;
    genUniforms.uHM.value = p.mieScale;
    genUniforms.uG.value = p.mieG;
    genUniforms.uBetaO.value.fromArray(p.ozone);
    genUniforms.uOzoneC.value = p.ozoneCenter;
    genUniforms.uOzoneW.value = p.ozoneWidth;
    genUniforms.uGlow.value.fromArray(p.nightGlow);
  }

  function render(sunDir, sunE, moonDir, moonE, ambient = 0) {
    genUniforms.uAmbient.value = ambient;
    genUniforms.uLightDir.value[0].copy(sunDir);
    genUniforms.uLightDir.value[1].copy(moonDir);
    genUniforms.uLightE.value[0] = sunE;
    genUniforms.uLightE.value[1] = moonE;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(genScene, genCamera);
    renderer.setRenderTarget(prev);
  }

  return { texture: target.texture, setParams, render };
}

/** The visible sky dome: samples the sky texture and tone maps it. */
export function createSkyDome(sharedUniforms, glsl) {
  const material = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    vertexShader: DOME_VERT(glsl),
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      ${glsl.LAND}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Below see-through land: always the dark of night, as if through the earth.
        gl_FragColor = display(mix(skyAt(d), THROUGH_EARTH_SKY, throughEarth(d)));
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 64, 32), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// JavaScript twin of the shader, for a few samples per frame.

function ozoneDensity(p, h) {
  return Math.max(0, 1 - Math.abs(h - p.ozoneCenter) / p.ozoneWidth);
}

function toTop(p, r, h, mu) {
  const c = (h - p.height) * (2 * p.planetRadius + h + p.height);
  return -r * mu + Math.sqrt(Math.max(0, r * r * mu * mu - c));
}

/** Optical depths (rayleigh, mie, ozone) from the observer along a direction. */
function opticalDepth(p, dir, steps = 32) {
  const r0 = p.planetRadius + p.observerHeight;
  const t = toTop(p, r0, p.observerHeight, dir.y);
  const out = [0, 0, 0];
  let prev = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps;
    const s1 = t * f * f;
    const ds = s1 - prev;
    const s = prev + ds / 2;
    prev = s1;
    const x = dir.x * s;
    const y = r0 + dir.y * s;
    const z = dir.z * s;
    const h = Math.hypot(x, y, z) - p.planetRadius;
    out[0] += Math.exp(-h / p.rayleighScale) * ds;
    out[1] += Math.exp(-h / p.mieScale) * ds;
    out[2] += ozoneDensity(p, h) * ds;
  }
  return out;
}

/** RGB transmittance from the observer to space along a direction (light from a body there). */
export function transmittance(p, dir) {
  // Below the geometric horizon the path grazes the ground; clamp to a tiny altitude.
  const d = dir.y < -0.02 ? { x: dir.x, y: -0.02, z: dir.z } : dir;
  const od = opticalDepth(p, d);
  return [0, 1, 2].map((i) =>
    Math.exp(-(p.rayleigh[i] * od[0] + p.mie[i] * p.mieExtinction * od[1] + p.ozone[i] * od[2]))
  );
}

const LUMA = [0.2126, 0.7152, 0.0722];
export const luminance = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** Sky luminance (RGB, cd/m²) in a direction. lights: [{dir, e}] */
export function skyRadiance(p, dir, lights, n = 12, m = 6, ambient = 0) {
  const Rp = p.planetRadius;
  const r0 = Rp + p.observerHeight;
  let tMax = toTop(p, r0, p.observerHeight, dir.y);
  if (dir.y < 0) {
    const disc = r0 * r0 * dir.y * dir.y - p.observerHeight * (2 * Rp + p.observerHeight);
    if (disc >= 0) tMax = Math.min(tMax, -r0 * dir.y - Math.sqrt(disc));
  }
  const total = [...p.nightGlow];
  const g = p.mieG;
  const g2 = g * g;
  const ph = lights.map((L) => {
    const c = dir.x * L.dir.x + dir.y * L.dir.y + dir.z * L.dir.z;
    return [
      (3 / (16 * Math.PI)) * (1 + c * c),
      ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + c * c))) / ((2 + g2) * (1 + g2 - 2 * g * c) ** 1.5),
    ];
  });
  const od = [0, 0, 0];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n;
    const s1 = tMax * f * f;
    const ds = s1 - prev;
    const s = prev + ds / 2;
    prev = s1;
    const px = dir.x * s;
    const py = r0 + dir.y * s;
    const pz = dir.z * s;
    const r = Math.hypot(px, py, pz);
    const h = r - Rp;
    const d = [Math.exp(-h / p.rayleighScale) * ds, Math.exp(-h / p.mieScale) * ds, ozoneDensity(p, h) * ds];
    const mid = [od[0] + d[0] / 2, od[1] + d[1] / 2, od[2] + d[2] / 2];
    od[0] += d[0];
    od[1] += d[1];
    od[2] += d[2];
    if (ambient > 0) {
      for (let c = 0; c < 3; c++) {
        const tau = p.rayleigh[c] * mid[0] + p.mie[c] * p.mieExtinction * mid[1] + p.ozone[c] * mid[2];
        total[c] += (ambient / (4 * Math.PI)) * Math.exp(-tau) * (p.rayleigh[c] * d[0] + p.mie[c] * d[1]);
      }
    }
    lights.forEach((L, k) => {
      if (L.e <= 0) return;
      const ml = (px * L.dir.x + py * L.dir.y + pz * L.dir.z) / r;
      if (ml < 0 && h * (2 * Rp + h) < r * r * ml * ml) return;
      const tl = toTop(p, r, h, ml);
      const st = tl / m;
      const ol = [0, 0, 0];
      for (let j = 0; j < m; j++) {
        const q = st * (j + 0.5);
        const hl = Math.hypot(px + L.dir.x * q, py + L.dir.y * q, pz + L.dir.z * q) - Rp;
        ol[0] += Math.exp(-hl / p.rayleighScale);
        ol[1] += Math.exp(-hl / p.mieScale);
        ol[2] += ozoneDensity(p, hl);
      }
      for (let c = 0; c < 3; c++) {
        const tau =
          p.rayleigh[c] * (mid[0] + ol[0] * st) +
          p.mie[c] * p.mieExtinction * (mid[1] + ol[1] * st) +
          p.ozone[c] * (mid[2] + ol[2] * st);
        total[c] += L.e * Math.exp(-tau) * (p.rayleigh[c] * ph[k][0] * d[0] + p.mie[c] * ph[k][1] * d[1]);
      }
    });
  }
  return total;
}

// Sample directions for the eye's adaptation: zenith plus two rings for the
// average, and a low ring (weight 0) that only contributes to the peak.
const ADAPT_DIRS = [{ x: 0, y: 1, z: 0, w: 1 }];
for (const [alt, w] of [
  [12, 1.4],
  [40, 1.2],
  [3, 0],
]) {
  for (let i = 0; i < 8; i++) {
    const a = (alt * Math.PI) / 180;
    const z = (i * Math.PI) / 4;
    ADAPT_DIRS.push({ x: Math.cos(a) * Math.sin(z), y: Math.sin(a), z: -Math.cos(a) * Math.cos(z), w });
  }
}

/** Weighted average sky luminance (cd/m²), the zenith luminance and the brightest sample. */
export function averageSkyLuminance(p, lights, ambient = 0) {
  let sum = 0;
  let wsum = 0;
  let zenith = 0;
  let peak = 0;
  for (const d of ADAPT_DIRS) {
    const L = luminance(skyRadiance(p, d, lights, 12, 6, ambient));
    if (d.y === 1) zenith = L;
    peak = Math.max(peak, L);
    sum += L * d.w;
    wsum += d.w;
  }
  return { average: sum / wsum, zenith, peak };
}
