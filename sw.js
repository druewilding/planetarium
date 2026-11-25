const CACHE_NAME = "planetarium-shell-v1";
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);

      const page = await cache.match(new URL("index.html", self.registration.scope));
      const importMap = page
        ? page.text().then((html) => {
            const json = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
            return json ? Object.values(JSON.parse(json).imports) : [];
          })
        : [];
      for (const url of await importMap) {
        if (new URL(url).origin !== "https://cdn.jsdelivr.net") continue;
        try {
          const response = await fetch(url);
          if (response.ok) await cache.put(url, response);
        } catch {
          // The app shell can still be installed if a CDN is temporarily unavailable.
        }
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("planetarium-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const inScope = url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
  if (!inScope && url.origin !== "https://cdn.jsdelivr.net") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && response.type !== "opaque") cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return cache.match(new URL("index.html", self.registration.scope));
        return Response.error();
      }
    })()
  );
});
