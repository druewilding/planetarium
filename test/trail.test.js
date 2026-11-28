import { describe, expect, test } from "vitest";

import { createTrail } from "../src/trail.js";

// Choices like the app's, compared by what they are.
const saturn = { type: "planet", id: "Saturn" };
const tethys = { type: "satellite", id: "Tethys" };
const dione = { type: "satellite", id: "Dione" };
const same = (a, b) => a.type === b.type && a.id === b.id;

/** Walk through some choices, from the overview, as the app does. */
function walk(trail, ...choices) {
  let at = null;
  for (const c of choices) {
    trail.move(at, c);
    at = c;
  }
  return at;
}

describe("the back arrow's trail", () => {
  test("Saturn, then Tethys, then Dione: back goes to Tethys, then Saturn, then the overview", () => {
    const trail = createTrail({ same });
    walk(trail, saturn, tethys, dione);
    expect(trail.peek()).toBe(tethys);
    expect(trail.back()).toBe(tethys);
    expect(trail.peek()).toBe(saturn);
    expect(trail.back()).toBe(saturn);
    expect(trail.peek()).toBeNull();
    expect(trail.back()).toBeNull();
  });

  test("going back doesn't add a step (the app doesn't call move for it)", () => {
    const trail = createTrail({ same });
    walk(trail, saturn, tethys, dione);
    trail.back();
    expect(trail.length).toBe(1);
  });

  test("choosing what you're already on isn't a step", () => {
    const trail = createTrail({ same });
    walk(trail, saturn, { ...saturn }, tethys);
    expect(trail.length).toBe(1);
    expect(trail.back()).toEqual(saturn);
  });

  test("the same thing twice, with something between, is two steps", () => {
    const trail = createTrail({ same });
    walk(trail, saturn, tethys, saturn, dione);
    expect([trail.back(), trail.back(), trail.back()]).toEqual([saturn, tethys, saturn]);
  });

  test("the overview starts the trail again", () => {
    const trail = createTrail({ same });
    let at = walk(trail, saturn, tethys);
    trail.move(at, null);
    at = null;
    expect(trail.length).toBe(0);
    trail.move(at, dione);
    expect(trail.back()).toBeNull();
  });

  test("skips what isn't there to go back to any more", () => {
    const mountain = { type: "feature", id: "Herstedhøje" };
    const gone = new Set();
    const trail = createTrail({ same, stillThere: (c) => !gone.has(c.id) });
    walk(trail, saturn, mountain, tethys);
    gone.add("Herstedhøje"); // walked away from it
    expect(trail.peek()).toBe(saturn);
    expect(trail.back()).toBe(saturn);
    expect(trail.length).toBe(0);
  });

  test("only goes back so far", () => {
    const trail = createTrail({ same, limit: 3 });
    const stars = ["Sirius", "Vega", "Deneb", "Altair", "Rigel"].map((id) => ({ type: "star", id }));
    walk(trail, ...stars);
    expect(trail.length).toBe(3);
    expect([trail.back(), trail.back(), trail.back(), trail.back()].map((s) => s?.id ?? null)).toEqual([
      "Altair",
      "Deneb",
      "Vega",
      null,
    ]);
  });
});
