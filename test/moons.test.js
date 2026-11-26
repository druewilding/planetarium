import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { A, AU_KM, computeSky, R2D } from "../src/astro.js";
import { readLink, writeLink } from "../src/link.js";
import { insideDisc, JUPITER_MOONS, jupiterMoons, searchMoonEvents, sunlightPast } from "../src/satellites.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };
const START = Date.parse("2026-11-27T00:00Z");
const HOUR = 3600000;

const jupiterOf = (sky) => sky.planets.find((p) => p.id === "Jupiter");
const moon = (sky, id) => jupiterMoons(sky).find((m) => m.id === id);

// How far each one gets from Jupiter, in km: a little over its average, as the others pull its orbit oval.
const FURTHEST_KM = { Io: 424500, Europa: 678500, Ganymede: 1073500, Callisto: 1899000 };

describe("Jupiter's moons", () => {
  test("are seen as they were when their light left them, like Jupiter", () => {
    const sky = computeSky(START, oslo);
    const jupiter = jupiterOf(sky);
    const lightDays = (jupiter.dist * AU_KM) / 299792.458 / 86400;
    const then = A.JupiterMoons(sky.time.AddDays(-lightDays)).io;
    const now = A.JupiterMoons(sky.time).io;
    const io = moon(sky, "Io").offsetAU.clone().applyMatrix4(sky.eqjToWorld.clone().transpose());
    expect(io.distanceTo(new THREE.Vector3(then.x, then.y, then.z)) * AU_KM).toBeLessThan(1);
    // Io moves about 17 km/s: in Jupiter's 42 light-minutes, over 40,000 km.
    expect(io.distanceTo(new THREE.Vector3(now.x, now.y, now.z)) * AU_KM).toBeGreaterThan(30000);
  });

  test("never stray further from Jupiter than their orbits allow, on the sky or in space", () => {
    for (let h = 0; h < 24 * 20; h += 5) {
      const sky = computeSky(START + h * HOUR, oslo);
      const jupiter = jupiterOf(sky);
      for (const m of jupiterMoons(sky)) {
        const km = m.offsetAU.length() * AU_KM;
        expect(km).toBeLessThan(FURTHEST_KM[m.id]);
        expect(km).toBeGreaterThan(FURTHEST_KM[m.id] * 0.97);
        expect(m.trueDir.angleTo(jupiter.trueDir)).toBeLessThan(km / AU_KM / jupiter.dist);
      }
    }
  });

  test("come back to the same place round Jupiter once each orbit", () => {
    const sky = computeSky(START, oslo);
    for (const def of JUPITER_MOONS) {
      const later = computeSky(START + def.periodDays * 24 * HOUR, oslo);
      const halfway = computeSky(START + (def.periodDays / 2) * 24 * HOUR, oslo);
      const at = (s) => moon(s, def.id).offsetAU.clone().applyMatrix4(s.eqjToWorld.clone().transpose());
      expect(at(later).angleTo(at(sky)) * R2D).toBeLessThan(3);
      expect(at(halfway).angleTo(at(sky)) * R2D).toBeGreaterThan(170);
    }
  });

  test("are magnitude 4.5 to 6.5, and about a second of arc across", () => {
    const sky = computeSky(START, oslo);
    for (const m of jupiterMoons(sky)) {
      expect(m.mag).toBeGreaterThan(4.5);
      expect(m.mag).toBeLessThan(6.5);
      expect(m.angularRadius * 2 * R2D * 3600).toBeGreaterThan(0.7);
      expect(m.angularRadius * 2 * R2D * 3600).toBeLessThan(1.8);
    }
  });

  test("are hidden behind Jupiter only while they're beyond it and inside its disc", () => {
    let hidden = 0;
    for (let h = 0; h < 24 * 4; h += 0.25) {
      const sky = computeSky(START + h * HOUR, oslo);
      const jupiter = jupiterOf(sky);
      for (const m of jupiterMoons(sky)) {
        const sep = m.trueDir.angleTo(jupiter.trueDir);
        if (m.behind) {
          hidden++;
          expect(m.dist).toBeGreaterThan(jupiter.dist);
          expect(sep).toBeLessThan(jupiter.angularRadius);
        } else if (m.dist > jupiter.dist) {
          // (Squashed at the poles, the disc is a little narrower than its equator.)
          expect(sep).toBeGreaterThan(jupiter.angularRadius * 0.93);
        }
      }
    }
    // Io goes behind Jupiter once every orbit, for a couple of hours.
    expect(hidden).toBeGreaterThan(8);
  });

  test("are worked out once for each sky", () => {
    const sky = computeSky(START, oslo);
    expect(jupiterMoons(sky)).toBe(jupiterMoons(sky));
  });
});

