import { describe, expect, test } from "vitest";

import {
  dayOfYear,
  formatDuration,
  fromInputValue,
  isValidZone,
  localMinutesOfDay,
  offsetMinutes,
  startOfLocalDay,
  toInputValue,
  zoneLabel,
} from "../src/timezone.js";

const oslo = { lat: 59.91, lon: 10.75, tz: "Europe/Oslo" };
const WINTER = Date.parse("2026-01-15T12:00Z");
const SUMMER = Date.parse("2026-07-15T12:00Z");

describe("offsetMinutes", () => {
  test("follows daylight saving time", () => {
    expect(offsetMinutes(WINTER, oslo)).toBe(60);
    expect(offsetMinutes(SUMMER, oslo)).toBe(120);
  });

  test("handles half and quarter hours, and the southern summer", () => {
    expect(offsetMinutes(WINTER, { tz: "Australia/Adelaide" })).toBe(630);
    expect(offsetMinutes(SUMMER, { tz: "Australia/Adelaide" })).toBe(570);
    expect(offsetMinutes(WINTER, { tz: "Asia/Kathmandu" })).toBe(345);
  });

  test("falls back to the nearest whole hour of solar time without a time zone", () => {
    expect(offsetMinutes(WINTER, { lon: 10.75 })).toBe(60);
    expect(offsetMinutes(WINTER, { lon: -74 })).toBe(-300);
    expect(offsetMinutes(WINTER, { lon: 10.75, tz: "Not/AZone" })).toBe(60);
  });
});

describe("isValidZone", () => {
  test("knows real time zones", () => {
    expect(isValidZone("Europe/Oslo")).toBe(true);
    expect(isValidZone("Not/AZone")).toBe(false);
    expect(isValidZone("")).toBe(false);
  });
});

describe("local days", () => {
  test("starts the local day at local midnight", () => {
    expect(new Date(startOfLocalDay(WINTER, oslo)).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(new Date(startOfLocalDay(SUMMER, oslo)).toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  test("starts the day the clocks go forward at midnight before the change", () => {
    // Norway goes to summer time at 01:00 UTC on 29 March 2026
    expect(new Date(startOfLocalDay(Date.parse("2026-03-29T12:00Z"), oslo)).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z"
    );
  });

  test("counts minutes since local midnight", () => {
    expect(localMinutesOfDay(SUMMER, oslo)).toBe(14 * 60);
  });

  test("counts days since 1 January", () => {
    expect(dayOfYear(Date.parse("2026-01-01T00:00Z"), oslo)).toBeCloseTo(1 / 24, 6);
    expect(Math.floor(dayOfYear(SUMMER, oslo))).toBe(195);
  });
});

describe("labels and formatting", () => {
  test("names the zone and its offset", () => {
    expect(zoneLabel(SUMMER, oslo)).toBe("Oslo time · UTC+2");
    expect(zoneLabel(WINTER, { tz: "America/St_Johns" })).toBe("St Johns time · UTC−3:30");
    expect(zoneLabel(WINTER, { lon: 10.75 })).toBe("≈ solar time · UTC+1");
  });

  test("writes a duration in hours and minutes", () => {
    expect(formatDuration(0)).toBe("0h 00m");
    expect(formatDuration(18 * 60 + 53.2)).toBe("18h 53m");
    expect(formatDuration(5 * 60 + 59.7)).toBe("6h 00m");
  });

  test("round-trips the date and time input in local time", () => {
    expect(toInputValue(SUMMER, oslo)).toBe("2026-07-15T14:00");
    expect(fromInputValue("2026-07-15T14:00", oslo, SUMMER)).toBe(SUMMER);
  });

  test("ignores a cleared or unreadable date and time", () => {
    expect(fromInputValue("", oslo, SUMMER)).toBeNull();
    expect(fromInputValue("not a date", oslo, SUMMER)).toBeNull();
    expect(fromInputValue("2026-13-45T99:99", oslo, SUMMER)).toBeNull();
  });
});
