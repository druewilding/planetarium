import { describe, expect, test } from "vitest";

import { parseLatLon } from "../src/ui/location.js";

const near = (text, lat, lon) => {
  const got = parseLatLon(text);
  expect(got, text).not.toBeNull();
  expect(got.lat, text).toBeCloseTo(lat, 4);
  expect(got.lon, text).toBeCloseTo(lon, 4);
};

describe("parseLatLon", () => {
  test("reads decimal degrees, as Google Maps copies them", () => {
    near("55.77183675758103, 11.62986982388424", 55.77183675758103, 11.62986982388424);
    near("55.77,11.63", 55.77, 11.63);
    near("55.77 11.63", 55.77, 11.63);
    near("  -33.8568; 151.2153 ", -33.8568, 151.2153);
    near("40.7128 / -74.0060", 40.7128, -74.006);
    near("55 12", 55, 12);
  });

  test("reads decimal commas", () => {
    near("55,68 12,32", 55.68, 12.32);
    near("55,68, 12,32", 55.68, 12.32);
    near("55,68; 12,32", 55.68, 12.32);
    near("-33,8568 151,2153", -33.8568, 151.2153);
    near("55,12", 55, 12); // two whole numbers, not one with a decimal comma
  });

  test("reads degrees, minutes and seconds", () => {
    near("69° 37′ 38.28″ N, 18° 54′ 48.24″ E", 69.6273, 18.9134);
    near("69°37'38.3\u0022N 18°54'48.2\u0022E", 69.627306, 18.913389);
    near("69 37 38.28 N 18 54 48.24 E", 69.6273, 18.9134);
    near("33°51′S 151°13′E", -(33 + 51 / 60), 151 + 13 / 60);
    near("N 55° 46.31′ E 11° 37.79′", 55 + 46.31 / 60, 11 + 37.79 / 60);
    near("51°28′40″N 0°0′5″W", 51.477778, -5 / 3600);
    near("-0° 30′, 51° 30′ N", 51.5, -0.5);
  });

  test("reads hemisphere letters and words, in either order", () => {
    near("55.68 N 12.32 E", 55.68, 12.32);
    near("55.68N, 12.32W", 55.68, -12.32);
    near("12.32 E 55.68 N", 55.68, 12.32);
    near("S 33.86 E 151.21", -33.86, 151.21);
    near("55,68 nord 12,32 øst", 55.68, 12.32);
    near("69.63 N 18.91 Ø", 69.63, 18.91);
    near("40.71 north, 74.01 west", 40.71, -74.01);
    near("lat 55.68, lon 12.32", 55.68, 12.32);
  });

  test("reads map links", () => {
    near("https://www.google.com/maps/@55.6761,12.5683,14z", 55.6761, 12.5683);
    near("https://www.google.com/maps/place/Tromsø/@69.6496,18.9560,12z/data=!3m1", 69.6496, 18.956);
    near("geo:55.68,12.32", 55.68, 12.32);
  });

  test("says when it can't tell", () => {
    for (const text of [
      "",
      "Copenhagen",
      "55.68",
      "1, 2, 3",
      "95, 12",
      "55, 200",
      "55 N 12 S",
      "12 E 55 W",
      "55° 75′ N, 12° E",
    ])
      expect(parseLatLon(text), text).toBeNull();
  });
});
