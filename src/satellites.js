// Moons of other planets: Mars' two little ones; Jupiter's four big ones, found by
// Galileo in 1610, with little Amalthea and Thebe close in and Himalia and Elara far
// out; Saturn's six brightest, Titan the biggest; Uranus' five big ones; Neptune's
// Triton; and Pluto's Charon.
//
// Nothing here assumes you're on the Earth. A moon is placed by where it is from
// its planet, added to where the planet is from you, so the same sums work from
// the ground, from up above the Earth, or (later) standing on Mars or on Jupiter
// itself. Shadows work the same way: from any point, how much of the Sun's disc
// a body hides. That one rule gives a moon going dark in its planet's shadow, a
// moon's black shadow on the planet's clouds, and (later) the Sun eclipsed by Io,
// seen from Jupiter.

import { Vector3 } from "three";

import { A, altAz, AU_KM, D2R, planetPole, PLANETS, SUN_RADIUS_KM, sunVisibleFraction } from "./astro.js";
import { ELARA, HIMALIA } from "./moon-states.js";

// H: brightness (absolute magnitude) at 1 AU from the Sun and from you; albedo: how
// much sunlight it sends back; color: as a point, and its surface crossing its
// planet; reachKm: the furthest it gets from its planet.
//
// Jupiter's big four are placed by astronomy-engine's own theory of them (good to a
// few hundred km). Most others follow an average orbit (`orbit`, below), fitted to
// JPL's ephemerides for 1950–2100; Himalia and Elara, far out, from JPL's own
// positions (`states`, below).
const JUPITER_MOONS_DEFS = [
  {
    id: "Io",
    name: "Io",
    key: "io",
    radiusKm: 1821.6,
    H: -1.68,
    albedo: 0.63,
    periodDays: 1.769,
    reachKm: 424500,
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
    reachKm: 678500,
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
    reachKm: 1073500,
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
    reachKm: 1899000,
    color: [0.72, 0.66, 0.58],
  },
].map((m) => ({ ...m, parent: "Jupiter" }));

