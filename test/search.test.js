import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { buildDeepSky } from "../src/deepsky.js";
import { fold, searchMatches, searchRecords } from "../src/ui/panels.js";

// The deep-sky objects as the search box has them (see main.js).
const objects = buildDeepSky(
  JSON.parse(readFileSync(new URL("../data/deepsky.json", import.meta.url), "utf8")),
  () => null
);
const records = searchRecords([
  { name: "Saturn" },
  { name: "Mars" },
  ...objects.map((o) => ({ name: o.name, aka: o.numbers })),
]);
const find = (typed) => searchMatches(records, fold(typed)).map((r) => r.name);

describe("the search box", () => {
  test("a Messier number finds its own object first, not the others that start the same", () => {
    expect(find("M1")[0]).toBe("Crab Nebula");
    expect(find("m4")[0]).toBe("M4");
    expect(find("M13")[0]).toBe("Hercules Cluster");
    expect(find("M31")[0]).toBe("Andromeda Galaxy");
  });

  test("names, catalogue numbers and parts of names", () => {
    expect(find("ngc 224")[0]).toBe("Andromeda Galaxy");
    expect(find("pleia")).toEqual(["Pleiades", "Southern Pleiades"]);
    expect(find("sat")[0]).toBe("Saturn");
    expect(find("magellanic")).toEqual(["Large Magellanic Cloud", "Small Magellanic Cloud"]);
  });

  test("at most eight", () => {
    expect(find("m").length).toBe(8);
  });
});
