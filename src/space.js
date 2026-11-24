// Where things are in space, in one shared frame, so a distance can be measured
// from wherever you're standing: Earth now, and later the Moon, the Sun, the
// planets or their moons.
//
// The frame is heliocentric and fixed to the J2000 mean equator (astronomy-
// engine's EQJ, the frame of HelioVector), measured in AU:
//   x towards the March equinox (RA 0h), y towards RA 6h, z towards the north
//   celestial pole.
// A distance is then just the length of (target − observer).

import { A, AU_KM, Body, D2R } from "./astro.js";

export const LIGHT_YEAR_AU = 63241.077;
export const LIGHT_YEAR_KM = LIGHT_YEAR_AU * AU_KM;
export const LIGHT_SPEED_KM_S = 299792.458;

/** The Sun, the Moon, a planet or (later) a planet's moon, by name. */
const BODIES = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  earth: Body.Earth,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
  pluto: Body.Pluto,
};

/** Where a body in the solar system is at an instant (centre of the body). */
export function bodyPosition(name, ms) {
  const body = BODIES[String(name).toLowerCase()];
  if (!body) throw new Error(`No position for ${name}`);
  const v = A.HelioVector(body, new Date(ms));
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Where a star is, from its catalogue direction (J2000 RA and Dec, degrees) and
 * its parallax (milliarcseconds). Stars barely move over a human lifetime, so
 * this has no time. `relError` is how uncertain the distance is (0.1 = ±10%).
 * Null when there's no usable parallax: the star is too far to measure.
 */
export function starPosition({ ra, dec, plx, ePlx }) {
  if (!(plx > 0)) return null;
  const r = (1000 / plx) * (LIGHT_YEAR_AU * 3.26156); // parsecs → AU
  const cosDec = Math.cos(dec * D2R);
  return {
    x: r * cosDec * Math.cos(ra * D2R),
    y: r * cosDec * Math.sin(ra * D2R),
    z: r * Math.sin(dec * D2R),
    relError: ePlx > 0 ? ePlx / plx : 0,
  };
}

/** Distance between two positions, in AU. */
export function distanceAU(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
