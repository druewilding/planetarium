import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { A, AU_KM, computeSky, insideDisc, JUPITER_MOONS, jupiterMoons, R2D } from "../src/astro.js";
import { readLink, writeLink } from "../src/link.js";

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
