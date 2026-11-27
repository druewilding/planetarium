import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { poleNearness, starFacts, starLuminosity, starTemperature } from "../src/stars.js";

describe("the poles of the sky, circling over 26,000 years", () => {
  test("Polaris is just over half a degree from the pole now, and nearest around 2100", () => {
    const p = poleNearness(37.95, 89.26, 2026);
    expect(p.now.pole).toBe("north");
    expect(p.now.deg).toBeGreaterThan(0.55);
    expect(p.now.deg).toBeLessThan(0.7);
    expect(p.nearest.year).toBeGreaterThan(2090);
    expect(p.nearest.year).toBeLessThan(2115);
    expect(p.nearest.deg).toBeLessThan(0.5);
  });

  test("Thuban was the pole star when the pyramids were built, and Vega will be in about 12,000 years", () => {
    const thuban = poleNearness(211.1, 64.38, 2026).nearest;
    expect(thuban.year).toBeGreaterThan(-3000);
    expect(thuban.year).toBeLessThan(-2600);
    expect(thuban.deg).toBeLessThan(0.5);
    const vega = poleNearness(279.23, 38.78, 2026).nearest;
    expect(vega.year).toBeGreaterThan(13000);
    expect(vega.year).toBeLessThan(14500);
    expect(vega.deg).toBeLessThan(6);
  });

  test("a southern star is nearest the south pole", () => {
    expect(poleNearness(186.65, -63.1, 2026).now.pole).toBe("south"); // Acrux
  });
});

describe("a star's temperature, from its colour", () => {
  test("Betelgeuse is red and cool, the Sun's colour about 5,500 °C, Rigel blue-white and hot", () => {
    expect(starTemperature(1.85)).toMatchObject({ colour: "red" });
    expect(starTemperature(1.85).celsius).toBeLessThan(3500);
    expect(starTemperature(0.65).celsius).toBeCloseTo(5500, -2);
    expect(starTemperature(-0.03)).toMatchObject({ colour: "blue-white" });
  });
});

describe("how much light a star really gives out", () => {
  test("the Sun at 10 parsecs is the Sun; Sirius is about 25 Suns", () => {
    expect(starLuminosity(4.83, 32.616)).toBeCloseTo(1, 5);
    expect(starLuminosity(-1.46, 8.6)).toBeGreaterThan(20);
    expect(starLuminosity(-1.46, 8.6)).toBeLessThan(27);
  });
});

describe("the famous stars", () => {
  test("are all named in the catalogue, so their facts show", () => {
    const { names } = JSON.parse(readFileSync(new URL("../data/stars.json", import.meta.url), "utf8"));
    const proper = new Set(Object.values(names).map(([p]) => p));
    for (const name of ["Sirius", "Polaris", "Betelgeuse", "Vega", "Algol", "Mizar", "Albireo", "Gacrux"]) {
      expect(proper.has(name), name).toBe(true);
      expect(starFacts(name)?.fact, name).toBeTruthy();
    }
  });
});
