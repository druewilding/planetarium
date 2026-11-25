import { describe, expect, test } from "vitest";

import { A, AU_KM } from "../src/astro.js";
import { createOrbits } from "../src/scene/orbits.js";
import { surfaceDirection } from "../src/space.js";

// The shaders aren't compiled here: only the lines' geometry is checked.
const shared = {
  uRefract: { value: 0 },
  uStereo: { value: 0 },
  uProjScale: { value: 1 },
  uAspect: { value: 1 },
  uPixelRatio: { value: 1 },
};
const glsl = { REFRACTION: "", PROJECTION: "" };
const MS = Date.parse("2026-11-24T10:30:00Z");

/** You, `km` straight up above Oslo (J2000, AU, from the Earth's centre). */
function above(km) {
  const d = surfaceDirection(59.91, 10.75, MS);
  const r = (6371 + km) / AU_KM;
  return { x: d.x * r, y: d.y * r, z: d.z * r };
}

/** The lengths of a line's vertices: 870 in front of the Earth, 960 behind it. */
function depths(obj) {
  const pos = obj.geometry.attributes.position.array;
  const out = [];
  for (let i = 0; i < obj.geometry.drawRange.count; i++) {
    out.push(Math.round(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])));
  }
  return out;
}

describe("orbits", () => {
  const orbits = createOrbits(shared, glsl);
  orbits.update(MS, above(20000), { moonOrbit: true, earthOrbit: true, planetOrbits: true });

  test("every orbit is drawn", () => {
    for (const obj of [orbits.layers.moonOrbit, orbits.layers.earthOrbit, ...orbits.layers.planetOrbits.children]) {
      expect(obj.geometry.drawRange.count).toBeGreaterThan(300);
    }
  });

  test("the Earth's orbit runs through the Earth, so the Earth hides part of it", () => {
    const d = depths(orbits.layers.earthOrbit);
    expect(d.filter((r) => r === 960).length).toBeGreaterThan(0);
    expect(d.filter((r) => r === 870).length).toBeGreaterThan(d.length / 2);
  });

  test("from above Oslo the whole of the Moon's orbit is in view, clear of the Earth", () => {
    expect(new Set(depths(orbits.layers.moonOrbit))).toEqual(new Set([870]));
  });

  test("from the far side of the Earth from the Moon, the Earth hides part of its orbit", () => {
    const m = A.GeoMoon(A.MakeTime(new Date(MS)));
    const k = -(6371 + 20000) / AU_KM / Math.hypot(m.x, m.y, m.z);
    orbits.update(MS, { x: m.x * k, y: m.y * k, z: m.z * k }, { moonOrbit: true });
    const d = depths(orbits.layers.moonOrbit);
    expect(d.filter((r) => r === 960).length).toBeGreaterThan(0);
    expect(d.filter((r) => r === 870).length).toBeGreaterThan(d.length / 2);
  });

  test("lines fade with distance: the far side of Mars's orbit is far fainter than the near side", () => {
    orbits.update(MS, above(20000), { planetOrbits: true });
    const fade = orbits.layers.planetOrbits.children[2].geometry.attributes.aFade;
    const n = orbits.layers.planetOrbits.children[2].geometry.drawRange.count;
    const values = Array.from(fade.array.subarray(0, n));
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    expect(Math.min(...values)).toBeLessThan(0.25);
  });

  test("each orbit is named, along the line", () => {
    orbits.update(MS, above(20000), { moonOrbit: true, planetOrbits: true });
    const names = orbits.names().map((n) => n.text);
    expect(names).toContain("Mars’s orbit");
    expect(names).toContain("Moon’s orbit");
  });

  test("the months along the Earth's orbit run round to the far side of the Sun", () => {
    const { o } = orbits.update(MS, above(20000), { earthOrbit: true });
    const marks = orbits.monthMarks(o, above(20000));
    expect(marks.map((m) => m.text)).toEqual([
      "1 Dec",
      "1 Jan",
      "1 Feb",
      "1 Mar",
      "1 Apr",
      "1 May",
      "1 Jun",
      "1 Jul",
      "1 Aug",
      "1 Sept",
      "1 Oct",
      "1 Nov",
    ]);
    // Half a year on, the Earth is beyond the Sun: almost the opposite way from where it is now.
    const sun = { x: -o.x, y: -o.y, z: -o.z };
    const r = Math.hypot(sun.x, sun.y, sun.z);
    const may = marks[5].dir;
    expect(Math.acos((may.x * sun.x + may.y * sun.y + may.z * sun.z) / r) * (180 / Math.PI)).toBeLessThan(15);
  });
});
