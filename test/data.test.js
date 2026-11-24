import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isValidZone } from "../src/timezone.js";
import { syncImportMap } from "../tools/sync-importmap.mjs";

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));

describe("stars", () => {
  const { stars, names } = load("stars");

  test("has the naked-eye stars, brightest first", () => {
    expect(stars.length).toBeGreaterThan(5000);
    expect(names[stars[0][0]][0]).toBe("Sirius");
    const mags = stars.map((row) => row[3]);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
  });

  test("has a Hipparcos number, position, brightness, colour and parallax for every star", () => {
    for (const [hip, ra, dec, mag, bv, plx, ePlx] of stars) {
      expect(Number.isInteger(hip)).toBe(true);
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThan(360);
      expect(Math.abs(dec)).toBeLessThanOrEqual(90);
      expect(mag).toBeLessThan(6.6);
      expect(bv === null || typeof bv === "number").toBe(true);
      expect(plx === null || typeof plx === "number").toBe(true);
      expect(ePlx === null || ePlx >= 0).toBe(true);
    }
  });

  test("has parallaxes for nearly all of them", () => {
    expect(stars.filter((row) => row[5] == null).length).toBeLessThan(10);
  });

  test("only names stars it has", () => {
    const hips = new Set(stars.map((row) => String(row[0])));
    for (const hip of Object.keys(names)) expect(hips.has(hip), hip).toBe(true);
  });
});

describe("constellations", () => {
  const constellations = load("constellations");

  test("has all 88, with Serpens in two halves", () => {
    expect(new Set(constellations.map((c) => c.id)).size).toBe(88);
    expect(constellations.filter((c) => c.id === "Ser")).toHaveLength(2);
  });

  test("has a name and figure for each", () => {
    for (const c of constellations) {
      expect(c.name, c.id).toBeTruthy();
      expect(c.lines.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe("cities", () => {
  const cities = load("cities");

  test("has a name, country, position and real time zone for each", () => {
    expect(cities.length).toBeGreaterThan(1000);
    for (const [name, country, lat, lon, tz] of cities) {
      expect(name).toBeTruthy();
      expect(country).toBeTruthy();
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      // Antarctic bases have no time zone of their own: they use solar time.
      if (tz !== "") expect(isValidZone(tz), `${name}: ${tz}`).toBe(true);
    }
    expect(cities.filter(([, , lat, , tz]) => tz === "" && lat > -60).length).toBeLessThan(5);
  });

  test("lists the biggest cities first, so the map shows them when zoomed out", () => {
    expect(cities.slice(0, 2).map(([name]) => name)).toEqual(["Tokyo", "New York City"]);
  });
});

describe("syncImportMap", () => {
  const page = `<script type="importmap">
    { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js" } }
  </script>`;

  test("points the CDN at the version in package.json", () => {
    expect(syncImportMap(page, { three: "0.181.2" })).toContain("/npm/three@0.181.2/build/three.module.js");
  });

  test("leaves libraries that aren't dependencies alone", () => {
    expect(syncImportMap(page, {})).toBe(page);
  });
});
