import { describe, expect, test } from "vitest";

import { bodyPosition, distanceAU, LIGHT_YEAR_AU, starPosition } from "../src/space.js";

const NEW_YEAR = Date.parse("2026-01-01T00:00Z");
const sirius = { ra: 101.2872, dec: -16.7161, plx: 379.21, ePlx: 1.58 };

describe("bodyPosition", () => {
  test("puts the Sun at the centre", () => {
    const sun = bodyPosition("sun", NEW_YEAR);
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBe(0);
  });

  test("puts the Earth about 1 AU from the Sun, nearest in early January", () => {
    const january = distanceAU(bodyPosition("earth", NEW_YEAR), bodyPosition("sun", NEW_YEAR));
    const july = distanceAU(bodyPosition("earth", Date.parse("2026-07-04T00:00Z")), bodyPosition("sun", NEW_YEAR));
    expect(january).toBeCloseTo(0.983, 3);
    expect(july).toBeCloseTo(1.017, 3);
  });

  test("puts the Moon about 384,000 km from the Earth", () => {
    const km = distanceAU(bodyPosition("moon", NEW_YEAR), bodyPosition("earth", NEW_YEAR)) * 149597870.7;
    expect(km).toBeGreaterThan(356000);
    expect(km).toBeLessThan(407000);
  });

  test("ignores case in a body's name", () => {
    expect(bodyPosition("Mars", NEW_YEAR)).toEqual(bodyPosition("mars", NEW_YEAR));
  });

  test("refuses a body it doesn't know", () => {
    expect(() => bodyPosition("vulcan", NEW_YEAR)).toThrow("No position for vulcan");
  });
});

describe("starPosition", () => {
  test("places Sirius 8.6 light-years away, in the direction of its catalogue position", () => {
    const pos = starPosition(sirius);
    const ly = Math.hypot(pos.x, pos.y, pos.z) / LIGHT_YEAR_AU;
    expect(ly).toBeCloseTo(8.6, 1);
    // South of the equator, and RA 6h 45m is just past the +y axis (RA 6h).
    expect(pos.z).toBeLessThan(0);
    expect(pos.y).toBeGreaterThan(0);
    expect(pos.x).toBeLessThan(0);
  });

  test("gives how uncertain the distance is", () => {
    expect(starPosition(sirius).relError).toBeCloseTo(1.58 / 379.21, 6);
    expect(starPosition({ ...sirius, ePlx: null }).relError).toBe(0);
  });

  test("has no position for a star too far to measure", () => {
    expect(starPosition({ ...sirius, plx: -0.5 })).toBeNull();
    expect(starPosition({ ...sirius, plx: 0 })).toBeNull();
    expect(starPosition({ ...sirius, plx: null })).toBeNull();
  });

  test("measures the same distance to a star from the Earth and from the Sun, give or take", () => {
    const pos = starPosition(sirius);
    const fromSun = distanceAU(pos, bodyPosition("sun", NEW_YEAR));
    const fromEarth = distanceAU(pos, bodyPosition("earth", NEW_YEAR));
    expect(Math.abs(fromSun - fromEarth)).toBeLessThanOrEqual(1);
  });
});

describe("distanceAU", () => {
  test("is the straight-line distance", () => {
    expect(distanceAU({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 })).toBe(5);
  });
});
