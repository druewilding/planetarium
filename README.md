# Planetarium

An accurate, explorable sky in the browser. Stand anywhere on Earth at any moment and see where the Sun, Moon, planets and
stars are, with a physically based sky and real brightness. Built to help understand the phases of the Moon, the motion
of the planets and how the Sun's daily path changes with the seasons and your latitude.

Pure HTML/CSS/JS with no build step, so it can be hosted directly on GitHub Pages.
You can also install it as an app from the browser. It keeps a copy of everything it needs, so it opens and shows the
sky with no connection (the hills and place names need one the first time you visit a place).

## What it does (Milestone 1: the sky from where you are)

- **Opens on now, here.** It starts with the current time and your location: a guess from your time zone, then the
  browser's location if you allow it.
- **Accurate positions:** Sun, Moon and planets from [astronomy-engine](https://github.com/cosinekitty/astronomy)
  (accurate to about an arcminute), including topocentric parallax, aberration, precession and atmospheric refraction.
- **5,000 naked-eye stars** coloured by temperature, plus all 88 constellation figures, with labels.
- **A physically based sky:** single scattering, with an approximate multiple-scattering term (Rayleigh, Mie and ozone)
  for blue skies, red sunsets and twilight, moonlit nights included. Stars fade in and out according to how bright the
  sky is behind them (Schaefer's limiting-magnitude relation), and they dim near the horizon through atmospheric
  extinction.
- **Real brightness:** everything is computed in cd/m² and lux, then an "eye" adapts its exposure the way yours does.
- **Sunlight dimmer:** a linear slider that dims the Sun to show what's in the sky right now, even at noon. The
  daytime sky is so bright that stars only appear in the last percent or so; **Night sky** jumps straight to 0%.
- **The Milky Way:** NASA's all-sky map of its glow, dust lanes and Magellanic Clouds included. Like the stars, it
  shows only where it stands out from the sky, so it's at its best on dark, moonless nights and washes out under a
  bright Moon or twilight.
- **The Moon:** a lit 3D sphere with a NASA LRO texture, so its phase, tilt, libration and earthshine all come straight
  from the geometry. On a dark night it glows, the way haze and your own eyes make it dazzle. Zoomed out, the Sun and
  Moon are drawn up to 3½ times larger, because at true size a wide view shrinks them to a few pixels; zoom in and
  they're true to size (or turn off **Enlarge Sun & Moon**). The phase icon in the info panel is turned the way the
  Moon looks in your sky right now, so near the equator a crescent lies on its back.
- **Eclipses:** in a solar eclipse the Moon covers the Sun and the sky darkens with it. Even with most of the Sun
  covered, what's left still dazzles, so **Eclipse glasses** appear: like the real thing, they black out everything
  but the Sun, and the Moon's bite finally shows (in totality they show nothing, which is your cue to take them off). In a lunar eclipse the Earth's
  shadow creeps across the Moon, which turns a dim copper red: the only sunlight reaching it has been bent through the
  Earth's air. The shadow's size comes from the same geometry as the eclipse predictions, so the two agree. The info
  panel lists the next solar and lunar eclipses you can see from where you are, and the next total solar eclipse
  anywhere; tap one to go to its peak (or to its centre line). Risen up above the Earth, a solar eclipse is the Moon's
  shadow on the Earth: tapping one glides you round to look down on it, a dark spot with a soft grey edge where the Sun
  is partly covered. A lunar eclipse turns you to the red Moon, which looks the same from up there.
- **Time tracks:** drag along a 24-hour track shaded by where the Sun is (night, twilight, day), or along a date track
  shaded by day length through the year. Dots mark the solstices, the equinoxes and the eclipses you can see from where
  you are on the date track, and an eclipse's moment on the time track (with a band for how long it lasts). Hover for what each one is, or tap to go there. A year stepper sits beside it, and
  time can play from −12 hours/s to +12 hours/s.
- **Wide views without distortion:** zoomed in, the view uses ordinary perspective. Zoom out past about 70° and it
  blends into a stereographic ("fisheye") projection, which keeps circles round, so the Sun's daily arc reads
  correctly. **Look up** shows the whole sky as a dome; press it again to return to the horizon.
- **Compass:** shows where you're facing, your field of view, and the Sun and Moon on its rim. Drag it to turn, or
  tap a direction, the Sun or the Moon to face it.
- **Location:** a world map showing live day/night shading, a search over 1,250 cities (with correct local time zones
  and daylight saving), or typed coordinates. The map zooms and pans (scroll, pinch or drag), and shows the cities as
  dots: the biggest when zoomed out, more as you zoom in. Dots swell as the pointer comes near, and clicking one stands
  you in that city. Changing location glides smoothly.
- **Lift off:** rise straight off the ground, still looking the way you were. You're a kilometre up in half a second: the hills, with their names, and the lakes and sea fall away below you as the far land comes into view, then the sky
  darkens to black as the air thins. The view tips down a little, as far as it can while what you were looking at stays in sight:
  turn round (or press Face the Earth) to see the Earth below you, lit by the Sun, with city lights on its night side and your spot marked. The stars, the Moon, the planets and their
  labels stay with you. Up there you float still against the stars, so the sky stops turning and the Earth turns
  beneath you instead, carrying your spot round into the night and back into the day. There's no up or down in
  space, so dragging slides the sky freely under your finger; drag on the Earth instead and it turns like a ball, with the sky turning with it, carrying you round to look down on anywhere. The Moon, being near, shifts against the stars as you
  climb. Choosing another place while you're up glides you round the Earth until you're floating straight over it. − + set how high you are, from 1 km to 250,000 km, and **Face the Earth** turns it back to the middle of the view. Up here the Earth is in the search too, or tap it, for what's below you and how much of it is lit. **North up** turns the Earth in place, with the sky turning round it, until its north is at the top, and then offers **South up** (the one it offers first depends on which hemisphere you're in). The layers
  change to suit space: the horizon, the compass and the Sun's path fade out, and the orbits fade in: the Moon's round
  the Earth, the Earth's round the Sun (with where it will be on the first of each month) and the planets', each
  named in its own colour and fading with distance, so the far side of an orbit is a ghost of its near side. **Back
  to the ground** brings you down over wherever your spot has turned to, turning back to the view you had.
- **Overlays:** the Sun's path today with hour marks, the solstice and equinox paths, the Moon's path, the ecliptic,
  the celestial equator, and alt/az and RA/Dec grids.
- **Info panel:** rise, set and transit times, twilight, day length, Moon phases and age, distances, light travel time,
  and the brightest stars in each constellation. Stars have distances too, from their Hipparcos parallaxes: in
  kilometres, in years of light travel (light-years), and the year the light you see left them. Distant stars are hard
  to measure, so those say "about" or give a range.
- **Point at sky:** on a phone, hold it up and the sky follows it, so you can aim at a star and read its name. It
  uses the compass for north (via `deviceorientationabsolute` on Android, `webkitCompassHeading` on iOS). Phone
  compasses are often a few degrees out and point to magnetic north, so dragging sideways turns the sky into line.
- **Share links:** the address always holds where you're standing, the moment, which way you're looking, the zoom
  and whatever you've picked out, so a link opens exactly the sky you saw. Risen up above the Earth, it also holds how
  high you are and when you took off, so it opens straight onto the same view from space. While the clock is on now (real time), the
  link leaves the time out, so it opens on the sky as it is whenever it's followed. The **Share** button sends it (or
  copies it). Layer toggles stay out of the link, since those are each person's own preferences. Places are kept to
  about a metre, so the link shows exactly what you saw: the same hills and names, even standing on a summit.
