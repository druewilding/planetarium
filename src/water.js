// Where the water is: sea, lakes and rivers, so the ground can show them.
//
// The elevation tiles can't tell: Norway's sea is stored as 0 m like a beach,
// and Dutch polders lie deeper than the Øresund. So the water comes from
// OpenStreetMap instead, through OpenFreeMap's free vector tiles (the
// OpenMapTiles layout, whose "water" layer holds the oceans, lakes and
// riverbanks). Each tile's water polygons are filled into a grid of
// land-or-water pixels, by hand rather than through a canvas (Brave adds noise
// to canvas pixels).

import { cachedFetch } from "./cachedfetch.js";
import { mercX, mercY } from "./tiles.js";

const TILEJSON = "https://tiles.openfreemap.org/planet";
// Saved under a fixed address: the real one names this week's build of the map.
const CACHE_URL = (z, x, y) => `https://tiles.openfreemap.org/planet/water/${z}/${x}/${y}.pbf`;
export const RASTER = 512; // pixels across each tile's water grid
// What each pixel of the grid is.
export const LAND = 0;
export const INLAND = 1; // lakes and rivers
export const OCEAN = 2;
export const OPEN_OCEAN = 3; // ocean well away from any coast
const MAX_TILES_PER_LEVEL = 16;
const MAX_ZOOM = 14; // the deepest the tiles go
const SKIP = new Set(["swimming_pool"]);
const OPEN_OCEAN_MARGIN = 300; // metres

let template = null;
/** This week's tile address, from the map's TileJSON. */
function tileTemplate() {
  template ??= fetch(TILEJSON)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} from OpenFreeMap`);
      return res.json();
    })
    .then((json) => json.tiles[0])
    .catch((err) => {
      template = null; // try again next time
      throw err;
    });
  return template;
}

const tileCache = new Map(); // "z/x/y" → Promise<{ mask, coast, pixel } | null>

function loadTile(z, x, y) {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  const key = `${z}/${xx}/${y}`;
  if (!tileCache.has(key)) {
    if (tileCache.size > 200) tileCache.clear();
    tileCache.set(key, fetchTile(z, xx, y));
  }
  return tileCache.get(key);
}

async function fetchTile(z, x, y) {
  try {
    const sources = async () => [(await tileTemplate()).replace("{z}", z).replace("{x}", x).replace("{y}", y)];
    const res = await cachedFetch(CACHE_URL(z, x, y), sources);
    const mask = rasterise(waterPolygons(new Uint8Array(await res.arrayBuffer())));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
    const pixel = (40075016 * Math.cos(lat)) / (2 ** z * RASTER); // metres
    // "Open ocean" is a few hundred metres off any coast (more on coarse tiles,
    // whose coastlines are simplified): there the sea is surely flat, whatever the
    // elevation tiles say (around Iceland they have blobs hundreds of metres high
    // out in the bays).
    const offshore = distanceTo(mask, (k) => k < OCEAN);
    const margin = Math.max(3, Math.ceil(OPEN_OCEAN_MARGIN / pixel));
    for (let i = 0; i < mask.length; i++) if (offshore[i] > margin) mask[i] = OPEN_OCEAN;
    // How far each pixel is from the sea, for keeping shores believable.
    const coast = distanceTo(mask, (k) => k >= OCEAN);
    return { mask, coast, pixel };
  } catch (err) {
    console.warn(`Water tile ${z}/${x}/${y} didn't load`, err);
    return null;
  }
}

// ---- Vector tiles (Mapbox Vector Tile: protocol buffers) ----

/** A minimal protobuf reader: just what vector tiles need. */
function reader(buf, pos = 0, end = buf.length) {
  const r = {
    pos,
    end,
    varint() {
      let v = 0;
      let mul = 1;
      for (;;) {
        const b = buf[r.pos++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) return v;
        mul *= 128;
      }
    },
    /** The next field: [field number, wire type], or null at the end. */
    next() {
      if (r.pos >= r.end) return null;
      const key = r.varint();
      return [Math.floor(key / 8), key & 7];
    },
    bytes() {
      const len = r.varint();
      const start = r.pos;
      r.pos += len;
      return [start, r.pos];
    },
    skip(type) {
      if (type === 0) r.varint();
      else if (type === 1) r.pos += 8;
      else if (type === 2) r.pos = r.bytes()[1];
      else if (type === 5) r.pos += 4;
      else throw new Error(`Unexpected wire type ${type}`);
    },
    packed() {
      const [start, stop] = r.bytes();
      const sub = reader(buf, start, stop);
      const out = [];
      while (sub.pos < stop) out.push(sub.varint());
      return out;
    },
    string() {
      const [start, stop] = r.bytes();
      return new TextDecoder().decode(buf.subarray(start, stop));
    },
  };
  return r;
}