// An average orbit: an ellipse, turning slowly, in the plane the moon's orbit
// wobbles around (its Laplace plane, whose pole is at `pole`: [RA, Dec] in degrees).
// a: size (km), e: how oval; i: tilt to that plane, node: where it crosses it, peri:
// where it comes closest, lon: where it is along it (mean longitude), all in degrees
// at 1 January 2000, 12:00 TT, measured from where the plane crosses the Earth's
// equator. n: how fast it goes round (degrees a day), lonAccel: how much that
// changes (degrees a century²: Phobos is spiralling in); nodeRate and periRate:
// how fast they turn (degrees a year). libration: [degrees, period in days, phase]
// for each slow swing back and forth, where a moon's pull on another one adds up
// orbit after orbit (Tethys with Mimas, Enceladus with Dione). Miranda, pulled
// about by its bigger neighbours, needs several: only its 12½-year swing and a
// couple of smaller ones are real; the slow ones together just follow its drift
// over these 150 years, and soon go wrong outside them.
//
// Fitted by least squares to JPL Horizons (MAR099 for Mars, SAT441 for Saturn,
// URA184 for Uranus, NEP098 for Neptune, PLU060 for Pluto), every 4 days from 1950
// to 2100. fitKm: the furthest out it was then. The pole is the planet's equator's
// (theirs are Laplace planes too), turned so the moon goes round anticlockwise:
// Triton's goes round backwards, and Uranus spins (and its moons go round) on its side.
const ORBIT_MOONS_DEFS = [
  {
    id: "Amalthea",
    name: "Amalthea",
    parent: "Jupiter",
    radiusKm: 83.5,
    H: 7.4,
    albedo: 0.09,
    color: [0.9, 0.6, 0.45],
    fitKm: 22,
    orbit: {
      pole: [268.057, 64.495],
      a: 181365.1,
      e: 0.003313,
      i: 0.37559,
      node: 282.8718,
      nodeRate: -914.9,
      peri: 102.9697,
      periRate: 918.0277,
      lon: 53.57183,
      n: 722.631721674,
      lonAccel: 0.010373,
    },
  },
  {
    id: "Thebe",
    name: "Thebe",
    parent: "Jupiter",
    radiusKm: 49.3,
    H: 9.0,
    albedo: 0.047,
    color: [0.75, 0.65, 0.58],
    fitKm: 52,
    orbit: {
      pole: [268.057, 64.495],
      a: 221887.8,
      e: 0.017603,
      i: 1.06677,
      node: 340.3871,
      nodeRate: -451.5646,
      peri: 7.0079,
      periRate: 452.3801,
      lon: 189.08534,
      n: 533.700272757,
      lonAccel: -0.005672,
    },
  },
  {
    id: "Phobos",
    name: "Phobos",
    parent: "Mars",
    radiusKm: 11.08,
    H: 11.8,
    phaseCoef: 0.03,
    albedo: 0.071,
    color: [0.66, 0.62, 0.58],
    fitKm: 84,
    orbit: {
      pole: [317.7, 52.9],
      a: 9377.9,
      e: 0.015121,
      i: 1.07478,
      node: 169.1373,
      nodeRate: -159.1719,
      peri: 25.5968,
      periRate: 158.9508,
      lon: 215.33632,
      n: 1128.84477643,
      lonAccel: 11.406,
    },
  },
  {
    id: "Deimos",
    name: "Deimos",
    parent: "Mars",
    radiusKm: 6.2,
    H: 12.89,
    phaseCoef: 0.03,
    albedo: 0.068,
    color: [0.7, 0.66, 0.6],
    fitKm: 516,
    orbit: {
      pole: [316.6, 53.5],
      a: 23454.2,
      e: 0.000269,
      i: 1.7899,
      node: 54.4379,
      nodeRate: -6.60004,
      peri: 249.0579,
      periRate: 6.5637,
      lon: 259.8866,
      n: 285.161929442,
      lonAccel: -3.1888,
    },
  },
  {
    id: "Enceladus",
    name: "Enceladus",
    parent: "Saturn",
    radiusKm: 252.1,
    H: 2.1,
    albedo: 1.375,
    color: [0.96, 0.98, 1.0],
    fitKm: 1249,
    orbit: {
      pole: [40.6, 83.5],
      a: 238017.7,
      e: 0.004741,
      i: 0.03647,
      node: 183.7546,
      nodeRate: 0.06242,
      peri: 171.5386,
      periRate: 123.4412,
      lon: 182.21844,
      n: 262.731893254,
      lonAccel: 0.26818,
      libration: [[0.261785, 4034.267, 72.38034]],
    },
  },
  {
    id: "Tethys",
    name: "Tethys",
    parent: "Saturn",
    radiusKm: 531.1,
    H: 0.7,
    albedo: 1.229,
    color: [0.95, 0.95, 0.95],
    fitKm: 467,
    orbit: {
      pole: [40.6, 83.5],
      a: 294664.6,
      e: 0,
      i: 1.0913,
      node: 259.8253,
      nodeRate: -72.26446,
      peri: 0,
      periRate: 0,
      lon: 188.39378,
      n: 190.697912507,
      lonAccel: -0.10952,
      libration: [[2.093931, 25757.721, 320.52028]],
    },
  },
  {
    id: "Dione",
    name: "Dione",
    parent: "Saturn",
    radiusKm: 561.4,
    H: 0.8,
    albedo: 0.998,
    color: [0.94, 0.93, 0.92],
    fitKm: 611,
    orbit: {
      pole: [40.6, 83.5],
      a: 377405.1,
      e: 0.002197,
      i: 0.04,
      node: 190.0233,
      nodeRate: 0.07888,
      peri: 214.6788,
      periRate: 30.7716,
      lon: 176.88824,
      n: 131.53492865,
      lonAccel: 0.10541,
    },
  },
  {
    id: "Rhea",
    name: "Rhea",
    parent: "Saturn",
    radiusKm: 763.5,
    H: 0.1,
    albedo: 0.949,
    color: [0.93, 0.92, 0.9],
    fitKm: 707,
    orbit: {
      pole: [40.6, 83.5],
      a: 527068.5,
      e: 0.000966,
      i: 0.33101,
      node: 351.1465,
      nodeRate: -10.04589,
      peri: 204.1515,
      periRate: 0.5146,
      lon: 52.16527,
      n: 79.6900458444,
      lonAccel: -0.013253,
    },
  },
  {
    id: "Titan",
    name: "Titan",
    parent: "Saturn",
    radiusKm: 2574.7,
    H: -1.28,
    albedo: 0.22,
    color: [1.0, 0.76, 0.45],
    fitKm: 970,
    orbit: {
      pole: [36.4, 84.0],
      a: 1221847.3,
      e: 0.028735,
      i: 0.34674,
      node: 23.5258,
      nodeRate: -0.47019,
      peri: 208.2187,
      periRate: 0.5164,
      lon: 11.72464,
      n: 22.5769763614,
      lonAccel: 0.00047486,
    },
  },
  {
    id: "Iapetus",
    name: "Iapetus",
    parent: "Saturn",
    radiusKm: 734.3,
    // One side is snow-bright, the side it leads with as dark as coal: brightest seen
    // from behind (west of Saturn), about this much fainter seen from the front.
    H: 0.8,
    twoTone: 1.6,
    albedo: 0.3,
    color: [0.86, 0.8, 0.72],
    fitKm: 12816,
    orbit: {
      pole: [288.7, 78.9],
      a: 3560677.0,
      e: 0.028467,
      i: 7.58335,
      node: 74.7922,
      nodeRate: -0.11408,
      peri: 351.3689,
      periRate: 0.0973,
      lon: 200.23547,
      n: 4.53794832445,
      lonAccel: -0.081113,
    },
  },
  {
    id: "Miranda",
    name: "Miranda",
    parent: "Uranus",
    radiusKm: 235.8,
    H: 3.5,
    albedo: 0.32,
    color: [0.8, 0.8, 0.8],
    fitKm: 143,
    orbit: {
      pole: [77.311, 15.175],
      a: 129848.3,
      e: 0.001359,
      i: 4.4271,
      node: 100.8611,
      nodeRate: -20.23971,
      peri: 255.9125,
      periRate: 20.0262,
      lon: 315.5025,
      n: 254.677707812,
      lonAccel: 699.63,
      libration: [
        [356.771032, 79993.435, 14.28258],
        [1.435992, 4583.499, 318.02506],
        [256.647526, 45624.355, 170.69429],
        [0.17668, 2291.448, 275.70626],
        [215.914553, 62440695.735, 270.3358],
        [148.416973, 37573.287, 312.06219],
        [24.647838, 29442.424, 167.47177],
        [168.288144, 75066.541, 79.87244],
        [52.620188, 32792.139, 48.13555],
        [0.438555, 20333.331, 260.92039],
      ],
    },
  },
  {
    id: "Ariel",
    name: "Ariel",
    parent: "Uranus",
    radiusKm: 578.9,
    H: 1.45,
    albedo: 0.53,
    color: [0.88, 0.88, 0.88],
    fitKm: 946,
    orbit: {
      pole: [77.311, 15.175],
      a: 190920.7,
      e: 0.001451,
      i: 0.01196,
      node: 272.8889,
      nodeRate: -20.0478,
      peri: 83.4278,
      periRate: 6.2408,
      lon: 203.14692,
      n: 142.835656004,
      lonAccel: -0.51634,
    },
  },
  {
    id: "Umbriel",
    name: "Umbriel",
    parent: "Uranus",
    radiusKm: 584.7,
    H: 2.1,
    albedo: 0.26,
    color: [0.7, 0.7, 0.7],
    fitKm: 862,
    orbit: {
      pole: [77.311, 15.175],
      a: 265979.8,
      e: 0.003759,
      i: 0.07645,
      node: 196.2704,
      nodeRate: -2.77472,
      peri: 350.8437,
      periRate: 2.8892,
      lon: 251.2408,
      n: 86.8688727688,
      lonAccel: 0.058559,
    },
  },
  {
    id: "Titania",
    name: "Titania",
    parent: "Uranus",
    radiusKm: 788.9,
    H: 1.02,
    albedo: 0.35,
    color: [0.85, 0.82, 0.8],
    fitKm: 3125,
    orbit: {
      pole: [77.311, 15.175],
      a: 436279.6,
      e: 0.001144,
      i: 0.10306,
      node: 13.1547,
      nodeRate: 0.34841,
      peri: 229.318,
      periRate: 1.3697,
      lon: 281.55605,
      n: 41.3514138154,
      lonAccel: 0.072092,
    },
  },
  {
    id: "Oberon",
    name: "Oberon",
    parent: "Uranus",
    radiusKm: 761.4,
    H: 1.23,
    albedo: 0.31,
    color: [0.82, 0.78, 0.76],
    fitKm: 2717,
    orbit: {
      pole: [77.311, 15.175],
      a: 583443.7,
      e: 0.001392,
      i: 0.17165,
      node: 37.8148,
      nodeRate: -0.58125,
      peri: 194.6144,
      periRate: 0.5892,
      lon: 352.54475,
      n: 26.7394803355,
      lonAccel: 0.1362,
    },
  },
  {
    id: "Triton",
    name: "Triton",
    parent: "Neptune",
    radiusKm: 1353.4,
    H: -1.2,
    albedo: 0.76,
    color: [1.0, 0.93, 0.9],
    fitKm: 177,
    orbit: {
      pole: [119.36, -43.46],
      a: 354760.2,
      e: 0.000127,
      i: 23.16905,
      node: 182.1385,
      nodeRate: -0.52383,
      peri: 79.2591,
      periRate: 0.4077,
      lon: 60.72761,
      n: 61.2572603114,
      lonAccel: 0.0087549,
    },
  },
  {
    id: "Charon",
    name: "Charon",
    parent: "Pluto",
    radiusKm: 606.0,
    H: 1.3,
    albedo: 0.41,
    color: [0.8, 0.78, 0.76],
    fitKm: 1,
    orbit: {
      pole: [132.993, -6.163],
      a: 19595.8,
      e: 0.000161,
      i: 0.08342,
      node: 9.9763,
      nodeRate: 0.03255,
      peri: 155.3436,
      periRate: 0.0009,
      lon: 304.12378,
      n: 56.3625303407,
      lonAccel: 0.0031221,
    },
  },
].map((m) => ({ ...m, periodDays: 360 / m.orbit.n, reachKm: m.orbit.a * (1 + m.orbit.e) * 1.02 }));

