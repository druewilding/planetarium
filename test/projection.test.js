import { describe, expect, test } from "vitest";

import { eyeScale, limitFor, radiusFor, stereoAmount, telescopeGain, thetaFor } from "../src/projection.js";

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

describe("telescopeGain", () => {
  test("is nothing for views as wide as the screen or wider", () => {
    expect(telescopeGain(23)).toBe(0);
    expect(telescopeGain(70)).toBe(0);
  });

  test("shows fainter things the further you zoom in, up to a limit", () => {
    expect(telescopeGain(2.3)).toBeCloseTo(2.5);
    expect(telescopeGain(0.4)).toBeGreaterThan(4);
    expect(telescopeGain(0.01)).toBe(9);
  });
});

describe("telescopeGain at the closest zoom", () => {
  test("is about the 29 cm telescope it takes to just see Pluto from a dark site", () => {
    // A dark sky lets the eye see about magnitude 6.5; Pluto is 14.4 to 14.6.
    expect(6.5 + telescopeGain(0.04)).toBeGreaterThan(14.7);
    expect(6.5 + telescopeGain(0.04)).toBeLessThan(15.2);
  });
});
