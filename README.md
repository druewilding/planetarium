# Earth Sky

A static planetarium for looking up from Earth and exploring the Earth–Moon system. It starts at the current instant in Reykjavik, the example city. Search for another city, enter coordinates, place a globe pin, or explicitly request browser location. Location and searches are neither sent by the app nor stored between visits. If you request location, the browser or OS may use its own location service.

## Run locally

With Node.js 22+ and npm:

```sh
npm ci
npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8000/>. Do not open the source HTML directly. `dist/` is the complete static output; its relative URLs also work under a project path such as `/planetarium/`. Browser location requires a secure context (HTTPS or loopback). A basic Canvas 2D sky and readouts are available without WebGL 2; globe features require it.

Use the date dial or a date field for large jumps, and the time-of-day dial or time field for finer changes. Edits pause playback. Drag the sky or use arrow keys to look around; in globe mode, drag to orbit and pinch, scroll, or use the zoom buttons. In pin mode, click/tap Earth or use the viewport's arrow keys and Enter to pin the center. The orbit overview compresses the separation and enlarges the Moon; the default globe mode does neither. The surface marker and its label are annotations, not physical objects.

## Verification

```sh
npm test              # Deterministic model and sampled reference fixtures
npm run test:browser  # Builds, serves under /planetarium/, runs headless Google Chrome
npm audit
```

Set `CHROME_PATH` to use a nonstandard Chromium executable. Browser tests use one desktop viewport and a Chromium iPhone-sized touch emulation, not Safari or a physical phone. Independent fixtures in `tests/model.test.js` are from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) and [USNO Astronomical Applications](https://aa.usno.navy.mil/data/api); none of these services are contacted at runtime.

## Model and data limits

- The 22 built-in cities have hand-curated city-center coordinates and IANA zones. Globe pins, manual coordinates, and device coordinates use explicitly labeled UTC; worldwide civil zone lookup is not bundled. City offsets use the browser's `Intl` data, which can be incomplete for historical dates, and future laws can change. A zone change preserves the instant even if its new local date briefly falls outside the supported 1900–2100 edit range.
- Directions use a sea-level observer and standard refraction; solar events assume a level sea-level horizon and standard limb/refraction conventions. Terrain, elevation, and weather are not modeled, and grazing crossings are particularly sensitive. Illuminated fraction is geocentric, while apparent Moon diameter and center direction are topocentric. Comparisons are sampled, not a range-wide accuracy certification.
- The hand-curated star table contains 30 rounded J2000 positions and approximate visual magnitudes (individual astronomical facts; see the [SIMBAD object database](https://simbad.cds.unistra.fr/simbad/) for reference). It transforms precession and nutation but omits proper motion and annual aberration. The three constellation stick figures are schematic. Marker brightness is for orientation, not visibility prediction. Globe relief and lunar texture are not simulated.
- Land outlines are [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) public-domain data, version 4.1.0, via World Atlas `land-110m` (ISC distribution). Astronomy Engine and Three.js are MIT; TopoJSON Client is ISC. The build includes redistribution notices in `dist/licenses/` and `dist/app.js.LEGAL.txt`.

Publishing `dist/` to GitHub Pages requires separate hosting or CI setup and authorization. This repository does not configure or perform a deployment.

The static GitHub Pages build does not enforce an anti-framing policy: the HTML meta CSP cannot set `frame-ancestors`. Other sites can embed the page in a frame. If embedding must be blocked, use a deployment that sets `Content-Security-Policy: frame-ancestors 'none'` as an HTTP response header and verify the served response.