- **Hills and mountains:** the real skyline around you, from free elevation maps. The Sun can be up and still hidden:
  from Tromsø in late November it never clears the mountains, and the info panel shows when the Sun, Moon and
  planets are actually **over the mountains** (in Tromsø the Sun first shows again on 21 January, Soldagen). The
  skyline accounts for the Earth's curve and for light bending near the ground. Named peaks you can actually see
  (with no nearer land in the way) are labelled in green. Tap one for its height and distance, or fly to its summit and
  watch the land drop away as you climb. Towns and villages, lighthouses, observatories, and tall towers and
  masts are labelled too, when you can see them.
  Buildings and trees aren't included.
- **Sea, lakes and rivers:** wherever you are, the water you can see mirrors the sky and the hills across it, more
  strongly at a low angle, with a glittering path under the Sun or the Moon. The water comes from OpenStreetMap
  (through OpenFreeMap's map tiles), so it follows the real coast; it's drawn where the land would let you see it, so
  a headland or a slope down to the shore can hide the sea.
- **See through the earth:** turn off **Solid ground** and the hills become a faint outline. Below them the sky is
  always a dark night sky, whatever the time of day, so you can see the stars, planets, Sun and Moon that are below
  the land, and read their labels.
- Works with mouse, keyboard and touch.

### Controls

| Action           | Mouse / touch                | Keyboard   |
| ---------------- | ---------------------------- | ---------- |
| Look around      | Drag the sky, or the compass | Arrow keys |
| Zoom             | Scroll / pinch / − + buttons | `+` / `-`  |
| Select an object | Click / tap                  |            |
| Point at sky     | Point at sky button (phones) |            |
| Reset view       | Reset view button            | `0`        |
| Play / pause     | ▶ button                     | Space      |
| Faster / slower  | ⏩ / ⏪                      | `]` / `[`  |
| Back to now      | Now                          | `n`        |

### Link format

```
#body=earth&lat=59.91&lon=10.74&tz=Europe/Oslo&t=2026-12-04T19:22:12Z&az=182.3&alt=21.2&fov=80.0&sel=star:Sirius
```

Every part is optional; whatever a link leaves out stays as it is (here and now, the usual view). `body` is the world
you're standing on, so `lat` and `lon` will mean the same thing on the Moon or Mars. `sel` is `sun`, `moon`,
`planet:Mars`, `star:Sirius` (or a Hipparcos number, `star:32349`) or `con:Ori`. Editing the address in place jumps
there.

From the browser console, `planetarium.clock.set(Date.parse("2027-08-02T10:00Z"))` jumps to any instant.

## Running locally

```bash
npm install
npm start            # live-server on http://localhost:3000
npm run dev          # or serve on http://localhost:8076
# or, with no Node tooling at all:
python3 -m http.server 3000
```

Location access and the motion sensors (Point at sky) need `https://` or `localhost`. To try Point at sky on a
phone before deploying, serve it over HTTPS, for example with a tunnel such as `npx localtunnel --port 3000`.

### Checks

```bash
npm test             # Vitest, once (npm run test:watch to keep watching)
npm run lint:check   # ESLint
npm run format:check # Prettier
```

The same checks run on every pull request. There's no build step, so the tests also check that every file and module
the page loads exists. `three` and `astronomy-engine` are dev dependencies so the tests can use them; the page itself
loads them from a CDN through the import map in `index.html`, and `npm run importmap` keeps that at the versions in
`package.json`.

## Project structure

```
planetarium/
├── index.html
├── css/styles.css
├── src/
│   ├── main.js            # app setup, render loop, eye adaptation, picking, labels
│   ├── astro.js           # astronomy-engine wrapper → horizon (world) frame
│   ├── climb.js           # how high you are, second by second, rising and landing
│   ├── clock.js           # simulated time, rates, smooth jumps
│   ├── timezone.js        # wall-clock time for any location
│   ├── projection.js      # perspective ↔ stereographic projection (JS side)
│   ├── terrain.js         # elevation tiles → skyline profile, and when bodies clear it
│   ├── water.js           # map tiles → where the sea, lakes and rivers are
│   ├── cachedfetch.js     # fetch, keeping a copy in Cache Storage
│   ├── space.js           # positions in space (Sun-centred, J2000), for distances from wherever you stand
│   ├── eclipses.js        # the Earth's shadow on the Moon, and finding eclipses
│   ├── constants.js       # sizes and distances shared by the astronomy and the drawing
│   ├── scene/
│   │   ├── atmosphere.js  # scattering model (GLSL + JS twin)
│   │   ├── earth.js       # the Earth seen from above, drawn into the sky
│   │   ├── bodies.js      # Sun, Moon, ground
│   │   ├── points.js      # stars and planets as points
│   │   ├── lines.js       # lines on the sky (refraction-aware)
│   │   ├── overlays.js    # constellations, grids, paths
│   │   ├── orbits.js      # the Moon's, the Earth's and the planets' orbits, in perspective
│   │   └── glsl.js        # shared shader code: tone mapping, sky lookup, refraction
│   └── ui/                # time bar, compass, location dialog, info panel, layers, search, labels, camera
├── data/                  # stars, constellations, cities, land outlines (compact JSON)
├── textures/            # the Moon, the Milky Way, and the Earth by day, by night and its seas
├── test/                  # Vitest tests
└── tools/                 # scripts that produced data/, and the import map updater
```

## Data & credits

- Positions: [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT)
- 3D: [three.js](https://threejs.org) (MIT)
- Stars (Hipparcos, to mag 6), constellation lines and star names:
  [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD-3-Clause)
- Star distances: parallaxes from the Hipparcos new reduction (van Leeuwen 2007, ESA), via the
  [Gaia archive](https://gea.esac.esa.int/archive/)
- Milky Way: [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) (the star-free Milky Way layer,
  public domain)
- Moon texture: [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LRO, public domain)
- Earth by day, its city lights and its seas: NASA's Blue Marble and Earth at Night (public domain), as prepared for
  the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)
- Coastlines and cities: [Natural Earth](https://www.naturalearthdata.com) (public domain)
- Mountain, place and landmark names: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL),
  from [planetarium-labels](https://github.com/druewilding/planetarium-labels) (built from
  [Geofabrik](https://download.geofabrik.de)'s extracts)
- Water: [OpenFreeMap](https://openfreemap.org) vector tiles, © [OpenMapTiles](https://www.openmaptiles.org),
  data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- Terrain: [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), built by Mapzen from SRTM, EU-DEM,
  Kartverket, GMTED, ETOPO1 and others ([attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md))

## Roadmap

1. ✅ The sky from your location
2. Earth from orbit: ✅ textured globe, day/night terminator, ✅ the Moon's, the Earth's and the planets' orbits;
   still to come: rising far enough to see the solar system from outside, true-scale sizes
3. Fly-to travel between bodies, orbit trails
4. Standing on the Moon: Earth's phases, the two-week day
5. Planets and moons: Jupiter's Galilean moons, Saturn's rings and Titan, Mars' moons
6. The Martian sky, with its blue sunset
7. ✅ Eclipses: find them and jump to them, the red Moon, the Moon's shadow on the Earth
8. ✅ Shareable links (place, time, view in the URL)
