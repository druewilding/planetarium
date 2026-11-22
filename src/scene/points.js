// Point-like light sources (stars, planets). Each point's visibility is decided
// in the vertex shader from its magnitude, atmospheric extinction and the
// brightness of the sky behind it, using Schaefer's naked-eye limiting-magnitude
// relation. So stars fade out naturally at dawn and come back when you dim the Sun.

import * as THREE from "three";

const VERT = (glsl) => /* glsl */ `
${glsl.SKY_LOOKUP}
${glsl.REFRACTION}
${glsl.PROJECTION}
uniform float uExtK;
uniform float uBoost;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uRadius;
attribute float aMag;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
varying float vCore;

void main() {
  vec3 d = refractDir(normalize(mat3(modelMatrix) * position));
  float altDeg = degrees(asin(clamp(d.y, -1.0, 1.0)));

  // Extinction: Kasten–Young airmass.
  float h = max(altDeg, -1.5);
  float X = 1.0 / (sin(radians(h)) + 0.50572 * pow(h + 6.07995, -1.6364));
  float m = aMag + uExtK * X;

  // Limiting magnitude from local sky luminance (cd/m²).
  float L = max(dot(skyAt(d), vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  float mLim = 7.93 - 5.0 * log(1.0 + 63.0 * sqrt(L)) / log(10.0) + uBoost;
  float delta = mLim - m;

  vAlpha = smoothstep(-0.4, 1.0, delta);
  vCore = clamp(0.25 + delta * 0.12, 0.0, 1.0);
  vColor = aColor;
  gl_PointSize = (1.6 + 1.05 * sqrt(max(delta, 0.0))) * uSizeScale * uPixelRatio;
  if (vAlpha <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectView(viewMatrix * vec4(d * uRadius, 1.0));
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vCore;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0);
  float halo = exp(-r2 * 2.2) * 0.35;
  float i = (core + halo * vCore) * vAlpha;
  vec3 col = mix(vec3(1.0), vColor, 0.55) * (0.55 + 0.45 * vCore);
  gl_FragColor = vec4(col * i, i);
}
`;

export function createPointsMaterial(sharedUniforms, glsl, radius) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uRadius: { value: radius },
      uRefract: sharedUniforms.uRefract,
    },
    vertexShader: VERT(glsl),
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/** Star colour from B−V index (Ballesteros temperature → approximate sRGB). */
export function bvToRgb(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  let r;
  let g;
  let b;
  if (k <= 66) {
    r = 255;
    g = 99.47 * Math.log(k) - 161.12;
    b = k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  } else {
    r = 329.7 * (k - 60) ** -0.1332;
    g = 288.12 * (k - 60) ** -0.0755;
    b = 255;
  }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

/** Fixed stars, positioned in the J2000 equatorial frame (parent group rotates them). */
export function createStars(catalog, material) {
  const n = catalog.stars.length;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  catalog.stars.forEach(([, ra, dec, m, bv], i) => {
    const a = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    v.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
    v.toArray(pos, i * 3);
    mag[i] = m;
    col.set(bvToRgb(bv), i * 3);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
  geom.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return points;
}

/** Planets as points (positions/magnitudes updated every frame, already in world space). */
export function createPlanetPoints(planetDefs, material) {
  const n = planetDefs.length;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geom.setAttribute("aMag", new THREE.BufferAttribute(new Float32Array(n), 1));
  const col = new Float32Array(n * 3);
  planetDefs.forEach((p, i) => col.set(p.color, i * 3));
  geom.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = 4;

  function update(planets) {
    const pos = geom.attributes.position;
    const mag = geom.attributes.aMag;
    planets.forEach((p, i) => {
      pos.setXYZ(i, p.trueDir.x, p.trueDir.y, p.trueDir.z);
      mag.setX(i, p.mag);
    });
    pos.needsUpdate = true;
    mag.needsUpdate = true;
  }
  return { points, update };
}