// Far out from Jupiter, the Sun pulls Himalia and Elara about so much that no
// average orbit fits them for long. So these keep JPL's own positions and speeds,
// every 512 days from 1950 to 2100 (see moon-states.js), and go from the ones either
// side of any moment by working out, a day or two at a time, how Jupiter and the Sun
// pull them: within a few hundred km of where JPL has them.
const STATE_MOONS_DEFS = [
  {
    id: "Himalia",
    name: "Himalia",
    parent: "Jupiter",
    radiusKm: 70,
    H: 7.9,
    albedo: 0.057,
    color: [0.78, 0.74, 0.7],
    fitKm: 350, // (against JPL every 8 days, 1950–2100)
    periodDays: 250.6,
    states: HIMALIA,
  },
  {
    id: "Elara",
    name: "Elara",
    parent: "Jupiter",
    radiusKm: 43,
    H: 9.6,
    albedo: 0.046,
    color: [0.76, 0.72, 0.68],
    fitKm: 360, // (the same)
    periodDays: 259.6,
    states: ELARA,
  },
].map((m) => ({
  ...m,
  reachKm: Math.max(...m.states.states.map(([x, y, z]) => Math.hypot(x, y, z))) * 1.05,
}));

/**
 * Every moon there is here, in the order of their planets in PLANETS and then
 * outwards from each, each { id, name, parent, … }.
 */
