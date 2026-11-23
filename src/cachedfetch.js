// Fetch, keeping a copy in the browser's Cache Storage: elevation tiles, water
// tiles and names for the land are all saved there. The land hardly changes, and
// the servers send no caching headers (or short ones), so the ordinary HTTP cache
// would only be guessing.

const CACHE_NAME = "terrain-v1";

/** Fetch `url` from the cache, else from each of `sources` in turn, and keep it. */
export async function cachedFetch(url, sources = [url], { tries = 2, check = null } = {}) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    // No Cache Storage (private window, or not a secure page): just fetch.
  }
  // `sources` can be a function, for when working out the address costs a request.
  if (typeof sources === "function") sources = await sources();
  let error = null;
  // By default each source gets a second try: a dropped connection would leave a hole
  // in the hills. `check` can turn down an answer that came back "OK" but isn't, so
  // it's never cached.
  for (const src of sources.flatMap((s) => Array(tries).fill(s))) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(src).host}`);
      if (check) await check(res.clone(), src);
      cache?.put(url, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      error = err;
    }
  }
  throw error;
}
