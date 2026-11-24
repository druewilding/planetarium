// Orbits, seen in perspective from wherever you are: the Moon's round the Earth,
// and the Earth's and the planets' round the Sun.
//
// Each orbit is a ring of real positions (J2000 equator, AU, like space.js),
// worked out once and then seen from where you are every frame. A stretch that
// passes close by is split finer, so it still curves smoothly across the sky,
// and each point is drawn either just in front of the Earth or behind it, so the
// Earth hides the parts of an orbit that go round its far side.

import * as THREE from "three";

import { A, AU_KM, Body, PLANETS } from "../astro.js";
import { createLineMaterial, lines } from "./lines.js";

const DAY = 86400000;
const YEAR = 365.25 * DAY;
const EARTH_RADIUS_AU = 6371 / AU_KM;
const IN_FRONT = 870; // the Earth is drawn at 920 (see earth.js)
const BEHIND = 960;
const MAX_STEP = (1.5 * Math.PI) / 180; // longest piece of line, as an angle on the sky
const MAX_SPLITS = 12;

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

/** One period of positions, from `epoch` (ms): a closed ring. */
function ring(body, epoch, days, n, at = (t) => A.HelioVector(body, new Date(t))) {
  const pts = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = at(epoch + (i / n) * days * DAY);
    pts.set([v.x, v.y, v.z], i * 3);
  }
  return { epoch, days, n, pts };
}