export const SATELLITES = PLANETS.flatMap((p) =>
  [...JUPITER_MOONS_DEFS, ...ORBIT_MOONS_DEFS, ...STATE_MOONS_DEFS]
    .filter((m) => m.parent === p.id)
    .sort((a, b) => a.reachKm - b.reachKm)
);
/** Jupiter's four big moons, found by Galileo. */
export const JUPITER_MOONS = SATELLITES.filter((m) => m.key);
/** The planets that have moons here, and theirs. */
export const MOONS_OF = Object.fromEntries(
  [...new Set(SATELLITES.map((m) => m.parent))].map((p) => [p, SATELLITES.filter((m) => m.parent === p)])
);
/** The furthest any of a planet's moons here gets from it (km). */
export const MOON_REACH_KM = Object.fromEntries(
  Object.entries(MOONS_OF).map(([p, moons]) => [p, Math.max(...moons.map((m) => m.reachKm))])
);

const LIGHT_DAYS_PER_AU = AU_KM / 299792.458 / 86400;

// Each Laplace plane's own axes (J2000 equator): x where it crosses the equator, z its pole.
const planeAxes = new Map();
function axesOf([ra, dec]) {
  const key = `${ra},${dec}`;
  let axes = planeAxes.get(key);
  if (!axes) {
    const z = new Vector3(
      Math.cos(dec * D2R) * Math.cos(ra * D2R),
      Math.cos(dec * D2R) * Math.sin(ra * D2R),
      Math.sin(dec * D2R)
    );
    const x = new Vector3(0, 0, 1).cross(z).normalize();
    axes = { x, y: z.clone().cross(x), z };
    planeAxes.set(key, axes);
  }
  return axes;
}

