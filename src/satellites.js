// Moons of other planets: for now Jupiter's four big ones, found by Galileo in 1610.
//
// Nothing here assumes you're on the Earth. A moon is placed by where it is from
// its planet, added to where the planet is from you, so the same sums work from
// the ground, from up above the Earth, or (later) standing on Mars or on Jupiter
// itself. Shadows work the same way: from any point, how much of the Sun's disc
// a body hides. That one rule gives a moon going dark in Jupiter's shadow, a
// moon's black shadow on Jupiter's clouds, and (later) the Sun eclipsed by Io,
// seen from Jupiter.

import { Vector3 } from "three";

import { A, altAz, AU_KM, planetPole, PLANETS, SUN_RADIUS_KM, sunVisibleFraction } from "./astro.js";

// H: brightness (absolute magnitude) at 1 AU from the Sun and from you; albedo: how
// much sunlight it sends back; color: as a point, and its surface crossing Jupiter.
export const JUPITER_MOONS = [
  {
    id: "Io",
    name: "Io",
    key: "io",
    radiusKm: 1821.6,
    H: -1.68,
    albedo: 0.63,
    periodDays: 1.769,
    color: [1.0, 0.9, 0.6],
  },
  {
    id: "Europa",
    name: "Europa",
    key: "europa",
    radiusKm: 1560.8,
    H: -1.41,
    albedo: 0.67,
    periodDays: 3.551,
    color: [1.0, 0.97, 0.92],
  },
  {
    id: "Ganymede",
    name: "Ganymede",
    key: "ganymede",
    radiusKm: 2634.1,
    H: -2.09,
    albedo: 0.43,
    periodDays: 7.155,
    color: [0.88, 0.82, 0.74],
  },
  {
    id: "Callisto",
    name: "Callisto",
    key: "callisto",
    radiusKm: 2410.3,
    H: -1.05,
    albedo: 0.22,
    periodDays: 16.689,
    color: [0.72, 0.66, 0.58],
  },
];

const JUPITER = PLANETS.find((p) => p.id === "Jupiter");
const LIGHT_DAYS_PER_AU = AU_KM / 299792.458 / 86400;

/** Where each moon is from Jupiter's centre at `time` (J2000 equator, AU), keyed by id. */
function jupiterOffsets(time) {
  const found = A.JupiterMoons(time);
  return Object.fromEntries(
    JUPITER_MOONS.map((m) => [m.id, new Vector3(found[m.key].x, found[m.key].y, found[m.key].z)])
  );
}

/**
 * Whether a point `offset` from a planet's centre lies inside its disc as seen
 * along `look`: an ellipse squashed along the pole by `flattening`.
 */
export function insideDisc(offset, look, pole, radius, flattening = 0) {
  const across = offset.clone().addScaledVector(look, -offset.dot(look));
  const up = pole.clone().addScaledVector(look, -pole.dot(look));
  // Seen pole-on, the disc is round.
  const tilt = up.length();
  if (tilt < 1e-9) return across.length() < radius;
  up.divideScalar(tilt);
  const polar = radius * (1 - flattening * tilt * tilt);
  const y = across.dot(up);
  const x = Math.sqrt(Math.max(0, across.lengthSq() - y * y));
  return (x / radius) ** 2 + (y / polar) ** 2 < 1;
}

/**
 * Share of the Sun's disc you'd see from `point`, with a round body of radius
 * `casterRadius` at `caster` perhaps in the way (all positions in AU, in any one frame).
 */
export function sunlightPast(point, sun, caster, casterRadius) {
  const toSun = sun.clone().sub(point);
  const toCaster = caster.clone().sub(point);
  const casterDist = toCaster.length();
  if (casterDist <= casterRadius) return 0;
  const sunDist = toSun.length();
  // (Only something nearer than the Sun can hide it.)
  if (casterDist >= sunDist) return 1;
  const rs = Math.asin(Math.min(1, SUN_RADIUS_KM / AU_KM / sunDist));
  const rc = Math.asin(casterRadius / casterDist);
  return sunVisibleFraction(rs, rc, toSun.angleTo(toCaster));
}

// Points across a moon's disc (in its radii), towards and away from the shadow's
// middle, weighted by how much of the disc each stands for.
const ACROSS = [-0.8, -0.4, 0, 0.4, 0.8].map((a) => [a, Math.sqrt(1 - a * a)]);
const ACROSS_WEIGHT = ACROSS.reduce((sum, [, w]) => sum + w, 0);

/**
 * How the moon at `offset` from its planet stands with it, seen from you, with
 * the planet at `planet` and the Sun at `sun` (from you, AU, all in one frame),
 * the planet's pole `pole` (a unit vector in that frame) and `def` the planet's
 * PLANETS entry. { behind, inFront: hidden by its disc or crossing it, as you see
 * them; shadowOnPlanet: its shadow falls on the planet; light: the share of
 * sunlight reaching it, out of the planet's shadow }.
 */
export function satelliteGeometry(offset, radiusKm, planet, sun, pole, def) {
  const R = def.radiusKm / AU_KM;
  const f = def.flattening ?? 0;
  const look = planet.clone().normalize();
  const nearer = offset.dot(look) < 0;
  const onDisc = insideDisc(offset, look, pole, R, f);
  const sunward = sun.clone().sub(planet).normalize();
  const shadowOnPlanet = offset.dot(sunward) > 0 && insideDisc(offset, sunward, pole, R, f);

  let light = 1;
  if (offset.dot(sunward) < 0) {
    // Behind the planet from the Sun: how much of the Sun do points across the moon see?
    const across = offset.clone().addScaledVector(sunward, -offset.dot(sunward));
    const out = across.lengthSq() > 0 ? across.clone().normalize() : new Vector3(1, 0, 0);
    // The planet's edge is nearer its centre towards its poles.
    const lean = out.dot(pole);
    const edge = R * (1 - f * lean * lean);
    const r = radiusKm / AU_KM;
    const sunFromPlanet = sun.clone().sub(planet);
    const p = new Vector3();
    light = 0;
    for (const [a, w] of ACROSS) {
      p.copy(offset).addScaledVector(out, a * r);
      light += w * sunlightPast(p, sunFromPlanet, new Vector3(), edge);
    }
    light /= ACROSS_WEIGHT;
  }
  return { behind: !nearer && onDisc, inFront: nearer && onDisc, shadowOnPlanet, light };
}

