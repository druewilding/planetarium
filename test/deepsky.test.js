import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  airmass,
  BINOCULARS,
  buildDeepSky,
  DARK_SKY,
  deepTimeNote,
  FACT_IDS,
  howToSee,
  seeing,
} from "../src/deepsky.js";

const rows = JSON.parse(readFileSync(new URL("../data/deepsky.json", import.meta.url), "utf8"));
const all = buildDeepSky(rows, () => ({ id: "Xxx", name: "Somewhere" }));
const get = (id) => all.find((o) => o.id === id);
// A sky's luminance (cd/m²) from its brightness in magnitudes per square arcsecond.
const sky = (mag) => 108000 * 10 ** (-0.4 * mag);

describe("the deep-sky catalogue", () => {
  test("has all 110 Messier objects, and the famous southern ones", () => {
    for (let n = 1; n <= 110; n++) expect(get(`M${n}`), `M${n}`).toBeDefined();
    for (const id of ["NGC5139", "NGC104", "LMC", "SMC", "NGC3372", "NGC4755", "NGC869"])
      expect(get(id), id).toBeDefined();
  });

  test("every object is somewhere real, with a size, a kind and a distance", () => {
    const ids = new Set();
    for (const o of all) {
      expect(ids.has(o.id), o.id).toBe(false);
      ids.add(o.id);
      expect(o.ra, o.id).toBeGreaterThanOrEqual(0);
      expect(o.ra, o.id).toBeLessThan(360);
      expect(Math.abs(o.dec), o.id).toBeLessThanOrEqual(90);
      expect(o.major, o.id).toBeGreaterThanOrEqual(o.minor);
      expect(o.minor, o.id).toBeGreaterThan(0);
      expect(o.kind, o.id).toBeTruthy();
      expect(o.ly, o.id).toBeGreaterThan(100);
      // A glow is never brighter than the whole object.
      if (o.glow != null) expect(o.glow, o.id).toBeGreaterThanOrEqual(o.mag);
    }
  });

  test("its facts are all about objects in it", () => {
    for (const id of FACT_IDS) expect(get(id), id).toBeDefined();
  });

  test("names and numbers", () => {
    expect(get("M31").name).toBe("Andromeda Galaxy");
    expect(get("M31").numbers).toEqual(["M31", "NGC 224"]);
    expect(get("M2").name).toBe("M2");
    expect(get("M2").numbers).toEqual(["NGC 7089"]);
    expect(get("NGC6752").name).toBe("NGC 6752");
    expect(get("Cr140").name).toBe("Collinder 140");
  });

  test("the Milky Way's map draws the Magellanic Clouds, and loose clusters of bright stars have no haze", () => {
    for (const id of ["LMC", "SMC", "Mel25", "Mel20"]) expect(get(id).glow, id).toBeNull();
    // The Pleiades' bright stars are drawn as stars: only the rest of their light is a glow.
    expect(get("M45").glow).toBeGreaterThan(get("M45").mag + 1);
  });
});

describe("seeing faint smudges", () => {
  test("the Andromeda Galaxy and the Orion Nebula show by eye from the country, but fade over a city", () => {
    for (const id of ["M31", "M42"]) {
      expect(seeing(get(id), DARK_SKY), id).toBeGreaterThan(5);
      expect(seeing(get(id), sky(17.5)), id).toBeLessThan(1.2);
    }
  });

  test("the Ring Nebula needs a telescope: zoomed right in, it shows", () => {
    const ring = get("M57");
    expect(seeing(ring, DARK_SKY)).toBeLessThan(0.2);
    expect(seeing(ring, DARK_SKY, { gain: 6 })).toBeGreaterThan(5);
  });

  test("zooming in never makes a big one harder to see, and a small one gets easier", () => {
    for (const o of all.filter((x) => x.mag != null)) {
      expect(seeing(o, DARK_SKY, { gain: 4 }), o.id).toBeGreaterThanOrEqual(seeing(o, DARK_SKY) * 0.999);
    }
    // Magnified enough, Andromeda spreads wider than the patch the eye pools light over:
    // from then on its surface is no brighter, however far you zoom in.
    expect(seeing(get("M31"), DARK_SKY, { gain: 6 })).toBeCloseTo(seeing(get("M31"), DARK_SKY, { gain: 4 }), 6);
  });

  test("low down, the air dims them", () => {
    const high = seeing(get("M31"), DARK_SKY, { trans: 10 ** (-0.08 * airmass(60)) });
    const low = seeing(get("M31"), DARK_SKY, { trans: 10 ** (-0.08 * airmass(5)) });
    expect(low).toBeLessThan(high * 0.6);
  });

  test("what you need to see each one, as the guidebooks say", () => {
    for (const id of ["M31", "M42", "M44", "M45", "NGC5139", "NGC104", "NGC869", "M13", "M8"])
      expect(howToSee(get(id)), id).toBe("eye");
    for (const id of ["M27", "M51", "M81", "M82", "M3", "M92", "M104"])
      expect(howToSee(get(id)), id).toBe("binoculars");
    for (const id of ["M57", "M97", "M76", "M91"]) expect(howToSee(get(id)), id).toBe("telescope");
    expect(howToSee(get("GC"))).toBeNull();
    expect(BINOCULARS).toBe(3);
  });
});

describe("how old the light is", () => {
  test("set against the deep past", () => {
    expect(deepTimeNote(2500000)).toBe(
      "The light you’re seeing set off about 2.5 million years ago, after our ancestors made the oldest stone tools ever found."
    );
    expect(deepTimeNote(55000000)).toBe(
      "The light you’re seeing set off about 55 million years ago, after an asteroid wiped out the dinosaurs."
    );
    expect(deepTimeNote(22200)).toContain("about 22,000 years ago, before the last ice age was at its coldest");
  });
});
