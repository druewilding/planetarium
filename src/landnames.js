// Names for the land, from planetarium-labels: peaks, places and landmarks from
// OpenStreetMap, built into static files, one per 1° square, published on
// GitHub Pages (www.druewilding.com/planetarium-labels/). See that project's
// README for the format.
//
// index.json says when the files were built and which squares have labels. It's
// fetched once a visit, with the last copy kept for offline. Squares are kept in
// the same cache as the hills, under the build date, so a new build is fetched
// afresh and visited places still have their names offline.

import { cachedFetch } from "./cachedfetch.js";

const KM_PER_DEG = 111.2;
const CACHE_NAME = "landnames-v1";

// Always the published files, which any site may fetch: the same in development.
const BASE = "https://www.druewilding.com/planetarium-labels/";
const base = () => new URL(BASE);

/** The square a place is in, named by its south-west corner: "59_10", "-34_-71". */
export const squareKey = (lat, lon) => `${Math.floor(lat)}_${Math.floor(lon)}`;

/** The squares that reach within `radiusKm` of a place (by their bounding box). */
export function squaresAround(lat, lon, radiusKm) {
  const dLat = radiusKm / KM_PER_DEG;
  const dLon = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const keys = [];
  for (let y = Math.floor(Math.max(lat - dLat, -90)); y <= Math.floor(Math.min(lat + dLat, 89.999)); y++) {
    for (let x = Math.floor(lon - dLon); x <= Math.floor(lon + dLon); x++) {
      keys.push(`${y}_${((((x + 180) % 360) + 360) % 360) - 180}`); // wrapped at the date line
    }
  }
  return [...new Set(keys)];
}

/** Rough distance in km, plenty for a 50 km circle. */
function distanceKm(lat1, lon1, lat2, lon2) {
  const x = (((((lon2 - lon1 + 540) % 360) - 180) * Math.PI) / 180) * Math.cos(((lat1 + lat2) * Math.PI) / 360);
  const y = ((lat2 - lat1) * Math.PI) / 180;
  return Math.hypot(x, y) * (KM_PER_DEG * (180 / Math.PI));
}

const TYPES = { n: "node", w: "way", r: "relation" };
const TAG = {
  peak: ["natural", "ele"],
  volcano: ["natural", "ele"],
  city: ["place", "population"],
  town: ["place", "population"],
  village: ["place", "population"],
  lighthouse: ["man_made", "height"],
  observatory: ["man_made", "height"],
  tower: ["man_made", "height"],
  mast: ["man_made", "height"],
};

/** A row from a square, as the OpenStreetMap element Overpass would have given. */
export function toElement([id, kind, lat, lon, name, number]) {
  const [key, numberKey] = TAG[kind];
  const tags = { [key]: kind };
  if (name) tags.name = name;
  if (number != null) tags[numberKey] = String(number);
  return { type: TYPES[id[0]], id: Number(id.slice(1)), lat, lon, tags };
}

let index = null;

/** index.json: from the network once a visit, else the copy kept last time. */
function loadIndex() {
  index ??= (async () => {
    const url = new URL("index.json", base()).href;
    const cache = await caches.open(CACHE_NAME).catch(() => null);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache?.put(url, res.clone()).catch(() => {});
      return await res.json();
    } catch (err) {
      const kept = await cache?.match(url);
      if (kept) return kept.json();
      throw err;
    }
  })();
  index.catch(() => (index = null)); // try again next time
  return index;
}

/**
 * The labelled things within `radiusKm` of a place, as OpenStreetMap elements, or
 * null if the labels don't cover it yet (or can't be reached).
 */
export async function landNamesNear(lat, lon, radiusKm) {
  let built, squares;
  try {
    ({ built, squares } = await loadIndex());
  } catch {
    return null;
  }
  if (!squares[squareKey(lat, lon)]) return null;
  const wanted = squaresAround(lat, lon, radiusKm).filter((key) => squares[key]);
  const rows = await Promise.all(
    wanted.map(async (key) => {
      const url = new URL(`squares/${key}.json?built=${built}`, base()).href;
      return (await cachedFetch(url)).json();
    })
  );
  return rows
    .flat()
    .filter(([, , rLat, rLon]) => distanceKm(lat, lon, rLat, rLon) <= radiusKm)
    .map(toElement);
}
