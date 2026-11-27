import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  AZ_BINS,
  createLightPollution,
  describeSky,
  GLOW_AZ,
  GLOW_ROWS,
  glowAt,
  glowKernel,
  glowTable,
  REACH_KM,
  RINGS,
  rowAltitude,
} from "../src/lightpollution.js";
import { decodePNG } from "../src/png.js";

const zenithOf = (ring) => {
  const k = glowKernel()[ring];
  const o = (GLOW_ROWS - 1) * 2; // straight ahead (no azimuth offset), the top row
  return k[o] + k[o + 1];
};
// The ring a distance falls in, and the distance at its middle.
const ringAt = (km) => Math.floor((RINGS * Math.log(km / 0.3)) / Math.log(REACH_KM / 0.3));
const ringKm = (k) => 0.3 * (REACH_KM / 0.3) ** ((k + 0.5) / RINGS);

/** Sources with a single town in it, `km` away towards `az` degrees. */
function oneTown(km, az, brightness = 1000) {
  const sources = new Float32Array(RINGS * AZ_BINS);
  sources[ringAt(km) * AZ_BINS + Math.round((az / 360) * AZ_BINS)] = brightness;
  return sources;
}

describe("the glow of a town", () => {
  test("fades with distance roughly as Walker's law has it (d^−2.5), from 10 to 50 km", () => {
    const [a, b] = [ringAt(10), ringAt(50)];
    const slope = Math.log(zenithOf(b) / zenithOf(a)) / Math.log(ringKm(b) / ringKm(a));
    expect(slope).toBeLessThan(-2);
    expect(slope).toBeGreaterThan(-3);
  });

  test("is brightest low down towards the town, and the same either side of it", () => {
    const table = glowTable(oneTown(40, 90));
    expect(table.brightest.az).toBe(90);
    expect(table.brightest.contrast).toBeGreaterThan(5);
    const low = { y: Math.sin((5 * Math.PI) / 180), h: Math.cos((5 * Math.PI) / 180) };
    const towards = (az) => {
      const a = (az * Math.PI) / 180;
      return glowAt(table, { x: low.h * Math.sin(a), y: low.y, z: -low.h * Math.cos(a) })[1];
    };
    expect(towards(90)).toBeGreaterThan(20 * towards(270));
    expect(towards(80)).toBeCloseTo(towards(100), 8);
  });

  test("is warm low down and nearer grey overhead", () => {
    const table = glowTable(oneTown(40, 0));
    const ratio = (j) => table.rgb[(j * GLOW_AZ + 0) * 3] / table.rgb[(j * GLOW_AZ + 0) * 3 + 2];
    expect(ratio(0)).toBeGreaterThan(ratio(GLOW_ROWS - 1));
    expect(ratio(GLOW_ROWS - 1)).toBeGreaterThan(1);
  });
});

describe("glowAt", () => {
  const table = glowTable(oneTown(5, 0));
  const g = (j, v) => table.rgb[(j * GLOW_AZ + v) * 3 + 1];

  test("reads the table at its rows and bins, wrapping round through north", () => {
    const j = 3;
    const alt = (rowAltitude(j) * Math.PI) / 180;
    const look = (az) => {
      const a = (az * Math.PI) / 180;
      return glowAt(table, { x: Math.cos(alt) * Math.sin(a), y: Math.sin(alt), z: -Math.cos(alt) * Math.cos(a) })[1];
    };
    expect(look(0)).toBeCloseTo(g(j, 0), 10);
    expect(look(360 / GLOW_AZ)).toBeCloseTo(g(j, 1), 10);
    expect(look(-180 / GLOW_AZ)).toBeCloseTo((g(j, 0) + g(j, GLOW_AZ - 1)) / 2, 10);
  });

  test("fades below the horizon", () => {
    const down = (deg) => {
      const a = (deg * Math.PI) / 180;
      return glowAt(table, { x: 0, y: Math.sin(a), z: -Math.cos(a) })[1];
    };
    expect(down(0)).toBeCloseTo(g(0, 0), 10);
    expect(down(-1) / down(0)).toBeCloseTo(Math.exp(-1), 6);
    expect(down(-30) / down(0)).toBeLessThan(1e-12);
  });
});

describe("createLightPollution", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Offline: every tile fails. Resolves once `n` places have been tried. */
  function offline(n) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const tried = [];
    let finish;
    const all = new Promise((resolve) => (finish = resolve));
    const lp = createLightPollution({
      onReady: (table) => {
        tried.push(table);
        if (tried.length === n) finish();
      },
    });
    return { lp, fetched, tried, all };
  }

  test("works out only the latest of the places asked for while it's busy", async () => {
    const { lp, tried, all } = offline(2);
    for (const lat of [10, 20, 30]) expect(lp.glowFor({ lat, lon: 0 })).toBeNull();
    await all;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tried).toEqual([null, null]); // the first place and the last, not the middle one
  });

  test("tries again after a while when the tiles didn't load", async () => {
    const { lp, fetched, all } = offline(1);
    const here = { lat: 59.91, lon: 10.74 };
    lp.glowFor(here);
    await all;
    const calls = fetched.mock.calls.length;
    lp.glowFor(here);
    expect(fetched.mock.calls.length).toBe(calls);
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    lp.glowFor(here);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetched.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("describeSky", () => {
  test("puts skies on the Bortle scale", () => {
    expect(describeSky(0)).toMatchObject({ bortle: 1, mag: 22 });
    // About what it works out for the middle of Oslo, and somewhere 10 km from a town.
    expect(describeSky(5.7e-3)).toMatchObject({ bortle: 8 });
    expect(describeSky(4.5e-4).bortle).toBe(4);
    expect(describeSky(0.02).text).toMatch(/Inner-city/);
  });
});

describe("decodePNG", () => {
  /** A 2×1 RGBA PNG. */
  function png(pixels) {
    const chunk = (type, data) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, "latin1");
      data.copy(out, 8);
      return out; // (the CRC isn't checked)
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const raw = Buffer.from([0, ...pixels.flat()]);
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ])
    );
  }

  test("keeps the channels asked for", async () => {
    const bytes = png([
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ]);
    expect([...(await decodePNG(bytes))]).toEqual([10, 20, 30, 50, 60, 70]);
    expect([...(await decodePNG(bytes, [3]))]).toEqual([40, 80]);
  });
});
