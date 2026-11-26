// The planets as discs. Most of the time a planet is far too small to be anything
// but a point of light (see points.js), but zoomed right in, Jupiter and Saturn
// are a few arcseconds across: then each one is drawn as a sphere lit from the
// Sun's true direction, so Venus and Mercury show their phases, Mars is gibbous,
// and Saturn has its rings, tilted the way they are this year, with the globe's
// shadow across them and theirs across the globe. As the disc grows it takes over
// from the point.

import * as THREE from "three";

import { SUN_ILLUMINANCE } from "../astro.js";

export const PLANET_DISTANCE = 985; // behind the Moon, in front of the Sun (so transits work)

// Saturn's rings, in Saturn radii: the faint C ring, the bright B ring, the Cassini
// division, and the A ring. [inner edge, opacity, brightness]
const RINGS = [
  [1.24, 0.12, 0.25],
  [1.53, 0.9, 0.62],
  [1.95, 0.12, 0.25],
  [2.03, 0.6, 0.5],
];
export const RING_OUTER = 2.27;

/** Disc radius in pixels at which a planet starts to show as a disc, and where the point has gone. */
const FADE_FROM = 1.2;
const FADE_TO = 2.5;

const VERT = (glsl) => /* glsl */ `
  ${glsl.PROJECTION}
  varying vec3 vLocal;
  varying vec3 vPos;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectView(viewMatrix * wp);
  }
`;

// In the planet's own frame (y up its axis, in planet radii): sunlight let through
// by the rings, for a point p on the globe. 1 where they're not in the way.
const RING_SHADOW = /* glsl */ `
  uniform float uRings;
  float ringOpacity(float r) {
    ${RINGS.map(([r0, op], i) => `if (r < ${(RINGS[i + 1]?.[0] ?? RING_OUTER).toFixed(2)}) return r < ${r0.toFixed(2)} ? 0.0 : ${op.toFixed(2)};`).join("\n    ")}
    return 0.0;
  }
  float ringBrightness(float r) {
    ${RINGS.map(([, , b], i) => `if (r < ${(RINGS[i + 1]?.[0] ?? RING_OUTER).toFixed(2)}) return ${b.toFixed(2)};`).join("\n    ")}
    return 0.0;
  }
  float throughRings(vec3 p, vec3 s) {
    if (uRings < 0.5 || abs(s.y) < 1e-4) return 1.0;
    // (With the Sun nearly edge-on to the rings their shadow is a hairline, which
    // would only break up into specks: let it fade in.)
    float strength = smoothstep(0.02, 0.08, abs(s.y));
    float t = -p.y / s.y;
    if (t <= 0.0) return 1.0;
    vec3 q = p + t * s;
    return 1.0 - strength * ringOpacity(length(q.xz));
  }
`;

const COMMON = /* glsl */ `
  uniform vec3 uSunLocal;  // towards the Sun, in the planet's frame
  uniform vec3 uViewLocal; // towards you, in the planet's frame
  uniform vec3 uSurface;   // colour × albedo
  uniform float uLit;      // luminance of a face square-on to the Sun, cd/m²
  uniform vec3 uTransmit;
  uniform float uPlanetExposure;
  uniform float uFade;
`;

