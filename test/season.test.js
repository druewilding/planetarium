import { describe, expect, test } from "vitest";

import { seasonAt } from "../src/season.js";
import { startOfLocalDay } from "../src/timezone.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };
const sydney = { lat: -33.87, lon: 151.21, tz: "Australia/Sydney" };
const singapore = { lat: 1.35, lon: 103.82, tz: "Asia/Singapore" };
const on = (iso, place) => {
  const ms = Date.parse(iso);
  return seasonAt(ms, place.lat, startOfLocalDay(ms, place));
};

describe("seasonAt", () => {
  test("knows the day of the December solstice is the shortest day in Oslo", () => {
    expect(on("2026-12-21T12:00Z", oslo)).toMatchObject({
      name: "winter",
      label: "Winter solstice",
      eventMeaning: "the shortest day of the year",
    });
  });

  test("knows the same solstice is the longest day in Sydney, where it's already the 22nd", () => {
    expect(on("2026-12-21T12:00Z", sydney).label).toBe("Late spring");
    expect(on("2026-12-22T00:00Z", sydney)).toMatchObject({
      name: "summer",
      label: "Summer solstice",
      eventMeaning: "the longest day of the year",
    });
  });

  test("names the season and how far through it we are", () => {
    expect(on("2026-11-24T12:00Z", oslo)).toMatchObject({ label: "Late autumn", nextEvent: "winter solstice" });
    expect(on("2026-08-07T12:00Z", oslo).label).toBe("Mid summer");
    expect(on("2026-08-07T12:00Z", sydney).label).toBe("Mid winter");
  });

  test("counts the days to the next solstice or equinox", () => {
    expect(on("2026-12-20T12:00Z", oslo).daysToNext).toBeCloseTo(1.37, 2);
  });

  test("doesn't use four seasons near the equator", () => {
    expect(on("2026-11-24T12:00Z", singapore)).toEqual({ tropical: true, name: "tropical", label: "Tropical" });
    expect(on("2026-12-22T00:00Z", singapore)).toMatchObject({
      label: "December solstice",
      eventMeaning: "the Sun is furthest south",
    });
  });
});
