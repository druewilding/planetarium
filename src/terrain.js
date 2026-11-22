// Real terrain on the horizon: hills and mountains that hide the Sun after it
// has technically risen.
//
// Elevations come from the free Terrain Tiles on AWS (Terrarium PNGs, the same
// global DEM Mapzen built: SRTM, EU-DEM, Kartverket's 10 m model for Norway,
// GMTED and others). Around the observer we load three rings of tiles, fine
// nearby and coarse far away, then walk outwards along 720 compass directions
// and keep the steepest angle up to the land. That "horizon profile" is all the
// rest of the app needs: the ground shader draws it, labels and picking hide
// what's behind it, and the info panel works out when the Sun clears it.
//
// Distances bend with the Earth's curve, eased by terrestrial refraction (light
// near the ground curves down a little, k ≈ 0.13), so far peaks sink as they do.

import { A } from "./astro.js";

const TILE_URL = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
const TILE_CACHE = "terrain-tiles-v1";
const EARTH_R = 6371000;
const REFRACTION_K = 0.13;
const R_EFF = EARTH_R / (1 - REFRACTION_K);
const EYE_HEIGHT = 2; // metres above the ground
export const SAMPLES = 720; // compass directions, every half degree
const MAX_LAT = 84; // web-mercator tiles stop at ±85°

// Finer tiles near you, coarser further out: [target metres per pixel, reach in km].
const LEVELS = [
  [25, 6],
  [100, 30],
  [450, 150],
];
const MAX_TILES_PER_LEVEL = 25;

const tileCache = new Map(); // "z/x/y" → Promise<Float32Array | null>

function loadTile(z, x, y) {
  const n = 2 ** z;
  const key = `${z}/${((x % n) + n) % n}/${y}`;
  if (!tileCache.has(key)) {
    if (tileCache.size > 300) tileCache.clear();
    tileCache.set(key, fetchTile(z, ((x % n) + n) % n, y));
  }
  return tileCache.get(key);
}

/**
 * Fetch a tile, keeping a copy in the browser's Cache Storage. The tiles never
 * change, and the server sends no caching headers, so the ordinary HTTP cache
 * would only be guessing.
 */
async function cachedFetch(url) {
  let cache = null;
  try {
    cache = await caches.open(TILE_CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    // No Cache Storage (private window, or not a secure page): just fetch.
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  cache?.put(url, res.clone()).catch(() => {});
  return res;
}

async function fetchTile(z, x, y) {
  try {
    const res = await cachedFetch(TILE_URL(z, x, y));
    const px = await decodePNG(new Uint8Array(await res.arrayBuffer()));
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) {
      // Terrarium: height = R·256 + G + B/256 − 32768 metres. Sea floor counts as sea level.
      h[i] = Math.max(0, px[i * 3] * 256 + px[i * 3 + 1] + px[i * 3 + 2] / 256 - 32768);
    }
    return h;
  } catch (err) {
    console.warn(`Terrain tile ${z}/${x}/${y} didn't load`, err);
    return null;
  }
}

/**
 * Decode an 8-bit RGB(A) PNG into packed RGB bytes. Done by hand rather than via
 * a canvas, because browsers may colour-manage canvas pixels and some (Brave)
 * add noise to them on purpose; here one step in red is 256 m of mountain.
 */
async function decodePNG(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      channels = { 2: 3, 6: 4 }[colour];
      if (depth !== 8 || !channels || interlace) throw new Error("Unexpected PNG format");
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const stride = width * channels;
  const out = new Uint8Array(width * height * 3);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = raw[row];
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      let v = raw[row + 1 + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const c = i >= channels ? prev[i - channels] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 3] = cur[x * channels];
      out[(y * width + x) * 3 + 1] = cur[x * channels + 1];
      out[(y * width + x) * 3 + 2] = cur[x * channels + 2];
    }
    [prev, cur] = [cur, prev];
  }
  return out;
}

const mercX = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
function mercY(lat, z) {
  const p = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * 256 * 2 ** z;
}

