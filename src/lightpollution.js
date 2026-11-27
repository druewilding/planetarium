// Light pollution: the glow that towns and cities put on the night sky.
//
// The lights come from NASA's Black Marble (the VIIRS satellite's cloud-free
// picture of the Earth at night, 2016), as map tiles from NASA GIBS. Around the
// observer they're gathered into bins by compass direction and distance, fine
// tiles close by and coarse ones out to 300 km.
//
// Each bin is a source of light going up, partly straight up (light reflected off
// the ground) and partly low, sideways (light spilling from lamps). Some of it is
// scattered by the air (Rayleigh) and the haze (Mie) towards the observer, and
// dimmed on the way there and back: a single-scattering model in the spirit of
// Garstang's (1986), which is what Falchi's World Atlas of sky brightness (2016)
// is built on. How a single source's light reaches each part of the sky depends
// only on its distance and its direction from where you're looking, so that
// "kernel" is worked out once; each place is then a sum round the compass.
//
// The result is a small table of sky luminance (cd/m²) by azimuth and altitude,
// which the sky shader adds to the natural night glow. Its overall scale, and how
// the tiles' pixel values map to brightness, are fitted so city centres, suburbs,
// towns and the countryside come out near the brightness Falchi's atlas gives.

import { cachedFetch } from "./cachedfetch.js";
import { EARTH_RADIUS_KM } from "./constants.js";
import { decodePNG } from "./png.js";

