import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { compassPoint, computeSky, horizonFrame, refractionDeg, sunVisibleFraction } from "../src/astro.js";
import { surfaceDirection } from "../src/space.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };

describe("computeSky", () => {
  test("puts the midsummer Sun 53.5° up, due south, at noon in Oslo", () => {
    const { sun } = computeSky(Date.parse("2026-06-21T11:19Z"), oslo);
    // 90° − 59.91° latitude + 23.44° tilt, plus a little refraction
    expect(sun.alt).toBeCloseTo(53.54, 1);
    expect(sun.az).toBeCloseTo(180, 0);
  });

  test("keeps the midwinter Sun under 7° up in Oslo", () => {
    const { sun } = computeSky(Date.parse("2026-12-21T11:15Z"), oslo);
    expect(sun.alt).toBeGreaterThan(6.5);
    expect(sun.alt).toBeLessThan(7);
  });

  test("puts the Sun below the horizon at midnight in Oslo in winter", () => {
    expect(computeSky(Date.parse("2026-12-21T23:00Z"), oslo).sun.alt).toBeLessThan(-40);
  });

  test("covers the Sun completely in Luxor during the eclipse of 2 August 2027", () => {
    const luxor = { lat: 25.69, lon: 32.64 };
    expect(computeSky(Date.parse("2027-08-02T10:02Z"), luxor).sun.visibleFraction).toBe(0);
    expect(computeSky(Date.parse("2027-08-02T13:00Z"), luxor).sun.visibleFraction).toBe(1);
  });

  test("has a full Moon on 3 January 2026", () => {
    const { moon } = computeSky(Date.parse("2026-01-03T10:03Z"), oslo);
    expect(moon.phaseAngle).toBeCloseTo(180, 0);
    expect(moon.phaseFraction).toBeGreaterThan(0.99);
  });

  test("gives the Sun and Moon about half a degree across", () => {
    const { sun, moon } = computeSky(Date.parse("2026-01-03T10:03Z"), oslo);
    for (const body of [sun, moon]) {
      const degrees = (2 * body.angularRadius * 180) / Math.PI;
      expect(degrees).toBeGreaterThan(0.48);
      expect(degrees).toBeLessThan(0.57);
    }
  });

  test("includes the seven other planets", () => {
    const { planets } = computeSky(Date.now(), oslo);
    expect(planets.map((p) => p.name)).toEqual(["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]);
  });
});

describe("refractionDeg", () => {
  test("lifts the horizon by about half a degree", () => {
    expect(refractionDeg(0)).toBeCloseTo(0.48, 2);
  });

  test("barely lifts anything high in the sky", () => {
    expect(refractionDeg(45)).toBeLessThan(0.02);
    expect(refractionDeg(90)).toBeLessThan(0.001);
  });

  test("fades out below the horizon", () => {
    expect(refractionDeg(-45)).toBeLessThan(refractionDeg(-1));
    expect(refractionDeg(-90)).toBe(0);
  });
});

describe("sunVisibleFraction", () => {
  test("is all of the Sun when the Moon is clear of it", () => {
    expect(sunVisibleFraction(1, 1, 2.5)).toBe(1);
  });

  test("is none of the Sun in a total eclipse", () => {
    expect(sunVisibleFraction(1, 1.05, 0)).toBe(0);
  });

  test("leaves a ring in an annular eclipse", () => {
    expect(sunVisibleFraction(1, 0.9, 0)).toBeCloseTo(0.19, 5);
  });

  test("is half the Sun when the Moon's edge passes through its centre, for a huge Moon", () => {
    // A Moon so large its edge is nearly straight across the Sun
    expect(sunVisibleFraction(1, 1000, 1000)).toBeCloseTo(0.5, 2);
  });
});

describe("compassPoint", () => {
  test.each([
    [0, "N"],
    [359, "N"],
    [90, "E"],
    [225, "SW"],
    [-90, "W"],
    [720 + 22.5, "NNE"],
  ])("%f° is %s", (az, point) => {
    expect(compassPoint(az)).toBe(point);
  });
});

describe("floating over a place", () => {
  test("over anywhere on Earth, its own frame puts the Earth's centre straight below you", () => {
    const ms = Date.parse("2026-11-25T12:00:00Z");
    for (const [lat, lon] of [
      [59.91, 10.75],
      [-26.2, 28.05],
      [78.22, 15.65],
      [0, -78.5],
      [-77.8, 166.7],
    ]) {
      const d = surfaceDirection(lat, lon, ms);
      const up = new THREE.Vector3(d.x, d.y, d.z).applyMatrix4(horizonFrame(ms, { lat, lon }));
      // (Within the small difference between geodetic and geocentric latitude.)
      expect(up.angleTo(new THREE.Vector3(0, 1, 0)) * (180 / Math.PI)).toBeLessThan(0.25);
    }
  });
});

describe("computeSky from above the Earth", () => {
  const ms = Date.parse("2026-11-24T22:00Z");
  const above = (km, air = 0) => {
    const d = surfaceDirection(oslo.lat, oslo.lon, ms);
    const r = (6371 + km) / 149597870.7;
    return { posAU: { x: d.x * r, y: d.y * r, z: d.z * r }, eqjToWorld: horizonFrame(ms, oslo), air };
  };

  test("agrees with the ground just above it", () => {
    const ground = computeSky(ms, oslo);
    const up = computeSky(ms, oslo, above(0.01, 1));
    expect(up.sun.dir.angleTo(ground.sun.dir)).toBeLessThan(1e-4);
    expect(up.moon.dir.angleTo(ground.moon.dir)).toBeLessThan(1e-3);
    expect(up.planets[2].dir.angleTo(ground.planets[2].dir)).toBeLessThan(1e-4);
  });

  test("shifts the nearby Moon against the stars as you rise, and the Sun hardly at all", () => {
    const low = computeSky(ms, oslo, above(1));
    const high = computeSky(ms, oslo, above(100000));
    expect((low.moon.dir.angleTo(high.moon.dir) * 180) / Math.PI).toBeGreaterThan(5);
    expect((low.sun.dir.angleTo(high.sun.dir) * 180) / Math.PI).toBeLessThan(0.05);
  });
});