export function createOrbits(shared, glsl) {
  const group = new THREE.Group();
  const make = (color, opacity) => {
    const obj = lines(
      new THREE.BufferGeometry(),
      createLineMaterial(shared, glsl, { color, opacity, radius: null }),
      3
    );
    obj.userData.buffer = new Float32Array(0);
    group.add(obj);
    return obj;
  };
  const moonLine = make(ORBIT_COLORS.moon, 0.6);
  const earthLine = make(ORBIT_COLORS.earth, 0.6);
  const planetGroup = new THREE.Group();
  const planetLines = PLANETS.map((p) => {
    const obj = make(ORBIT_COLORS[p.id], 0.5);
    planetGroup.add(obj); // (moves it out of `group`)
    return { id: p.id, obj, ring: null };
  });
  group.add(planetGroup);

  let earthRing = null;
  let moonRing = null;
  let months = { key: "", marks: [] };

  // ---- Drawing a ring as seen from `o`, with the Earth's centre at `e` (same frame) ----
  let out = new Float32Array(4096);
  let count = 0;
  const push = (x, y, z) => {
    if (count + 3 > out.length) {
      const grown = new Float32Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[count++] = x;
    out[count++] = y;
    out[count++] = z;
  };

  /** Is a point (relative to you) hidden by the Earth (centre `e`, relative to you)? */
  function behindEarth(x, y, z, e) {
    const dist = Math.hypot(x, y, z);
    const along = (x * e.x + y * e.y + z * e.z) / dist; // the Earth's centre, along the line of sight
    if (along <= 0) return false;
    const miss2 = e.x * e.x + e.y * e.y + e.z * e.z - along * along;
    const r2 = EARTH_RADIUS_AU * EARTH_RADIUS_AU;
    return miss2 < r2 && dist > along - Math.sqrt(r2 - miss2);
  }

  /** Add one vertex: its direction, pushed out to the depth that puts it in front of or behind the Earth. */
  function vertex(x, y, z, e) {
    const r = (behindEarth(x, y, z, e) ? BEHIND : IN_FRONT) / Math.hypot(x, y, z);
    push(x * r, y * r, z * r);
  }

  /** A straight piece from a to b (relative to you), split until each bit is short on the sky. */
  function piece(ax, ay, az, bx, by, bz, e, depth) {
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const cos = (ax * bx + ay * by + az * bz) / (la * lb);
    if (depth < MAX_SPLITS && cos < Math.cos(MAX_STEP)) {
      const [mx, my, mz] = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
      piece(ax, ay, az, mx, my, mz, e, depth + 1);
      piece(mx, my, mz, bx, by, bz, e, depth + 1);
      return;
    }
    vertex(ax, ay, az, e);
    vertex(bx, by, bz, e);
  }

  /** Draw positions `pts` (a closed ring unless `open`), seen from `o`, into a line. */
  function draw(obj, pts, o, e, { open = false, insert = null } = {}) {
    count = 0;
    const n = pts.length / 3;
    const at = (i) => [pts[i * 3] - o.x, pts[i * 3 + 1] - o.y, pts[i * 3 + 2] - o.z];
    const last = open ? n - 1 : n;
    for (let i = 0; i < last; i++) {
      const a = at(i);
      const b = at((i + 1) % n);
      if (insert && insert.after === i) {
        // Through exactly where the body is now (the Earth: you're right beside its orbit).
        const p = [insert.x - o.x, insert.y - o.y, insert.z - o.z];
        piece(...a, ...p, e, 0);
        piece(...p, ...b, e, 0);
      } else piece(...a, ...b, e, 0);
    }
    const geom = obj.geometry;
    if (obj.userData.buffer.length < count) {
      obj.userData.buffer = new Float32Array(Math.max(count, obj.userData.buffer.length * 2));
      geom.setAttribute("position", new THREE.BufferAttribute(obj.userData.buffer, 3));
    }
    obj.userData.buffer.set(out.subarray(0, count));
    geom.attributes.position.needsUpdate = true;
    geom.setDrawRange(0, count / 3);
  }

  /**
   * Redraw the orbits that are switched on, seen from `you` (J2000, AU, from the
   * Earth's centre) at `ms`.
   */
  function update(ms, you, on) {
    const earthNow = A.HelioVector(Body.Earth, new Date(ms));
    const o = { x: earthNow.x + you.x, y: earthNow.y + you.y, z: earthNow.z + you.z }; // you, from the Sun
    const e = { x: -you.x, y: -you.y, z: -you.z }; // the Earth's centre, from you

    if (on.planetOrbits) {
      for (const p of planetLines) {
        // An orbit barely changes over the years: work it out again only now and then.
        if (!p.ring || Math.abs(ms - p.ring.epoch) > 20 * YEAR) p.ring = ring(Body[p.id], ms, PERIOD[p.id], 360);
        draw(p.obj, p.ring.pts, o, e);
      }
    }

    if (on.earthOrbit) {
      if (!earthRing || Math.abs(ms - earthRing.epoch) > 2 * YEAR) earthRing = ring(Body.Earth, ms, PERIOD.Earth, 366);
      const days = ((((ms - earthRing.epoch) / DAY) % PERIOD.Earth) + PERIOD.Earth) % PERIOD.Earth;
      const after = Math.min(earthRing.n - 1, Math.floor((days / PERIOD.Earth) * earthRing.n));
      draw(earthLine, earthRing.pts, o, e, { insert: { after, ...earthNow } });
      updateMonths(ms);
    }

    if (on.moonOrbit) {
      // Half a month either side of now (the Moon's orbit shifts a little each time round).
      const step = 2 * 3600000;
      const centre = Math.round(ms / step) * step;
      if (!moonRing || Math.abs(centre - moonRing.centre) > DAY) {
        const n = Math.round((MOON_MONTH * DAY) / step) + 1;
        moonRing = ring(null, centre - (n - 1) * step * 0.5, ((n - 1) * step) / DAY, n - 1, (t) =>
          A.GeoMoon(A.MakeTime(new Date(t)))
        );
        moonRing.centre = centre;
      }
      draw(moonLine, moonRing.pts, you, { x: -you.x, y: -you.y, z: -you.z }, { open: true });
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
    layers: { moonOrbit: moonLine, earthOrbit: earthLine, planetOrbits: planetGroup },
    update,
    monthMarks,
  };
}