/** Where a moon on an average `orbit` is from its planet `days` after J2000: km, J2000 equator. */
export function orbitPosition(orbit, days) {
  const years = days / 365.25;
  const T = days / 36525;
  let lon = orbit.lon + orbit.n * days + orbit.lonAccel * T * T;
  for (const [amp, period, phase] of orbit.libration ?? []) {
    lon += amp * Math.sin(((2 * Math.PI) / period) * days + phase * D2R);
  }
  const e = orbit.e;
  const peri = (orbit.peri + orbit.periRate * years) * D2R;
  const node = (orbit.node + orbit.nodeRate * years) * D2R;
  const i = orbit.i * D2R;
  const M = lon * D2R - peri;
  let E = M;
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = orbit.a * (Math.cos(E) - e);
  const yp = orbit.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = peri - node;
  const [cw, sw, cO, sO, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(node), Math.sin(node), Math.cos(i), Math.sin(i)];
  const X = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const Y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const Z = sw * si * xp + cw * si * yp;
  const ax = axesOf(orbit.pole);
  return new Vector3().addScaledVector(ax.x, X).addScaledVector(ax.y, Y).addScaledVector(ax.z, Z);
}

const KM_TO_AU = 1 / AU_KM;
const NUDGE_DAYS = 0.001;

/**
 * Where a moon is from its planet's centre at `time`, and which way it's going:
 * { pos (AU), vel (AU/day) }, J2000 equator. (`jupiter`: Jupiter's big moons at
 * that time, if they've been worked out already.)
 */
function offsetOf(m, time, jupiter = null) {
  if (m.key) {
    const st = (jupiter ?? A.JupiterMoons(time))[m.key];
    return { pos: new Vector3(st.x, st.y, st.z), vel: new Vector3(st.vx, st.vy, st.vz) };
  }
  if (m.states) {
    const { r, v } = stateAt(m, time.tt);
    return { pos: r.clone().multiplyScalar(KM_TO_AU), vel: v.clone().multiplyScalar(KM_TO_AU * DAY_S) };
  }
  const pos = orbitPosition(m.orbit, time.tt).multiplyScalar(KM_TO_AU);
  const ahead = orbitPosition(m.orbit, time.tt + NUDGE_DAYS).multiplyScalar(KM_TO_AU);
  return { pos, vel: ahead.sub(pos).divideScalar(NUDGE_DAYS) };
}

/** Where each of a planet's moons is (see offsetOf), keyed by id. */
function offsetsOf(parent, time) {
  const jupiter = parent === "Jupiter" ? A.JupiterMoons(time) : null;
  return Object.fromEntries(MOONS_OF[parent].map((m) => [m.id, offsetOf(m, time, jupiter)]));
}

const DAY_S = 86400;
const GM_JUPITER = 126712767; // km³/s², Jupiter and its big moons together
const GM_SUN = 132712440018;
const STEP_DAYS = 2;
const lastState = new Map(); // id → (JPL's state number → { t, r, v }): where it was last asked for, from each

/** The Sun from Jupiter, `days` after J2000 (TT), km. */
function sunFromJupiter(days) {
  const v = A.HelioVector(A.Body.Jupiter, A.MakeTime(days));
  return new Vector3(-v.x, -v.y, -v.z).multiplyScalar(AU_KM);
}

/** The pull on a moon at `r` from Jupiter (km): Jupiter's, and the Sun's difference from its pull on Jupiter. km/s². */
function pull(r, sun) {
  const d = sun.clone().sub(r);
  const a = r.clone().multiplyScalar(-GM_JUPITER / r.length() ** 3);
  a.addScaledVector(d, GM_SUN / d.length() ** 3);
  return a.addScaledVector(sun, -GM_SUN / sun.length() ** 3);
}

/**
 * Where a moon kept as `states` is, `days` after J2000 (TT): { r (km), v (km/s) }
 * from Jupiter, J2000 equator. Worked out step by step (Runge–Kutta, about 2 days a
 * step) from JPL's on either side, forward from the one before and back from the
 * one after, and blended between them as it goes from one to the other: so there's
 * no jump halfway, and each is only trusted near where it came from.
 */
