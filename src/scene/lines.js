// Lines on the celestial sphere (constellations, grids, paths). Vertices are
// unit directions in their parent frame; the shader refracts them near the
// horizon (optional) and pushes them out to a fixed radius.

import * as THREE from "three";

/**
 * `radius`: how far out to draw the line (which sets what it's in front of), or
 * null to take it from each vertex's length (see orbits.js).
 */
export function createLineMaterial(sharedUniforms, glsl, { color, opacity = 1, refract = true, radius = 960 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      // Shaders here write sRGB directly, so keep the colour's sRGB numbers as-is.
      uColor: { value: new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace) },
      uOpacity: { value: opacity },
      uRefract: refract ? sharedUniforms.uRefract : { value: 0 },
      uRadius: { value: radius ?? 0 },
      uStereo: sharedUniforms.uStereo,
      uProjScale: sharedUniforms.uProjScale,
      uAspect: sharedUniforms.uAspect,
    },
    vertexShader: /* glsl */ `
      ${glsl.REFRACTION}
      ${glsl.PROJECTION}
      uniform float uRadius;
      void main() {
        vec3 d = refractDir(normalize(mat3(modelMatrix) * position));
        float r = uRadius > 0.0 ? uRadius : length(position);
        gl_Position = projectView(viewMatrix * vec4(d * r, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** Split long segments so refraction and the far-radius projection stay smooth. */
function subdivide(a, b, out, maxDeg = 2) {
  const angle = a.angleTo(b);
  const n = Math.max(1, Math.ceil((angle * 180) / Math.PI / maxDeg));
  let prev = a.clone();
  for (let i = 1; i <= n; i++) {
    const p = new THREE.Vector3()
      .copy(a)
      .lerp(b, i / n)
      .normalize();
    out.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    prev = p;
  }
}

/** Polylines (arrays of Vector3 directions) → LineSegments geometry. */
export function polylineGeometry(polylines, { closed = false } = {}) {
  const arr = [];
  for (const line of polylines) {
    for (let i = 0; i + 1 < line.length; i++) subdivide(line[i], line[i + 1], arr);
    if (closed && line.length > 2) subdivide(line[line.length - 1], line[0], arr);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  return geom;
}

/** A small circle at fixed "latitude" in some frame (z is the pole). */
export function latitudeCircle(latDeg, steps = 180) {
  const pts = [];
  const lat = (latDeg * Math.PI) / 180;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(a), Math.cos(lat) * Math.sin(a), Math.sin(lat)));
  }
  return pts;
}

/** A great half-circle at fixed "longitude" from pole to pole (z is the pole). */
export function longitudeArc(lonDeg, steps = 90, fromLat = -90, toLat = 90) {
  const pts = [];
  const lon = (lonDeg * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const lat = ((fromLat + ((toLat - fromLat) * i) / steps) * Math.PI) / 180;
    pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)));
  }
  return pts;
}

export function lines(geometry, material, renderOrder = 2) {
  const obj = new THREE.LineSegments(geometry, material);
  obj.frustumCulled = false;
  obj.renderOrder = renderOrder;
  return obj;
}

/**
 * Fade a line (or a group of them) to a fraction of its own opacity, and hide it
 * once it's gone. Used as you rise from the ground into space and back.
 */
export function setFade(obj, f) {
  obj.visible = f > 0.002;
  obj.traverse((o) => {
    const u = o.material?.uniforms?.uOpacity;
    if (!u) return;
    o.userData.baseOpacity ??= u.value;
    u.value = o.userData.baseOpacity * f;
  });
}
