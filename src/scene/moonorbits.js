// The moons' orbits round their planets: each the ellipse a moon is on right now
// (from where it is and how it's moving), drawn round its planet on the sky, true
// to size. The part behind the planet's disc is hidden, and the planet's rings
// (drawn after) pass in front of them.

import * as THREE from "three";

import { insideDisc, orbitPath } from "../satellites.js";
import { ORBIT_COLORS } from "./orbits.js";

const POINTS = 128;
const OPACITY = 0.45;
const RADIUS = 990; // (on the sky, just inside the moons' points)

/** `defs`: SATELLITES. */
export function createMoonOrbits(sharedUniforms, glsl, defs) {
  const group = new THREE.Group();
  const lines = defs.map((def) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3));
    geom.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(POINTS), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color().setStyle(ORBIT_COLORS[def.parent], THREE.LinearSRGBColorSpace) },
        uOpacity: { value: OPACITY },
        uRefract: sharedUniforms.uRefract,
        uStereo: sharedUniforms.uStereo,
        uProjScale: sharedUniforms.uProjScale,
        uAspect: sharedUniforms.uAspect,
      },
      vertexShader: /* glsl */ `
        ${glsl.REFRACTION}
        ${glsl.PROJECTION}
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec3 d = refractDir(normalize(position));
          gl_Position = projectView(viewMatrix * vec4(d * ${RADIUS.toFixed(1)}, 1.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor, uOpacity * vAlpha); }
      `,
      transparent: true,
      depthWrite: false,
    });
    const line = new THREE.LineLoop(geom, material);
    line.frustumCulled = false;
    // After the planet's globe (5.2), before its rings (5.3) and the moons' points.
    line.renderOrder = 5.25;
    line.visible = false;
    group.add(line);
    return { def, line, geom, material };
  });
  const byId = new Map(lines.map((l) => [l.def.id, l]));
  const p = new THREE.Vector3();

  /**
   * Draw the orbits of `moons` (as moonsOf gives them, all of one planet's) round
   * `planet` (of the same sky), each faded by `fade(moon)` (0 to 1), with the
   * planet's pole `pole` and its PLANETS entry `def`. Every other orbit is hidden
   * (see hideAll) unless drawn again this frame.
   */
  function draw(planet, moons, pole, def, fade) {
    const look = planet.trueDir;
    const R = def.radiusKm / 149597870.7;
    const f = def.flattening ?? 0;
    for (const m of moons) {
      const l = byId.get(m.id);
      const a = fade(m);
      const path = a > 0.01 ? orbitPath(m.parent, m.offsetAU, m.velocity, POINTS) : null;
      l.line.visible = !!path;
      if (!path) continue;
      l.material.uniforms.uOpacity.value = OPACITY * a;
      const pos = l.geom.attributes.position;
      const alpha = l.geom.attributes.aAlpha;
      path.forEach((off, i) => {
        p.copy(planet.vecAU).add(off).normalize();
        pos.setXYZ(i, p.x, p.y, p.z);
        // Behind the planet: hidden by its disc.
        alpha.setX(i, off.dot(look) > 0 && insideDisc(off, look, pole, R, f) ? 0 : 1);
      });
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    }
  }

  function hideAll() {
    for (const l of lines) l.line.visible = false;
  }

  return { group, draw, hideAll };
}