const TILE_URL = (z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Night_Lights/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
const MAX_LAT = 84;

// Bins for the lights: compass directions, and distances spaced evenly in log.
export const AZ_BINS = 144; // 2.5° each
export const RINGS = 30;
const INNER_KM = 0.3;
export const REACH_KM = 300;
const ringEdge = (k) => INNER_KM * (REACH_KM / INNER_KM) ** (k / RINGS);
// The nearest ring holds everything inside INNER_KM too.
const ringKm = (k) => (k === 0 ? 0.6 * INNER_KM : Math.sqrt(ringEdge(k) * ringEdge(k + 1)));
function ringOf(km) {
  if (km < INNER_KM) return 0;
  const k = Math.floor((RINGS * Math.log(km / INNER_KM)) / Math.log(REACH_KM / INNER_KM));
  return k < RINGS ? k : -1;
}

// The sky table: every bin of azimuth, and altitude rows spaced like the sky
// texture's (finely near the horizon, where distant towns' glow sits).
export const GLOW_AZ = AZ_BINS;
export const GLOW_ROWS = 24;
export const rowAltitude = (j) => ((j + 0.5) / GLOW_ROWS) ** 2 * 90; // degrees

// The air the light crosses (per km, at 550 nm), and how the lamps send it out.
const BETA_R = 0.01356; // Rayleigh scattering at sea level
const H_R = 8;
const BETA_M = 0.05; // a light haze (aerosol optical depth about 0.06)
const MIE_EXT = 1.11;
const H_M = 1.2;
const G = 0.7;
const SPILL = 0.4; // the share sent out low, sideways, rather than reflected upwards
// Light from the ground right round you counts as if spread over a couple of km:
// streets, walls and trees hide most of the lamps nearest you, and the tiles,
// at 600 m a pixel, can't say where in a town you're standing anyway.
const NEAR_SPREAD_KM = 2;

/** How a source sends its light out, per steradian, by elevation (sin of it). */
function emission(sinE) {
  const cosE2 = 1 - sinE * sinE;
  // Upward light, reflected off the ground: Lambertian, ∫ sin ε dΩ = π. Sideways
  // spill, cos⁴ ε, ∫ = 3.351.
  return ((1 - SPILL) * sinE) / Math.PI + (SPILL * cosE2 * cosE2) / 3.351;
}

/** Mean density of an exponential layer (scale height H) along a path from the ground up to height h. */
const meanDensity = (h, H) => (h < 1e-3 ? 1 : (H * (1 - Math.exp(-h / H))) / h);

/**
 * The sky luminance at each altitude row and each azimuth offset (0° to 180°)
 * from a unit source at ring k: [Rayleigh, Mie] pairs.
 */
function ringKernel(k) {
  const r = Math.hypot(ringKm(k), NEAR_SPREAD_KM);
  const half = AZ_BINS / 2;
  const out = new Float32Array((half + 1) * GLOW_ROWS * 2);
  const R = EARTH_RADIUS_KM;
  const g2 = G * G;
  for (let i = 0; i <= half; i++) {
    const dphi = (i / AZ_BINS) * 2 * Math.PI;
    const cphi = Math.cos(dphi);
    const sphi = Math.sin(dphi);
    for (let j = 0; j < GLOW_ROWS; j++) {
      const alt = (rowAltitude(j) * Math.PI) / 180;
      const ca = Math.cos(alt);
      const sa = Math.sin(alt);
      const heightAt = (s) => s * sa + (s * ca) ** 2 / (2 * R);
      // Out to the top of the haze and air that matter, or well past the source.
      let sMax = Math.min(sa > 0.01 ? 40 / sa : 1e9, Math.sqrt(2 * R * 40), REACH_KM + 150);
      sMax = Math.max(sMax, 1);
      // Steps: spaced in log, plus close together where the line of sight passes
      // nearest the source, where nearly all its light is scattered.
      const pts = [0];
      for (let n = 0; n <= 48; n++) pts.push(0.01 * (sMax / 0.01) ** (n / 48));
      if (cphi > 0) {
        const s0 = (r * cphi) / ca;
        const w = Math.max(heightAt(s0), r * Math.abs(sphi), 0.02);
        for (const f of [-8, -4, -2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4, 8]) {
          const s = s0 + f * w;
          if (s > 0 && s < sMax) pts.push(s);
        }
      }
      pts.sort((a, b) => a - b);
      let tauR = 0; // optical depth back to the observer, so far
      let tauM = 0;
      let sumR = 0;
      let sumM = 0;
      for (let n = 1; n < pts.length; n++) {
        const ds = pts[n] - pts[n - 1];
        if (ds <= 0) continue;
        const s = pts[n - 1] + ds / 2;
        const h = heightAt(s);
        const nR = Math.exp(-h / H_R);
        const nM = Math.exp(-h / H_M);
        const oR = tauR + (BETA_R * nR * ds) / 2;
        const oM = tauM + (BETA_M * MIE_EXT * nM * ds) / 2;
        tauR += BETA_R * nR * ds;
        tauM += BETA_M * MIE_EXT * nM * ds;
        // From the source (at distance r, straight ahead when dphi is 0) to this point.
        const px = s * ca * sphi;
        const py = s * ca * cphi - r;
        const D2 = px * px + py * py;
        const rho = Math.sqrt(D2 + h * h);
        const sinE = (h - D2 / (2 * R)) / rho; // its elevation, seen from the source
        if (sinE <= 0) continue;
        const E = emission(sinE) / (rho * rho);
        const tSP = Math.exp(-rho * (BETA_R * meanDensity(h, H_R) + BETA_M * MIE_EXT * meanDensity(h, H_M)));
        // Scattering angle: between the light's way (source → point) and back to the eye.
        const c = -(px * ca * sphi + py * ca * cphi + h * sa) / rho;
        const pR = (3 / (16 * Math.PI)) * (1 + c * c);
        const pM = (1 - g2) / (4 * Math.PI * (1 + g2 - 2 * G * c) ** 1.5);
        const back = E * tSP * ds;
        sumR += back * BETA_R * nR * pR * Math.exp(-oR - oM);
        sumM += back * BETA_M * nM * pM * Math.exp(-oR - oM);
      }
      const o = (i * GLOW_ROWS + j) * 2;
      out[o] = sumR;
      out[o + 1] = sumM;
    }
  }
  return out;
}

let kernel = null;
/** The kernel for every ring (worked out the first time it's needed: about a tenth of a second). */
export function glowKernel() {
  kernel ??= Array.from({ length: RINGS }, (_, k) => ringKernel(k));
  return kernel;
}

/**
 * The sky's glow from a set of sources ([ring][azimuth bin] of brightness × km²):
 * a Float32Array of [Rayleigh, Mie] pairs for each row of altitude and each bin
 * of azimuth (row-major from the horizon up), in the sources' units.
 */
export function skyGlow(sources) {
  const K = glowKernel();
  const half = AZ_BINS / 2;
  const out = new Float32Array(GLOW_ROWS * GLOW_AZ * 2);
  for (let k = 0; k < RINGS; k++) {
    const ker = K[k];
    for (let a = 0; a < AZ_BINS; a++) {
      const P = sources[k * AZ_BINS + a];
      if (!P) continue;
      for (let v = 0; v < GLOW_AZ; v++) {
        let d = (((v - a) % AZ_BINS) + AZ_BINS) % AZ_BINS;
        if (d > half) d = AZ_BINS - d;
        for (let j = 0; j < GLOW_ROWS; j++) {
          const o = (d * GLOW_ROWS + j) * 2;
          const t = (j * GLOW_AZ + v) * 2;
          out[t] += P * ker[o];
          out[t + 1] += P * ker[o + 1];
        }
      }
    }
  }
  return out;
}

// ---- From the tiles' pixels to brightness ----

// The tiles' pixel values are compressed, to fit 8 bits: brightness rises much
// faster than the value. Both of these are fitted (see the comment at the top).
export const GAMMA = 2.6;
export const SCALE = 1.23; // cd/m² of sky per unit the model gives
// The colour of the glow: orange sodium lamps, with more and more white LEDs.
// Scattered by the air (Rayleigh) it's bluer, by haze the lamps' own colour, so
// a city's glow is near grey overhead and orange low down.
const LAMPS = [1.5, 0.92, 0.35];
const RAYLEIGH_TINT = [0.66, 1, 1.95];

const mercX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const mercY = (lat, z) => {
  const p = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * 2 ** z;
};
const latOf = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

const tileCache = new Map(); // "z/x/y" → Promise<Uint8Array | null>
function loadTile(z, x, y) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    if (tileCache.size > 100) tileCache.clear();
    tileCache.set(
      key,
      cachedFetch(TILE_URL(z, x, y))
        .then(async (res) => decodePNG(new Uint8Array(await res.arrayBuffer()), [3]))
        .catch((err) => {
          console.warn(`Night lights tile ${z}/${x}/${y} didn't load`, err);
          return null;
        })
    );
  }
  return tileCache.get(key);
}

