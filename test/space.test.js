import * as A from "astronomy-engine";
import { describe, expect, test } from "vitest";

import {
  bodyPosition,
  distanceAU,
  earthAxes,
  LIGHT_YEAR_AU,
  starPosition,
  sunDirection,
  surfaceDirection,
} from "../src/space.js";

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

describe("the Earth's turn", () => {
  const angle = (a, b) => (Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 180) / Math.PI;
  const MIDSUMMER_NOON = Date.parse("2026-06-21T12:00Z");

  test("has three square-on axes, with the pole close to the J2000 pole", () => {
    const { x, y, z } = earthAxes(MIDSUMMER_NOON);
    expect(angle(x, y)).toBeCloseTo(90, 6);
    expect(angle(y, z)).toBeCloseTo(90, 6);
    // Precession has moved the pole about a third of a degree since 2000.
    expect(angle(z, { x: 0, y: 0, z: 1 })).toBeGreaterThan(0.1);
    expect(angle(z, { x: 0, y: 0, z: 1 })).toBeLessThan(0.5);
  });

  test("puts a place where astronomy-engine does (allowing for the Earth not being quite round)", () => {
    for (const [lat, lon] of [
      [59.91, 10.75],
      [-26.2, 28.04],
      [35.69, 139.75],
    ]) {
      const o = A.ObserverVector(new Date(MIDSUMMER_NOON), new A.Observer(lat, lon, 0), false);
      const r = Math.hypot(o.x, o.y, o.z);
      expect(angle(surfaceDirection(lat, lon, MIDSUMMER_NOON), { x: o.x / r, y: o.y / r, z: o.z / r })).toBeLessThan(
        0.2
      );
    }
  });

  test("has the Sun overhead on the Tropic of Cancer, near Greenwich, at noon on the June solstice", () => {
    const sun = sunDirection(MIDSUMMER_NOON);
    expect(angle(surfaceDirection(23.44, 0.4, MIDSUMMER_NOON), sun)).toBeLessThan(0.3);
  });

  test("turns once a sidereal day, about 4 minutes short of 24 hours", () => {
    const start = surfaceDirection(0, 0, MIDSUMMER_NOON);
    expect(angle(start, surfaceDirection(0, 0, MIDSUMMER_NOON + 86164091))).toBeLessThan(0.01);
    expect(angle(start, surfaceDirection(0, 0, MIDSUMMER_NOON + 86400000))).toBeCloseTo(0.99, 1);
  });
});
