import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { computeSky, R2D } from "../src/astro.js";
import { readLink, writeLink } from "../src/link.js";
import { moonEventsBetween, MOONS_OF, moonsOf, orbitPosition, SATELLITES } from "../src/satellites.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };
const DAY = 86400000;
const byId = (id) => SATELLITES.find((m) => m.id === id);
// Days after 1 January 2000, 12:00 TT, of a date at 00:00 TT.
const days = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1, 12)) / DAY;

// From JPL Horizons (MAR099 and SAT441): km from the planet's centre, J2000 equator, at 00:00 TT.
const HORIZONS = {
  Phobos: [
    [1960, 1, 1, 5782.2, -4748.3, -5778.8],
    [2026, 11, 22, 2125.9, -7671.9, -4978.7],
    [2090, 3, 3, -5013.4, -7904.7, -1328.4],
  ],
  Deimos: [
    [1960, 1, 1, -15844.0, -17284.2, -859.3],
    [2026, 11, 22, -17076.8, -16084.0, 224.2],
    [2090, 3, 3, 21359.6, 3898.2, -8896.8],
  ],
  Enceladus: [
    [1960, 1, 1, 231352.3, -50751.8, -16201.8],
    [2026, 11, 22, -67304.6, -227898.4, 22551.7],
    [2090, 3, 3, 195327.0, 134395.5, -26734.2],
  ],
  Tethys: [
    [1960, 1, 1, -288028.8, 57088.4, 25017.4],
    [2026, 11, 22, -293937.2, -2222.6, 20269.7],
    [2090, 3, 3, -102865.3, 276030.4, -6395.1],
  ],
  Dione: [
    [1960, 1, 1, -359604.4, -104957.3, 38603.4],
    [2026, 11, 22, -280061.3, 252114.0, 5536.8],
    [2090, 3, 3, 336608.5, -169926.1, -16430.1],
  ],
  Rhea: [
    [1960, 1, 1, -193565.2, 490372.7, -21632.3],
    [2026, 11, 22, -410481.9, -325697.9, 59602.6],
    [2090, 3, 3, -136345.9, -507222.9, 46803.6],
  ],
  Titan: [
    [1960, 1, 1, 920703.1, 787545.8, -132428.5],
    [2026, 11, 22, -630446.3, 1073093.3, -16109.7],
    [2090, 3, 3, 84797.3, -1226556.6, 70955.3],
  ],
  Iapetus: [
    [1960, 1, 1, -3333011.4, 1208738.1, 862507.8],
    [2026, 11, 22, -3101467.8, 1657178.1, 924183.3],
    [2090, 3, 3, -252662.9, -3526862.3, -668650.1],
  ],
};

