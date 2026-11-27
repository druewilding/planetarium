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
//
// On the same walk it notes which of the ground in view is water (see water.js),
// so the ground shader can draw the sea, lakes and rivers.

import { A } from "./astro.js";
import { cachedFetch } from "./cachedfetch.js";
import { EARTH_RADIUS_KM } from "./constants.js";
import { landNamesNear } from "./landnames.js";
import { decodePNG } from "./png.js";
import { mercX, mercY } from "./tiles.js";
import { LAND, loadWater, OCEAN, OPEN_OCEAN } from "./water.js";

const TILE_URL = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
// Names for the land come from planetarium-labels (see landnames.js), within this far.
const FEATURE_RADIUS_KM = 50;
const EARTH_R = EARTH_RADIUS_KM * 1000;
const REFRACTION_K = 0.13;
const R_EFF = EARTH_R / (1 - REFRACTION_K);
const EYE_HEIGHT = 2; // metres above the ground
export const SAMPLES = 720; // compass directions, every half degree
const MAX_LAT = 84; // web-mercator tiles stop at ±85°

// Water on the ground, for each compass direction, by how far below (or above) the
// horizon you look: rows spaced finely near the horizon, where the land is
// squeezed into a sliver, and coarsely further down.
export const WATER_ROWS = 512;
export const WATER_DETAIL = 4;
const NEAR_KM = 30; // where the water tiles are fine enough to tidy shores with // directions for water per skyline sample
export const WATER_SCALE = 0.05; // degrees: rows are spaced evenly in asinh(altitude / this)
export const WATER_SPAN = Math.asinh(90 / WATER_SCALE);
const WATER_ROW_ALT = Array.from(
  { length: WATER_ROWS },
  (_, r) => WATER_SCALE * Math.sinh((((r + 0.5) / WATER_ROWS) * 2 - 1) * WATER_SPAN)
);

// Finer tiles near you, coarser further out: [target metres per pixel, reach in km].
const LEVELS = [
  [25, 6],
  [100, 30],
  [450, 150],
];
const MAX_TILES_PER_LEVEL = 25;
// Water needs finer rings than the hills: shores close by are seen large.
const WATER_LEVELS = [
  [4, 1.5],
  [12, 6],
  [50, 30],
  [200, 150],
];

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

