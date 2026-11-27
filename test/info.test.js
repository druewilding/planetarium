import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { lightLeftNote, phaseName, starDistance } from "../src/ui/info.js";

const { stars } = JSON.parse(readFileSync(new URL("../data/stars.json", import.meta.url), "utf8"));
const star = (hip) => {
  const [, ra, dec, , , plx, ePlx] = stars.find((row) => row[0] === hip);
  return { ra, dec, plx, ePlx };
};
const fromEarth = { standingOn: "earth", ms: Date.parse("2026-01-01T00:00Z") };

// The rows as plain text: "Distance: 81 trillion km | Light travel time: …"
const rows = (html) =>
  [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(([, term, value]) => `${term}: ${value}`).join(" | ");

describe("starDistance", () => {
  test("gives a well-measured star's distance, light travel time and when its light left", () => {
    const sirius = starDistance(fromEarth, star(32349));
    expect(rows(sirius.rows)).toBe(
      "Distance: 81 trillion km | Light travel time: 8.6 years | Light you see left: in 2017"
    );
    expect(sirius.short).toBe("8.6 ly");
  });

  test("says “about” when the distance is a little uncertain", () => {
    const betelgeuse = starDistance(fromEarth, star(27989));
    expect(rows(betelgeuse.rows)).toBe(
      "Distance: about 4,700 trillion km | Light travel time: about 500 years | Light you see left: around 1528"
    );
    expect(betelgeuse.short).toBe("~500 ly");
  });

  test("gives a range when the distance is very uncertain", () => {
    const alnilam = starDistance(fromEarth, star(26311));
    expect(rows(alnilam.rows)).toBe(
      "Distance: between 15,000 and 26,000 trillion km (hard to measure) | Light travel time: between 1,600 and 2,700 years"
    );
    expect(alnilam.short).toBe("");
  });

  test("gives no upper limit when the parallax could be zero", () => {
    const { rows: html } = starDistance(fromEarth, { ra: 0, dec: 0, plx: 1, ePlx: 1.5 });
    expect(rows(html)).toContain("Light travel time: more than 1,300 years");
  });

  test("counts years before year 1 as BCE", () => {
    expect(rows(starDistance(fromEarth, star(42570)).rows)).toContain("Light you see left: around 2843 BCE");
    // There's no year 0: the year before 1 is 1 BCE.
    const leftYearsAgo = (lightYears) =>
      rows(starDistance(fromEarth, { ra: 0, dec: 90, plx: 3261.56 / lightYears, ePlx: 0 }).rows);
    expect(leftYearsAgo(2025)).toContain("Light you see left: in 1");
    expect(leftYearsAgo(2026)).toContain("Light you see left: in 1 BCE");
  });

  test("explains when there's no distance", () => {
    expect(rows(starDistance(fromEarth, { ...star(32349), plx: -1 }).rows)).toBe("Distance: Too far to measure");
    expect(rows(starDistance(fromEarth, { ...star(32349), plx: null }).rows)).toBe("Distance: Not measured");
  });
});

describe("phaseName", () => {
  test.each([
    [0, "New Moon"],
    [45, "Waxing crescent"],
    [90, "First quarter"],
    [180, "Full Moon"],
    [270, "Last quarter"],
    [350, "New Moon"],
    [-90, "Last quarter"],
  ])("%i° is %s", (angle, name) => {
    expect(phaseName(angle)).toBe(name);
  });
});

describe("lightLeftNote", () => {
  test("sets a star's light against the nearest thing in history", () => {
    expect(lightLeftNote(1478, false)).toBe(
      "The light you’re seeing set off 14 years before Columbus sailed to America."
    );
    expect(lightLeftNote(2018, false)).toBe(
      "The light you’re seeing set off 3 years before the James Webb Space Telescope was launched."
    );
    expect(lightLeftNote(1969, false)).toBe(
      "The light you’re seeing set off the year people first walked on the Moon."
    );
  });

  test("says 'about' for a distance that isn't known so well, and copes with long ago", () => {
    expect(lightLeftNote(-20000, true)).toBe(
      "The light you’re seeing set off about 10,300 years before the end of the last ice age."
    );
  });
});
