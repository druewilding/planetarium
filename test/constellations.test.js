import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { constellationFacts, fromLatitude, highestAtMidnight, sunInConstellation } from "../src/constellations.js";

const ids = [
  ...new Set(
    JSON.parse(readFileSync(new URL("../data/constellations.json", import.meta.url), "utf8")).map((c) => c.id)
  ),
];
const day = (ms) => new Date(ms).toISOString().slice(5, 10);

describe("every constellation", () => {
  test("has its size, its story and who drew it", () => {
    expect(ids).toHaveLength(88);
    for (const id of ids) {
      const f = constellationFacts(id);
      expect(f.area, id).toBeGreaterThan(60);
      expect(f.story, id).toBeTruthy();
      expect(f.origin, id).toBeTruthy();
    }
  });

  test("is ranked by size, Hydra the biggest and Crux the smallest", () => {
    const ranks = ids.map((id) => constellationFacts(id).rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 88 }, (_, i) => i + 1));
    expect(constellationFacts("Hya").rank).toBe(1);
    expect(constellationFacts("Cru").rank).toBe(88);
  });

  test("covers the whole sky between them", () => {
    const total = ids.reduce((sum, id) => sum + constellationFacts(id).area, 0);
    expect(total).toBeCloseTo(41253, -1);
  });

  test("comes from Ptolemy's 48, the Dutch navigators' 12, Hevelius's 7 or Lacaille's 14, and a few more", () => {
    const count = (word) => ids.filter((id) => constellationFacts(id).origin.includes(word)).length;
    expect(count("Ptolemy’s Almagest")).toBe(47);
    expect(count("Argo Navis")).toBe(3);
    expect(count("Keyser")).toBe(12);
    expect(count("Hevelius")).toBe(7);
    expect(count("Lacaille in the 1750s")).toBe(14);
  });
});

describe("the Sun's real path", () => {
  test("crosses Scorpius in a week, then Ophiuchus for nearly three", () => {
    const [sco] = sunInConstellation("Sco", 2026);
    const [oph] = sunInConstellation("Oph", 2026);
    expect([day(sco.start), day(sco.end)]).toEqual(["11-24", "11-29"]);
    expect([day(oph.start), day(oph.end)]).toEqual(["11-30", "12-18"]);
  });

  test("never crosses Orion, and goes through Sagittarius across the new year", () => {
    expect(sunInConstellation("Ori", 2026)).toEqual([]);
    const [sgr, ...more] = sunInConstellation("Sgr", 2026);
    expect(more).toEqual([]);
    expect(new Date(sgr.start).toISOString().slice(0, 10)).toBe("2026-12-19");
    expect(new Date(sgr.end).toISOString().slice(0, 10)).toMatch(/^2027-01-1/);
  });

  test("leaves Capricornus, just after the new year, as it is", () => {
    const [cap, ...more] = sunInConstellation("Cap", 2026);
    expect(more).toEqual([]);
    expect(day(cap.start)).toMatch(/^01-/);
    expect(day(cap.end)).toMatch(/^02-/);
  });
});

describe("the best time to see one", () => {
  test("Orion is highest at midnight in mid-December, Scorpius in early June", () => {
    expect(day(highestAtMidnight("Ori", 2026))).toMatch(/^12-1/);
    expect(day(highestAtMidnight("Sco", 2026))).toMatch(/^06-0/);
  });
});

describe("how much of one you can see from where you are", () => {
  test("from Copenhagen, the Southern Cross never rises, and the Little Bear never sets", () => {
    expect(fromLatitude([-57, -60, -63], 55.7)).toEqual({ all: "rises", seeFrom: "33°N", toward: "south" });
    expect(fromLatitude([74, 78, 89], 55.7)).toEqual({ all: "sets" });
  });

  test("from Cape Town it's the other way round", () => {
    expect(fromLatitude([-57, -60, -63], -33.9)).toEqual({ all: "sets" });
    expect(fromLatitude([74, 78, 89], -33.9).all).toBe("rises");
  });

  test("says how far you'd have to go to see all of one only partly up", () => {
    expect(fromLatitude([-10, -50, 10], 55.7)).toEqual({
      someNeverSet: false,
      someNeverRise: true,
      seeAllFrom: "40°N",
      toward: "south",
    });
  });
});