describe("the moons of Mars and Saturn", () => {
  test.each(Object.keys(HORIZONS))("put %s where JPL does, within what the info box says", (id) => {
    const m = byId(id);
    for (const [y, mo, d, x, yy, z] of HORIZONS[id]) {
      const off = orbitPosition(m.orbit, days(y, mo, d)).distanceTo(new THREE.Vector3(x, yy, z));
      expect(off).toBeLessThanOrEqual(m.fitKm);
    }
  });

  test("go round in the right time", () => {
    // Phobos: 7 h 39 min; Titan: 15.95 days; Iapetus: 79.3 days.
    expect(byId("Phobos").periodDays * 24).toBeCloseTo(7.65, 2);
    expect(byId("Titan").periodDays).toBeCloseTo(15.945, 2);
    expect(byId("Iapetus").periodDays).toBeCloseTo(79.33, 1);
  });

  test("are listed with their planets, Mars' first", () => {
    expect(Object.keys(MOONS_OF)).toEqual(["Mars", "Jupiter", "Saturn"]);
    expect(MOONS_OF.Saturn.map((m) => m.id)).toEqual(["Enceladus", "Tethys", "Dione", "Rhea", "Titan", "Iapetus"]);
    expect(SATELLITES.map((m) => m.id)).toEqual(Object.values(MOONS_OF).flatMap((ms) => ms.map((m) => m.id)));
  });

  test("are about as bright as a telescope shows them", () => {
    const sky = computeSky(Date.parse("2027-02-19T00:00Z"), oslo);
    const mag = (parent, id) => moonsOf(sky, parent).find((m) => m.id === id).mag;
    // At Mars' opposition of 2027 (a far one) and with Saturn a month from the Sun.
    expect(mag("Mars", "Phobos")).toBeGreaterThan(11.5);
    expect(mag("Mars", "Phobos")).toBeLessThan(12.5);
    expect(mag("Mars", "Deimos")).toBeGreaterThan(12.5);
    expect(mag("Mars", "Deimos")).toBeLessThan(13.5);
    expect(mag("Saturn", "Titan")).toBeGreaterThan(8);
    expect(mag("Saturn", "Titan")).toBeLessThan(9);
    expect(mag("Saturn", "Rhea")).toBeLessThan(mag("Saturn", "Enceladus"));
  });

  test("stay near their planets on the sky", () => {
    const sky = computeSky(Date.parse("2026-11-27T20:00Z"), oslo);
    for (const parent of ["Mars", "Saturn"]) {
      const planet = sky.planets.find((p) => p.id === parent);
      for (const m of moonsOf(sky, parent)) {
        const reach = (m.def.reachKm / 149597870.7 / planet.dist) * R2D;
        expect(m.trueDir.angleTo(planet.trueDir) * R2D).toBeLessThan(reach);
      }
    }
  });
});

describe("Iapetus", () => {
  test("is much brighter west of Saturn than east of it", () => {
    const iapetus = (ms) => {
      const sky = computeSky(ms, oslo);
      const saturn = sky.planets.find((p) => p.id === "Saturn");
      const m = moonsOf(sky, "Saturn").find((x) => x.id === "Iapetus");
      const ra = (saturn.ra * 15) / R2D;
      const eqj = m.offsetAU.clone().applyMatrix4(sky.eqjToWorld.clone().transpose());
      return { east: -eqj.x * Math.sin(ra) + eqj.y * Math.cos(ra), mag: m.mag };
    };
    // Furthest east and west in November 2026 to January 2027.
    const east = iapetus(Date.parse("2026-11-11T00:00Z"));
    const west = iapetus(Date.parse("2026-12-21T00:00Z"));
    expect(east.east).toBeGreaterThan(0);
    expect(west.east).toBeLessThan(0);
    expect(east.mag - west.mag).toBeGreaterThan(1.2);
  });
});

describe("their crossings, shadows and eclipses", () => {
  test("Titan's shadow crosses Saturn in the years round its equinox, and not in between", () => {
    const from = Date.parse("2025-01-01T00:00Z");
    expect(moonEventsBetween("Titan", from, from + 120 * DAY).shadow.length).toBeGreaterThan(3);
    const later = Date.parse("2030-01-01T00:00Z");
    const none = moonEventsBetween("Titan", later, later + 120 * DAY);
    expect(none.shadow.length + none.transit.length + none.eclipse.length).toBe(0);
  });

  test("Phobos crosses Mars several times a day, a short while each time", () => {
    const from = Date.parse("2027-02-10T00:00Z");
    const all = moonEventsBetween("Phobos", from, from + 2 * DAY);
    expect(all.transit.length).toBeGreaterThanOrEqual(5);
    for (const e of all.transit) expect(e.end - e.start).toBeLessThan(60 * 60000);
  });
});

describe("links to a moon of Saturn", () => {
  test("keep it chosen", () => {
    const link = readLink(`#${writeLink({ place: oslo, selection: { type: "satellite", id: "Titan" } })}`);
    expect(link.selection).toEqual({ type: "satellite", id: "Titan" });
  });
});