export function stateAt(def, days) {
  const { from, step, states } = def.states;
  const x = (days - from) / step;
  const k = Math.min(states.length - 2, Math.max(0, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - k));
  if (f === 0) return fromState(def, k, days);
  if (f === 1) return fromState(def, k + 1, days);
  const a = fromState(def, k, days);
  const b = fromState(def, k + 1, days);
  return { r: a.r.clone().lerp(b.r, f), v: a.v.clone().lerp(b.v, f) };
}

/**
 * Where a moon is at `days`, worked out from JPL's state number `k`. Going on from
 * where it was last asked for from that same one, if that's nearer (so the clock
 * running on doesn't step it all the way again each frame).
 */
function fromState(def, k, days) {
  const { from, step, states } = def.states;
  const row = states[k];
  let start = { t: from + k * step, r: new Vector3(row[0], row[1], row[2]), v: new Vector3(row[3], row[4], row[5]) };
  let last = lastState.get(def.id);
  if (!last) lastState.set(def.id, (last = new Map()));
  const before = last.get(k);
  if (before && Math.abs(days - before.t) < Math.abs(days - start.t)) start = before;
  const n = Math.ceil(Math.abs(days - start.t) / STEP_DAYS);
  let { r, v } = start;
  if (n > 0) {
    const h = (days - start.t) / n;
    const hs = h * DAY_S;
    let t = start.t;
    let sun0 = sunFromJupiter(t);
    for (let i = 0; i < n; i++) {
      const sunMid = sunFromJupiter(t + h / 2);
      const sun1 = sunFromJupiter(t + h);
      const a1 = pull(r, sun0);
      const r2 = r.clone().addScaledVector(v, hs / 2);
      const v2 = v.clone().addScaledVector(a1, hs / 2);
      const a2 = pull(r2, sunMid);
      const r3 = r.clone().addScaledVector(v2, hs / 2);
      const v3 = v.clone().addScaledVector(a2, hs / 2);
      const a3 = pull(r3, sunMid);
      const r4 = r.clone().addScaledVector(v3, hs);
      const v4 = v.clone().addScaledVector(a3, hs);
      const a4 = pull(r4, sun1);
      r = r
        .clone()
        .addScaledVector(v, hs / 6)
        .addScaledVector(v2, hs / 3)
        .addScaledVector(v3, hs / 3)
        .addScaledVector(v4, hs / 6);
      v = v
        .clone()
        .addScaledVector(a1, hs / 6)
        .addScaledVector(a2, hs / 3)
        .addScaledVector(a3, hs / 3)
        .addScaledVector(a4, hs / 6);
      t += h;
      sun0 = sun1;
    }
  }
  const state = { t: days, r, v };
  // (Only the two in use: the clock moves on from one pair to the next.)
  for (const key of last.keys()) if (Math.abs(key - k) > 1) last.delete(key);
  last.set(k, state);
  return state;
}

// How strongly each planet (and its moons) pulls, km³/s²: for drawing orbits.
const GM = {
  Mars: 42828.37,
  Jupiter: GM_JUPITER,
  Saturn: 37940585,
  Uranus: 5794556,
  Neptune: 6836527,
  Pluto: 975.5, // with Charon: they go round each other
};

/**
 * The orbit a moon is on right now, from where it is (`offset`, from its planet)
 * and how it's moving (`velocity`, per day), both in AU in any one frame: `n`
 * points round the ellipse, in that frame, from its planet. Null if it's not on
 * one (as it wouldn't be, for a moment, if the numbers were off).
 */
export function orbitPath(parent, offset, velocity, n = 128) {
  const mu = GM[parent];
  const r = offset.clone().multiplyScalar(AU_KM);
  const v = velocity.clone().multiplyScalar(AU_KM / DAY_S);
  const h = r.clone().cross(v);
  const rl = r.length();
  const a = 1 / (2 / rl - v.lengthSq() / mu);
  const eVec = v
    .clone()
    .cross(h)
    .divideScalar(mu)
    .addScaledVector(r, -1 / rl);
  const e = eVec.length();
  if (!(a > 0) || e >= 0.95 || h.lengthSq() === 0) return null;
  const P = e > 1e-6 ? eVec.clone().divideScalar(e) : r.clone().divideScalar(rl);
  const Q = h.clone().normalize().cross(P);
  const b = a * Math.sqrt(1 - e * e);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const E = (i / n) * 2 * Math.PI;
    pts.push(
      new Vector3().addScaledVector(P, (a * (Math.cos(E) - e)) / AU_KM).addScaledVector(Q, (b * Math.sin(E)) / AU_KM)
    );
  }
  return pts;
}

