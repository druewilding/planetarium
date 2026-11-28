// What's up tonight: when it's dark, the Moon, the planets you can see and when
// they're best, and the clusters, nebulae and galaxies worth looking for, from where
// you are. The night is walked through in steps, with the sky's brightness at each
// step from the natural night glow, the glow of towns (see lightpollution.js), the
// Moon (Krisciunas & Schaefer's model of moonlit sky) and twilight.

import { A, Body, PLANETS } from "./astro.js";
import { airmass, BINOCULARS, DARK_SKY, seeing } from "./deepsky.js";
import { glowAt } from "./lightpollution.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STEP = 15 * MINUTE;
const D2R = Math.PI / 180;
const EXTINCTION = 0.2; // magnitudes per airmass (see atmosphere.js)
const LUMA = [0.2126, 0.7152, 0.0722];

const NIGHT = -12; // the Sun this far below the horizon: dark enough for the brighter stars
const DARK = -18; // and this far: properly dark (astronomical twilight is over)
const LOW = 15; // degrees: lower than this, too much air in the way to bother

/** Where something is in the sky ({ alt, az }, degrees), from its J2000 RA and Dec (degrees). */
export function altAzOf(ra, dec, ms, loc) {
  // (Ignoring the slow drift of the poles since 2000: a few tenths of a degree.)
  const lst = (A.SiderealTime(new Date(ms)) * 15 + loc.lon) * D2R;
  const h = lst - ra * D2R;
  const [d, lat] = [dec * D2R, loc.lat * D2R];
  const alt = Math.asin(Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(h));
  const az = Math.atan2(
    -Math.cos(d) * Math.sin(h),
    Math.sin(d) * Math.cos(lat) - Math.cos(d) * Math.cos(h) * Math.sin(lat)
  );
  return { alt: alt / D2R, az: (((az / D2R) % 360) + 360) % 360 };
}

function bodyAltAz(body, ms, obs) {
  const date = new Date(ms);
  const eq = A.Equator(body, date, obs, true, true);
  const hor = A.Horizon(date, obs, eq.ra, eq.dec);
  return { alt: hor.altitude, az: hor.azimuth };
}

const sunAlt = (ms, obs) => bodyAltAz(Body.Sun, ms, obs).alt;

/**
 * The night: when the Sun is more than `limit` degrees down, from the stretch going on
 * now (if it's already dark) or the next one, as { start, end } (ms), or null if it
 * doesn't get that dark in the next day. In the polar night it can be a whole day long.
 */
export function nightWindow(ms, obs, limit = NIGHT) {
  const below = (t) => sunAlt(t, obs) < limit;
  // To the minute, between a time that's on one side and one that's on the other.
  const edge = (a, b) => {
    const side = below(a);
    while (Math.abs(b - a) > MINUTE) {
      const m = (a + b) / 2;
      if (below(m) === side) a = m;
      else b = m;
    }
    return Math.round(b / MINUTE) * MINUTE;
  };
  let start = ms;
  if (below(ms)) {
    while (ms - start < DAY && below(start - STEP)) start -= STEP;
    // (Dark all the past day: the polar night. Tonight starts now.)
    start = ms - start < DAY ? edge(start, start - STEP) : ms;
  } else {
    let t = ms;
    while (t - ms < DAY && !below(t)) t += STEP;
    if (t - ms >= DAY) return null;
    start = edge(t - STEP, t);
  }
  const until = Math.max(start, ms) + DAY;
  let end = Math.max(start, ms);
  while (end < until && below(end)) end += STEP;
  return { start, end: end < until ? edge(end - STEP, end) : until };
}

/**
 * How bright the Moon makes the sky (cd/m²) in a direction ρ degrees from it, for
 * the Moon `moonAlt` and the place `alt` degrees up, at phase angle α (0 full, 180
 * new). Krisciunas & Schaefer (1991).
 */
export function moonlight(rho, moonAlt, alt, alpha) {
  if (moonAlt < 0) return 0;
  const X = (a) => 1 / Math.sqrt(1 - 0.96 * Math.sin((90 - Math.max(a, 0)) * D2R) ** 2);
  const I = 10 ** (-0.4 * (3.84 + 0.026 * Math.abs(alpha) + 4e-9 * alpha ** 4));
  const f = 10 ** 5.36 * (1.06 + Math.cos(rho * D2R) ** 2) + 10 ** (6.15 - rho / 40);
  const nL = f * I * 10 ** (-0.4 * EXTINCTION * X(moonAlt)) * (1 - 10 ** (-0.4 * EXTINCTION * X(alt)));
  return nL * 3.183e-6; // nanolamberts → cd/m²
}

/** The twilight's glow (cd/m²), roughly, with the Sun `h` degrees up: 2 at −6°, 0.008 at −12°. */
export const twilight = (h) => (h > 0 ? Infinity : 0.008 * 10 ** (0.4 * (h + 12)));

/** A horizon direction ({x: east, y: up, z: south}), as lightpollution.glowAt wants. */
const horizonDir = (alt, az) => ({
  x: Math.cos(alt * D2R) * Math.sin(az * D2R),
  y: Math.sin(alt * D2R),
  z: -Math.cos(alt * D2R) * Math.cos(az * D2R),
});

