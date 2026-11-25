// Eclipses: the Earth's shadow on the Moon, and finding the next eclipses.
//
// The Earth's shadow is a pair of cones pointing away from the Sun: the umbra,
// where the whole Sun is hidden, inside the penumbra, where only part of it is.
// The sizes come from the same geometry astronomy-engine uses to predict lunar
// eclipses (the Earth plus 88 km of atmosphere), so what's drawn matches its
// predictions. Inside the umbra the Moon still gets a little sunlight, bent
// through the Earth's atmosphere: red, like all the world's sunsets at once.

import * as A from "astronomy-engine";

import { AU_KM, EARTH_RADIUS_KM, MOON_RADIUS_KM, SUN_RADIUS_KM } from "./constants.js";

const EARTH_SHADOW_RADIUS_KM = EARTH_RADIUS_KM + 88;

/** Light reaching the umbra through the atmosphere, as a share of full sunlight: dimmest at the centre. */
export const UMBRA_CENTRE = 4e-5;
export const UMBRA_EDGE = 8e-4;
export const UMBRA_TINT = [1, 0.3, 0.1];

/**
 * The Earth's shadow at an instant, in the J2000 equatorial frame (km):
 * `axis` points from the Earth directly away from the Sun, `moon` is the Moon's
 * centre seen from the Earth's centre, and `umbraKm` / `penumbraKm` are the
 * shadow's radii where it reaches the Moon.
 */
export function earthShadow(time) {
  const s = A.GeoVector(A.Body.Sun, time, true);
  const m = A.GeoMoon(time);
  const sunKm = Math.hypot(s.x, s.y, s.z) * AU_KM;
  const axis = { x: -s.x, y: -s.y, z: -s.z };
  const len = Math.hypot(axis.x, axis.y, axis.z);
  axis.x /= len;
  axis.y /= len;
  axis.z /= len;
  const moon = { x: m.x * AU_KM, y: m.y * AU_KM, z: m.z * AU_KM };
  const along = moon.x * axis.x + moon.y * axis.y + moon.z * axis.z; // km behind the Earth
  const u = along / sunKm; // as in astronomy-engine's CalcShadow
  return {
    axis,
    moon,
    umbraKm: SUN_RADIUS_KM - (1 + u) * (SUN_RADIUS_KM - EARTH_SHADOW_RADIUS_KM),
    penumbraKm: -SUN_RADIUS_KM + (1 + u) * (SUN_RADIUS_KM + EARTH_SHADOW_RADIUS_KM),
  };
}

/**
 * Light reaching a point `d` km from the shadow's axis, as [r, g, b] shares of
 * full sunlight. A GLSL twin lives in scene/bodies.js (EARTH_SHADOW).
 */
export function shadowLight(d, umbraKm, penumbraKm) {
  // In the penumbra the Earth's edge slides across the Sun's disc. From the Moon
  // the Earth is four times wider than the Sun, so its edge is nearly straight:
  // the lit share is a disc cut by a straight line.
  const x = Math.min(1, Math.max(0, (d - umbraKm) / (penumbraKm - umbraKm)));
  const c = 2 * x - 1;
  const sun = 0.5 + (c * Math.sqrt(1 - c * c) + Math.asin(c)) / Math.PI;
  const u = Math.min(1, Math.max(0, d / umbraKm));
  const red = UMBRA_CENTRE + (UMBRA_EDGE - UMBRA_CENTRE) * u ** 4;
  // (The bent light only matters where the Sun itself is hidden.)
  return UMBRA_TINT.map((t) => sun + red * t * (1 - sun));
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Points spread over the Moon's disc, in Moon radii.
const DISC = [];
for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) if (i * i + j * j <= 16) DISC.push([i / 4, j / 4]);

/**
 * How much of the Moon is in the Earth's shadow, seen along the shadow (close
 * enough to how it looks from the Earth whenever it's anywhere near the shadow):
 * `light` is the share of its usual brightness left, `umbra` and `penumbra` the
 * share of its disc inside each.
 */