export function createPlanetDiscs(shared, glsl, defs) {
  const group = new THREE.Group();
  const sphere = new THREE.SphereGeometry(1, 48, 24);
  // The rings lie in the planet's equator (its local xz plane).
  const ringGeometry = new THREE.RingGeometry(RINGS[0][0], RING_OUTER, 128, 1).rotateX(-Math.PI / 2);

  const discs = defs.map((def) => {
    const uniforms = {
      ...shared,
      uSunLocal: { value: new THREE.Vector3() },
      uViewLocal: { value: new THREE.Vector3() },
      uSurface: { value: new THREE.Vector3() },
      uLit: { value: 0 },
      uTransmit: { value: new THREE.Vector3(1, 1, 1) },
      uPlanetExposure: { value: 1 },
      uFade: { value: 0 },
      uBands: { value: def.bands ?? 0 },
      uRocky: { value: def.rocky ? 1 : 0 },
      uRings: { value: def.rings ? 1 : 0 },
    };
    const globe = new THREE.Mesh(
      sphere,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT(glsl),
        fragmentShader: /* glsl */ `
          ${glsl.DISPLAY}
          ${glsl.SKY_LOOKUP}
          ${COMMON}
          ${RING_SHADOW}
          uniform float uBands;
          uniform float uRocky;
          varying vec3 vLocal;
          varying vec3 vPos;
          void main() {
            vec3 n = normalize(vLocal);
            float ci = max(dot(n, uSunLocal), 0.0);
            float ce = max(dot(n, uViewLocal), 0.0);
            // Rocky worlds look flat when full (like the Moon); cloudy ones are
            // brightest in the middle, and darken towards the edge.
            float lit = mix(ci * (0.6 + 0.4 * ce), 2.0 * ci / (ci + ce + 1e-4), uRocky);
            lit *= throughRings(n, uSunLocal);
            // Dark belts either side of the bright equator, fainter ones further out,
            // and duskier poles (latitude in degrees).
            float la = abs(degrees(asin(clamp(n.y, -1.0, 1.0))));
            float belt = smoothstep(6.0, 9.0, la) * (1.0 - smoothstep(17.0, 21.0, la))
              + 0.5 * smoothstep(25.0, 28.0, la) * (1.0 - smoothstep(33.0, 36.0, la))
              + 0.6 * smoothstep(45.0, 70.0, la);
            vec3 tint = mix(vec3(1.0), vec3(0.72, 0.56, 0.42), uBands * belt * 0.6);
            vec3 x = uSurface * tint * uTransmit * uLit * lit * uPlanetExposure;
            vec3 sky = skyAt(normalize(vPos)) * uExposure;
            gl_FragColor = vec4(linearToSrgb(acesFilm(x + sky)) * uFade, uFade);
          }
        `,
        transparent: true,
        depthWrite: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      })
    );
    globe.matrixAutoUpdate = false;
    globe.frustumCulled = false;
    globe.renderOrder = 5;
    globe.visible = false;
    group.add(globe);

    let ring = null;
    if (def.rings) {
      ring = new THREE.Mesh(
        ringGeometry,
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: VERT(glsl),
          fragmentShader: /* glsl */ `
            ${glsl.DISPLAY}
            ${COMMON}
            ${RING_SHADOW}
            varying vec3 vLocal;
            varying vec3 vPos;
            void main() {
              float r = length(vLocal.xz);
              float op = ringOpacity(r);
              if (op <= 0.0) discard;
              vec3 s = uSunLocal;
              // Lit from above or below; seen from the other side, only what shines through.
              float lit = smoothstep(0.0, 0.05, abs(s.y)) * mix(0.25, 1.0, step(0.0, s.y * uViewLocal.y));
              // The globe's shadow: does the way to the Sun pass through it?
              float b = dot(vLocal, s);
              float c = dot(vLocal, vLocal) - 1.0;
              if (b < 0.0 && b * b > c) lit = 0.0;
              vec3 x = uSurface * uTransmit * uLit * ringBrightness(r) * lit * uPlanetExposure;
              float a = op * uFade;
              gl_FragColor = vec4(linearToSrgb(acesFilm(x)) * a, a);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
        })
      );
      ring.matrixAutoUpdate = false;
      ring.frustumCulled = false;
      ring.renderOrder = 5.5;
      ring.visible = false;
      group.add(ring);
    }
    return { def, uniforms, globe, ring };
  });

  const basis = new THREE.Matrix4();
  const toLocal = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const z = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  /**
   * planets: computeSky().planets. scale: how much bigger than true size to draw
   * them (see eyeScale), pxPerRad: the screen's pixels per radian. light(p):
   * { transmit: RGB, shown: bool } for a planet. Returns how far each one has
   * turned from a point into a disc (0 to 1), for fading the points out.
   */
  function update(planets, { scale: k, pxPerRad, exposure, light }) {
    return planets.map((p, i) => {
      const d = discs[i];
      const angR = p.angularRadius * k;
      const fade = THREE.MathUtils.smoothstep(angR * pxPerRad, FADE_FROM, FADE_TO);
      const { shown, transmit } = fade > 0 ? light(p) : { shown: false };
      d.globe.visible = shown;
      if (d.ring) d.ring.visible = shown;
      if (!shown) return 0;

      // A frame with y up the planet's axis.
      x.crossVectors(p.axis, p.dir);
      if (x.lengthSq() < 1e-8) x.set(1, 0, 0).cross(p.axis);
      x.normalize();
      z.crossVectors(x, p.axis);
      basis.makeBasis(x, p.axis, z);
      toLocal.copy(basis).transpose();
      const r = Math.tan(angR) * PLANET_DISTANCE;
      pos.copy(p.dir).multiplyScalar(PLANET_DISTANCE);
      scale.set(r, r * (1 - (d.def.flattening ?? 0)), r);
      d.globe.matrix.copy(basis).scale(scale).setPosition(pos);
      d.globe.matrixWorldNeedsUpdate = true;
      if (d.ring) {
        d.ring.matrix
          .copy(basis)
          .scale(scale.set(r, r, r))
          .setPosition(pos);
        d.ring.matrixWorldNeedsUpdate = true;
      }

      const u = d.uniforms;
      u.uSunLocal.value.copy(p.sunDir).applyMatrix4(toLocal);
      u.uViewLocal.value.copy(p.dir).negate().applyMatrix4(toLocal);
      const c = d.def.surface;
      u.uSurface.value.set(...c).multiplyScalar(1 / lum(c));
      // A face square-on to the Sun: albedo × sunlight there ÷ π.
      const L = (d.def.albedo * SUN_ILLUMINANCE) / (p.sunDist * p.sunDist) / Math.PI;
      u.uLit.value = L;
      u.uTransmit.value.fromArray(transmit);
      // As with the Moon, the eye adapts to the bright disc it's looking at.
      u.uPlanetExposure.value = Math.min(exposure, 0.9 / L);
      u.uFade.value = fade;
      return fade;
    });
  }

  return { group, update };
}