/**
 * How many magnitudes fainter a moon `m` looks for being so near its bright
 * `planet` (both as in a sky), lost in its glare: nothing for one well clear of it,
 * up to 8 (gone) for one far fainter right beside it. Through a telescope a moon
 * this much fainter than its planet can just be seen this close to it: 13½
 * magnitudes at 20″ (Phobos by Mars, near one of Mars's oppositions), 16 at an
 * arcminute (Amalthea, which only big telescopes show), 5.2 more for every tenfold
 * further out.
 */
export function glare(m, planet) {
  const arcsec = m.trueDir.angleTo(planet.trueDir) * (180 / Math.PI) * 3600;
  const limit = 6.7 + 5.2 * Math.log10(Math.max(arcsec, 0.1));
  const x = Math.min(1, Math.max(0, (m.mag - planet.mag - (limit - 1)) / 2));
  return 8 * x * x * (3 - 2 * x);
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
 * sunlight reaching it, out of the planet's shadow; entering: heading into the
 * shadow rather than out of it (given its `velocity`, in the same frame) }.
 */
export function satelliteGeometry(offset, radiusKm, planet, sun, pole, def, velocity = null) {
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
  // Getting nearer the shadow's middle line, or further from it?
  let entering = false;
  if (velocity) {
    const across = offset.clone().addScaledVector(sunward, -offset.dot(sunward));
    entering = across.dot(velocity.clone().addScaledVector(sunward, -velocity.dot(sunward))) < 0;
  }
  return { behind: !nearer && onDisc, inFront: nearer && onDisc, shadowOnPlanet, light, entering };
}

const cache = new WeakMap();
const PLANET_DEF = Object.fromEntries(PLANETS.map((p) => [p.id, p]));

/**
 * A planet's moons as seen in `sky`, like its planets: { id, name, parent, def,
 * vecAU, offsetAU, velocity, dist, trueDir, dir, alt, az, angularRadius, mag, behind,
 * inFront, shadowOnPlanet, light, entering }. offsetAU is where the moon is from its
 * planet (world frame, AU), and velocity how it's moving (AU a day). Worked out once per sky and planet, and only when asked for.
 */
export function moonsOf(sky, parent) {
  let bySky = cache.get(sky);
  if (!bySky) cache.set(sky, (bySky = new Map()));
  let moons = bySky.get(parent);
  if (moons) return moons;
  const planet = sky.planets.find((p) => p.id === parent);
  // We see the planet as it was when its light left it, so its moons too.
  const offsets = offsetsOf(parent, sky.time.AddDays(-planet.dist * LIGHT_DAYS_PER_AU));
  const pole = planetPole(parent, sky);
  moons = MOONS_OF[parent].map((m) => {
    const offsetAU = offsets[m.id].pos.applyMatrix4(sky.eqjToWorld);
    const velocity = offsets[m.id].vel.applyMatrix4(sky.eqjToWorld);
    const vecAU = planet.vecAU.clone().add(offsetAU);
    const dist = vecAU.length();
    const trueDir = vecAU.clone().divideScalar(dist);
    // Bent by the air just as the planet is (they're only minutes of arc apart).
    const dir = trueDir.clone().sub(planet.trueDir).add(planet.dir).normalize();
    const toSun = sky.sun.vecAU.clone().sub(vecAU);
    const geometry = satelliteGeometry(
      offsetAU,
      m.radiusKm,
      planet.vecAU,
      sky.sun.vecAU,
      pole,
      PLANET_DEF[parent],
      velocity
    );
    // Fainter lit from the side (for the dark little moons of Mars, seen from far round).
    const phase = m.phaseCoef ? m.phaseCoef * toSun.angleTo(trueDir.clone().negate()) * (180 / Math.PI) : 0;
    // Iapetus: dark seen from in front (coming towards you), bright from behind.
    const side = m.twoTone ? m.twoTone * 0.5 * (1 - velocity.clone().normalize().dot(trueDir)) : 0;
    return {
      id: m.id,
      name: m.name,
      parent,
      def: m,
      color: m.color,
      vecAU,
      offsetAU,
      velocity,
      dist,
      trueDir,
      dir,
      ...altAz(dir),
      angularRadius: Math.asin(m.radiusKm / (dist * AU_KM)),
      mag:
        m.H + 5 * Math.log10(toSun.length() * dist) + phase + side - 2.5 * Math.log10(Math.max(geometry.light, 1e-5)),
      ...geometry,
    };
  });
  bySky.set(parent, moons);
  return moons;
}

