import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { computeSky, planetPole, R2D } from "../src/astro.js";
import { readLink, writeLink } from "../src/link.js";
import {
  glare,
  moonEventsBetween,
  MOONS_OF,
  moonsOf,
  orbitPath,
  orbitPosition,
  SATELLITES,
  stateAt,
} from "../src/satellites.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };
const DAY = 86400000;
const byId = (id) => SATELLITES.find((m) => m.id === id);
// Days after 1 January 2000, 12:00 TT, of a date at 00:00 TT.
const days = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1, 12)) / DAY;

// From JPL Horizons (MAR099, JUP365, SAT441, URA184, NEP098 and PLU060): km from the planet's centre, J2000 equator, at 00:00 TT.
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
  Miranda: [
    [1960, 1, 1, 72586.9, -51827.3, 94172.7],
    [2026, 11, 22, 80140.9, -49265.9, 89394.2],
    [2090, 3, 3, 128542.4, -17097.3, -6211.6],
  ],
  Ariel: [
    [1960, 1, 1, 143586.5, 2327.5, -125269.9],
    [2026, 11, 22, 142994.4, -62704.1, 109888.0],
    [2090, 3, 3, 172135.3, -55868.6, 61260.0],
  ],
  Umbriel: [
    [1960, 1, 1, -166754.7, -19654.4, 207650.4],
    [2026, 11, 22, 165525.6, 20984.7, -208529.9],
    [2090, 3, 3, 186985.3, 9699.6, -187498.2],
  ],
  Titania: [
    [1960, 1, 1, 413841.4, -59266.6, -122320.0],
    [2026, 11, 22, -374325.6, 134066.4, -179591.6],
    [2090, 3, 3, 179866.8, 67862.2, -392023.0],
  ],
  Oberon: [
    [1960, 1, 1, -20776.9, 159520.1, -560111.0],
    [2026, 11, 22, 562929.6, -141143.9, 55425.7],
    [2090, 3, 3, -335859.8, -55086.9, 475839.1],
  ],
  Triton: [
    [1960, 1, 1, -332842.6, -80780.5, 92307.3],
    [2026, 11, 22, 185750.1, 221100.9, 206020.3],
    [2090, 3, 3, -246004.3, -101911.4, 234401.1],
  ],
  Charon: [
    [1960, 1, 1, 9927.8, 11157.1, 12681.9],
    [2026, 11, 22, 14382.1, 12973.6, -2955.1],
    [2090, 3, 3, -14318.0, -13381.9, -165.9],
  ],
  Amalthea: [
    [1960, 1, 1, -93628.1, 140508.1, 64690.7],
    [2026, 11, 22, 169364.2, -58298.5, -25053.1],
    [2090, 3, 3, 145538.7, -99433.2, -43737.1],
  ],
  Thebe: [
    [1960, 1, 1, -206454.4, 76413.3, 37248.8],
    [2026, 11, 22, 180748.0, -110665.3, -54067.7],
    [2090, 3, 3, -213589.1, 47712.6, 16117.4],
  ],
  Himalia: [
    [1960, 1, 5, 8755478.7, 1610996.4, -4261052.8],
    [2026, 11, 26, -11021430.2, -4189938.5, -21007.4],
    [2090, 3, 7, 2830841.3, -8985786.1, -7250902.0],
  ],
  Elara: [
    [1960, 1, 5, -5127285.3, 10411306.9, -343745.4],
    [2026, 11, 26, -11056513.6, 2178966.8, 8033064.4],
    [2090, 3, 7, -13448430.2, -1681759.3, -2304307.3],
  ],
};

