import { describe, expect, test } from "vitest";

import { DEFAULT_BODY, readLink, writeLink } from "../src/link.js";

const oslo = { lat: 59.9139, lon: 10.7522, tz: "Europe/Oslo" };

describe("writeLink", () => {
  test("holds the place, moment, view and selection", () => {
    const hash = writeLink({
      place: oslo,
      time: Date.parse("2026-12-04T19:22:12.400Z"),
      view: { az: 182.34, alt: 21.16, fov: 80 },
      selection: { type: "star", id: "Sirius" },
    });
    expect(hash).toBe(
      "body=earth&lat=59.91&lon=10.75&tz=Europe/Oslo&t=2026-12-04T19:22:12Z&az=182.3&alt=21.2&fov=80.0&sel=star:Sirius"
    );
  });

  test("leaves the time out when there isn't one (the clock is on now)", () => {
    expect(writeLink({ place: oslo, time: null })).not.toMatch(/(^|&)t=/);
  });

  test("keeps more decimals for a narrow field of view", () => {
    expect(writeLink({ view: { az: 0, alt: 0, fov: 1.234 } })).toContain("fov=1.23");
  });

  test("writes a selection with no id on its own", () => {
    expect(writeLink({ selection: { type: "moon" } })).toBe("body=earth&sel=moon");
  });

  test("names the body you're standing on", () => {
    expect(writeLink({})).toBe(`body=${DEFAULT_BODY}`);
    expect(writeLink({ body: "moon" })).toBe("body=moon");
  });
});

describe("risen up above the Earth", () => {
  const up = { km: 60000, from: Date.parse("2027-12-02T15:40:00Z") };

  test("says how high, when you took off, and how the view is turned", () => {
    const hash = writeLink({ place: oslo, view: { az: 258.3, alt: -40, fov: 80, roll: 12.34 }, up });
    expect(hash).toBe(
      "body=earth&lat=59.91&lon=10.75&tz=Europe/Oslo&az=258.3&alt=-40.0&fov=80.0&roll=12.3&up=60000&from=2027-12-02T15:40:00Z"
    );
    expect(readLink(`#${hash}`)).toMatchObject({ up, view: { az: 258.3, alt: -40, fov: 80, roll: 12.3 } });
  });

  test("leaves the roll out on the ground, or when the view is upright", () => {
    expect(writeLink({ view: { az: 0, alt: 0, fov: 80, roll: 30 } })).not.toContain("roll");
    expect(writeLink({ view: { az: 0, alt: 0, fov: 80, roll: 0.01 }, up })).not.toContain("roll");
  });

  test("ignores a height without a take-off time, or a height that isn't up", () => {
    expect(readLink("#body=earth&up=60000").up).toBeUndefined();
    expect(readLink("#body=earth&up=-5&from=2027-12-02T15:40:00Z").up).toBeUndefined();
  });
});

describe("readLink", () => {
  test("reads back what writeLink wrote", () => {
    const time = Date.parse("2026-12-04T19:22:12Z");
    const link = readLink(
      `#${writeLink({ place: oslo, time, view: { az: 90, alt: 10, fov: 60 }, selection: { type: "planet", id: "Mars" } })}`
    );
    expect(link).toEqual({
      body: "earth",
      place: { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" },
      time,
      view: { az: 90, alt: 10, fov: 60 },
      selection: { type: "planet", id: "Mars" },
    });
  });

  test("accepts a link with only some parts", () => {
    expect(readLink("#sel=con:Ori")).toEqual({ body: null, selection: { type: "con", id: "Ori" } });
    expect(readLink("#fov=20")).toEqual({ body: null, view: { fov: 20 } });
  });

  test("returns null for a fragment that isn't a link", () => {
    expect(readLink("")).toBeNull();
    expect(readLink("#top")).toBeNull();
  });

  test("ignores a place off the globe, a bad time and junk numbers", () => {
    const link = readLink("#body=earth&lat=95&lon=10&t=yesterday&az=abc");
    expect(link).toEqual({ body: "earth" });
  });

  test("keeps the view's altitude between straight down and straight up", () => {
    expect(readLink("#alt=120").view.alt).toBe(90);
    expect(readLink("#alt=-120").view.alt).toBe(-90);
  });

  test("lower-cases the body", () => {
    expect(readLink("#body=Moon").body).toBe("moon");
  });
});
