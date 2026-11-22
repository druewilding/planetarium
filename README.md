# Planetarium

An accurate, explorable sky in the browser. Stand anywhere on Earth at any moment and see where the Sun, Moon, planets and
stars are, with a physically based sky and real brightness. Built to help understand the phases of the Moon, the motion
of the planets and how the Sun's daily path changes with the seasons and your latitude.

Pure HTML/CSS/JS with no build step, so it can be hosted directly on GitHub Pages.

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
- **The Moon:** a lit 3D sphere with a NASA LRO texture, so its phase, tilt, libration and earthshine all come straight
  from the geometry.
- **Time tracks:** drag along a 24-hour track shaded by where the Sun is (night, twilight, day), or along a date track
  shaded by day length through the year, with the solstices and equinoxes marked. A year stepper sits beside it, and
  time can play from −1 month/s to +1 month/s.
- **Wide views without distortion:** zoomed in, the view uses ordinary perspective. Zoom out past about 70° and it
  blends into a stereographic ("fisheye") projection, which keeps circles round, so the Sun's daily arc reads
  correctly. **Look up** shows the whole sky as a dome; press it again to return to the horizon.
- **Compass:** shows where you're facing, your field of view, and the Sun and Moon on its rim. Drag it to turn, or
  tap a direction, the Sun or the Moon to face it.
- **Location:** a world map showing live day/night shading, a search over 1,250 cities (with correct local time zones
  and daylight saving), or typed coordinates. Changing location glides smoothly.
- **Overlays:** the Sun's path today with hour marks, the solstice and equinox paths, the Moon's path, the ecliptic,
  the celestial equator, and alt/az and RA/Dec grids.
- **Info panel:** rise, set and transit times, twilight, day length, Moon phases and age, distances, light travel time,
  and the brightest stars in each constellation.
- Works with mouse, keyboard and touch.

### Controls

| Action           | Mouse / touch                | Keyboard   |
| ---------------- | ---------------------------- | ---------- |
| Look around      | Drag the sky, or the compass | Arrow keys |
| Zoom             | Scroll / pinch / + − buttons | `+` / `-`  |
| Select an object | Click / tap                  |            |
| Play / pause     | ▶ button                     | Space      |
| Faster / slower  | ⏩ / ⏪                      | `]` / `[`  |
| Back to now      | Now                          | `n`        |

From the browser console, `planetarium.clock.set(Date.parse("2027-08-02T10:00Z"))` jumps to any instant (that one
is a total solar eclipse over Spain and North Africa).

## Running locally

```bash
npm install
npm start            # live-server on http://localhost:3000
# or, with no Node tooling at all:
python3 -m http.server 3000
```

Location access needs `https://` or `localhost`.

## Project structure

```
planetarium/
├── index.html
├── css/styles.css
├── src/
│   ├── main.js            # app setup, render loop, eye adaptation, picking, labels
│   ├── astro.js           # astronomy-engine wrapper → horizon (world) frame
│   ├── clock.js           # simulated time, rates, smooth jumps
│   ├── timezone.js        # wall-clock time for any location
│   ├── projection.js      # perspective ↔ stereographic projection (JS side)
│   ├── scene/
│   │   ├── atmosphere.js  # scattering model (GLSL + JS twin)
│   │   ├── bodies.js      # Sun, Moon, ground
│   │   ├── points.js      # stars and planets as points
│   │   ├── lines.js       # lines on the sky (refraction-aware)
│   │   ├── overlays.js    # constellations, grids, paths
│   │   └── glsl.js        # shared shader code: tone mapping, sky lookup, refraction
│   └── ui/                # time bar, compass, location dialog, info panel, layers, search, labels, camera
├── data/                  # stars, constellations, cities, land outlines (compact JSON)
├── textures/moon.jpg
└── tools/                 # scripts that produced data/
```

## Data & credits

- Positions: [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT)
- 3D: [three.js](https://threejs.org) (MIT)
- Stars (Hipparcos, to mag 6), constellation lines and star names:
  [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD-3-Clause)
- Moon texture: [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LRO, public domain)
- Coastlines and cities: [Natural Earth](https://www.naturalearthdata.com) (public domain)

## Roadmap

1. ✅ The sky from your location
2. Earth from orbit: textured globe, day/night terminator, the Moon's orbit
3. Fly-to travel between bodies, orbit trails
4. Standing on the Moon: Earth's phases, the two-week day
5. Planets and moons: Jupiter's Galilean moons, Saturn's rings and Titan, Mars' moons
6. The Martian sky, with its blue sunset
7. Eclipses: find them, jump to them, see the shadow on Earth
8. Shareable links (place, time, view in the URL)