describe("the moons of Mars, Saturn, Uranus, Neptune and Pluto", () => {
  test.each(Object.keys(HORIZONS))("put %s where JPL does, within what the info box says", (id) => {
    const m = byId(id);
    for (const [y, mo, d, x, yy, z] of HORIZONS[id]) {
      const at = m.orbit ? orbitPosition(m.orbit, days(y, mo, d)) : stateAt(m, days(y, mo, d)).r;
      const off = at.distanceTo(new THREE.Vector3(x, yy, z));
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
    expect(Object.keys(MOONS_OF)).toEqual(["Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);
    expect(MOONS_OF.Uranus.map((m) => m.id)).toEqual(["Miranda", "Ariel", "Umbriel", "Titania", "Oberon"]);
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

  test("further out, are as faint as big telescopes find them", () => {
    const sky = computeSky(Date.parse("2026-11-27T20:00Z"), oslo);
    const mag = (parent, id) => moonsOf(sky, parent).find((m) => m.id === id).mag;
    expect(mag("Uranus", "Titania")).toBeGreaterThan(13.5);
    expect(mag("Uranus", "Titania")).toBeLessThan(14.2);
    expect(mag("Uranus", "Miranda")).toBeGreaterThan(15.5);
    expect(mag("Neptune", "Triton")).toBeGreaterThan(13.2);
    expect(mag("Neptune", "Triton")).toBeLessThan(13.9);
    expect(mag("Pluto", "Charon")).toBeGreaterThan(16.5);
    expect(mag("Pluto", "Charon")).toBeLessThan(17.3);
  });

  test("Triton goes round backwards, against Neptune's spin", () => {
    const sky = computeSky(Date.parse("2026-11-27T20:00Z"), oslo);
    const triton = moonsOf(sky, "Neptune")[0];
    const pole = planetPole("Neptune", sky);
    // Its orbit's own spin (position × velocity) points away from Neptune's north pole.
    const later = computeSky(Date.parse("2026-11-27T22:00Z"), oslo);
    const moved = moonsOf(later, "Neptune")[0].offsetAU;
    expect(triton.offsetAU.clone().cross(moved).dot(pole)).toBeLessThan(0);
  });

  test("stay near their planets on the sky", () => {
    const sky = computeSky(Date.parse("2026-11-27T20:00Z"), oslo);
    for (const parent of ["Mars", "Saturn", "Uranus", "Neptune", "Pluto"]) {
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

describe("a planet's glare", () => {
  const seen = (iso, parent, id) => {
    const sky = computeSky(Date.parse(iso), oslo);
    const planet = sky.planets.find((p) => p.id === parent);
    return glare(
      moonsOf(sky, parent).find((m) => m.id === id),
      planet
    );
  };

  test("hides little Amalthea and Thebe beside bright Jupiter", () => {
    expect(seen("2026-11-27T20:00Z", "Jupiter", "Amalthea")).toBeGreaterThan(4);
    expect(seen("2026-11-27T20:00Z", "Jupiter", "Thebe")).toBeGreaterThan(4);
  });

  test("leaves the big moons, Himalia far out, and Charon by faint Pluto alone", () => {
    expect(seen("2026-11-27T20:00Z", "Jupiter", "Callisto")).toBe(0);
    expect(seen("2026-11-27T20:00Z", "Jupiter", "Himalia")).toBe(0);
    expect(seen("2026-08-12T01:00Z", "Pluto", "Charon")).toBe(0);
  });

  test("lets Phobos show at Mars' close opposition of 2035, far out from Mars, and not close in", () => {
    // 31″ from Mars, then 16″ two hours later.
    expect(seen("2035-09-15T20:00Z", "Mars", "Phobos")).toBe(0);
    expect(seen("2035-09-15T22:00Z", "Mars", "Phobos")).toBeGreaterThan(4);
    expect(seen("2035-09-15T22:00Z", "Mars", "Deimos")).toBe(0);
  });
});

describe("a moon's orbit", () => {
  test("is an ellipse through where the moon is, the size of its orbit", () => {
    const sky = computeSky(Date.parse("2026-11-27T20:00Z"), oslo);
    for (const parent of Object.keys(MOONS_OF)) {
      for (const m of moonsOf(sky, parent)) {
        const path = orbitPath(parent, m.offsetAU, m.velocity, 512);
        const km = (v) => v.length() * 149597870.7;
        const nearest = Math.min(...path.map((p) => km(p.clone().sub(m.offsetAU))));
        const furthest = Math.max(...path.map(km));
        // (Points 1/512 of the way round apart: the nearest is within half a step.)
        expect(nearest).toBeLessThan((km(m.offsetAU) * Math.PI) / 512 + 1);
        expect(furthest).toBeLessThan(m.def.reachKm * 1.05);
        expect(furthest).toBeGreaterThan(km(m.offsetAU) * 0.99);
      }
    }
  });
});
