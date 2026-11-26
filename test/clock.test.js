import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Clock, RATES } from "../src/clock.js";

const NOW = Date.parse("2026-11-24T18:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("Clock", () => {
  test("starts on now, at real time", () => {
    const clock = new Clock();
    expect(clock.ms).toBe(NOW);
    expect(clock.rate).toBe(1);
    expect(clock.rateLabel).toBe("Real time");
    expect(clock.following).toBe(true);
  });

  test("runs at its rate", () => {
    const clock = new Clock();
    clock.faster(); // 1 min / s
    clock.update(2);
    expect(clock.ms).toBe(NOW + 2 * 60 * 1000);
    expect(clock.following).toBe(false);
  });

  test("stands still when paused", () => {
    const clock = new Clock();
    clock.togglePlay();
    clock.update(10);
    expect(clock.ms).toBe(NOW);
    expect(clock.rateLabel).toBe("Paused");
    expect(clock.following).toBe(false);
  });

  test("goes no faster than 12 hours a second, either way", () => {
    const clock = new Clock();
    for (let i = 0; i < 20; i++) clock.faster();
    expect(clock.rate).toBe(43200);
    for (let i = 0; i < 40; i++) clock.slower();
    expect(clock.rate).toBe(-43200);
    expect(RATES.at(0).rate).toBe(-RATES.at(-1).rate);
  });

  test("starts playing again on faster or slower, keeping its speed", () => {
    const clock = new Clock();
    clock.togglePlay();
    clock.faster();
    expect(clock.playing).toBe(true);
    expect(clock.rate).toBe(1);
  });

  test("glides to a nearby moment", () => {
    const clock = new Clock();
    clock.togglePlay();
    clock.set(NOW + 3600000);
    expect(clock.ms).toBe(NOW);
    clock.update(0.2);
    expect(clock.ms).toBeGreaterThan(NOW);
    expect(clock.ms).toBeLessThan(NOW + 3600000);
    clock.update(5);
    expect(clock.ms).toBe(NOW + 3600000);
  });

  test("jumps straight to a faraway moment", () => {
    const clock = new Clock();
    clock.set(Date.parse("1999-08-11T11:00Z"));
    expect(clock.ms).toBe(Date.parse("1999-08-11T11:00Z"));
  });

  test("tells its listeners when it changes", () => {
    const clock = new Clock();
    const seen = [];
    clock.onChange((c) => seen.push(c.ms));
    clock.nudge(60000);
    expect(seen).toEqual([NOW + 60000]);
  });

  test("comes back to now at real time", () => {
    const clock = new Clock();
    clock.faster();
    clock.set(NOW - 10 * 86400000);
    clock.now();
    expect(clock.ms).toBe(NOW);
    expect(clock.following).toBe(true);
  });

  test("goes back to real speed, keeping the time, and stays paused if paused", () => {
    const clock = new Clock();
    clock.faster();
    clock.faster();
    clock.set(NOW + 86400000, { animate: false });
    clock.realSpeed();
    expect(clock.rate).toBe(1);
    expect(clock.ms).toBe(NOW + 86400000);
    clock.faster();
    clock.togglePlay();
    clock.realSpeed();
    expect(clock.rateLabel).toBe("Paused");
  });
});
