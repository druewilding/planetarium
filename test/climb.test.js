import { describe, expect, test } from "vitest";

import { climb, GROUND_KM } from "../src/climb.js";

describe("climb", () => {
  const up = climb(20000);

  test("gets going at once: a kilometre up within half a second, ten within a second and a half", () => {
    expect(up.kmAt(0)).toBeCloseTo(GROUND_KM, 6);
    expect(up.kmAt(0.1)).toBeGreaterThan(0.02);
    expect(up.kmAt(0.5)).toBeGreaterThan(1);
    expect(up.kmAt(1.5)).toBeGreaterThan(10);
  });

  test("takes a second or more to pass through the top of the air (60 to 120 km), where the sky turns black", () => {
    const times = [];
    for (let t = 0; t <= up.duration; t += 0.01) {
      const km = up.kmAt(t);
      if (km > 60 && km < 120) times.push(t);
    }
    expect(times.length * 0.01).toBeGreaterThan(0.8);
  });

  test("only ever climbs, and comes to a stop at the top", () => {
    let last = 0;
    for (let t = 0; t <= up.duration; t += 0.02) {
      const km = up.kmAt(t);
      expect(km).toBeGreaterThanOrEqual(last * 0.999999);
      last = km;
    }
    expect(up.kmAt(up.duration)).toBeCloseTo(20000, 3);
    expect(up.kmAt(up.duration - 0.05) / 20000).toBeGreaterThan(0.995);
    expect(up.duration).toBeGreaterThan(5);
    expect(up.duration).toBeLessThan(8);
  });

  test("a lower climb is shorter, and ends where it should", () => {
    const low = climb(50);
    expect(low.duration).toBeLessThan(up.duration);
    expect(low.kmAt(low.duration)).toBeCloseTo(50, 6);
  });
});