const angle = (a, b) => {
  const c =
    Math.sin(a.alt * D2R) * Math.sin(b.alt * D2R) +
    Math.cos(a.alt * D2R) * Math.cos(b.alt * D2R) * Math.cos((a.az - b.az) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
};

/** When a body rises and sets between `start` and `end`, and whether it's up at the start. */
function upBetween(body, obs, start, end) {
  const days = (end - start) / DAY;
  const rise = A.SearchRiseSet(body, obs, +1, new Date(start), days);
  const set = A.SearchRiseSet(body, obs, -1, new Date(start), days);
  return {
    upAtStart: bodyAltAz(body, start, obs).alt > -0.6,
    rise: rise ? rise.date.getTime() : null,
    set: set ? set.date.getTime() : null,
  };
}

// The kinds worth looking for in their own right: not just a sprinkling of bright stars.
const SMUDGES = new Set(["gc", "sg", "eg", "ig", "en", "rn", "pn", "sn"]);

/**
 * Tonight, from `loc` ({ lat, lon }) with `obs` its astronomy-engine Observer, from
 * `ms` on. objects: deep-sky objects (see deepsky.js); constellations: [{ id, ra, dec }]
 * (where each one's name goes); glow: the town glow table (see lightpollution.js), or null.
 */
export function planTonight({ ms, loc, obs, objects = [], constellations = [], glow = null }) {
  const window = nightWindow(ms, obs, NIGHT) ?? nightWindow(ms, obs, -6) ?? nightWindow(ms, obs, -0.833);
  if (!window) return { sunUp: true };
  const twilightOnly = !nightWindow(window.start, obs, NIGHT) || window.end - window.start < 30 * MINUTE;
  const plan = { start: window.start, end: window.end, twilightOnly, polar: window.end - window.start >= DAY - STEP };

  // Properly dark, if it gets that dark (within the night).
  const dark = nightWindow(Math.max(ms, window.start), obs, DARK);
  plan.dark = dark && dark.start < window.end ? { start: dark.start, end: Math.min(dark.end, window.end) } : null;
  // The darkest moment, for a night that never gets properly dark.
  if (!plan.dark) {
    let best = window.start;
    for (let t = window.start; t <= window.end; t += STEP) if (sunAlt(t, obs) < sunAlt(best, obs)) best = t;
    plan.darkest = best;
  }

  // ---- Step through the night (what's left of it) ----
  const from = Math.max(ms, window.start);
  const steps = [];
  for (let t = from; t <= window.end; t += STEP) {
    const moon = bodyAltAz(Body.Moon, t, obs);
    steps.push({ t, sun: sunAlt(t, obs), moon, phase: A.Illumination(Body.Moon, new Date(t)).phase_angle });
  }

  // ---- The Moon ----
  const mid = (window.start + window.end) / 2;
  const lit = A.Illumination(Body.Moon, new Date(mid)).phase_fraction;
  plan.moon = { ...upBetween(Body.Moon, obs, window.start, window.end), lit };
  const moonUp = steps.filter((s) => s.moon.alt > 0).length / Math.max(1, steps.length);
  plan.moon.bright = lit > 0.5 && moonUp > 0.3; // enough to hide the faint things

  // ---- The planets you can see ----
  plan.planets = [];
  for (const p of PLANETS) {
    if (p.dwarf) continue;
    const body = Body[p.id];
    const mag = A.Illumination(body, new Date(mid)).mag;
    if (mag > 6) continue;
    let best = null;
    for (const s of steps) {
      const at = bodyAltAz(body, s.t, obs);
      // (Planets are bright: seen in twilight, and only a little way up.)
      if (at.alt > 5 && (!best || at.alt > best.alt)) best = { ...at, t: s.t };
    }
    if (!best) continue;
    plan.planets.push({ id: p.id, name: p.name, mag, best, ...upBetween(body, obs, window.start, window.end) });
  }
  plan.planets.sort((a, b) => a.mag - b.mag);

  // ---- Clusters, nebulae and galaxies ----
  const skyGlow = (alt, az) => {
    if (!glow) return 0;
    const c = glowAt(glow, horizonDir(alt, az));
    return c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  };
  const found = [];
  for (const o of objects) {
    // (Not a cluster of stars you'd see anyway, with no haze between them: see deepsky.js.)
    if (o.mag == null || (o.type === "oc" && o.glow == null)) continue;
    let best = null;
    for (const s of steps) {
      const at = altAzOf(o.ra, o.dec, s.t, loc);
      if (at.alt < LOW) continue;
      const sky =
        DARK_SKY + skyGlow(at.alt, at.az) + moonlight(angle(at, s.moon), s.moon.alt, at.alt, s.phase) + twilight(s.sun);
      const trans = 10 ** (-0.4 * EXTINCTION * airmass(at.alt));
      const eye = seeing(o, sky, { trans });
      const binoculars = seeing(o, sky, { trans, gain: BINOCULARS });
      if (!best || binoculars > best.binoculars) best = { ...at, t: s.t, eye, binoculars };
    }
    if (!best || best.binoculars < 1.5) continue;
    const how = best.eye >= 1.5 ? "eye" : "binoculars";
    // Smudges first (the stars of a loose cluster you'd see anyway), and the famous ones.
    const score =
      Math.log10(how === "eye" ? best.eye : best.binoculars) +
      (SMUDGES.has(o.type) ? 0.7 : 0) +
      (o.name !== o.id ? 0.3 : 0);
    found.push({ id: o.id, name: o.name, how, best, score });
  }
  found.sort((a, b) => (a.how === b.how ? b.score - a.score : a.how === "eye" ? -1 : 1));
  plan.deepSky = found.slice(0, 6);

  // ---- The constellations high up in the middle of the night ----
  const middle = (from + window.end) / 2;
  plan.middle = middle;
  plan.constellations = constellations
    .map((c) => ({ id: c.id, ...altAzOf(c.ra, c.dec, middle, loc) }))
    .filter((c) => c.alt > 50)
    .sort((a, b) => b.alt - a.alt)
    .slice(0, 4);
  return plan;
}