// Fine tiles (about 600 m a pixel at the equator) close by, coarse (2.4 km) further out.
const LEVELS = [
  [8, 0, 15],
  [6, 15, REACH_KM],
];

/**
 * The lights around a place, as sources for skyGlow: brightness × km² in each
 * bin of distance and direction. Null if no tiles loaded.
 */
export async function lightsAround(lat, lon, { gamma = GAMMA } = {}) {
  const sources = new Float32Array(RINGS * AZ_BINS);
  const rad = Math.PI / 180;
  const cosLat = Math.cos(lat * rad);
  const sinLat = Math.sin(lat * rad);
  let loaded = 0;
  for (const [z, from, to] of LEVELS) {
    const dLat = to / 111.32;
    const dLon = Math.min(180, to / (111.32 * Math.max(cosLat, 0.01)));
    const tx0 = Math.floor(mercX(lon - dLon, z));
    const tx1 = Math.floor(mercX(lon + dLon, z));
    const ty0 = Math.max(0, Math.floor(mercY(Math.min(MAX_LAT, lat + dLat), z)));
    const ty1 = Math.min(2 ** z - 1, Math.floor(mercY(Math.max(-MAX_LAT, lat - dLat), z)));
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty, loadTile(z, tx, ty)]);
    const pxKm = 40075.017 / (256 * 2 ** z);
    for (const [tx, ty, job] of jobs) {
      const tile = await job;
      if (!tile) continue;
      loaded++;
      for (let py = 0; py < 256; py++) {
        const la = latOf(ty + (py + 0.5) / 256, z);
        const cl = Math.cos(la * rad);
        const sl = Math.sin(la * rad);
        const area = (pxKm * cl) ** 2;
        for (let px = 0; px < 256; px++) {
          const v = tile[py * 256 + px];
          if (!v) continue;
          const lo = ((tx + (px + 0.5) / 256) / 2 ** z) * 360 - 180;
          const dl = (lo - lon) * rad;
          // Distance and bearing, on the sphere.
          const cosC = sinLat * sl + cosLat * cl * Math.cos(dl);
          const km = Math.acos(Math.min(1, cosC)) * EARTH_RADIUS_KM;
          if (km < from || km >= to) continue;
          const k = ringOf(km);
          if (k < 0) continue;
          const bearing = Math.atan2(Math.sin(dl) * cl, cosLat * sl - sinLat * cl * Math.cos(dl));
          const a = Math.round((bearing / (2 * Math.PI)) * AZ_BINS + AZ_BINS) % AZ_BINS;
          sources[k * AZ_BINS + a] += (v / 255) ** gamma * area;
        }
      }
    }
  }
  return loaded ? sources : null;
}

/**
 * The glow over a place, ready to draw: RGB luminance (cd/m²) for each altitude
 * row and azimuth bin, the luminance at the zenith, and where it's brightest low
 * down (azimuth in degrees, and how much brighter than the average there).
 */