/** Load one ring of tiles and return a sampler for it. */
async function loadLevel(lat, lon, metresPerPixel, reachKm) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let z = Math.round(Math.log2((40075016 * cosLat) / (256 * metresPerPixel)));
  z = Math.max(1, Math.min(15, z));
  const dLat = reachKm / 111.32;
  const dLon = reachKm / (111.32 * cosLat);
  let tx0, tx1, ty0, ty1;
  for (;;) {
    tx0 = Math.floor(mercX(lon - dLon, z) / 256);
    tx1 = Math.floor(mercX(lon + dLon, z) / 256);
    ty0 = Math.floor(mercY(Math.min(MAX_LAT + 1, lat + dLat), z) / 256);
    ty1 = Math.floor(mercY(Math.max(-MAX_LAT - 1, lat - dLat), z) / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= MAX_TILES_PER_LEVEL || z <= 1) break;
    z--;
  }
  const nx = tx1 - tx0 + 1;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(loadTile(z, tx, ty));
  const tiles = await Promise.all(jobs);
  const W = 256 * 2 ** z;

  const pixel = (ix, iy) => {
    const t = tiles[((iy >> 8) - ty0) * nx + ((ix >> 8) - tx0)];
    return t ? t[(iy & 255) * 256 + (ix & 255)] : 0;
  };
  /** Height in metres at a point (bilinear), with lon unwrapped around the observer. */
  function height(la, lo) {
    const gx = mercX(lo, z) - 0.5;
    const gy = mercY(la, z) - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    if (ix < tx0 * 256 || iy < ty0 * 256 || ix + 1 >= (tx1 + 1) * 256 || iy + 1 >= (ty1 + 1) * 256) return 0;
    const a = pixel(ix, iy);
    const b = pixel(ix + 1, iy);
    const c = pixel(ix, iy + 1);
    const d = pixel(ix + 1, iy + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  return { height, reach: reachKm * 1000, loaded: tiles.filter(Boolean).length, total: tiles.length, W };
}

/**
 * Work out the horizon profile around a point: for each half degree of azimuth,
 * the apparent altitude of the skyline (degrees) and how far away it is (km).
 * Returns null if no elevation data could be loaded.
 */
export async function computeProfile(lat, lon) {
  if (Math.abs(lat) > MAX_LAT) return null;
  const levels = await Promise.all(LEVELS.map(([m, km]) => loadLevel(lat, lon, m, km)));
  if (levels.every((l) => l.loaded === 0)) return null;

  const ground = levels[0].height(lat, lon);
  const h0 = ground + EYE_HEIGHT;
  const altitude = new Float32Array(SAMPLES);
  const distance = new Float32Array(SAMPLES);
  const latR = (lat * Math.PI) / 180;
  const maxD = levels[levels.length - 1].reach;

  // Distances to sample, shared by every direction: steady steps nearby, then
  // growing with distance (a 1% step at 50 km is still under 0.01° of skyline).
  const steps = [];
  for (let d = 100; d <= maxD; d += Math.max(20, d * 0.008)) steps.push(d);
  const levelFor = steps.map((d) => levels.find((l) => d <= l.reach) ?? levels[levels.length - 1]);

  for (let i = 0; i < SAMPLES; i++) {
    // Yield now and then so the page stays responsive.
    if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
    const az = (i / SAMPLES) * 2 * Math.PI;
    const north = Math.cos(az);
    const east = Math.sin(az);
    let best = -Infinity;
    let bestD = maxD;
    for (let s = 0; s < steps.length; s++) {
      const d = steps[s];
      const la = latR + (d * north) / EARTH_R;
      const lo = lon + ((d * east) / (EARTH_R * Math.cos(la))) * (180 / Math.PI);
      const h = levelFor[s].height((la * 180) / Math.PI, lo);
      const t = (h - h0 - (d * d) / (2 * R_EFF)) / d;
      if (t > best) {
        best = t;
        bestD = d;
      }
    }
    altitude[i] = (Math.atan(best) * 180) / Math.PI;
    distance[i] = bestD / 1000;
  }
  return { lat, lon, ground, altitude, distance, max: Math.max(...altitude) };
}

/** Skyline altitude (degrees) towards an azimuth (degrees), interpolated. */
export function skylineAt(profile, azDeg) {
  const x = ((((azDeg % 360) + 360) % 360) / 360) * SAMPLES;
  const i = Math.floor(x) % SAMPLES;
  const f = x - Math.floor(x);
  return profile.altitude[i] + (profile.altitude[(i + 1) % SAMPLES] - profile.altitude[i]) * f;
}

/**
 * Keeps one profile for wherever you're standing. `profileFor(loc)` returns it
 * once ready (null until then) and starts loading it if needed.
 */
export function createTerrain({ onReady } = {}) {
  const done = new Map(); // key → profile | null (failed)
  let busy = null;
  let queued = null;

  const keyOf = (loc) => `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;

  async function run(loc) {
    const key = keyOf(loc);
    busy = key;
    let profile = null;
    try {
      profile = await computeProfile(loc.lat, loc.lon);
    } catch (err) {
      console.warn("Terrain failed to load", err);
    }
    if (done.size > 20) done.clear();
    done.set(key, profile);
    busy = null;
    if (profile) profile.key = key;
    onReady?.(profile);
    if (queued) {
      const next = queued;
      queued = null;
      if (!done.has(keyOf(next))) run(next);
    }
  }

  function profileFor(loc) {
    const key = keyOf(loc);
    if (done.has(key)) return done.get(key);
    if (busy === key) return null;
    if (busy) queued = { lat: loc.lat, lon: loc.lon };
    else run(loc);
    return null;
  }

  return { profileFor };
}

/**
 * When a body is clear of the skyline during one local day: a list of
 * [startMs, endMs] spans, plus how many minutes the land hides it while it's
 * above the flat horizon. `radiusDeg` counts the first glint of the upper limb.
 */
export function spansAboveSkyline(body, obs, startMs, profile, radiusDeg = 0) {
  const STEP = 2 * 60000;
  const N = (24 * 3600000) / STEP;
  const sample = (ms) => {
    const d = new Date(ms);
    const eq = A.Equator(body, d, obs, true, true);
    const hor = A.Horizon(d, obs, eq.ra, eq.dec, "normal");
    const top = hor.altitude + radiusDeg;
    return { flat: top > 0, clear: top - skylineAt(profile, hor.azimuth) };
  };
  const spans = [];
  let hiddenSteps = 0;
  let upSteps = 0;
  let prev = sample(startMs);
  let open = prev.clear > 0 ? startMs : null;
  for (let i = 1; i <= N; i++) {
    const ms = startMs + i * STEP;
    const cur = sample(ms);
    if (cur.flat) upSteps++;
    if (cur.flat && cur.clear <= 0) hiddenSteps++;
    if (cur.clear > 0 !== prev.clear > 0) {
      // Narrow the crossing down to a few seconds.
      let lo = ms - STEP;
      let hi = ms;
      for (let k = 0; k < 9; k++) {
        const mid = (lo + hi) / 2;
        if (sample(mid).clear > 0 === prev.clear > 0) lo = mid;
        else hi = mid;
      }
      if (cur.clear > 0) open = hi;
      else {
        spans.push([open, hi]);
        open = null;
      }
    }
    prev = cur;
  }
  if (open != null) spans.push([open, startMs + N * STEP]);
  return { spans, hiddenMinutes: hiddenSteps * 2, upMinutes: upSteps * 2, endMs: startMs + N * STEP };
}
