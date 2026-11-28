import { describe, expect, test } from "vitest";

import { DEFAULT_FOV, MIN_FOV, orbitFov, overviewZoom } from "../src/ui/view.js";

describe("zooming back out at the overview", () => {
  test("on the ground: back out to the usual 80°, from a planet, a star or a galaxy", () => {
    expect(DEFAULT_FOV).toBe(80);
    for (const fov of [MIN_FOV, 0.1, 3, 8, 50, 79.9]) expect(overviewZoom(fov, false), `${fov}°`).toBe(80);
  });

  test("on the ground, already zoomed out that far or wider (Look up's whole sky): it stays as it is", () => {
    for (const fov of [80, 100, 150]) expect(overviewZoom(fov, false), `${fov}°`).toBeNull();
  });

  test("in orbit: back out as far as Reset zoom goes there", () => {
    for (const fov of [MIN_FOV, 0.1, 3, 49.9]) expect(overviewZoom(fov, true), `${fov}°`).toBe(50);
    // (In orbit, anything from 50° to 100° is already zoomed out.)
    for (const fov of [50, 70, 100, 140]) expect(overviewZoom(fov, true), `${fov}°`).toBeNull();
  });

  test("Reset zoom in orbit keeps 50° to 100°, and brings a wider view back in to 100°", () => {
    expect(orbitFov(0.1)).toBe(50);
    expect(orbitFov(70)).toBe(70);
    expect(orbitFov(140)).toBe(100);
  });
});