const cache = new WeakMap();

/**
 * Jupiter's moons as seen in `sky`, like its planets: { id, name, parent, vecAU,
 * offsetAU, dist, trueDir, dir, alt, az, angularRadius, mag, behind, inFront,
 * shadowOnPlanet, light }. offsetAU is where the moon is from Jupiter (world frame,
 * AU). Worked out once per sky, and only when asked for.
 */
export function jupiterMoons(sky) {
  let moons = cache.get(sky);
  if (moons) return moons;
  const jupiter = sky.planets.find((p) => p.id === "Jupiter");
  // We see Jupiter as it was when its light left it, so its moons too.
  const offsets = jupiterOffsets(sky.time.AddDays(-jupiter.dist * LIGHT_DAYS_PER_AU));
  const pole = planetPole("Jupiter", sky);
  moons = JUPITER_MOONS.map((m) => {
    const offsetAU = offsets[m.id].applyMatrix4(sky.eqjToWorld);
    const vecAU = jupiter.vecAU.clone().add(offsetAU);
    const dist = vecAU.length();
    const trueDir = vecAU.clone().divideScalar(dist);
    // Bent by the air just as Jupiter is (they're only minutes of arc apart).
    const dir = trueDir.clone().sub(jupiter.trueDir).add(jupiter.dir).normalize();
    const fromSun = vecAU.distanceTo(sky.sun.vecAU);
    const geometry = satelliteGeometry(offsetAU, m.radiusKm, jupiter.vecAU, sky.sun.vecAU, pole, JUPITER);
    return {
      id: m.id,
      name: m.name,
      parent: "Jupiter",
      def: m,
      color: m.color,
      vecAU,
      offsetAU,
      dist,
      trueDir,
      dir,
      ...altAz(dir),
      angularRadius: Math.asin(m.radiusKm / (dist * AU_KM)),
      mag: m.H + 5 * Math.log10(fromSun * dist) - 2.5 * Math.log10(Math.max(geometry.light, 1e-5)),
      ...geometry,
    };
  });
  cache.set(sky, moons);
  return moons;
}

/** Seen from the Earth's centre: Jupiter and the Sun (J2000 equator, AU, with light time). */
const fromEarth = (time) => ({
  planet: vec(A.GeoVector(A.Body.Jupiter, time, true)),
  sun: vec(A.GeoVector(A.Body.Sun, time, true)),
});
const vec = (v) => new Vector3(v.x, v.y, v.z);

const STEP_MS = 10 * 60000;

/**
 * The next times a moon crosses in front of Jupiter (`transit`), casts its shadow
 * on it (`shadow`), goes dark in its shadow (`eclipse`) or hides behind it
 * (`hidden`), as you'd see them: each { start, end } in ms (start may be before
 * `fromMs` if it's happening now), or null if not within `days`.
 * `seenFrom(time)` gives { planet, sun } from you (J2000 equator, AU); the
 * Earth's centre is near enough for anywhere on or above the Earth.
 */
export function searchMoonEvents(id, fromMs, { days = 20, seenFrom = fromEarth } = {}) {
  const state = (ms) => {
    const time = A.MakeTime(new Date(ms));
    const { planet, sun } = seenFrom(time);
    const offset = jupiterOffsets(time.AddDays(-planet.length() * LIGHT_DAYS_PER_AU))[id];
    const n = A.RotationAxis(A.Body.Jupiter, time).north;
    const g = satelliteGeometry(offset, 0, planet, sun, vec(n), JUPITER);
    return { transit: g.inFront, shadow: g.shadowOnPlanet, eclipse: g.light < 0.5, hidden: g.behind };
  };
  // To the nearest half minute, between a time it wasn't and one it was (or the other way).
  const edge = (key, a, b) => {
    const was = state(a)[key];
    while (b - a > 30000) {
      const mid = (a + b) / 2;
      if (state(mid)[key] === was) a = mid;
      else b = mid;
    }
    return Math.round((a + b) / 2);
  };
  const found = { transit: null, shadow: null, eclipse: null, hidden: null };
  const open = {};
  let prevMs = fromMs;
  let prev = state(fromMs);
  // Already happening: look back for when it began.
  for (const key of Object.keys(found)) {
    if (!prev[key]) continue;
    let back = fromMs;
    while (state(back - STEP_MS)[key] && fromMs - back < 86400000) back -= STEP_MS;
    open[key] = edge(key, back - STEP_MS, back);
  }
  const until = fromMs + days * 86400000;
  for (let ms = fromMs + STEP_MS; ms <= until; ms += STEP_MS) {
    const now = state(ms);
    for (const key of Object.keys(found)) {
      if (found[key] || now[key] === prev[key]) continue;
      if (now[key]) open[key] = edge(key, prevMs, ms);
      else if (open[key] != null) found[key] = { start: open[key], end: edge(key, prevMs, ms) };
    }
    if (Object.values(found).every(Boolean)) break;
    prev = now;
    prevMs = ms;
  }
  return found;
}