/**
 * The water polygons in a tile: { extent, rings: [[x0, y0, x1, y1, …], …] },
 * each ring marked `.ocean` or not. Rings keep the tile's winding (outer rings
 * one way, holes the other), so filling by the non-zero rule cuts the islands out.
 */
export function waterPolygons(buf) {
  const tile = reader(buf);
  let field;
  while ((field = tile.next())) {
    if (field[0] !== 3 || field[1] !== 2) {
      tile.skip(field[1]);
      continue;
    }
    // A layer: is it "water"?
    const [start, stop] = tile.bytes();
    const layer = reader(buf, start, stop);
    let name = "";
    let extent = 4096;
    const keys = [];
    const values = [];
    const features = [];
    let f;
    while ((f = layer.next())) {
      if (f[0] === 1) name = layer.string();
      else if (f[0] === 2) features.push(layer.bytes());
      else if (f[0] === 3) keys.push(layer.string());
      else if (f[0] === 4) {
        const [vs, ve] = layer.bytes();
        const v = reader(buf, vs, ve);
        let value = null;
        let g;
        while ((g = v.next())) {
          if (g[0] === 1) value = v.string();
          else v.skip(g[1]);
        }
        values.push(value);
      } else if (f[0] === 5) extent = layer.varint();
      else layer.skip(f[1]);
    }
    if (name !== "water") continue;

    const rings = [];
    for (const [fs, fe] of features) {
      const feature = reader(buf, fs, fe);
      let type = 0;
      let tags = [];
      let geometry = [];
      let g;
      while ((g = feature.next())) {
        if (g[0] === 2) tags = feature.packed();
        else if (g[0] === 3) type = feature.varint();
        else if (g[0] === 4) geometry = feature.packed();
        else feature.skip(g[1]);
      }
      if (type !== 3) continue; // polygons only
      let skip = false;
      let ocean = false;
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const k = keys[tags[i]];
        const v = values[tags[i + 1]];
        if ((k === "class" && SKIP.has(v)) || (k === "brunnel" && v === "tunnel")) skip = true;
        if (k === "class" && v === "ocean") ocean = true;
      }
      if (skip) continue;
      // Geometry: MoveTo / LineTo / ClosePath commands with zig-zag deltas.
      let x = 0;
      let y = 0;
      let ring = null;
      for (let i = 0; i < geometry.length;) {
        const cmd = geometry[i] & 7;
        const count = geometry[i] >> 3;
        i++;
        if (cmd === 7) {
          if (ring && ring.length >= 6) {
            ring.ocean = ocean;
            rings.push(ring);
          }
          ring = null;
          continue;
        }
        for (let c = 0; c < count; c++) {
          const dx = geometry[i++];
          const dy = geometry[i++];
          x += (dx >> 1) ^ -(dx & 1);
          y += (dy >> 1) ^ -(dy & 1);
          if (cmd === 1) ring = [x, y];
          else ring?.push(x, y);
        }
      }
    }
    return { extent, rings };
  }
  return { extent: 4096, rings: [] };
}

/** Fill polygons into a RASTER × RASTER grid of LAND, INLAND and OCEAN. */
export function rasterise({ extent, rings }) {
  const mask = new Uint8Array(RASTER * RASTER);
  fill(mask, rings, RASTER / extent, INLAND);
  fill(
    mask,
    rings.filter((ring) => ring.ocean),
    RASTER / extent,
    OCEAN
  );
  return mask;
}

