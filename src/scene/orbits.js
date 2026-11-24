// Orbits, seen in perspective from wherever you are: the Moon's round the Earth,
// and the Earth's and the planets' round the Sun.
//
// Each orbit is a ring of real positions (J2000 equator, AU, like space.js),
// worked out once and then seen from where you are every frame, as a smooth curve
// through them. A stretch that passes close by is split finer, so it still curves
// smoothly across the sky, and each point is drawn either just in front of the
// Earth or behind it, so the Earth hides the parts of an orbit on its far side.
//
// To show how far away each part is, the line fades with distance, and beads
// spaced evenly in time along it are drawn bigger the nearer they are (bunching up
// as they go into the distance, like fence posts).

import * as THREE from "three";

import { A, AU_KM, Body, PLANETS } from "../astro.js";
import { lines } from "./lines.js";

const DAY = 86400000;
const YEAR = 365.25 * DAY;
const EARTH_RADIUS_AU = 6371 / AU_KM;
const IN_FRONT = 870; // the Earth is drawn at 920 (see earth.js)
const BEHIND = 960;
const MAX_STEP = (1.5 * Math.PI) / 180; // longest piece of line, as an angle on the sky
const MAX_BEND = (0.05 * Math.PI) / 180; // split a piece that bends more than this
const MAX_SPLITS = 14;
const BEADS = 24; // along each planet's orbit (and the Earth's)

/** Sidereal periods, in days. */
const PERIOD = {
  Mercury: 87.969,
  Venus: 224.701,
  Earth: 365.256,
  Mars: 686.98,
  Jupiter: 4332.59,
  Saturn: 10759.22,
  Uranus: 30688.5,
  Neptune: 60182,
};
const MOON_MONTH = 27.3217; // days
const MOON_STEP = 2 * 3600000; // between the Moon's positions: one bead a day is every 12th

export const ORBIT_COLORS = {
  moon: "#c9d6ff",
  earth: "#6fd3ff",
  Mercury: "#c2b8ad",
  Venus: "#f2dc9b",
  Mars: "#ff8a65",
  Jupiter: "#e6b98c",
  Saturn: "#d8c070",
  Uranus: "#8fe3e6",
  Neptune: "#7d96ff",
};

/**
 * Positions at `n` evenly spaced times from `epoch` (ms), `step` ms apart: a closed
 * ring (one whole period) unless `open`.
 */
function sample(epoch, step, n, at, open = false) {
  const pts = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = at(epoch + i * step);
    pts.set([v.x, v.y, v.z], i * 3);
  }
  return { epoch, step, n, pts, open, fix: null };
}
const helio = (body) => (t) => A.HelioVector(body, new Date(t));

/** Where along a ring (in samples, possibly fractional) a time falls. */
function indexAt(c, ms) {
  const s = (ms - c.epoch) / c.step;
  return c.open ? s : ((s % c.n) + c.n) % c.n;
}

/**
 * The position at sample index `s`, on a smooth curve through the samples (a
 * Catmull–Rom spline). `fix` nudges the curve near one point so it passes exactly
 * through where a body really is right now.
 */
function pointAt(c, s, out) {
  const { pts, n } = c;
  const i = Math.floor(s);
  const f = s - i;
  const idx = (k) => (c.open ? Math.min(n - 1, Math.max(0, k)) : ((k % n) + n) % n) * 3;
  const [a, b, d, e] = [idx(i - 1), idx(i), idx(i + 1), idx(i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  for (let k = 0; k < 3; k++) {
    const p0 = pts[a + k];
    const p1 = pts[b + k];
    const p2 = pts[d + k];
    const p3 = pts[e + k];
    out[k] = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
  }
  if (c.fix) {
    let ds = s - c.fix.s;
    if (!c.open) ds = ((ds + n * 1.5) % n) - n / 2;
    const w = Math.exp(-((ds / c.fix.width) ** 2));
    out[0] += c.fix.dx * w;
    out[1] += c.fix.dy * w;
    out[2] += c.fix.dz * w;
  }
  return out;
}

function lineMaterial(shared, color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace) },
      uOpacity: { value: opacity },
      uRefract: shared.uRefract,
      uStereo: shared.uStereo,
      uProjScale: shared.uProjScale,
      uAspect: shared.uAspect,
    },
    vertexShader: /* glsl */ `
      ${shared.glsl.REFRACTION}
      ${shared.glsl.PROJECTION}
      attribute float aFade;
      varying float vFade;
      void main() {
        // The vertex's length is the depth to draw it at (in front of the Earth or behind it).
        vec3 d = refractDir(normalize(mat3(modelMatrix) * position));
        vFade = aFade;
        gl_Position = projectView(viewMatrix * vec4(d * length(position), 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFade;
      void main() { gl_FragColor = vec4(uColor, uOpacity * vFade); }
    `,
    transparent: true,
    depthWrite: false,
  });
}

