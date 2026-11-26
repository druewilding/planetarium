import { describe, expect, test } from "vitest";

import { eyeScale, limitFor, radiusFor, stereoAmount, thetaFor } from "../src/projection.js";

describe("projection", () => {
  test("is ordinary perspective when zoomed in, and stereographic when zoomed right out", () => {
    expect(stereoAmount(30)).toBe(0);
    expect(stereoAmount(70)).toBe(0);
    expect(stereoAmount(90)).toBeCloseTo(0.5, 5);
    expect(stereoAmount(110)).toBe(1);
    expect(stereoAmount(180)).toBe(1);
  });

  test("matches tan θ for perspective and 2·tan(θ/2) for stereographic", () => {
    expect(radiusFor(0.5, 0)).toBeCloseTo(Math.tan(0.5), 10);
    expect(radiusFor(0.5, 1)).toBeCloseTo(2 * Math.tan(0.25), 10);
  });

  test.each([0, 0.3, 1])("finds the angle back from the radius (stereo amount %f)", (s) => {
    for (const theta of [0.01, 0.4, 1, 1.4]) {
      expect(thetaFor(radiusFor(theta, s), s)).toBeCloseTo(theta, 6);
    }
  });

  test("draws further from the centre the more stereographic it is", () => {
    expect(limitFor(1)).toBeGreaterThan(limitFor(0));
  });
});

describe("eyeScale", () => {
  test("is true size once the view is narrower than the screen is in your vision", () => {
    expect(eyeScale(0.5)).toBe(1);
    expect(eyeScale(20)).toBe(1);
  });

  test("grows as the view widens, so the Sun and Moon look the size they feel", () => {
    expect(eyeScale(40)).toBeGreaterThan(1);
    expect(eyeScale(70)).toBeCloseTo(3.4, 1);
    expect(eyeScale(40)).toBeLessThan(eyeScale(60));
  });

  test("stops growing for whole-sky views", () => {
    expect(eyeScale(120)).toBe(4);
    expect(eyeScale(180)).toBe(4);
  });
});
