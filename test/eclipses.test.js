import * as A from "astronomy-engine";
import { describe, expect, test } from "vitest";

import {
  earthShadow,
  lunarEclipsesFrom,
  moonInShadow,
  nextTotalSolarEclipse,
  shadowLight,
  solarEclipsesFrom,
} from "../src/eclipses.js";

const shadowAt = (iso) => moonInShadow(earthShadow(A.MakeTime(new Date(iso))));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const gibraltar = { lat: 36.14, lon: -5.35 };
const oslo = { lat: 59.91, lon: 10.75 };
const auckland = { lat: -36.85, lon: 174.76 };
const NOW = Date.parse("2026-11-24T12:00Z");

describe("the Earth's shadow on the Moon", () => {
  // Total lunar eclipse of 3 March 2026: greatest at 11:34 UTC, total for about an hour.
  test("covers the whole Moon at the peak of a total eclipse, leaving it very dim", () => {
    const peak = shadowAt("2026-03-03T11:33:40Z");
    expect(peak.umbra).toBe(1);
    expect(peak.light).toBeLessThan(1e-3);
    expect(peak.light).toBeGreaterThan(1e-5);
  });

  test("covers part of the Moon before totality", () => {
    const partial = shadowAt("2026-03-03T10:30Z");
    expect(partial.umbra).toBeGreaterThan(0.2);
    expect(partial.umbra).toBeLessThan(1);
  });

  test("only dims the Moon a little in the penumbra", () => {
    const penumbral = shadowAt("2026-03-03T09:45Z");
    expect(penumbral.umbra).toBe(0);
    expect(penumbral.light).toBeGreaterThan(0.3);
    expect(penumbral.light).toBeLessThan(1);
  });

  test("misses an ordinary full Moon", () => {
    expect(shadowAt("2026-01-03T10:03Z")).toEqual({ light: 1, umbra: 0, penumbra: 0 });
  });

  test("doesn't fall on the Moon during a solar eclipse, when it's on the Sun's side", () => {
    expect(shadowAt("2027-08-02T10:07Z")).toEqual({ light: 1, umbra: 0, penumbra: 0 });
  });

  test("is about 4,700 km across the umbra and 8,300 km across the penumbra, as radii at the Moon", () => {
    const { umbraKm, penumbraKm } = earthShadow(A.MakeTime(new Date("2026-03-03T11:33Z")));
    expect(umbraKm).toBeCloseTo(4680, -2);
    expect(penumbraKm).toBeCloseTo(8270, -2);
  });
});

describe("shadowLight", () => {
  test("is full sunlight outside the penumbra, and none of the Sun inside the umbra", () => {
    expect(shadowLight(9000, 4700, 8300)).toEqual([1, 1, 1]);
    expect(shadowLight(0, 4700, 8300)[0]).toBeLessThan(1e-3);
  });

  test("is half the Sun halfway across the penumbra", () => {
    expect(shadowLight(6500, 4700, 8300)[1]).toBeCloseTo(0.5, 2);
  });

  test("turns red in the umbra, brighter towards its edge", () => {
    const [r, g, b] = shadowLight(4000, 4700, 8300);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(shadowLight(4600, 4700, 8300)[0]).toBeGreaterThan(shadowLight(1000, 4700, 8300)[0]);
  });
});

describe("finding eclipses", () => {
  test("finds the total solar eclipse of 2 August 2027 from Gibraltar, at about 10.47 local time", () => {
    const [next] = solarEclipsesFrom(NOW, gibraltar);
    expect(next.kind).toBe("Total");
    expect(new Date(next.peak).toISOString()).toMatch(/^2027-08-02T08:4[67]/);
    expect(next.totalEnd - next.totalStart).toBeGreaterThan(4 * 60000);
    expect(next.sunAltitude).toBeCloseTo(38, 0);
  });

  test("skips eclipses that barely nibble the Sun", () => {
    // A 2% partial eclipse at sunset on 6 February 2027 comes first, and isn't worth a trip outside.
    for (const e of solarEclipsesFrom(NOW, gibraltar, 3)) expect(e.covered).toBeGreaterThanOrEqual(0.1);
  });

  test("lists eclipses in order", () => {
    const list = solarEclipsesFrom(NOW, gibraltar, 3);
    expect(list.map((e) => day(e.peak))).toEqual(["2027-08-02", "2028-01-26", "2030-06-01"]);
    expect(list[1].kind).toBe("Annular");
  });

  test("stops searching at a given date", () => {
    const until = Date.parse("2027-12-31T23:59Z");
    expect(solarEclipsesFrom(NOW, gibraltar, 10, until).map((e) => day(e.peak))).toEqual(["2027-08-02"]);
    expect(lunarEclipsesFrom(NOW, oslo, 10, until)).toEqual([]);
  });

  test("finds lunar eclipses with the Moon up for some of them", () => {
    expect(day(lunarEclipsesFrom(Date.parse("2026-03-01"), auckland)[0].peak)).toBe("2026-03-03");
    const fromOslo = lunarEclipsesFrom(NOW, oslo, 2);
    expect(fromOslo.map((e) => [day(e.peak), e.kind])).toEqual([
      ["2028-01-12", "Partial"],
      ["2028-12-31", "Total"],
    ]);
    expect(fromOslo[1].totalEnd).toBeGreaterThan(fromOslo[1].totalStart);
  });

  test("leaves out penumbral lunar eclipses", () => {
    for (const e of lunarEclipsesFrom(NOW, oslo, 4)) expect(e.kind).not.toBe("Penumbral");
  });

  test("finds the next total solar eclipse anywhere, on its centre line", () => {
    const total = nextTotalSolarEclipse(NOW);
    expect(day(total.peak)).toBe("2027-08-02");
    // Near Luxor, in Egypt
    expect(total.lat).toBeCloseTo(25.5, 0);
    expect(total.lon).toBeCloseTo(33.2, 0);
  });
});