function beadMaterial(shared, color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace) },
      uOpacity: { value: opacity },
      uRefract: shared.uRefract,
      uStereo: shared.uStereo,
      uProjScale: shared.uProjScale,
      uAspect: shared.uAspect,
      uPixelRatio: shared.uPixelRatio,
    },
    vertexShader: /* glsl */ `
      ${shared.glsl.REFRACTION}
      ${shared.glsl.PROJECTION}
      uniform float uPixelRatio;
      attribute float aSize;
      void main() {
        vec3 d = refractDir(normalize(mat3(modelMatrix) * position));
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectView(viewMatrix * vec4(d * length(position), 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(0.55, 1.0, r2)));
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** A growable Float32Array buffer behind a geometry attribute. */
function setAttribute(geom, name, data, size, count) {
  let attr = geom.getAttribute(name);
  if (!attr || attr.array.length < count * size) {
    attr = new THREE.BufferAttribute(new Float32Array(Math.max(count * size, (attr?.array.length ?? 0) * 2)), size);
    geom.setAttribute(name, attr);
  }
  attr.array.set(data.subarray(0, count * size));
  attr.needsUpdate = true;
}

/** shared: the scene's shared uniforms; glsl: the shared shader snippets. */
export function createOrbits(shared, glsl) {
  const ctx = { ...shared, glsl };
  const group = new THREE.Group();
  const make = (key, opacity) => {
    const line = lines(new THREE.BufferGeometry(), lineMaterial(ctx, ORBIT_COLORS[key], opacity), 3);
    const beads = new THREE.Points(new THREE.BufferGeometry(), beadMaterial(ctx, ORBIT_COLORS[key], 0.85));
    beads.frustumCulled = false;
    beads.renderOrder = 3;
    line.add(beads); // (fades and hides with its line)
    return { key, line, beads, ring: null };
  };
  const moon = make("moon", 0.6);
  const earth = make("earth", 0.6);
  const planets = PLANETS.map((p) => ({ ...make(p.id, 0.55), name: p.name }));
  const planetGroup = new THREE.Group();
  planetGroup.add(...planets.map((p) => p.line));
  group.add(moon.line, earth.line, planetGroup);

  let months = { key: "", marks: [] };
  let names = [];

  // ---- Seeing a ring from you ----
  let pos = new Float32Array(8192);
  let dist = new Float32Array(4096);
  let count = 0;
  const vertex = (x, y, z, e) => {
    if (count * 3 + 3 > pos.length) {
      const p = new Float32Array(pos.length * 2);
      p.set(pos);
      pos = p;
      const d = new Float32Array(dist.length * 2);
      d.set(dist);
      dist = d;
    }
    const r = Math.hypot(x, y, z);
    const k = (behindEarth(x, y, z, e) ? BEHIND : IN_FRONT) / r;
    pos.set([x * k, y * k, z * k], count * 3);
    dist[count++] = r;
  };

  /** Is a point (relative to you) hidden by the Earth (centre `e`, relative to you)? */
  function behindEarth(x, y, z, e) {
    const d = Math.hypot(x, y, z);
    const along = (x * e.x + y * e.y + z * e.z) / d; // the Earth's centre, along the line of sight
    if (along <= 0) return false;
    const miss2 = e.x * e.x + e.y * e.y + e.z * e.z - along * along;
    const r2 = EARTH_RADIUS_AU * EARTH_RADIUS_AU;
    return miss2 < r2 && d > along - Math.sqrt(r2 - miss2);
  }

  const angle = (a, b) => {
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    return Math.acos(Math.min(1, Math.max(-1, c)));
  };

  /** Draw ring `c` seen from `o` (same frame), with the Earth's centre at `e` (relative to you). */
  function draw(orbit, c, o, e, beadEvery) {
    const rel = (s) => {
      const p = pointAt(c, s, [0, 0, 0]);
      return [p[0] - o.x, p[1] - o.y, p[2] - o.z];
    };
    // Split a stretch of the curve until each piece is short, and straight, on the sky.
    const piece = (s0, s1, a, b, depth) => {
      const sm = (s0 + s1) / 2;
      const m = rel(sm);
      const chord = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
      if (depth < MAX_SPLITS && (angle(a, b) > MAX_STEP || angle(m, chord) > MAX_BEND)) {
        piece(s0, sm, a, m, depth + 1);
        piece(sm, s1, m, b, depth + 1);
        return;
      }
      vertex(...a, e);
      vertex(...b, e);
    };
    count = 0;
    const last = c.open ? c.n - 1 : c.n;
    let a = rel(0);
    for (let i = 0; i < last; i++) {
      const b = rel(i + 1);
      piece(i, i + 1, a, b, 0);
      a = b;
    }
    // Fainter the further away, against the nearest part of this orbit.
    let near = Infinity;
    for (let i = 0; i < count; i++) near = Math.min(near, dist[i]);
    for (let i = 0; i < count; i++) dist[i] = 0.25 + 0.75 * Math.sqrt(near / dist[i]);
    const geom = orbit.line.geometry;
    setAttribute(geom, "position", pos, 3, count);
    setAttribute(geom, "aFade", dist, 1, count);
    geom.setDrawRange(0, count);

    // Beads, evenly spaced in time, bigger the nearer they are.
    const n = Math.floor((last + 1e-9) / beadEvery) + (c.open ? 1 : 0);
    const bp = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const [x, y, z] = rel(k * beadEvery);
      const r = Math.hypot(x, y, z);
      const depth = (behindEarth(x, y, z, e) ? BEHIND : IN_FRONT) / r;
      bp.set([x * depth, y * depth, z * depth], k * 3);
      size[k] = Math.min(9, Math.max(2.5, 2 + 3 / Math.sqrt(r / near)));
    }
    setAttribute(orbit.beads.geometry, "position", bp, 3, n);
    setAttribute(orbit.beads.geometry, "aSize", size, 1, n);
    orbit.beads.geometry.setDrawRange(0, n);
  }

  /** A direction from you to a point on a ring, for a label, or null when the Earth hides it. */
  function labelAt(c, s, o, e) {
    const [x, y, z] = pointAt(c, s, [0, 0, 0]).map((v, k) => v - [o.x, o.y, o.z][k]);
    if (behindEarth(x, y, z, e)) return null;
    const r = Math.hypot(x, y, z);
    return new THREE.Vector3(x / r, y / r, z / r);
  }

  /**
   * Redraw the orbits that are switched on, seen from `you` (J2000, AU, from the
   * Earth's centre) at `ms`.
   */
  function update(ms, you, on) {
    const earthNow = A.HelioVector(Body.Earth, new Date(ms));
    const o = { x: earthNow.x + you.x, y: earthNow.y + you.y, z: earthNow.z + you.z }; // you, from the Sun
    const e = { x: -you.x, y: -you.y, z: -you.z }; // the Earth's centre, from you
    names = [];

    if (on.planetOrbits) {
      for (const p of planets) {
        // An orbit barely changes over the years: work it out again only now and then.
        if (!p.ring || Math.abs(ms - p.ring.epoch) > 20 * YEAR) {
          p.ring = sample(ms, (PERIOD[p.key] * DAY) / 360, 360, helio(Body[p.key]));
        }
        draw(p, p.ring, o, e, 360 / BEADS);
        // Name each orbit an eighth of the way round ahead of its planet.
        const dir = labelAt(p.ring, (indexAt(p.ring, ms) + 45) % 360, o, e);
        if (dir) names.push({ key: `orbit${p.key}`, text: `${p.name}’s orbit`, cls: `orbit ${p.key}`, dir });
      }
    }

    if (on.earthOrbit) {
      const c = (earth.ring ??= sample(ms, (PERIOD.Earth * DAY) / 366, 366, helio(Body.Earth)));
      if (Math.abs(ms - c.epoch) > 2 * YEAR) earth.ring = null;
      // You're right beside the Earth's orbit, so make the curve go exactly through the Earth.
      const s = indexAt(c, ms);
      const at = pointAt({ ...c, fix: null }, s, [0, 0, 0]);
      c.fix = { s, width: 1.5, dx: earthNow.x - at[0], dy: earthNow.y - at[1], dz: earthNow.z - at[2] };
      draw(earth, c, o, e, 366 / BEADS);
      // You're standing right beside the Earth's path, so its next and last few hours
      // sweep past beneath you, and the rest runs off into the distance from two points
      // on opposite sides of the sky: where the Earth is heading, and where it's come from.
      const perDay = c.n / PERIOD.Earth;
      for (const [key, days, text] of [
        ["heading", 3, "Where the Earth is heading"],
        ["came", -3, "Where the Earth has come from"],
      ]) {
        const dir = labelAt(c, (s + days * perDay + c.n) % c.n, o, e);
        if (dir) names.push({ key, text, cls: "orbit earth", dir });
      }
      updateMonths(ms);
    }

    if (on.moonOrbit) {
      // Half a month either side of now (the Moon's orbit shifts a little each time round).
      const centre = Math.round(ms / DAY) * DAY;
      if (!moon.ring || moon.ring.centre !== centre) {
        const n = Math.round((MOON_MONTH * DAY) / MOON_STEP);
        moon.ring = sample(
          centre - (n / 2) * MOON_STEP,
          MOON_STEP,
          n + 1,
          (t) => A.GeoMoon(A.MakeTime(new Date(t))),
          true
        );
        moon.ring.centre = centre;
      }
      draw(moon, moon.ring, you, e, DAY / MOON_STEP);
      const dir = labelAt(moon.ring, indexAt(moon.ring, ms + 4 * DAY), you, e);
      if (dir) names.push({ key: "orbitMoon", text: "Moon’s orbit", cls: "orbit moon", dir });
    }

    return { earthNow, o };
  }

  /** Where the Earth will be on the first of each of the next twelve months. */
  function updateMonths(ms) {
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key === months.key) return;
    const marks = [];
    for (let i = 1; i <= 12; i++) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1);
      const v = A.HelioVector(Body.Earth, new Date(t));
      const text = new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      marks.push({ key: `month${i}`, text, ms: t, pos: { x: v.x, y: v.y, z: v.z } });
    }
    months = { key, marks };
  }

  /**
   * The month marks along the Earth's orbit, as directions from you (J2000), each
   * with whether the Earth hides it.
   */
  function monthMarks(o, you) {
    const e = { x: -you.x, y: -you.y, z: -you.z };
    return months.marks.map((m) => {
      const x = m.pos.x - o.x;
      const y = m.pos.y - o.y;
      const z = m.pos.z - o.z;
      const r = Math.hypot(x, y, z);
      return { ...m, dir: new THREE.Vector3(x / r, y / r, z / r), hidden: behindEarth(x, y, z, e) };
    });
  }

  return {
    group,
    layers: { moonOrbit: moon.line, earthOrbit: earth.line, planetOrbits: planetGroup },
    update,
    monthMarks,
    /** The orbits' names, placed along them (J2000 directions from you), from the last update. */
    names: () => names,
  };
}