export function glowTable(sources) {
  const raw = skyGlow(sources);
  const rgb = new Float32Array(GLOW_ROWS * GLOW_AZ * 3);
  for (let i = 0; i < GLOW_ROWS * GLOW_AZ; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = SCALE * LAMPS[c] * (raw[i * 2] * RAYLEIGH_TINT[c] + raw[i * 2 + 1]);
  }
  const zenith = SCALE * mean(raw, GLOW_ROWS - 1);
  // Low down, about 5° up, where the domes over towns show.
  const low = Math.round(GLOW_ROWS * Math.sqrt(5 / 90) - 0.5);
  let best = 0;
  for (let v = 1; v < GLOW_AZ; v++) if (at(raw, low, v) > at(raw, low, best)) best = v;
  const brightest = { az: (best * 360) / GLOW_AZ, contrast: at(raw, low, best) / (mean(raw, low) || 1) };
  return { rgb, zenith, brightest };
}

const at = (raw, j, v) => raw[(j * GLOW_AZ + v) * 2] + raw[(j * GLOW_AZ + v) * 2 + 1];
function mean(raw, j) {
  let sum = 0;
  for (let v = 0; v < GLOW_AZ; v++) sum += at(raw, j, v);
  return sum / GLOW_AZ;
}

/** The glow (RGB, cd/m²) in a direction ({x, y, z}: y up, −z north, x east), from a table. */
export function glowAt(table, dir) {
  const alt = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const t = Math.sqrt(Math.max(alt, 0) / (Math.PI / 2));
  const y = Math.max(0, Math.min(GLOW_ROWS - 1, t * GLOW_ROWS - 0.5));
  const j = Math.min(GLOW_ROWS - 2, Math.floor(y));
  const fy = y - j;
  const az = Math.atan2(dir.x, -dir.z);
  const x = (((az / (2 * Math.PI)) * GLOW_AZ) % GLOW_AZ) + GLOW_AZ;
  const i = Math.floor(x) % GLOW_AZ;
  const i2 = (i + 1) % GLOW_AZ;
  const fx = x - Math.floor(x);
  const { rgb } = table;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = rgb[(j * GLOW_AZ + i) * 3 + c] * (1 - fx) + rgb[(j * GLOW_AZ + i2) * 3 + c] * fx;
    const b = rgb[((j + 1) * GLOW_AZ + i) * 3 + c] * (1 - fx) + rgb[((j + 1) * GLOW_AZ + i2) * 3 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

// ---- Describing it ----

/** Sky brightness in magnitudes per square arcsecond, from cd/m². */
export const magArcsec2 = (cdm2) => -2.5 * Math.log10(cdm2 / 108000);

// A natural sky, far from any lights, as a sky-quality meter reads it (Falchi's atlas uses this too).
const NATURAL = 108000 * 10 ** (-0.4 * 22.0);
// John Bortle's scale, by the zenith's brightness in mag/arcsec² (the usual reading of it).
const BORTLE = [
  [21.99, "Excellent dark sky: the Milky Way is bright enough to cast shadows"],
  [21.89, "Truly dark sky: the Milky Way is full of detail"],
  [21.69, "Rural sky: some glow from towns on the horizon, but the Milky Way is still detailed"],
  [20.49, "Between country and suburbs: the Milky Way still shows, but not low down"],
  [19.5, "Suburban sky: the Milky Way is faint, and lost towards the horizon"],
  [18.94, "Bright suburban sky: the Milky Way only just shows, overhead"],
  [18.38, "Between suburbs and city: no Milky Way, and the sky glows grey or orange"],
  [17.8, "City sky: only the brighter constellations show"],
  [-Infinity, "Inner-city sky: just the brightest stars and the planets"],
];

/** How dark the sky is, from the glow's luminance at the zenith (cd/m²). */
export function describeSky(zenith) {
  const mag = magArcsec2(NATURAL + zenith);
  const i = BORTLE.findIndex(([limit]) => mag >= limit);
  return { mag, bortle: i + 1, text: BORTLE[i][1], ratio: zenith / NATURAL };
}

/**
 * Keeps the glow for each place it's asked for, working it out (from tiles
 * fetched in the background) the first time. `onReady` is called with each.
 */
export function createLightPollution({ onReady } = {}) {
  const done = new Map(); // key → table | null (failed)
  const jobs = new Set();
  const keyOf = (loc) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

  async function run(key, lat, lon) {
    let table = null;
    try {
      const sources = await lightsAround(lat, lon);
      if (sources) table = glowTable(sources);
    } catch (err) {
      console.warn("Light pollution failed to load", err);
    }
    if (done.size > 20) done.clear();
    done.set(key, table);
    jobs.delete(key);
    onReady?.(table);
  }

  /** The glow over a place if it's ready (else null, and it gets started). */
  function glowFor(loc) {
    const key = keyOf(loc);
    if (done.has(key)) return done.get(key);
    if (!jobs.has(key)) {
      jobs.add(key);
      run(key, loc.lat, loc.lon);
    }
    return null;
  }

  return { glowFor };
}