/** Load one ring of tiles and return a sampler for it. */
async function loadLevel(lat, lon, metresPerPixel, reachKm) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let z = Math.round(Math.log2((40075016 * cosLat) / (256 * metresPerPixel)));
  z = Math.max(1, Math.min(15, z));
  const dLat = reachKm / 111.32;
  const dLon = reachKm / (111.32 * cosLat);
  let tx0, tx1, ty0, ty1;
  for (;;) {
    tx0 = Math.floor(mercX(lon - dLon, z));
    tx1 = Math.floor(mercX(lon + dLon, z));
    ty0 = Math.floor(mercY(Math.min(MAX_LAT + 1, lat + dLat), z));
    ty1 = Math.floor(mercY(Math.max(-MAX_LAT - 1, lat - dLat), z));
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
    const gx = mercX(lo, z) * 256 - 0.5;
    const gy = mercY(la, z) * 256 - 0.5;
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
export async function computeProfile(lat, lon, { groundHint = null, eye = null, fast = false } = {}) {
  if (Math.abs(lat) > MAX_LAT) return null;
  const [levels, waters] = await Promise.all([
    Promise.all(LEVELS.map(([m, km]) => loadLevel(lat, lon, m, km))),
    Promise.all(WATER_LEVELS.map(([m, km]) => loadWater(lat, lon, m, km).catch(() => null))),
  ]);
  if (levels.every((l) => l.loaded === 0)) return null;
  const hasWater = waters.some((w) => w?.loaded > 0);

  // Standing on a summit: the elevation model rounds peaks off, so trust its mapped height.
  const dem = levels[0].height(lat, lon);
  const ground = groundHint != null && Math.abs(groundHint - dem) < 300 ? Math.max(dem, groundHint) : dem;
  // `eye`: an absolute height to look from (in flight), kept clear of the ground.
  const h0 = eye != null ? Math.max(eye, ground + 20) : ground + EYE_HEIGHT;
  const altitude = new Float32Array(SAMPLES);
  const distance = new Float32Array(SAMPLES);
  const latR = (lat * Math.PI) / 180;
  const maxD = levels[levels.length - 1].reach;

  // Distances to sample, shared by every direction: steady steps nearby, then
  // growing with distance (a 1% step at 50 km is still under 0.01° of skyline).
  const steps = [];
  // (`fast`, for the frames of a flight, samples more sparsely.)
  for (let d = 100; d <= maxD; d += fast ? Math.max(50, d * 0.02) : Math.max(20, d * 0.008)) steps.push(d);
  const levelFor = steps.map((d) => levels.find((l) => d <= l.reach) ?? levels[levels.length - 1]);
  const waterFor = steps.map(
    (d) =>
      waters[
        Math.max(
          0,
          WATER_LEVELS.findIndex(([, km]) => d <= km * 1000)
        )
      ]
  );
  // Water gets finer directions than the skyline, so shores running away from
  // you aren't stepped (not in a flight's frames, which only flash by).
  const cols = hasWater && !fast ? SAMPLES * WATER_DETAIL : SAMPLES;
  const per = cols / SAMPLES;
  const water = hasWater ? new Uint8Array(cols * WATER_ROWS) : null;
  const visAlt = new Float32Array(steps.length);
  const visFrom = new Float32Array(steps.length);
  const visD = new Float32Array(steps.length);
  const visStep = new Uint16Array(steps.length);
  const visWater = new Uint8Array(steps.length);
  const eyeAbove = h0 - ground;

  // The ground at a step along a direction: its height, and what the map says is there.
  // Out in open ocean the sea is flat, whatever the elevation tiles say.
  let kind = LAND;
  const heightAt = (s, d, north, east) => {
    const la = latR + (d * north) / EARTH_R;
    const lo = lon + ((d * east) / (EARTH_R * Math.cos(la))) * (180 / Math.PI);
    const laDeg = (la * 180) / Math.PI;
    const w = waterFor[s];
    kind = w?.water(laDeg, lo) ?? LAND;
    if (kind === OPEN_OCEAN) return 0;
    const h = levelFor[s].height(laDeg, lo);
    if (!w || d > NEAR_KM * 1000 || h <= 2) return h;
    // Nearby the map is sharp enough to trust: where it says sea, it's sea level.
    return kind === OCEAN ? 2 : h > 30 ? tidyShore(w, levelFor[s], laDeg, lo, h) : h;
  };
  // The elevation tiles have the odd wall of nonsense along a shore (Reykjavík's
  // stands 230 m high, on land 85 m high). A real cliff has land behind it about
  // as high as its top; a rim standing well above the land behind it is brought
  // down to that land.
  const tidyShore = (w, level, la, lo, h) => {
    const sea = w.fromSea(la, lo);
    if (sea > 150) return h;
    const dLat = 200 / 111320;
    const dLon = dLat / Math.cos((la * Math.PI) / 180);
    let behind = -Infinity;
    for (const [a, b] of [
      [dLat, 0],
      [-dLat, 0],
      [0, dLon],
      [0, -dLon],
    ]) {
      if (w.fromSea(la + a, lo + b) > sea + 100) behind = Math.max(behind, level.height(la + a, lo + b));
    }
    // Narrow land (a pier, a spit, a small island) has nothing behind it: there,
    // it can't rise out of the water steeper than about 76°.
    if (behind === -Infinity) return Math.min(h, 5 + 4 * sea);
    return h > behind + 40 ? behind : h;
  };

  /** What the water map says at a distance along a direction. */
  const waterKindAt = (d, north, east) => {
    const w =
      waters[
        Math.max(
          0,
          WATER_LEVELS.findIndex(([, km]) => d <= km * 1000)
        )
      ];
    const la = latR + (d * north) / EARTH_R;
    const lo = lon + ((d * east) / (EARTH_R * Math.cos(la))) * (180 / Math.PI);
    return w ? w.water((la * 180) / Math.PI, lo) : LAND;
  };

  for (let j = 0; j < cols; j++) {
    // Yield now and then so the page stays responsive.
    if (j % (60 * per) === 0) await new Promise((r) => setTimeout(r, 0));
    const az = (j / cols) * 2 * Math.PI;
    const north = Math.cos(az);
    const east = Math.sin(az);
    let best = -Infinity;
    let bestD = maxD;
    let seen = 0; // ground in view along this direction, nearest first
    let level = 0; // the height of the water in view just before
    for (let s = 0; s < steps.length; s++) {
      const d = steps[s];
      const h = heightAt(s, d, north, east);
      const t = (h - h0 - (d * d) / (2 * R_EFF)) / d;
      if (t > best) {
        best = t;
        bestD = d;
        if (water) {
          // Water is flat, so from here it fills only the sliver of view that a
          // level surface would: never the face of a slope (where the map's coast
          // and the elevations don't quite line up), and never above eye level.
          // Water seen just before is the same surface, whatever small bumps the
          // elevations put in between; ground rising well above it is the shore.
          const before = seen > 0 && visWater[seen - 1] > 0;
          const wet = h < h0 && kind !== LAND && !(before && h > level + 3);
          const dp = s ? steps[s - 1] : d;
          const flat = (Math.atan((h - h0 - (dp * dp) / (2 * R_EFF)) / dp) * 180) / Math.PI;
          if (wet) level = before ? Math.min(level, h) : h;
          visAlt[seen] = (Math.atan(t) * 180) / Math.PI;
          visD[seen] = d;
          visStep[seen] = s;
          visFrom[seen] = wet && !before ? flat : -90;
          visWater[seen++] = wet ? 255 : 0;
        }
      }
    }
    if (j % per === 0) {
      altitude[j / per] = (Math.atan(best) * 180) / Math.PI;
      distance[j / per] = bestD / 1000;
    }

    if (water) {
      // For each row, the nearest ground in view at that angle. Closer than the
      // first step, the ground is taken as flat.
      let k = 0;
      for (let r = 0; r < WATER_ROWS; r++) {
        const a = WATER_ROW_ALT[r];
        let w;
        if (a < visAlt[0] || !seen) {
          const d = eyeAbove / Math.tan((Math.max(0.01, -a) * Math.PI) / 180);
          if (d < steps[0] || !seen) {
            heightAt(0, Math.min(d, steps[0]), north, east);
            w = kind !== LAND ? 255 : 0;
          } else w = visWater[0];
        } else {
          while (k < seen - 1 && visAlt[k] < a) k++;
          // A lone wet point is most likely a beach the map and elevations disagree on.
          const wetAt = (m) => visWater[m] > 0 && (visWater[m - 1] > 0 || visWater[m + 1] > 0);
          const here = wetAt(k);
          if (k > 0 && here && !wetAt(k - 1) && visStep[k] === visStep[k - 1] + 1 && a >= visFrom[k]) {
            // Land down to water between two neighbouring samples: ask the map at
            // this row's distance. (Not water up to land: the rows between are the
            // rising shore. Nor across hidden ground: those rows see the far sample.)
            const f = (a - visAlt[k - 1]) / (visAlt[k] - visAlt[k - 1]);
            const d = visD[k - 1] + (visD[k] - visD[k - 1]) * f;
            w = waterKindAt(d, north, east) !== LAND ? 255 : 0;
          } else w = here && a >= visFrom[k] ? 255 : 0;
        }
        water[r * cols + j] = w;
      }
    }
  }
  /**
   * Where a summit appears from here (degrees), or null if it's hidden behind
   * nearer land or out of range. `ele` is the mapped height, if known.
   */
  function summit(plat, plon, ele, { above = 0, strict = false } = {}) {
    const midLat = ((plat + lat) / 2) * (Math.PI / 180);
    const dN = (plat - lat) * (Math.PI / 180) * EARTH_R;
    const dE = (plon - lon) * (Math.PI / 180) * EARTH_R * Math.cos(midLat);
    const d = Math.hypot(dN, dE);
    if (d < 300 || d > maxD) return null;
    // The elevation model smooths summits off, so trust a mapped height near it.
    const dem = (levels.find((l) => d <= l.reach) ?? levels[levels.length - 1]).height(plat, plon);
    const h = (Number.isFinite(ele) && Math.abs(ele - dem) < 300 ? Math.max(ele, dem) : dem) + above;
    const t = (h - h0 - (d * d) / (2 * R_EFF)) / d;
    // Line of sight: is any land in between steeper? The mountain's own front slopes
    // (the last 30% of the way) may rise a little above a summit set back on a
    // plateau: from town you see Fløya's edge, not its top, but it's still Fløya.
    const north = dN / d;
    const east = dE / d;
    const stop = d - Math.max(200, d * 0.03);
    for (let s = 0; s < steps.length && steps[s] < stop; s++) {
      const ds = steps[s];
      const hs = heightAt(s, ds, north, east);
      const allowed = strict || ds < d * 0.7 ? 0.003 : 0.035; // tan of about 0.2° or 2°
      if ((hs - h0 - (ds * ds) / (2 * R_EFF)) / ds > t + allowed) return null;
    }
    const az = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
    return { az, alt: (Math.atan(t) * 180) / Math.PI, distance: d / 1000, height: h };
  }

  return { lat, lon, ground, altitude, distance, water, waterCols: cols, max: Math.max(...altitude), summit };
}

/** Water rows with fewer directions: every `cols / to`-th column. */
export function thinWater(water, cols, to) {
  if (cols === to) return water;
  const out = new Uint8Array(to * WATER_ROWS);
  const per = cols / to;
  for (let r = 0; r < WATER_ROWS; r++) for (let i = 0; i < to; i++) out[r * to + i] = water[r * cols + i * per];
  return out;
}

/** A peak's everyday name: "Tromsdalstinden - Sálašoaivi" → "Tromsdalstinden". */
const NAME_SPLIT = / [-–/] /;
const shortName = (name) => name.split(NAME_SPLIT)[0].trim();

/** What a thing on the map is: its kind, the group that colours its label, and how tall it stands. */
function classify(tags) {
  const height = parseFloat(tags.height);
  if (tags.natural === "peak" || tags.natural === "volcano") return { kind: "peak", group: "peak" };
  // A place is one point on the map but spreads up its hillsides: look for its higher houses.
  const spread = { city: 60, town: 40, village: 25 }[tags.place];
  if (spread) return { kind: tags.place, group: "place", above: spread };
  const tall = Number.isFinite(height) ? height : null;
  if (tags.man_made === "lighthouse") return { kind: "lighthouse", group: "landmark", above: tall ?? 15, tall };
  if (tags.man_made === "observatory") return { kind: "observatory", group: "landmark", above: tall ?? 10, tall };
  if (tags.man_made === "tower" || tags.man_made === "mast") {
    // Plenty of small phone masts and church towers: keep the named and the tall.
    if (tags["tower:type"] === "bell_tower") return null;
    if (!tags.name && !(tall >= 40)) return null;
    return { kind: tags.man_made, group: "landmark", above: tall ?? 30, tall };
  }
  return null;
}

const UNNAMED = { lighthouse: "Lighthouse", observatory: "Observatory", tower: "Tower", mast: "Mast" };

/**
 * Things from OpenStreetMap that can be seen from where the profile was made
 * (named peaks, towns, lighthouses, observatories, towers and masts), each with
 * where it appears in the sky. Empty if there's nothing to name; null if the
 * names couldn't be loaded (so it can try again later).
 */
export async function visibleFeatures(profile) {
  let elements;
  try {
    elements = await landNamesNear(profile.lat, profile.lon, FEATURE_RADIUS_KM);
  } catch (err) {
    console.warn("Couldn't load names for the land", err);
    return null;
  }
  const features = [];
  for (let i = 0; i < elements.length; i++) {
    if (i % 100 === 99) await new Promise((r) => setTimeout(r, 0));
    const e = elements[i];
    const tags = e.tags ?? {};
    const type = classify(tags);
    if (!type) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const ele = parseFloat(tags.ele);
    const peak = type.group === "peak";
    const seen = profile.summit(lat, lon, peak ? ele : NaN, { above: type.above ?? 0, strict: !peak });
    if (!seen) continue;
    let alt = seen.alt;
    if (peak) {
      // Sit the label on the drawn ridge when the summit is (nearly) the skyline there.
      const sky = skylineAt(profile, seen.az);
      const onSkyline = seen.alt > sky - 2;
      // Little knolls only clutter the view, unless they're what you see against the sky.
      if (seen.height < 150 && !onSkyline) continue;
      if (onSkyline) alt = Math.max(seen.alt, sky);
    }
    const fullName = tags.name ?? "";
    const population = parseInt(tags.population, 10);
    features.push({
      id: `${e.type}${e.id}`,
      ...type,
      named: !!fullName,
      name: fullName ? shortName(fullName) : UNNAMED[type.kind],
      otherNames: fullName.split(NAME_SPLIT).slice(1).join(", "),
      lat,
      lon,
      ele: peak && Number.isFinite(ele) ? ele : null,
      population: Number.isFinite(population) ? population : null,
      ...seen,
      alt,
    });
  }
  return features;
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
  const jobs = new Map(); // key → Promise of a profile being worked out
  let chain = Promise.resolve(); // one at a time
  let wanted = null; // the latest place asked for while busy

  const keyOf = (loc) => `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;

  async function run(loc) {
    const key = keyOf(loc);
    let profile = null;
    try {
      profile = await computeProfile(loc.lat, loc.lon, { groundHint: loc.ele });
    } catch (err) {
      console.warn("Terrain failed to load", err);
    }
    if (done.size > 20) done.clear();
    done.set(key, profile);
    jobs.delete(key);
    if (profile) {
      profile.key = key;
      // Names come from a slower server; the skyline doesn't wait for them.
      profile.features = [];
      loadFeatures(profile);
    }
    onReady?.(profile);
    if (!jobs.size && wanted && !done.has(keyOf(wanted))) {
      const next = wanted;
      wanted = null;
      ensure(next);
    }
    return profile;
  }

  /** Names for the land around a profile; if the servers are busy, try again a little later. */
  async function loadFeatures(profile, attempt = 0) {
    const features = await visibleFeatures(profile).catch(() => null);
    if (features) profile.features = features;
    else if (attempt < 2) setTimeout(() => loadFeatures(profile, attempt + 1), [30, 120][attempt] * 1000);
  }

  /** The profile for a place, worked out if need be. */
  function ensure(loc) {
    const key = keyOf(loc);
    if (done.has(key)) return Promise.resolve(done.get(key));
    if (!jobs.has(key)) {
      const place = { lat: loc.lat, lon: loc.lon, ele: loc.ele };
      const job = chain.then(() => run(place));
      chain = job.catch(() => {});
      jobs.set(key, job);
    }
    return jobs.get(key);
  }

  /** The profile if it's ready (else null, and it gets started). Only the latest place queues. */
  function profileFor(loc) {
    const key = keyOf(loc);
    if (done.has(key)) return done.get(key);
    if (!jobs.has(key)) {
      if (jobs.size) wanted = { lat: loc.lat, lon: loc.lon, ele: loc.ele };
      else ensure(loc);
    }
    return null;
  }

  return { profileFor, ensure };
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