export function moonInShadow(shadow) {
  const { axis, moon, umbraKm, penumbraKm } = shadow;
  const along = moon.x * axis.x + moon.y * axis.y + moon.z * axis.z;
  const off = { x: moon.x - along * axis.x, y: moon.y - along * axis.y, z: moon.z - along * axis.z };
  const offKm = Math.hypot(off.x, off.y, off.z);
  // The shadow only falls behind the Earth: at new Moon the Moon is in line with it, but on the Sun's side.
  if (along <= 0 || offKm > penumbraKm + MOON_RADIUS_KM) return { light: 1, umbra: 0, penumbra: 0 };
  let light = 0;
  let umbra = 0;
  let penumbra = 0;
  for (const [a, b] of DISC) {
    // Across the disc: `a` away from the axis, `b` sideways, so the distance is just Pythagoras.
    const d = Math.hypot(offKm + a * MOON_RADIUS_KM, b * MOON_RADIUS_KM);
    light += luminance(shadowLight(d, umbraKm, penumbraKm));
    if (d < umbraKm) umbra++;
    if (d < penumbraKm) penumbra++;
  }
  return { light: light / DISC.length, umbra: umbra / DISC.length, penumbra: penumbra / DISC.length };
}

const ms = (t) => t.date.getTime();
const MIN_COVERED = 0.1; // a smaller bite out of the Sun goes unnoticed
const KIND = { partial: "Partial", annular: "Annular", total: "Total", penumbral: "Penumbral" };
const moonAltitude = (time, observer) => {
  const eq = A.Equator(A.Body.Moon, time, observer, true, true);
  return A.Horizon(time, observer, eq.ra, eq.dec, "normal").altitude;
};

/**
 * The next solar eclipses seen from a place, with the Sun up for some of it and
 * enough of it covered to notice:
 * [{ kind, peak, covered, sunAltitude, start, end, totalStart?, totalEnd? }], times in ms.
 * `covered` is the share of the Sun's disc hidden at the peak. The search stops
 * after `count` eclipses, or at `untilMs`, whichever comes first.
 */
export function solarEclipsesFrom(startMs, place, count = 1, untilMs = Infinity) {
  const observer = new A.Observer(place.lat, place.lon, 0);
  const list = [];
  let e = A.SearchLocalSolarEclipse(new Date(startMs), observer);
  for (let tries = 0; list.length < count && tries < 60; tries++) {
    if (ms(e.peak.time) > untilMs) break;
    if (e.obscuration < MIN_COVERED) {
      e = A.NextLocalSolarEclipse(e.peak.time, observer);
      continue;
    }
    list.push({
      kind: KIND[e.kind],
      peak: ms(e.peak.time),
      covered: e.obscuration,
      sunAltitude: e.peak.altitude,
      start: ms(e.partial_begin.time),
      end: ms(e.partial_end.time),
      ...(e.total_begin && { totalStart: ms(e.total_begin.time), totalEnd: ms(e.total_end.time) }),
    });
    if (list.length < count) e = A.NextLocalSolarEclipse(e.peak.time, observer);
  }
  return list;
}

/**
 * The next lunar eclipses you can see from a place: partial or total (a
 * penumbral one barely dims the Moon), with the Moon up for some of the time
 * it's in the umbra. [{ kind, peak, start, end, totalStart?, totalEnd?, moonAltitude }], ms.
 * Like solarEclipsesFrom, it stops after `count` eclipses or at `untilMs`.
 */
export function lunarEclipsesFrom(startMs, place, count = 1, untilMs = Infinity) {
  const observer = new A.Observer(place.lat, place.lon, 0);
  const list = [];
  let e = A.SearchLunarEclipse(new Date(startMs));
  for (let tries = 0; list.length < count && tries < 60; tries++) {
    if (ms(e.peak) > untilMs) break;
    if (e.kind !== "penumbral") {
      const peak = ms(e.peak);
      const half = e.sd_partial * 60000;
      const up = [peak - half, peak, peak + half].map((t) => moonAltitude(new Date(t), observer));
      if (Math.max(...up) > 0) {
        list.push({
          kind: KIND[e.kind],
          peak,
          start: peak - half,
          end: peak + half,
          ...(e.sd_total > 0 && { totalStart: peak - e.sd_total * 60000, totalEnd: peak + e.sd_total * 60000 }),
          moonAltitude: up[1],
        });
      }
    }
    e = A.NextLunarEclipse(e.peak);
  }
  return list;
}

/** The next total solar eclipse anywhere: { peak (ms), lat, lon }, on the centre line at its peak. */
export function nextTotalSolarEclipse(startMs) {
  let e = A.SearchGlobalSolarEclipse(new Date(startMs));
  while (e.kind !== "total") e = A.NextGlobalSolarEclipse(e.peak);
  return { peak: ms(e.peak), lat: e.latitude, lon: e.longitude };
}
