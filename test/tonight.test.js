import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { A, Body } from "../src/astro.js";
import { buildDeepSky } from "../src/deepsky.js";
import { altAzOf, moonlight, nightWindow, planTonight } from "../src/tonight.js";

const objects = buildDeepSky(
  JSON.parse(readFileSync(new URL("../data/deepsky.json", import.meta.url), "utf8")),
  () => null
);
const place = (lat, lon) => ({ loc: { lat, lon }, obs: new A.Observer(lat, lon, 0) });
const MINUTE = 60000;

describe("the night", () => {
  test("in Copenhagen in late November it's dark enough from about 16:15 UTC, and properly dark by 17:00", () => {
    const { obs } = place(55.68, 12.57);
    const night = nightWindow(Date.parse("2026-11-28T12:00Z"), obs);
    expect(Math.abs(night.start - Date.parse("2026-11-28T16:17Z"))).toBeLessThan(5 * MINUTE);
    expect(Math.abs(night.end - Date.parse("2026-11-29T05:40Z"))).toBeLessThan(5 * MINUTE);
    const dark = nightWindow(Date.parse("2026-11-28T12:00Z"), obs, -18);
    expect(Math.abs(dark.start - Date.parse("2026-11-28T17:02Z"))).toBeLessThan(5 * MINUTE);
  });

  test("already dark: the night that's going on now", () => {
    const { obs } = place(55.68, 12.57);
    const night = nightWindow(Date.parse("2026-11-29T01:00Z"), obs);
    expect(night.start).toBeLessThan(Date.parse("2026-11-29T01:00Z"));
    expect(Math.abs(night.start - Date.parse("2026-11-28T16:17Z"))).toBeLessThan(5 * MINUTE);
  });

  test("the midnight Sun, and a light midsummer night", () => {
    expect(planTonight({ ms: Date.parse("2026-06-21T12:00Z"), ...place(69.65, 18.96) }).sunUp).toBe(true);
    const oslo = planTonight({ ms: Date.parse("2026-06-21T12:00Z"), ...place(59.91, 10.75) });
    expect(oslo.twilightOnly).toBe(true);
    expect(oslo.dark).toBeNull();
  });

  test("in the polar night, the night lasts most of the day, or all of it", () => {
    // Longyearbyen: at noon the Sun is only just above 12° below the horizon.
    const svalbard = planTonight({ ms: Date.parse("2026-12-21T12:00Z"), ...place(78.22, 15.65) });
    expect(svalbard.end - svalbard.start).toBeGreaterThan(20 * 60 * MINUTE);
    const nearPole = planTonight({ ms: Date.parse("2026-12-21T12:00Z"), ...place(85, 0) });
    expect(nearPole.polar).toBe(true);
    expect(nearPole.dark).not.toBeNull();
  });
});

describe("what's up tonight", () => {
  test("from a dark site on a moonless December night: the Andromeda Galaxy by eye, and the bright planets", () => {
    const plan = planTonight({ ms: Date.parse("2026-12-10T12:00Z"), ...place(61.64, 8.31), objects });
    const andromeda = plan.deepSky.find((d) => d.id === "M31");
    expect(andromeda?.how).toBe("eye");
    expect(andromeda.best.alt).toBeGreaterThan(40);
    expect(plan.moon.lit).toBeLessThan(0.1);
    expect(plan.moon.bright).toBe(false);
    expect(plan.planets.map((p) => p.id)).toContain("Jupiter");
    // Brightest first.
    const mags = plan.planets.map((p) => p.mag);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
    // Not the loose clusters of bright stars: you'd see those anyway.
    expect(plan.deepSky.find((d) => d.id === "Mel25")).toBeUndefined();
  });

  test("the southern sky has its own: the Magellanic Clouds, 47 Tucanae", () => {
    const plan = planTonight({ ms: Date.parse("2026-12-10T08:00Z"), ...place(-31.27, 149.06), objects });
    const ids = plan.deepSky.map((d) => d.id);
    expect(ids).toContain("LMC");
    expect(ids.some((id) => ["NGC104", "NGC3372", "IC2602"].includes(id))).toBe(true);
  });
});

describe("the sums underneath", () => {
  test("altitudes from RA and Dec agree with astronomy-engine", () => {
    const { loc, obs } = place(55.68, 12.57);
    const ms = Date.parse("2026-11-28T21:00Z");
    A.DefineStar(Body.Star1, 10.68 / 15, 41.27, 1000);
    const eq = A.Equator(Body.Star1, new Date(ms), obs, true, true);
    const hor = A.Horizon(new Date(ms), obs, eq.ra, eq.dec);
    const ours = altAzOf(10.68, 41.27, ms, loc);
    expect(Math.abs(ours.alt - hor.altitude)).toBeLessThan(0.5);
    expect(Math.abs(ours.az - hor.azimuth)).toBeLessThan(0.7);
  });

  test("a full Moon brightens the sky to about 18–19 mag/arcsec², a crescent far less, a set Moon not at all", () => {
    const mag = (L) => -2.5 * Math.log10(L / 108000);
    const full = moonlight(60, 50, 60, 0);
    expect(mag(full)).toBeGreaterThan(17.5);
    expect(mag(full)).toBeLessThan(19.5);
    expect(moonlight(60, 50, 60, 120)).toBeLessThan(full / 10);
    expect(moonlight(60, -5, 60, 0)).toBe(0);
  });
});
