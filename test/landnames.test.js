import { describe, expect, test } from "vitest";

import { squareKey, squaresAround, toElement } from "../src/landnames.js";

describe("squareKey", () => {
  test("names a square by its south-west corner, like planetarium-labels", () => {
    expect(squareKey(55.68, 12.57)).toBe("55_12");
    expect(squareKey(-33.45, -70.66)).toBe("-34_-71");
  });
});

describe("squaresAround", () => {
  test("is the squares a 50 km circle reaches", () => {
    // Copenhagen: 0.45° of latitude and 0.8° of longitude each way.
    expect(squaresAround(55.68, 12.57, 50).toSorted()).toEqual(["55_11", "55_12", "55_13", "56_11", "56_12", "56_13"]);
  });

  test("is just the one square for a place in its middle and a small circle", () => {
    expect(squaresAround(61.5, 8.5, 10)).toEqual(["61_8"]);
  });

  test("wraps round at the date line", () => {
    expect(squaresAround(-17.5, 179.9, 20)).toEqual(expect.arrayContaining(["-18_179", "-18_-180"]));
  });
});

describe("toElement", () => {
  test("turns a peak's row into the element Overpass gave", () => {
    expect(toElement(["n251488763", "peak", 55.99251, 9.79581, "Yding Skovhøj", 170.8])).toEqual({
      type: "node",
      id: 251488763,
      lat: 55.99251,
      lon: 9.79581,
      tags: { natural: "peak", name: "Yding Skovhøj", ele: "170.8" },
    });
  });

  test("gives a place its population and a landmark its height", () => {
    expect(toElement(["n13707878", "city", 55.68672, 12.57007, "København", 613288]).tags).toEqual({
      place: "city",
      name: "København",
      population: "613288",
    });
    expect(toElement(["w7", "mast", 56, 10, "", 220]).tags).toEqual({ man_made: "mast", height: "220" });
  });

  test("leaves off a name or number it doesn't have", () => {
    expect(toElement(["r9", "lighthouse", 58, 5, ""])).toMatchObject({
      type: "relation",
      tags: { man_made: "lighthouse" },
    });
  });
});