describe("insideDisc", () => {
  const look = new THREE.Vector3(0, 0, -1);
  const pole = new THREE.Vector3(0, 1, 0);
  test("is a circle for a round planet", () => {
    expect(insideDisc(new THREE.Vector3(0.99, 0, 5), look, pole, 1)).toBe(true);
    expect(insideDisc(new THREE.Vector3(0.71, 0.71, 5), look, pole, 1)).toBe(false);
  });
  test("is squashed along the pole when the planet is", () => {
    expect(insideDisc(new THREE.Vector3(0.97, 0, 5), look, pole, 1, 0.065)).toBe(true);
    expect(insideDisc(new THREE.Vector3(0, 0.97, 5), look, pole, 1, 0.065)).toBe(false);
  });
  test("is round again seen from over a pole", () => {
    expect(insideDisc(new THREE.Vector3(0, 0.97, 5), pole, look, 1, 0.065)).toBe(false);
    expect(insideDisc(new THREE.Vector3(0.97, 5, 0), pole, look, 1, 0.065)).toBe(true);
  });
});

describe("links to a moon of Jupiter", () => {
  test("keep it chosen", () => {
    const link = readLink(`#${writeLink({ place: oslo, selection: { type: "satellite", id: "Io" } })}`);
    expect(link.selection).toEqual({ type: "satellite", id: "Io" });
  });
});

const MINUTE = 60000;
const near = (ms, iso, minutes = 2) => expect(Math.abs(ms - Date.parse(iso))).toBeLessThan(minutes * MINUTE);

describe("Jupiter's moons and its shadow", () => {
  test("find Io's shadow on Jupiter when the almanacs do", () => {
    // Published times (University of Granada and ASSA tables).
    near(searchMoonEvents("Io", Date.parse("2025-12-20T12:00Z")).shadow.start, "2025-12-21T03:35Z");
    near(searchMoonEvents("Io", Date.parse("2025-03-01T12:00Z")).shadow.start, "2025-03-02T08:35Z");
  });

  test("show Io and its shadow on Jupiter together, as they were on 21 December 2025", () => {
    const sky = computeSky(Date.parse("2025-12-21T04:40Z"), oslo);
    const io = moon(sky, "Io");
    expect(io.inFront).toBe(true);
    expect(io.shadowOnPlanet).toBe(true);
    expect(moon(sky, "Europa").shadowOnPlanet).toBe(false);
  });

  test("fade Io out over a few minutes as it goes into Jupiter's shadow", () => {
    const io = (iso) => moon(computeSky(Date.parse(iso), oslo), "Io");
    expect(io("2025-12-22T00:50Z").light).toBe(1);
    const fading = io("2025-12-22T00:55Z");
    expect(fading.light).toBeGreaterThan(0.2);
    expect(fading.light).toBeLessThan(0.9);
    expect(io("2025-12-22T01:00Z").light).toBeLessThan(0.001);
    expect(io("2025-12-22T01:00Z").mag).toBeGreaterThan(12);
  });

  test("say when something is happening now, and when it began", () => {
    const events = searchMoonEvents("Io", Date.parse("2025-12-21T04:40Z"));
    near(events.shadow.start, "2025-12-21T03:35Z");
    expect(events.transit.start).toBeLessThan(Date.parse("2025-12-21T04:40Z"));
    expect(events.transit.end).toBeGreaterThan(Date.parse("2025-12-21T04:40Z"));
  });

  test("work from anywhere: from Mars, the same shadow, by Mars' own light time", () => {
    const helio = (body, time) => {
      const v = A.HelioVector(body, time);
      return new THREE.Vector3(v.x, v.y, v.z);
    };
    // (Light time is applied to Jupiter, as GeoVector does from the Earth.)
    const fromMars = (time) => {
      const mars = helio(A.Body.Mars, time);
      let planet = helio(A.Body.Jupiter, time).sub(mars);
      planet = helio(A.Body.Jupiter, time.AddDays(-(planet.length() * AU_KM) / 299792.458 / 86400)).sub(mars);
      return { planet, sun: mars.negate() };
    };
    const from = Date.parse("2025-12-20T12:00Z");
    const earth = searchMoonEvents("Io", from).shadow.start;
    const mars = searchMoonEvents("Io", from, { seenFrom: fromMars }).shadow.start;
    const time = A.MakeTime(new Date(earth));
    const lightMs = (v) => ((v.length() * AU_KM) / 299792.458) * 1000;
    const jupiter = helio(A.Body.Jupiter, time);
    const difference =
      lightMs(jupiter.clone().sub(helio(A.Body.Mars, time))) - lightMs(jupiter.clone().sub(helio(A.Body.Earth, time)));
    expect(Math.abs(mars - earth - difference)).toBeLessThan(2 * MINUTE);
  });
});

describe("sunlightPast", () => {
  const sun = new THREE.Vector3(0, 0, 5);
  test("is full sunlight with nothing in the way", () => {
    expect(sunlightPast(new THREE.Vector3(), sun, new THREE.Vector3(1, 0, 1), 0.001)).toBe(1);
  });
  test("is dark behind a body that looks bigger than the Sun", () => {
    expect(sunlightPast(new THREE.Vector3(), sun, new THREE.Vector3(0, 0, 0.01), 0.001)).toBe(0);
  });
  test("is a thin ring of sunlight behind one that looks smaller", () => {
    const light = sunlightPast(new THREE.Vector3(), sun, new THREE.Vector3(0, 0, 1), 0.0001);
    expect(light).toBeGreaterThan(0.5);
    expect(light).toBeLessThan(1);
  });
});
