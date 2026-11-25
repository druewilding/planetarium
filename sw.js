// Keeps a copy of the whole app, so it opens and works with no connection.
//
// The page's own files try the network first, so a new release shows up as soon
// as you're online, but a slow connection only gets a few seconds before the
// saved copy is used instead. The libraries from the CDN have their version in
// the address and never change, so they come straight from the saved copy.

const CACHE_NAME = "planetarium-v1";
const PATIENCE_MS = 3000;
// The page's modules load one after another, so waiting PATIENCE_MS for each one
// would add up. Once the network has been too slow, use the saved copies straight
// away for this long (still fetching, to update them for next time).
const SLOW_FOR_MS = 60_000;
let slowUntil = 0;

// Everything the page loads from here. The tests check nothing is missing.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./css/styles.css",
  "./src/astro.js",
  "./src/cachedfetch.js",
  "./src/climb.js",
  "./src/clock.js",
  "./src/constants.js",
  "./src/eclipses.js",
  "./src/link.js",
  "./src/main.js",
  "./src/projection.js",
  "./src/season.js",
  "./src/space.js",
  "./src/terrain.js",
  "./src/timezone.js",
  "./src/water.js",
  "./src/scene/atmosphere.js",
  "./src/scene/bodies.js",
  "./src/scene/earth.js",
  "./src/scene/glsl.js",
  "./src/scene/lines.js",
  "./src/scene/milkyway.js",
  "./src/scene/orbits.js",
  "./src/scene/overlays.js",
  "./src/scene/points.js",
  "./src/ui/compass.js",
  "./src/ui/info.js",
  "./src/ui/labels.js",
  "./src/ui/location.js",
  "./src/ui/panels.js",
  "./src/ui/sensor.js",
  "./src/ui/timebar.js",
  "./src/ui/view.js",
  "./data/cities.json",
  "./data/constellations.json",
  "./data/land.json",
  "./data/stars.json",
  "./textures/earth-day.jpg",
  "./textures/earth-night.jpg",
  "./textures/earth-ocean.jpg",
  "./textures/milkyway.jpg",
  "./textures/moon.jpg",
];

// The import map's libraries, and the files they import in turn. `npm run
// importmap` keeps the versions in step with index.html.
const CDN = "https://cdn.jsdelivr.net";
const LIBRARIES = [
  "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.js",
  "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/esm/astronomy.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...LIBRARIES])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((key) => key.startsWith("planetarium-") && key !== CACHE_NAME);
      await Promise.all(old.map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === CDN) event.respondWith(savedFirst(request));
  else if (url.href.startsWith(self.registration.scope)) event.respondWith(networkFirst(request));
  // Anything else (elevation tiles, place names) goes straight to the network.
});

/** The saved copy if there is one, else fetch it and keep it. */
async function savedFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

/**
 * Fetch it and keep it, but fall back to the saved copy when the network fails or
 * takes longer than PATIENCE_MS (the fetch carries on, to update the copy).
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const started = Date.now();
  const slow = started < slowUntil;
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    if (Date.now() - started < PATIENCE_MS) slowUntil = 0; // quick again
    return response;
  });
  fresh.catch(() => {}); // a failure is handled below, by falling back
  const fallback = async () =>
    (await cache.match(request)) ?? (request.mode === "navigate" ? await cache.match("./") : undefined);

  const late = new Promise((resolve) => setTimeout(resolve, slow ? 0 : PATIENCE_MS));
  const first = await Promise.race([fresh.catch(() => null), late]);
  if (first) return first;
  slowUntil = Date.now() + SLOW_FOR_MS;
  return (await fallback()) ?? fresh;
}