/** Jupiter's four big moons, as seen in `sky` (see moonsOf). */
export const jupiterMoons = (sky) => moonsOf(sky, "Jupiter");

/** Seen from the Earth's centre: the planet and the Sun (J2000 equator, AU, with light time). */
const fromEarth = (parent) => (time) => ({
  planet: vec(A.GeoVector(A.Body[parent], time, true)),
  sun: vec(A.GeoVector(A.Body.Sun, time, true)),
});
const vec = (v) => new Vector3(v.x, v.y, v.z);

const STEP_MS = 10 * 60000;
const DAY_MS = 86400000;
export const MOON_EVENT_KINDS = ["transit", "shadow", "eclipse", "hidden"];

/**
 * Every time between `fromMs` and `untilMs` that a moon crosses in front of
 * its planet (`transit`), casts its shadow on it (`shadow`), is in its shadow
 * (`eclipse`, from when it's half faded) or hides behind it (`hidden`), as you'd
 * see them: { transit: [{ start, end }, …], … } in ms. (One already going on at
 * `fromMs` is left out: when it began isn't known.)
 * `seenFrom(time)` gives { planet, sun } from you (J2000 equator, AU); the
 * Earth's centre is near enough for anywhere on or above the Earth.
 */
export function moonEventsBetween(id, fromMs, untilMs, { seenFrom } = {}) {
  const def = SATELLITES.find((m) => m.id === id);
  const { radiusKm, parent, periodDays } = def;
  // (Small enough steps not to miss Phobos' quick crossings, a few minutes long.)
  const step = Math.min(STEP_MS, (periodDays * DAY_MS) / 100);
  seenFrom ??= fromEarth(parent);
  const state = (ms) => {
    const time = A.MakeTime(new Date(ms));
    const { planet, sun } = seenFrom(time);
    const offset = offsetOf(def, time.AddDays(-planet.length() * LIGHT_DAYS_PER_AU)).pos;
    const n = A.RotationAxis(A.Body[parent], time).north;
    const g = satelliteGeometry(offset, radiusKm, planet, sun, vec(n), PLANET_DEF[parent]);
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
  const found = Object.fromEntries(MOON_EVENT_KINDS.map((k) => [k, []]));
  const open = {};
  let prevMs = fromMs;
  let prev = state(fromMs);
  for (let ms = fromMs + step; ms <= untilMs; ms += step) {
    const now = state(ms);
    for (const key of MOON_EVENT_KINDS) {
      if (now[key] === prev[key]) continue;
      if (now[key]) open[key] = edge(key, prevMs, ms);
      else if (open[key] != null) {
        found[key].push({ start: open[key], end: edge(key, prevMs, ms) });
        open[key] = null;
      }
    }
    prev = now;
    prevMs = ms;
  }
  return found;
}

/**
 * From a list of events (see moonEventsBetween), the next of each kind: going on
 * at `ms`, or starting within `days`. { transit: { start, end } or null, … }.
 */
export function nextMoonEvents(all, ms, days = 20) {
  return Object.fromEntries(
    MOON_EVENT_KINDS.map((k) => [k, all[k].find((e) => e.end > ms && e.start < ms + days * DAY_MS) ?? null])
  );
}

/**
 * The next times a moon crosses its planet, and so on (see moonEventsBetween): each
 * { start, end } (start may be before `fromMs` if it's happening now), or null
 * if not within `days`. (None lasts anywhere near a day, so looking back a day
 * finds when one going on now began.)
 */
export function searchMoonEvents(id, fromMs, { days = 20, seenFrom } = {}) {
  const all = moonEventsBetween(id, fromMs - DAY_MS, fromMs + days * DAY_MS, { seenFrom });
  return nextMoonEvents(all, fromMs, days);
}