function fill(mask, rings, scale, value) {
  const n = RASTER;
  const xs = Array.from({ length: n }, () => []);
  // Each edge crossing a row's centre adds its x and which way it's heading.
  for (const ring of rings) {
    const len = ring.length;
    for (let i = 0; i < len; i += 2) {
      const x0 = ring[i] * scale;
      const y0 = ring[i + 1] * scale;
      const j = (i + 2) % len;
      const x1 = ring[j] * scale;
      const y1 = ring[j + 1] * scale;
      if (y0 === y1) continue;
      const dir = y1 > y0 ? 1 : -1;
      const r0 = Math.max(0, Math.ceil(Math.min(y0, y1) - 0.5));
      const r1 = Math.min(n - 1, Math.ceil(Math.max(y0, y1) - 0.5) - 1);
      const k = (x1 - x0) / (y1 - y0);
      for (let r = r0; r <= r1; r++) xs[r].push(x0 + (r + 0.5 - y0) * k, dir);
    }
  }
  for (let r = 0; r < n; r++) {
    const row = xs[r];
    if (!row.length) continue;
    const order = [];
    for (let i = 0; i < row.length; i += 2) order.push(i);
    order.sort((a, b) => row[a] - row[b]);
    let wind = 0;
    let from = 0;
    for (const i of order) {
      const before = wind;
      wind += row[i + 1];
      if (before === 0 && wind !== 0) from = row[i];
      else if (before !== 0 && wind === 0) {
        const a = Math.max(0, Math.ceil(from - 0.5));
        const b = Math.min(n, Math.ceil(row[i] - 0.5));
        mask.fill(value, r * n + a, r * n + Math.max(a, b));
      }
    }
  }
}

/**
 * Distance in pixels (up to 255) from each pixel to the nearest one where
 * `target(kind)` holds, in two passes (a chamfer transform).
 */
function distanceTo(mask, target) {
  const n = RASTER;
  const dist = new Uint8Array(n * n);
  for (let i = 0; i < dist.length; i++) dist[i] = target(mask[i]) ? 0 : 255;
  const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 255 : dist[y * n + x]);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (dist[i])
        dist[i] = Math.min(dist[i], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      if (dist[i])
        dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
    }
  }
  return dist;
}

// ---- Rings of tiles around a place ----

/**
 * Load the water tiles reaching `reachKm` around a point, at about
 * `metresPerPixel`, and return a lookup: water(lat, lon) → LAND, INLAND, OCEAN
 * or OPEN_OCEAN.
 */
export async function loadWater(lat, lon, metresPerPixel, reachKm) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let z = Math.round(Math.log2((40075016 * cosLat) / (RASTER * metresPerPixel)));
  z = Math.max(1, Math.min(MAX_ZOOM, z));
  const dLat = reachKm / 111.32;
  const dLon = reachKm / (111.32 * cosLat);
  let tx0, tx1, ty0, ty1;
  for (;;) {
    tx0 = Math.floor(mercX(lon - dLon, z));
    tx1 = Math.floor(mercX(lon + dLon, z));
    ty0 = Math.max(0, Math.floor(mercY(Math.min(85, lat + dLat), z)));
    ty1 = Math.min(2 ** z - 1, Math.floor(mercY(Math.max(-85, lat - dLat), z)));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= MAX_TILES_PER_LEVEL || z <= 1) break;
    z--;
  }
  const nx = tx1 - tx0 + 1;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(loadTile(z, tx, ty));
  const tiles = await Promise.all(jobs);
  const loaded = tiles.filter(Boolean).length;

  let tile = null;
  let index = 0;
  /** Find the pixel (gx, gy) in the ring (into `tile` and `index`); false if outside. */
  function pixel(gx, gy) {
    const tx = Math.floor(gx / RASTER);
    const ty = Math.floor(gy / RASTER);
    if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) return false;
    tile = tiles[(ty - ty0) * nx + (tx - tx0)];
    index = (gy - ty * RASTER) * RASTER + (gx - tx * RASTER);
    return !!tile;
  }
  const find = (la, lo) => pixel(Math.floor(mercX(lo, z) * RASTER), Math.floor(mercY(la, z) * RASTER));

  /**
   * What's at a point: LAND, INLAND, OCEAN or OPEN_OCEAN. The four pixels around
   * it are blended and split halfway, so shores come out as smooth lines rather
   * than stairs of pixels.
   */
  function water(la, lo) {
    const gx = mercX(lo, z) * RASTER - 0.5;
    const gy = mercY(la, z) * RASTER - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    let wet = 0;
    let kind = OPEN_OCEAN;
    for (let k = 0; k < 4; k++) {
      const dx = k & 1;
      const dy = k >> 1;
      const v = pixel(ix + dx, iy + dy) ? tile.mask[index] : LAND;
      if (v === LAND) continue;
      wet += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      kind = Math.min(kind, v); // open ocean only when it's all around
    }
    return wet >= 0.5 ? kind : LAND;
  }
  /** Roughly how far a point is from the sea, in metres (Infinity if far or unknown). */
  const fromSea = (la, lo) => (find(la, lo) && tile.coast[index] < 255 ? tile.coast[index] * tile.pixel : Infinity);
  return { water, fromSea, loaded, total: tiles.length };
}
