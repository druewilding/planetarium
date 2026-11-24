import * as THREE from "three";

import {
  A,
  altAz,
  AU_KM,
  Body,
  computeSky,
  D2R,
  dirFromAltAz,
  eqVector,
  horizonFrame,
  PLANETS,
  R2D,
  refract,
} from "./astro.js";
import { climb, GROUND_KM } from "./climb.js";
import { Clock } from "./clock.js";
import { DEFAULT_BODY, readLink, writeLink } from "./link.js";
import { createProjection } from "./projection.js";
import {
  ATMOSPHERES,
  averageSkyLuminance,
  createAtmosphere,
  createSkyDome,
  luminance,
  NONE,
  skyRadiance,
  transmittance,
} from "./scene/atmosphere.js";
import { createGround, createMoon, createSkylineTexture, createSun, SUN_LUMINANCE } from "./scene/bodies.js";
import { createEarth } from "./scene/earth.js";
import * as glsl from "./scene/glsl.js";
import { setFade } from "./scene/lines.js";
import { createMilkyWay } from "./scene/milkyway.js";
import { createOrbits } from "./scene/orbits.js";
import { createOverlays } from "./scene/overlays.js";
import { createPlanetPoints, createPointsMaterial, createStars } from "./scene/points.js";
import { earthAxes, surfaceDirection } from "./space.js";
import {
  computeProfile,
  createTerrain,
  SAMPLES as SKYLINE_SAMPLES,
  skylineAt,
  thinWater,
  WATER_ROWS,
} from "./terrain.js";
import { formatDateTime, formatTime, startOfLocalDay } from "./timezone.js";
import { createCompass } from "./ui/compass.js";
import { createInfo } from "./ui/info.js";
import { createLabels } from "./ui/labels.js";
import { createLocation } from "./ui/location.js";
import { createLayersPanel, createSearch } from "./ui/panels.js";
import { createSensor, sensorSupported } from "./ui/sensor.js";
import { createTimebar } from "./ui/timebar.js";
import { createView } from "./ui/view.js";

const $ = (id) => document.getElementById(id);

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  return res.json();
}

/** Load a texture and measure its mean (squared) brightness so the Moon's albedo can be normalised. */
function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 32;
        const ctx = c.getContext("2d");
        ctx.drawImage(tex.image, 0, 0, 64, 32);
        const d = ctx.getImageData(0, 0, 64, 32).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          sum += y * y;
        }
        resolve({ texture: tex, mean: sum / (d.length / 4) });
      },
      undefined,
      reject
    );
  });
}

// ---------------------------------------------------------------- Catalog

const GREEK = {
  α: 1,
  β: 1,
  γ: 1,
  δ: 1,
  ε: 1,
  ζ: 1,
  η: 1,
  θ: 1,
  ι: 1,
  κ: 1,
  λ: 1,
  μ: 1,
  ν: 1,
  ξ: 1,
  ο: 1,
  π: 1,
  ρ: 1,
  σ: 1,
  τ: 1,
  υ: 1,
  φ: 1,
  χ: 1,
  ψ: 1,
  ω: 1,
};

function buildCatalog(starData, constellations) {
  const gen = Object.fromEntries(constellations.map((c) => [c.id, c.gen]));
  const conName = Object.fromEntries(constellations.map((c) => [c.id, c.name]));
  const tmp = new THREE.Vector3();

  const positionOf = (ra, dec) => (sky) => {
    const d = refract(eqVector(ra, dec, tmp).applyMatrix4(sky.eqjToWorld).normalize());
    return { dir: d.clone(), ...altAz(d) };
  };

  const stars = starData.stars.map(([hip, ra, dec, mag, bv, plx, ePlx]) => {
    const [proper = "", desig = "", con = ""] = starData.names[hip] || [];
    const designation = desig && con ? `${desig} ${gen[con] || con}` : "";
    const label = proper || designation || `HIP ${hip}`;
    const bayer = desig && (GREEK[desig[0]] || /^\d/.test(desig));
    return {
      hip,
      ra,
      dec,
      mag,
      bv,
      plx, // parallax and its error (milliarcseconds), for the distance
      ePlx,
      con,
      proper,
      name: label,
      label: proper || (bayer ? designation : label),
      subtitle: [proper && designation, con && `Star in ${conName[con] || con}`].filter(Boolean).join(" · ") || "Star",
      position: positionOf(ra, dec),
    };
  });

  const seen = new Set();
  const cons = constellations
    .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
    .map((c) => ({ ...c, position: positionOf(c.label[0], c.label[1]) }));

  return {
    stars,
    named: stars.filter((s) => s.proper),
    constellations: cons,
    constellationLabels: constellations.map((c, i) => ({
      key: `con${i}`,
      name: c.name,
      ra: c.label[0],
      dec: c.label[1],
    })),
    starsIn: (id) => stars.filter((s) => s.con === id && s.mag < 4.5).sort((a, b) => a.mag - b.mag),
  };
}

// ---------------------------------------------------------------- App

async function main() {
  const canvas = $("sky");
  const [starData, constellationData, cities, land, moonTex, milkyWayTex] = await Promise.all([
    loadJSON("data/stars.json"),
    loadJSON("data/constellations.json"),
    loadJSON("data/cities.json"),
    loadJSON("data/land.json"),
    loadTexture("textures/moon.jpg"),
    new THREE.TextureLoader().loadAsync("textures/milkyway.jpg"),
  ]);
  const catalog = buildCatalog(starData, constellationData);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 5000);

  const atmosphere = createAtmosphere(renderer, { coarse });
  const projection = createProjection(camera);
  const shared = {
    ...projection.uniforms,
    uSky: { value: atmosphere.texture },
    uExposure: { value: 1 },
    uScotopic: { value: 0 },
    uRefract: { value: 1 },
    uExtK: { value: 0.2 },
    uBoost: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uSizeScale: { value: 1 },
    // The land's skyline, for every sky shader (see glsl.LAND).
    uHorizon: { value: createSkylineTexture() },
    uTerrain: { value: 0 },
    uSeeThrough: { value: 0 },
  };

  scene.add(createSkyDome(shared, glsl));
  const overlays = createOverlays(shared, glsl, constellationData);
  scene.add(...overlays.groups);

  const starMaterial = createPointsMaterial(shared, glsl, 1000);
  const milkyWay = createMilkyWay(shared, glsl, milkyWayTex);
  overlays.eqj.add(milkyWay);
  overlays.eqj.add(createStars(starData, starMaterial));
  const planetPoints = createPlanetPoints(PLANETS, createPointsMaterial(shared, glsl, 1000));
  // Orbits (shown from up above the Earth), in the same J2000 frame as the stars.
  const orbits = createOrbits(shared, glsl);
  overlays.eqj.add(orbits.group);
  scene.add(planetPoints.points);

  moonTex.texture.colorSpace = THREE.NoColorSpace;
  moonTex.texture.wrapS = THREE.RepeatWrapping;
  moonTex.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const moon = createMoon(shared, glsl, moonTex.texture, moonTex.mean);
  const sun = createSun(shared, glsl);
  const ground = createGround(shared, glsl);
  scene.add(moon.mesh, moon.glow, sun.mesh, ground.mesh);

  // The Earth seen from above (Rise up). Its maps load the first time you go up.
  const earth = createEarth(shared, glsl);
  scene.add(earth.mesh);
  const loadEarthMaps = () =>
    Promise.all(
      ["textures/earth-day.jpg", "textures/earth-night.jpg", "textures/earth-ocean.jpg"].map((url) =>
        new THREE.TextureLoader().loadAsync(url)
      )
    );

  // Hills and mountains on the horizon, loaded for wherever you're standing.
  const terrain = createTerrain({ onReady: () => info?.update(true) });
  let skyline = null; // the profile the ground is showing
  let skylineFade = 0;
  let flight = null; // a flight across the land: skylines along the way (see flyTo)
  /** Altitude (degrees) of the land's skyline towards an azimuth; 0 for a flat horizon. */
  const skylineAlt = (az) => (skyline && skylineFade > 0.5 ? skylineAt(skyline, az) : 0);
  /** Is this direction behind solid ground (or the hills)? */
  function behindLand(dir, margin = 0.25) {
    // Up above it, the Earth itself is in the way.
    if (isAloft()) return aloft.earthRadius > 0 && dir.angleTo(aloft.earthDir) < aloft.earthRadius - margin * D2R;
    if (!layers.ground) return false;
    const { alt, az } = altAz(dir);
    return alt < skylineAlt(az) - margin;
  }
  function updateSkyline(dt) {
    if (flight) {
      // Flying: blend between the skylines worked out along the way.
      const n = flight.frames.length - 1;
      const x = (locTween ? locTween.k : 1) * n;
      const i = Math.min(n - 1, Math.floor(x));
      const f = x - i;
      const [a, b] = [flight.frames[i], flight.frames[i + 1]];
      const out = flight.view.altitude;
      for (let j = 0; j < out.length; j++) out[j] = a[j] + (b[j] - a[j]) * f;
      ground.setSkylineAltitudes(out, flight.top);
      const [wa, wb] = [flight.water[i], flight.water[i + 1]];
      const wet = flight.view.water;
      if (wa && wb) for (let j = 0; j < wet.length; j++) wet[j] = wa[j] + (wb[j] - wa[j]) * f;
      ground.setWater(wa && wb ? wet : null, SKYLINE_SAMPLES);
      skyline = flight.view;
      skylineFade = 1;
      if (!locTween) {
        skyline = flight.final; // landed
        ground.setSkyline(skyline);
        flight = null;
      }
      return;
    }
    const want = layers.terrain && !locTween ? terrain.profileFor(loc) : null;
    if (want !== skyline) {
      // Fade the old skyline out, swap, then fade the new one in.
      skylineFade = Math.max(0, skylineFade - dt * 4);
      if (skylineFade === 0) {
        skyline = want;
        ground.setSkyline(skyline);
      }
    } else if (skyline) skylineFade = Math.min(1, skylineFade + dt * 2.5);
  }

  const labels = createLabels($("labels"));
  let info = null;

  // ---- State ----
  const clock = new Clock();
  let selection = null;
  let sky = null;
  let loc = null; // current (possibly mid-animation) location
  let locTween = null;
  let layers = {};
  let sunLevel = 1;
  let exposure = 1;
  let globalLimit = 6;
  // Up above the Earth (see Rise up, below).
  const aloft = {
    km: 0,
    frame: null, // Matrix4, J2000 → view, held still against the stars
    dir: null, // Vector3, where above the Earth you are (J2000, from its centre)
    tween: null, // { to, t (s), duration, and either curve (see climb.js; rise or landing) or from }
    before: null, // the view you had on the ground, to come back to
    startedAt: 0, // when you took off (performance.now())
    takeoff: 0, // the moment you took off (clock time): with the place, it fixes where you are
    move: null, // gliding round the Earth to a new place: { from, to (frame quaternions), fromDir, toDir, t }
    turned: false, // moved round the Earth by hand since taking off (see grabEarth)
    spin: null, // still turning after you let go of the Earth: { axis (J2000), rate (rad/s) }
    panned: false, // turned to look down at the Earth yet?
    earthDir: new THREE.Vector3(0, -1, 0), // from you to the Earth's centre (view frame)
    earthRadius: 0, // the Earth's angular radius as you see it, radians
  };
  const isAloft = () => aloft.frame !== null;

  const location = createLocation({
    cities,
    land,
    getTime: () => clock.ms,
    onChange: (next, { animate } = {}) => setLocation(next, animate),
  });

  function setLocation(next, animate, { duration = 1.6 } = {}) {
    // Mountains belong to where you were standing.
    if (selection?.type === "feature") select(null);
    location.set(next);
    // Up above the Earth: glide round it to float over the new place instead.
    if (isAloft() && !aloft.tween?.landing) {
      moveAloftOver(next, animate && !!loc);
      duration = MOVE_SECONDS;
    }
    if (!loc || !animate) {
      loc = { ...next };
      locTween = null;
      return;
    }
    let dLon = next.lon - loc.lon;
    dLon = ((dLon + 540) % 360) - 180;
    // Crossing the equator: turn around, so you keep facing the Sun's side of the sky
    // (south in the north, north in the south) and its daily path still makes sense.
    if (!isAloft() && Math.sign(next.lat || 1) !== Math.sign(loc.lat || 1)) view.lookTo({ az: view.state.az + 180 });
    locTween = { from: { ...loc }, to: next, dLon, t: 0, k: 0, duration };
  }

  function updateLocationTween(dt) {
    if (!locTween) return;
    locTween.t = Math.min(1, locTween.t + dt / locTween.duration);
    const k = locTween.t < 0.5 ? 2 * locTween.t ** 2 : 1 - (-2 * locTween.t + 2) ** 2 / 2;
    locTween.k = k;
    const lon = locTween.from.lon + locTween.dLon * k;
    loc = {
      ...locTween.to,
      lat: locTween.from.lat + (locTween.to.lat - locTween.from.lat) * k,
      lon: ((((lon + 180) % 360) + 360) % 360) - 180,
    };
    if (locTween.t >= 1) {
      loc = { ...locTween.to };
      locTween = null;
    }
  }

  // A shared link says where and when; otherwise it's here and now.
  const link = readLink(window.location.hash);
  if (link?.place) setLocation(location.fromLink(link.place.lat, link.place.lon, link.place.tz), false);
  else {
    setLocation(location.initialGuess(), false);
    location.requestGeolocation();
  }
  if (link?.time != null) clock.set(link.time, { animate: false });

  // ---- View ----
  const DEFAULT_FOV = 80;
  /** Altitude to look at so the horizon sits just above the time controls. */
  function horizonAltitude(fov) {
    const h = window.innerHeight;
    const barTop = document.querySelector(".timebar").getBoundingClientRect().top;
    const y = Math.min(h * 0.85, barTop - 24); // horizon's screen position
    return projection.altitudeForHorizonAt(-(y - h / 2) / (h / 2), fov);
  }
  /** Face the Sun or Moon if up (keeping the horizon in view), else the equator side of the sky. */
  /**
   * A view with the Earth (straight below you) rising half into view above the
   * time bar, so it fills the bottom of the sky with your spot still in sight.
   */
  function earthBelowView(fov) {
    fov = Math.max(50, Math.min(fov, 100));
    const h = window.innerHeight;
    const barTop = document.querySelector(".timebar").getBoundingClientRect().top;
    const y = barTop - 40; // the Earth's centre (and your spot, at first) just above the time bar
    const below = projection.altitudeForHorizonAt(-(y - h / 2) / (h / 2), fov); // how far below the middle that is
    return { alt: Math.max(-89.9, -90 + below), az: view.state.az, fov };
  }
  function defaultView(s, fov = DEFAULT_FOV) {
    // Up above the Earth: look out with the Earth in the lower third of the view.
    if (isAloft()) return earthBelowView(view.state.fov);
    const base = horizonAltitude(fov);
    const body = s.sun.alt > 3 ? s.sun : s.moon.alt > 3 ? s.moon : null;
    if (!body) return { alt: base, az: loc.lat >= 0 ? 180 : 0, fov };
    // Tilt up only as far as needed to keep the body comfortably on screen.
    return { alt: Math.max(base, body.alt - fov / 2 + 12), az: body.az, fov };
  }

  const sensor = createSensor();
  const view = createView(camera, canvas, {
    onClick: pick,
    unproject: projection.unproject,
    sensor,
    // Up above the Earth, a drag that starts on it turns it like a ball (see grabEarth).
    grab: { start: (x, y) => grabEarth(x, y), move: (x, y, dt) => dragEarth(x, y, dt), end: (g) => letGoOfEarth(g) },
  });
  {
    view.lookTo(defaultView(computeSky(clock.ms, loc)));
    view.update(10);
    // (Aimed again after the first frame, once the time bar has its real height.)
  }
  $("zoom-in").addEventListener("click", () => view.zoom(0.6));
  $("zoom-out").addEventListener("click", () => view.zoom(1 / 0.6));

  // ---- Reset: back to the starting view (facing the Sun or Moon, else the equator side) ----
  const resetBtn = $("reset-view");
  function resetView() {
    beforeLookUp = null;
    // With the phone doing the aiming, only the zoom can go back.
    view.lookTo(sensor.active ? { fov: DEFAULT_FOV } : defaultView(sky));
  }
  /** Has the view been turned, tilted or zoomed away from where Reset would take it? */
  function awayFromDefault() {
    const fovOff = Math.abs(view.state.fov - DEFAULT_FOV) > 2;
    if (sensor.active) return fovOff;
    const d = defaultView(sky);
    if (isAloft()) return Math.abs(view.state.alt - d.alt) > 4; // (and any way round)
    const azOff = Math.abs(((view.state.az - d.az + 540) % 360) - 180) > 4;
    return fovOff || azOff || Math.abs(view.state.alt - d.alt) > 4;
  }
  resetBtn.addEventListener("click", resetView);
  window.addEventListener("keydown", (e) => {
    if (e.key === "0" && !e.target.closest("input, textarea, select, dialog, [role=slider]")) resetView();
  });

  // ---- Panels ----
  const layersPanel = createLayersPanel({
    onChange: (l) => {
      layers = { ...l };
      for (const [key, obj] of Object.entries(overlays.layers)) obj.visible = !!layers[key];
      milkyWay.visible = !!layers.milkyWay;
    },
  });

  const timebar = createTimebar({ clock, getLocation: () => loc, onEclipse: (body, ms) => goToEclipse(body, ms) });

  const infoPanel = $("info");
  // Up above the Earth, the info panel still talks about the sky from your spot on the ground.
  let groundSky = null;
  function skyFromGround() {
    if (!isAloft()) return sky;
    if (groundSky?.ms !== clock.ms || groundSky.loc !== loc) groundSky = { ...computeSky(clock.ms, loc), loc };
    return groundSky;
  }
  info = createInfo({
    container: $("info-content"),
    catalog,
    getState: () => ({
      // (Rise and set, up or down: always as seen from where you're standing.)
      sky: skyFromGround(),
      loc,
      standingOn: DEFAULT_BODY,
      ms: clock.ms,
      selection,
      skyline: !flight && skylineFade > 0.5 ? skyline : null,
    }),
    onLook: () => lookAtSelection(),
    onClear: () => select(null),
    onGo: () => selection?.type === "feature" && flyTo(selection.feature),
    onEclipse: (body, ms, place) => goToEclipse(body, ms, place),
    placeName: (lat, lon) => location.fromPoint(lat, lon).name,
    onSelect: (type, id) => {
      if (type === "sun") select(selectSun(), { look: true });
      else if (type === "moon") select(selectMoon(), { look: true });
      else if (type === "planet") select(selectPlanet(PLANETS.find((p) => p.id === id)), { look: true });
      else if (type === "star") {
        const star = catalog.stars.find((st) => String(st.hip) === id);
        if (star) select(selectStar(star), { look: true });
      }
    },
  });
  $("info-btn").addEventListener("click", () => {
    const collapsed = infoPanel.classList.toggle("collapsed");
    $("info-btn").setAttribute("aria-pressed", String(!collapsed));
  });
  if (window.matchMedia("(max-width: 760px)").matches) {
    infoPanel.classList.add("collapsed");
    $("info-btn").setAttribute("aria-pressed", "false");
  }

  // Sunlight dimmer: linear. (The daytime sky is so bright that stars only show
  // through in the last percent or so; the Night sky button jumps straight there.)
  const slider = $("sun-level");
  const nightBtn = $("night-sky");
  let levelBeforeNight = 100;
  const updateSunLevel = () => {
    const pct = parseFloat(slider.value);
    sunLevel = pct / 100;
    $("sun-level-out").textContent = pct >= 10 || pct === 0 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
    nightBtn.setAttribute("aria-pressed", String(pct === 0));
    nightBtn.textContent = pct === 0 ? "Daylight" : "Night sky";
  };
  slider.addEventListener("input", updateSunLevel);
  nightBtn.addEventListener("click", () => {
    const pct = parseFloat(slider.value);
    if (pct > 0) {
      levelBeforeNight = pct;
      slider.value = "0";
    } else {
      slider.value = String(levelBeforeNight || 100);
    }
    updateSunLevel();
  });
  updateSunLevel();

  // ---- Compass ----
  const compass = createCompass($("compass"), {
    onTurn: (d) => {
      if (sensor.active) return sensor.nudge(d); // line the compass up by hand
      view.lookTo({ az: view.state.az + d });
      view.update(1); // apply immediately, no easing while dragging
    },
    onFace: (az) => view.lookTo({ az, alt: Math.max(view.state.alt, 5) }),
    onFaceBody: (id) => {
      const b = id === "sun" ? sky.sun : sky.moon;
      if (behindLand(b.dir, 0)) view.lookTo({ az: b.az, alt: Math.max(12, skylineAlt(b.az) + 8) });
      else view.lookAt(b.dir);
    },
  });

  // ---- Look up: the whole dome of the sky at once ----
  // Eclipse glasses: offered while the Moon is covering part of the Sun. Like the
  // real thing, they cut everything but the Sun, so its shape finally shows.
  let glasses = false;
  const glassesBtn = $("glasses-btn");
  const glassesLabel = glassesBtn.querySelector("span");
  function setGlasses(on) {
    glasses = on;
    glassesBtn.setAttribute("aria-pressed", String(on));
    $("labels").classList.toggle("glasses", on);
    for (const group of overlays.groups) group.visible = !on;
    planetPoints.points.visible = !on;
    // You put them on to look at the Sun.
    if (on) view.lookAt(sky.sun.dir, Math.min(view.state.fov, 4));
  }
  glassesBtn.addEventListener("click", () => setGlasses(!glasses));

  // With the glasses on, the view turns with the Sun as time passes, so it stays
  // where it is on screen (drag to move it somewhere else).
  let lastSun = null;
  function followSun() {
    if (glasses && lastSun) {
      const dAz = ((sky.sun.az - lastSun.az + 540) % 360) - 180;
      view.shift(sky.sun.alt - lastSun.alt, dAz);
    }
    lastSun = glasses ? { alt: sky.sun.alt, az: sky.sun.az } : null;
  }

  const lookUpBtn = $("look-up");
  let beforeLookUp = null;
  const lookingUp = () => view.state.alt > 80 && view.state.fov > 140;
  lookUpBtn.addEventListener("click", () => {
    if (sensor.active) stopSensor();
    if (lookingUp()) {
      view.lookTo(beforeLookUp ?? defaultView(sky));
      beforeLookUp = null;
    } else {
      beforeLookUp = { alt: view.state.alt, az: view.state.az, fov: view.state.fov };
      // Facing direction ends up at the bottom of the screen, like lying on your back.
      view.lookTo({ alt: 89.9, fov: 180 });
    }
  });

  // ---- Rise up: lift straight off the ground, keeping your view ----
  // While you're up you float still against the stars: the view keeps the frame
  // it had when you left the ground, and the Earth turns beneath you (turn round
  // to see it). Coming down drifts back over wherever your spot has turned to,
  // and blends back into the ground's frame.
  const EARTH_RADIUS_KM = 6371;
  const RISE_TO_KM = 20000;
  const MOVE_SECONDS = 3; // gliding round the Earth to float over another place
  const MIN_KM = 1;
  const MAX_KM = 250000; // well short of the Moon (384,000 km), which stays beyond the Earth
  const toVector3 = (v) => new THREE.Vector3(v.x, v.y, v.z);
  const riseBtn = $("rise-btn");
  const altitudeEl = $("altitude");
  function setAloftUi(up) {
    document.body.classList.toggle("aloft", up);
    altitudeEl.hidden = !up;
    riseBtn.setAttribute("aria-pressed", String(up));
    riseBtn.querySelector("span").textContent = up ? "Back to the ground" : "Rise up";
    riseBtn.title = up
      ? "Come back down to where you're standing"
      : "Rise straight up from where you're standing, high above the Earth";
    layersPanel.setPlace(up ? "space" : "ground");
    resetBtn.querySelector("span").textContent = up ? "Face the Earth" : "Reset view";
    resetBtn.title = up ? "Look down at the Earth (0)" : "Back to the starting view, facing the Sun or Moon (0)";
  }
  function riseUp() {
    if (isAloft()) return;
    if (sensor.active) stopSensor();
    earth.load(loadEarthMaps, renderer);
    aloft.frame = sky.eqjToWorld.clone();
    aloft.dir = toVector3(surfaceDirection(loc.lat, loc.lon, clock.ms));
    aloft.takeoff = clock.ms;
    aloft.turned = false;
    aloft.spin = null;
    aloft.km = GROUND_KM;
    aloft.tween = climbTo(RISE_TO_KM);
    aloft.before = { alt: view.state.alt, az: view.state.az, fov: Math.min(view.state.fov, 100) };
    aloft.startedAt = performance.now();
    aloft.panned = false;
    beforeLookUp = null;
    view.setFree(true); // no up or down in space
    setAloftUi(true);
  }
  function comeDown() {
    if (!isAloft() || aloft.tween?.landing) return;
    aloft.move = aloft.spin = null; // (landing goes wherever your spot is)
    const landing = { frame: aloft.frame.clone(), dir: aloft.dir.clone() };
    // The climb up to here, run backwards: falling fast, slowing as the ground comes up.
    const curve = climb(aloft.km);
    aloft.tween = { curve, t: 0, duration: curve.duration, to: GROUND_KM, landing };
    // Turn back to the view you had before you left, as the ground comes up to meet you.
    const back = aloft.before ?? { alt: 15, az: loc.lat >= 0 ? 180 : 0, fov: DEFAULT_FOV };
    view.lookTo(back, { duration: curve.duration * 0.9 });
  }
  /**
   * Go to a point above the Earth that a link describes: `km` up, above where
   * `place` was at the moment `from` (which also fixes the frame you float still
   * in). Animated, you rise (or move) there; otherwise you're simply there.
   */
  function goAloft({ km, from, over, spin = 0 }, place, animate) {
    if (sensor.active) stopSensor();
    earth.load(loadEarthMaps, renderer);
    const wasUp = isAloft();
    km = Math.min(MAX_KM, Math.max(MIN_KM, km));
    // Over your own spot, or (turned round the Earth by hand) over somewhere else.
    const at = over ?? place;
    aloft.frame = horizonFrame(from, at, aloft.frame ?? new THREE.Matrix4());
    if (over) aloft.frame.premultiply(new THREE.Matrix4().makeRotationY(spin * D2R));
    aloft.dir = toVector3(surfaceDirection(at.lat, at.lon, from));
    aloft.takeoff = from;
    aloft.turned = !!over;
    aloft.spin = null;
    aloft.panned = true; // the link says where to look
    aloft.move = null;
    if (!wasUp) aloft.before = null;
    if (animate) {
      if (!wasUp) aloft.km = GROUND_KM;
      aloft.startedAt = performance.now();
      aloft.tween = wasUp ? { from: aloft.km, to: km, t: 0, duration: 1.5 } : climbTo(km);
    } else {
      aloft.km = km;
      aloft.tween = null;
    }
    beforeLookUp = null;
    view.setFree(true);
    setAloftUi(true);
  }

  /**
   * Glide round the Earth to float straight over `place`, at the same height. You
   * end up just as if you'd taken off from there now: the Earth still below you,
   * and the stars turned to match (you're over another part of the Earth).
   */
  function moveAloftOver(place, animate) {
    const ms = clock.ms;
    const frame = horizonFrame(ms, place);
    const dir = toVector3(surfaceDirection(place.lat, place.lon, ms));
    aloft.takeoff = ms;
    aloft.turned = false;
    aloft.spin = null;
    if (!animate) {
      aloft.frame.copy(frame);
      aloft.dir.copy(dir);
      aloft.move = null;
      return;
    }
    aloft.move = {
      from: new THREE.Quaternion().setFromRotationMatrix(aloft.frame),
      to: new THREE.Quaternion().setFromRotationMatrix(frame),
      fromDir: aloft.dir.clone(),
      toDir: dir,
      t: 0,
    };
  }
  const moveTurn = new THREE.Quaternion();
  function updateMove(dt) {
    const m = aloft.move;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / MOVE_SECONDS);
    const k = m.t < 0.5 ? 2 * m.t * m.t : 1 - (-2 * m.t + 2) ** 2 / 2;
    aloft.frame.makeRotationFromQuaternion(moveTurn.slerpQuaternions(m.from, m.to, k));
    // Along the great circle between the two places, at your height.
    const angle = m.fromDir.angleTo(m.toDir);
    if (angle > 1e-9) {
      const s = Math.sin(angle);
      aloft.dir
        .copy(m.fromDir)
        .multiplyScalar(Math.sin((1 - k) * angle) / s)
        .addScaledVector(m.toDir, Math.sin(k * angle) / s);
    }
    if (m.t >= 1) {
      aloft.dir.copy(m.toDir);
      aloft.move = null;
    }
  }

  // ---- Turning the Earth like a ball ----
  // Grab a point on the Earth and drag: you move round the Earth so that point stays
  // under your finger. The Earth seems to turn where it is, and the sky, seen from
  // your new place, turns with it.
  let grabbedAt = null; // the pointer's last position on screen
  let grabSpin = null; // how fast it was turning as you dragged
  const toJ2000 = new THREE.Matrix4();

  /**
   * The point on the Earth's surface under a screen point (J2000, a unit vector from
   * its centre). Off the edge of the Earth, the nearest point on its edge (or null,
   * with `edge` false).
   */
  function earthPointAt(x, y, edge = true) {
    const d = view.dirAt(x, y);
    const k = 1 + aloft.km / EARTH_RADIUS_KM; // you to the Earth's centre, in Earth radii
    const c = aloft.earthDir.clone().multiplyScalar(k);
    const b = d.dot(c);
    const disc = b * b - (k * k - 1);
    let p;
    if (disc >= 0 && b > 0) p = d.multiplyScalar(b - Math.sqrt(disc)).sub(c);
    else if (edge) p = d.multiplyScalar(Math.max(b, 0)).sub(c);
    else return null;
    return p.applyMatrix4(toJ2000.copy(aloft.frame).transpose()).normalize();
  }

  /** Turn the Earth and the sky together by `q` (J2000): you move round the Earth the other way. */
  function turnWorld(q) {
    aloft.dir.applyQuaternion(q.clone().invert());
    aloft.frame.multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
    aloft.turned = true;
  }

  function grabEarth(x, y) {
    if (!isAloft() || aloft.tween?.landing || aloft.move || !earth.mesh.visible) return false;
    if (!earthPointAt(x, y, false)) return false; // on empty space: turn the view instead
    aloft.spin = grabSpin = null;
    grabbedAt = [x, y];
    return true;
  }
  function dragEarth(x, y, dt) {
    if (!grabbedAt || !isAloft()) return;
    const from = earthPointAt(...grabbedAt);
    const to = earthPointAt(x, y);
    grabbedAt = [x, y];
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    turnWorld(q);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (angle < 1e-9) return;
    const axis = new THREE.Vector3(q.x, q.y, q.z).normalize().multiplyScalar(Math.sign(q.w) || 1);
    grabSpin = { axis, rate: angle / dt };
  }
  function letGoOfEarth(gliding) {
    // Let go while it's turning, and it carries on a little, slowing to a stop.
    if (gliding && grabSpin && isAloft()) aloft.spin = grabSpin;
    grabbedAt = grabSpin = null;
  }
  function updateSpin(dt) {
    const sp = aloft.spin;
    if (!sp) return;
    turnWorld(new THREE.Quaternion().setFromAxisAngle(sp.axis, sp.rate * dt));
    sp.rate *= Math.exp(-dt * 3);
    if (sp.rate < 0.002) aloft.spin = null;
  }

  /**
   * Where you are over the Earth, for a link, once you've turned it by hand: the
   * place below you at the moment you took off, and how the view has turned about
   * straight down, compared with taking off from there.
   */
  function aloftOver() {
    const { x, y, z } = earthAxes(aloft.takeoff);
    const d = aloft.dir;
    const over = {
      lat: Math.asin(Math.max(-1, Math.min(1, d.x * z.x + d.y * z.y + d.z * z.z))) * R2D,
      lon: Math.atan2(d.x * y.x + d.y * y.y + d.z * y.z, d.x * x.x + d.y * x.y + d.z * x.z) * R2D,
    };
    const turn = aloft.frame.clone().multiply(horizonFrame(aloft.takeoff, over).transpose());
    const ex = new THREE.Vector3(1, 0, 0).applyMatrix4(turn);
    return { over, spin: Math.atan2(-ex.z, ex.x) * R2D };
  }

  /** Straight back on the ground, with no flight down (a link to the ground opened while you're up). */
  function landNow() {
    aloft.frame = aloft.dir = aloft.tween = aloft.move = aloft.spin = null;
    aloft.km = 0;
    view.setFree(false);
    setAloftUi(false);
  }

  /** Go higher (factor > 1) or lower, from wherever the last change was heading. */
  /** Taking off: up to `km` (see climb.js). */
  function climbTo(km) {
    const curve = climb(km);
    return { curve, t: 0, duration: curve.duration, to: km, rise: true };
  }
  function changeHeight(factor) {
    if (!isAloft() || aloft.tween?.landing) return;
    const to = Math.min(MAX_KM, Math.max(MIN_KM, (aloft.tween?.to ?? aloft.km) * factor));
    aloft.tween = { from: aloft.km, to, t: 0, duration: 1.2 };
  }
  riseBtn.addEventListener("click", () => (isAloft() ? comeDown() : riseUp()));
  $("alt-up").addEventListener("click", () => changeHeight(3));
  $("alt-down").addEventListener("click", () => changeHeight(1 / 3));

  const liveFrame = new THREE.Matrix4();
  const fromTurn = new THREE.Quaternion();
  const toTurn = new THREE.Quaternion();
  function updateAloft(dt) {
    if (isAloft()) updateMove(dt);
    if (isAloft()) updateSpin(dt);
    const tw = aloft.tween;
    if (!isAloft() || !tw) return;
    tw.t = Math.min(tw.duration, tw.t + dt);
    const p = tw.duration > 0 ? tw.t / tw.duration : 1;
    const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
    if (tw.curve) {
      // Taking off or landing (see climb.js); landing runs the climb backwards.
      aloft.km = tw.curve.kmAt(tw.landing ? tw.duration - tw.t : tw.t);
    } else {
      // Higher or lower: evenly in scale, so a kilometre near the ground counts as
      // much as a thousand far out.
      aloft.km = Math.exp(Math.log(tw.from) + (Math.log(tw.to) - Math.log(tw.from)) * ease(p));
    }
    // Once the ground has dropped away, turn slowly to look down at the Earth
    // (unless you've already started looking around yourself).
    if (tw.rise && !aloft.panned && performance.now() - aloft.startedAt > 1200) {
      aloft.panned = true;
      if (view.touchedAt() < aloft.startedAt && !sensor.active)
        view.lookTo(earthBelowView(view.state.fov), { duration: 7 });
    }
    if (tw.landing) {
      // Swing round to your spot, and back into the ground's own frame, high up,
      // before the land comes into view.
      const k = ease(Math.min(1, p / 0.75));
      horizonFrame(clock.ms, loc, liveFrame);
      fromTurn.setFromRotationMatrix(tw.landing.frame);
      toTurn.setFromRotationMatrix(liveFrame);
      aloft.frame.makeRotationFromQuaternion(fromTurn.slerp(toTurn, k));
      const over = toVector3(surfaceDirection(loc.lat, loc.lon, clock.ms));
      aloft.dir.copy(tw.landing.dir).lerp(over, k).normalize();
      if (p >= 1) {
        // Down: back on the ground, in its own (turning) frame.
        aloft.frame = aloft.dir = aloft.tween = null;
        aloft.km = 0;
        view.setFree(false);
        setAloftUi(false);
        return;
      }
    }
    if (p >= 1) aloft.tween = null;
  }

  /** Where you are above the Earth, for computeSky (null on the ground). */
  function abovePoint() {
    if (!isAloft()) return null;
    const r = (EARTH_RADIUS_KM + aloft.km) / AU_KM;
    return {
      posAU: { x: aloft.dir.x * r, y: aloft.dir.y * r, z: aloft.dir.z * r },
      eqjToWorld: aloft.frame,
      air: Math.exp(-aloft.km / 8), // the air thins by about e every 8 km
    };
  }

  const earthTurn = new THREE.Matrix4();
  const toEarth = new THREE.Matrix3();
  /** Aim the Earth below you, turned as it is right now. */
  function updateEarth(sunE, airGlow) {
    const up = isAloft() && aloft.km > 0.005;
    earth.mesh.visible = up;
    if (!isAloft()) {
      aloft.earthRadius = 0;
      return;
    }
    const height = aloft.km / EARTH_RADIUS_KM;
    aloft.earthDir.copy(aloft.dir).applyMatrix4(aloft.frame).negate().normalize();
    aloft.earthRadius = Math.asin(1 / (1 + height));
    if (!up) return;
    const { x, y, z } = earthAxes(clock.ms);
    earthTurn.makeBasis(toVector3(x), toVector3(y), toVector3(z)).premultiply(aloft.frame);
    toEarth.setFromMatrix4(earthTurn).transpose();
    earth.update({ earthDir: aloft.earthDir, heightRadii: height, toEarth, sunDir: sky.sun.trueDir, sunE, airGlow });
  }

  /** Your spot on the Earth, while you're up: where it is now, if it's on the side facing you. */
  function yourSpot() {
    const spot = toVector3(surfaceDirection(loc.lat, loc.lon, clock.ms));
    const you = aloft.dir.clone().multiplyScalar(1 + aloft.km / EARTH_RADIUS_KM);
    const toYou = you.clone().sub(spot);
    if (spot.dot(toYou) <= 0) return null; // round the far side
    return toYou.negate().applyMatrix4(aloft.frame).normalize();
  }

  function altitudeText(km) {
    if (km < 10) return `${km.toFixed(1)} km up`;
    return km < 10000
      ? `${Math.round(km).toLocaleString("en-GB")} km up`
      : `${Math.round(km / 1000).toLocaleString("en-GB")},000 km up`;
  }

  /** Where you are, from the Earth's centre (J2000, AU): up above it, or on the ground. */
  function youFromEarth() {
    if (isAloft()) return abovePoint().posAU;
    const s = surfaceDirection(loc.lat, loc.lon, clock.ms);
    const r = EARTH_RADIUS_KM / AU_KM;
    return { x: s.x * r, y: s.y * r, z: s.z * r };
  }

  // Lines and labels that belong to the ground fade out as you leave it, and the
  // ones for space fade in as you get up there (and the other way round coming down).
  const GROUND_LINES = ["sunPath", "seasonPaths", "altAzGrid", "compass", "moonPath"];
  const SPACE_LINES = ["moonOrbit", "earthOrbit", "planetOrbits"];
  let onGround = 1;
  let inSpace = 0;
  let monthMarks = [];
  function updatePlaceLayers(km) {
    onGround = 1 - smooth(0.01, 2, km);
    inSpace = smooth(2, 400, km);
    for (const key of GROUND_LINES) setFade(overlays.layers[key], layers[key] ? onGround : 0);
    for (const key of SPACE_LINES) setFade(orbits.layers[key], layers[key] ? inSpace : 0);
    monthMarks = [];
    const on = Object.fromEntries(SPACE_LINES.map((key) => [key, layers[key] && inSpace > 0]));
    if (!on.earthOrbit && layers.monthMarks && inSpace > 0.5) on.earthOrbit = true; // (for the marks)
    if (!Object.values(on).some(Boolean)) return;
    const you = youFromEarth();
    const { o } = orbits.update(clock.ms, you, on);
    if (layers.monthMarks && inSpace > 0.5) monthMarks = orbits.monthMarks(o, you);
  }

  // ---- Point your phone at the sky ----
  const sensorBtn = $("sensor-btn");
  const toast = $("toast");
  let toastTimer = 0;
  function showToast(text, ms = 6000) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), ms);
  }
  function stopSensor() {
    sensor.stop();
    sensorBtn.setAttribute("aria-pressed", "false");
  }
  if (sensorSupported()) {
    sensorBtn.hidden = false;
    sensorBtn.addEventListener("click", async () => {
      if (sensor.active) {
        stopSensor();
        return;
      }
      try {
        await sensor.start();
        sensorBtn.setAttribute("aria-pressed", "true");
        beforeLookUp = null;
        if (lookingUp()) view.lookTo({ fov: DEFAULT_FOV });
        if (!clock.following) clock.now(); // the real sky, right now
        showToast("Hold your phone up to the sky. If it doesn't line up, drag sideways to turn the sky into place.");
        // No readings at all usually means a desktop browser or a blocked sensor.
        setTimeout(() => {
          if (sensor.active && !sensor.orientation(new THREE.Quaternion())) {
            stopSensor();
            showToast("No motion sensor readings came through on this device.");
          } else if (sensor.active && !sensor.hasCompass) {
            showToast("No compass on this device, so north may be off. Drag sideways to line the sky up.");
          }
        }, 1500);
      } catch (err) {
        showToast(err.message || "Couldn't start the motion sensor.", 12000);
      }
    });
  }

  // ---- Share links: place, time, view and selection live in the URL fragment ----
  const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function selectionToLink(sel) {
    switch (sel?.type) {
      case "sun":
      case "moon":
        return { type: sel.type };
      case "planet":
        return { type: "planet", id: sel.id };
      case "star":
        return { type: "star", id: sel.star.proper || sel.star.hip };
      case "constellation":
        return { type: "con", id: sel.constellation.id };
      default:
        return null;
    }
  }

  function selectionFromLink(s) {
    const id = String(s?.id ?? "").toLowerCase();
    switch (s?.type) {
      case "sun":
        return selectSun();
      case "moon":
        return selectMoon();
      case "planet": {
        const p = PLANETS.find((pp) => pp.id.toLowerCase() === id);
        return p ? selectPlanet(p) : null;
      }
      case "star": {
        const star = catalog.stars.find((st) => String(st.hip) === id || st.proper?.toLowerCase() === id);
        return star ? selectStar(star) : null;
      }
      case "con": {
        const c = catalog.constellations.find((cc) => cc.id.toLowerCase() === id);
        return c ? selectConstellation(c) : null;
      }
      default:
        return null;
    }
  }

  function currentLink() {
    const place = locTween ? locTween.to : loc;
    return writeLink({
      body: DEFAULT_BODY,
      place,
      // Following the real clock: leave the time out, so the link opens on "now" for whoever follows it.
      time: clock.following ? null : clock.ms,
      view: view.state,
      selection: selectionToLink(selection),
      // Up above the Earth: how high (where you're heading, if you're on the way) and when you took off.
      up:
        isAloft() && !aloft.tween?.landing
          ? { km: aloft.tween?.to ?? aloft.km, from: aloft.takeoff, ...(aloft.turned ? aloftOver() : {}) }
          : null,
    });
  }

  /** Go to what a link describes. Anything it leaves out stays as it is. */
  function applyLink(l, { animate }) {
    if (!l) return;
    if (l.body && l.body !== DEFAULT_BODY) {
      showToast(`Standing on ${capitalise(l.body)} isn't possible yet, so here's the sky from Earth.`, 8000);
    }
    if (l.place) setLocation(location.fromLink(l.place.lat, l.place.lon, l.place.tz), animate);
    if (l.time != null) clock.set(l.time, { animate });
    if (l.up) goAloft(l.up, l.place ?? (locTween ? locTween.to : loc), animate);
    else if (isAloft() && l.place) {
      // A link to the ground: come down to it.
      if (animate) comeDown();
      else landNow();
    }
    select(selectionFromLink(l.selection));
    if (l.view) {
      if (sensor.active) stopSensor(); // a link says where to look
      beforeLookUp = null;
      view.lookTo(l.view);
      lastSun = null; // the link says where to look, so following the Sun starts from there
      if (!animate) view.update(10);
    }
  }

  // Keep the address bar in step (about once a second; replaceState doesn't add history).
  let lastLinkWrite = 0;
  let writtenHash = "";
  function updateLink(now) {
    if (now - lastLinkWrite < 1000) return;
    lastLinkWrite = now;
    const hash = `#${currentLink()}`;
    if (hash === writtenHash) return;
    writtenHash = hash;
    history.replaceState(null, "", hash);
  }

  // A link pasted into this tab, or edited by hand.
  window.addEventListener("hashchange", () => {
    if (window.location.hash === writtenHash) return;
    applyLink(readLink(window.location.hash), { animate: true });
  });

  $("share-btn").addEventListener("click", async () => {
    writtenHash = `#${currentLink()}`;
    history.replaceState(null, "", writtenHash);
    const url = window.location.href;
    const from = isAloft()
      ? `${altitudeText(aloft.tween?.to ?? aloft.km).replace(" up", "")} above ${loc.name}`
      : loc.name;
    const what = selection
      ? `${selection.name} from ${from}`
      : isAloft()
        ? `The Earth from ${from}`
        : `The sky from ${from}`;
    const text = clock.following ? `${what}, right now` : `${what}, ${formatDateTime(clock.ms, loc)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Planetarium", text, url });
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied. Send it to a friend and they'll see this sky.");
    } catch {
      window.prompt("Copy this link to share this sky:", url);
    }
  });

  // Keep floating controls clear of the time bar, whatever height it wraps to.
  const timebarEl = document.querySelector(".timebar");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--timebar-h", `${timebarEl.offsetHeight}px`);
  }).observe(timebarEl);

  // ---- Selection ----
  function selectionDir() {
    if (!selection || !sky) return null;
    switch (selection.type) {
      case "sun":
        return sky.sun.dir;
      case "moon":
        return sky.moon.dir;
      case "planet":
        return sky.planets.find((p) => p.id === selection.id).dir;
      case "star":
        return selection.star.position(sky).dir;
      case "constellation":
        return selection.constellation.position(sky).dir;
      case "feature":
        return (selection.feature.dir ??= dirFromAltAz(selection.feature.alt, selection.feature.az));
      default:
        return null;
    }
  }

  function select(sel, { look = false } = {}) {
    selection = sel;
    overlays.selectConstellation(sel?.type === "constellation" ? sel.constellation.id : null);
    if (sel && infoPanel.classList.contains("collapsed")) {
      infoPanel.classList.remove("collapsed");
      $("info-btn").setAttribute("aria-pressed", "true");
    }
    if (look) lookAtSelection();
    info.update(true);
  }

  function lookAtSelection() {
    const d = selectionDir();
    if (!d) return;
    let fov = view.state.fov;
    if (selection.type === "moon" || selection.type === "sun") fov = Math.min(fov, 20);
    if (selection.type === "constellation") fov = Math.max(fov, 50);
    const { az } = altAz(d);
    // Behind the ground or the hills: face its direction, just above the skyline.
    if (selection.type !== "feature" && behindLand(d, 0))
      view.lookTo({ alt: Math.max(12, skylineAlt(az) + 8), az, fov: Math.max(fov, 60) });
    else view.lookAt(d, fov);
  }

  /** Jump to an eclipse's peak (moving to `place` first, if given) and look at the Sun or Moon. */
  function goToEclipse(body, ms, place) {
    // A lunar eclipse happens at night: no use for the glasses.
    if (glasses && body === "moon") setGlasses(false);
    const dest = place ? location.fromPoint(place.lat, place.lon) : loc;
    if (place) setLocation(dest, true);
    clock.set(ms);
    if (glasses) {
      // Already looking at the Sun, and the view follows it through the jump
      // (see followSun), so turning to it as well would turn twice.
      select(selectSun());
      return;
    }
    // Aim using the sky as it will be there and then, not as it is now.
    sky = computeSky(ms, dest);
    select(body === "moon" ? selectMoon() : selectSun(), { look: true });
  }

  const selectSun = () => ({ type: "sun", name: "Sun" });
  const selectMoon = () => ({ type: "moon", name: "Moon" });
  const selectPlanet = (p) => ({ type: "planet", id: p.id, name: p.name });
  const selectStar = (s) => ({ type: "star", name: s.name, star: s });
  const selectConstellation = (c) => ({ type: "constellation", name: c.name, constellation: c });
  const selectFeature = (f) => ({ type: "feature", name: f.name, feature: f });

  /** Mountains, towns and landmarks to label, as the layers allow. */
  function shownFeatures() {
    // (Rising, they fall away with their hills, until the land fades below.)
    if ((isAloft() && aloft.km > 3) || flight || skylineFade <= 0.5 || !skyline?.features) return [];
    return skyline.features.filter((f) => (f.group === "peak" ? layers.peakNames : layers.placeNames));
  }
  const FEATURE_PRIORITY = { city: 37, town: 33, village: 27, lighthouse: 34, observatory: 36, tower: 25, mast: 24 };
  const featurePriority = (f) =>
    f.group === "peak" ? 30 + Math.min(8, f.height / 200) : FEATURE_PRIORITY[f.kind] + (f.named ? 2 : 0);

  /**
   * Fly to a mountain's summit (or a town, or a lighthouse), still facing the same way.
   * Skylines are worked out at points along the route first, climbing up and over and
   * down again, then the view blends through them as you go: peaks ahead grow, the
   * land drops away.
   */
  let takingOff = false;
  async function flyTo(p) {
    if (takingOff || flight) return;
    const here = location.fromPoint(p.lat, p.lon);
    const dest = { ...here, name: p.named ? p.name : here.name };
    if (p.group === "peak") dest.ele = p.ele ?? p.height;
    const from = locTween ? locTween.to : loc;
    const start = skyline;
    if (!start || !layers.terrain) return setLocation(dest, true);
    takingOff = true;
    showToast(`Taking off for ${p.name}…`, 30000);
    try {
      const final = await terrain.ensure(dest);
      if (!final) throw new Error("No terrain there");
      const steps = Math.max(6, Math.min(14, Math.round(p.distance * 1.2)));
      const startEye = start.ground + 2;
      const endEye = final.ground + 2;
      const climb = Math.min(1200, 150 + 60 * p.distance); // metres above the straight line
      const frames = [start.altitude];
      // The frames' water is coarser; match the ends to it.
      const coarse = (p) => p.water && thinWater(p.water, p.waterCols, SKYLINE_SAMPLES);
      const water = [coarse(start)];
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const eye = startEye + (endEye - startEye) * t + climb * Math.sin(Math.PI * t);
        const lat = from.lat + (dest.lat - from.lat) * t;
        const lon = from.lon + (dest.lon - from.lon) * t;
        const frame = await computeProfile(lat, lon, { eye, fast: true });
        if (!frame) throw new Error("No terrain along the way");
        frames.push(frame.altitude);
        water.push(frame.water);
      }
      frames.push(final.altitude);
      water.push(coarse(final));
      let top = 0;
      for (const f of frames) for (const v of f) top = Math.max(top, v);
      const view = {
        altitude: new Float32Array(final.altitude.length),
        water: new Uint8Array(WATER_ROWS * SKYLINE_SAMPLES),
        max: top,
        ground: final.ground,
      };
      flight = { frames, water, final, top, view };
      toast.hidden = true;
      setLocation(dest, true, { duration: Math.min(7, Math.max(3, 2.5 + p.distance * 0.3)) });
    } catch (err) {
      console.warn("Couldn't plan the flight", err);
      toast.hidden = true;
      setLocation(dest, true);
    } finally {
      takingOff = false;
    }
  }

  createSearch([
    { name: "Sun", kind: "Star", select: () => select(selectSun(), { look: true }) },
    { name: "Moon", kind: "Moon", select: () => select(selectMoon(), { look: true }) },
    ...PLANETS.map((p) => ({ name: p.name, kind: "Planet", select: () => select(selectPlanet(p), { look: true }) })),
    ...catalog.named.map((s) => ({
      name: s.proper,
      kind: `Star · mag ${s.mag.toFixed(1)}`,
      select: () => select(selectStar(s), { look: true }),
    })),
    ...catalog.constellations.map((c) => ({
      name: c.name,
      kind: "Constellation",
      select: () => select(selectConstellation(c), { look: true }),
    })),
  ]);

  // ---- Picking ----
  function screenOf(dir) {
    const p = projection.project(dir);
    if (!p) return null;
    return [(p.x * 0.5 + 0.5) * canvas.clientWidth, (-p.y * 0.5 + 0.5) * canvas.clientHeight];
  }

  function pick(x, y) {
    if (!sky) return;
    const below = (d) => behindLand(d);
    let best = null;
    let bestScore = Infinity;
    const consider = (dir, radiusPx, bonus, make) => {
      if (below(dir)) return;
      const s = screenOf(dir);
      if (!s) return;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d > radiusPx) return;
      const score = d - bonus;
      if (score < bestScore) [bestScore, best] = [score, make];
    };
    const pxPerRad = canvas.clientHeight / (view.state.fov * (Math.PI / 180));
    consider(sky.sun.dir, Math.max(20, shownRadius(sky.sun) * pxPerRad + 6), 10, selectSun);
    consider(sky.moon.dir, Math.max(20, shownRadius(sky.moon) * pxPerRad + 6), 10, selectMoon);
    for (const p of sky.planets) consider(p.dir, 18, 6, () => selectPlanet(p));
    // Mountains, towns and landmarks: the label sits centred just above the spot.
    {
      for (const p of isAloft() ? [] : shownFeatures()) {
        const s = p.dir && screenOf(p.dir);
        if (!s) continue;
        const dx = x - s[0];
        const dy = y - (s[1] - 16);
        const onLabel = Math.abs(dx) < p.name.length * 3.5 + 6 && Math.abs(dy) < 10;
        if (!onLabel && Math.hypot(x - s[0], y - s[1]) > 12) continue;
        const score = Math.min(Math.hypot(dx, dy), Math.hypot(x - s[0], y - s[1])) - 8;
        if (score < bestScore) [bestScore, best] = [score, () => selectFeature(p)];
      }
    }
    for (const s of catalog.stars) {
      if (s.mag > globalLimit + 0.5) break; // sorted by magnitude
      consider(s.position(sky).dir, 14, Math.max(0, 4 - s.mag) * 1.5, () => selectStar(s));
    }
    if (best) return select(best());
    // Otherwise: which constellation is that patch of sky in?
    const dir = view.dirAt(x, y);
    if (below(dir)) return select(null);
    const eqj = dir.clone().applyMatrix4(sky.eqjToWorld.clone().transpose());
    const ra = (Math.atan2(eqj.y, eqj.x) * R2D + 360) % 360;
    const dec = Math.asin(eqj.z) * R2D;
    const con = A.Constellation(ra / 15, dec);
    const c = catalog.constellations.find((cc) => cc.id === con.symbol);
    select(c ? selectConstellation(c) : null);
  }

  // ---- Paths that change slowly ----
  let sunHoursKey = "";
  let sunHours = [];
  let moonPathAt = 0;
  let moonPathLoc = "";
  let moonPathReal = 0;
  function updatePaths(now) {
    const dayStart = startOfLocalDay(clock.ms, loc);
    const locKey = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    if (layers.sunPath) {
      const eqd = A.Equator(Body.Sun, sky.time, sky.obs, true, true);
      overlays.updateSunPath(eqd.dec);
      const key = `${dayStart}|${locKey}`;
      if (key !== sunHoursKey) {
        sunHoursKey = key;
        sunHours = overlays.sunHours(sky.obs, dayStart);
      }
    }
    if (
      layers.moonPath &&
      (Math.abs(clock.ms - moonPathAt) > 20 * 60000 || locKey !== moonPathLoc) &&
      now - moonPathReal > 150
    ) {
      overlays.updateMoonPath(sky.obs, clock.ms);
      moonPathAt = clock.ms;
      moonPathLoc = locKey;
      moonPathReal = now;
    }
  }

  // ---- Labels ----
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((t, i) => ({
    key: `cmp${t}`,
    text: t,
    cls: t.length === 1 ? "compass" : "compass minor",
    dir: dirFromAltAz(0.6, i * 45),
  }));
  const tmp = new THREE.Vector3();

  // Put a disc's label just outside its edge, however far you zoom in.
  /**
   * How much bigger to draw the Sun and Moon. Zoomed out, a true-size Moon is a few
   * pixels across, far smaller than it looks to the eye (a phone held up covers about
   * 30° of sky, not the 80° it shows). Zoomed in close, it's drawn true to size.
   */
  function bodyScale() {
    if (!layers.bigBodies) return 1;
    const t = Math.min(1, Math.max(0, (view.state.fov - 3) / (60 - 3)));
    return 1 + 2.5 * t * t * (3 - 2 * t);
  }
  const shownRadius = (body) => body.angularRadius * bodyScale();

  function edgeOffset(body) {
    const px = shownRadius(body) * (canvas.clientHeight / (view.state.fov * (Math.PI / 180)));
    const k = Math.max(12, px * 0.75 + 6);
    return [k, -k];
  }

  function buildLabels() {
    const items = [];
    const hidden = (d) => behindLand(d);
    if (layers.planetLabels) {
      if (!hidden(sky.sun.dir))
        items.push({
          key: "sun",
          text: "Sun",
          dir: sky.sun.dir,
          cls: "body sun",
          priority: 100,
          always: true,
          offset: edgeOffset(sky.sun),
        });
      if (!hidden(sky.moon.dir)) {
        // Near the Sun (as in a solar eclipse), put the Moon's name below its disc
        // rather than on top of the Sun's.
        const [dx, dy] = edgeOffset(sky.moon);
        const nearSun = sky.moon.dir.angleTo(sky.sun.dir) < 3 * (shownRadius(sky.sun) + shownRadius(sky.moon));
        items.push({
          key: "moon",
          text: "Moon",
          dir: sky.moon.dir,
          cls: "body moon",
          priority: 99,
          always: true,
          offset: nearSun ? [dx, -dy] : [dx, dy],
        });
      }
      for (const p of sky.planets) {
        if (hidden(p.dir)) continue;
        items.push({
          key: p.id,
          text: p.name,
          dir: p.dir,
          cls: `body${p.mag > globalLimit ? " dim" : ""}`,
          priority: 90 - p.mag,
          always: true,
        });
      }
    }
    const zoomBoost = Math.max(0, Math.log2(70 / view.state.fov)) * 1.2;
    if (layers.starNames) {
      const limit = Math.min(globalLimit, 2.2 + zoomBoost);
      for (const s of catalog.named) {
        if (s.mag > limit) break;
        const d = s.position(sky).dir;
        if (hidden(d)) continue;
        items.push({ key: `s${s.hip}`, text: s.proper, dir: d, cls: "star", priority: 50 - s.mag });
      }
    }
    if (layers.constellationNames) {
      for (const c of catalog.constellationLabels) {
        const d = refract(eqVector(c.ra, c.dec, tmp).applyMatrix4(sky.eqjToWorld).normalize()).clone();
        if (hidden(d)) continue;
        items.push({
          key: c.key,
          text: c.name,
          dir: d,
          cls: "constellation",
          priority: 20,
          offset: [-c.name.length * 4, -6],
        });
      }
    }
    {
      for (const p of shownFeatures()) {
        p.dir ??= dirFromAltAz(p.alt, p.az);
        // Risen up, it has sunk with the land (see sinkLand).
        const dir = isAloft() ? dirFromAltAz(sinkAngle(p.alt, aloft.km, typicalDistance(skyline)), p.az) : p.dir;
        const chosen = selection?.type === "feature" && selection.feature === p;
        items.push({
          key: `f${p.id}`,
          text: p.name,
          dir,
          cls: `feature ${p.group} ${p.kind}${chosen ? " selected" : ""}`,
          priority: chosen ? 1000 : featurePriority(p),
          always: chosen,
          offset: [-p.name.length * 3, -16],
        });
      }
    }
    if (layers.compass && onGround > 0.5) {
      for (const c of COMPASS) items.push({ ...c, priority: 200, always: true, offset: [-5, -14] });
    }
    // Up above the Earth: where you came from, carried round as the Earth turns.
    if (isAloft() && earth.mesh.visible && layers.spot) {
      const spot = yourSpot();
      if (spot)
        items.push({ key: "you", text: loc.name, dir: spot, cls: "you", priority: 300, always: true, offset: [-6, 0] });
    }
    // The orbits' names, along them, in their own colours.
    if (inSpace > 0.5) {
      for (const o of orbits.names()) {
        const d = o.dir.clone().applyMatrix4(sky.eqjToWorld);
        if (hidden(d)) continue;
        items.push({ key: o.key, text: o.text, dir: d, cls: o.cls, priority: 27, offset: [6, -8] });
      }
    }
    // Where the Earth will be on the first of each month, along its orbit.
    for (const m of monthMarks) {
      const d = m.dir.clone().applyMatrix4(sky.eqjToWorld);
      if (m.hidden || hidden(d)) continue;
      items.push({ key: m.key, text: m.text, dir: d, cls: "month", priority: 28, offset: [-3, 0] });
    }
    if (layers.sunPath && onGround > 0.5) {
      for (const h of sunHours) {
        if (hidden(h.dir)) continue;
        items.push({
          key: `h${h.ms}`,
          text: `· ${formatTime(h.ms, loc)}`,
          dir: h.dir,
          cls: "hour",
          priority: 30,
          offset: [-3, 0],
        });
      }
    }
    if (layers.seasonPaths && onGround > 0.5) {
      for (const s of overlays.seasonLabelDirs(loc.lat)) {
        if (hidden(s.dir)) continue;
        items.push({ key: s.key, text: s.text, dir: s.dir, cls: "path", priority: 25, offset: [6, -10] });
      }
    }
    const sd = selectionDir();
    // (A chosen mountain's name is highlighted instead of ringed.)
    if (sd && selection.type !== "constellation" && selection.type !== "feature") {
      const angR =
        selection.type === "moon" ? shownRadius(sky.moon) : selection.type === "sun" ? shownRadius(sky.sun) : 0;
      const px = angR * (canvas.clientHeight / (view.state.fov * (Math.PI / 180)));
      if (px < 14)
        items.push({
          key: "sel",
          text: "",
          dir: sd,
          cls: "selected-ring",
          priority: 1000,
          always: true,
          noCollide: true,
          offset: [0, 7],
          width: 0,
        });
    }
    // Dark text where the sky behind a label is bright, light text where it's dark.
    for (const it of items) if (it.cls !== "selected-ring" && litBehind(it.dir)) it.cls += " lit";
    return items;
  }

  // ---- How bright the sky is behind labels ----
  // At dusk the glow over the sunset is far brighter than the sky overall, so each
  // label looks at the sky right behind it, sampled a few times a second on a
  // coarse grid (overhead, the top row stands in).
  const GLOW_ALTS = [1, 5, 12, 25, 45, 70];
  const GLOW_AZ = 24;
  const glow = new Float32Array(GLOW_AZ * GLOW_ALTS.length);
  let glowAt = -Infinity;
  function updateGlow(now, atm, lights, ambient) {
    if (now - glowAt < 300) return;
    glowAt = now;
    for (let j = 0; j < GLOW_ALTS.length; j++) {
      for (let i = 0; i < GLOW_AZ; i++) {
        dirFromAltAz(GLOW_ALTS[j], (i * 360) / GLOW_AZ, tmp);
        glow[j * GLOW_AZ + i] = luminance(skyRadiance(atm, tmp, lights, 8, 4, ambient));
      }
    }
  }
  function litBehind(dir) {
    const { alt, az } = altAz(dir);
    // Below the skyline it's the land behind the label (or the dark seen through it).
    if (alt < skylineAlt(az) - 0.3) return false;
    const a = Math.min(GLOW_ALTS[GLOW_ALTS.length - 1] - 1e-6, Math.max(GLOW_ALTS[0], alt));
    let j = 0;
    while (a > GLOW_ALTS[j + 1]) j++;
    const fy = (a - GLOW_ALTS[j]) / (GLOW_ALTS[j + 1] - GLOW_ALTS[j]);
    const x = (az / 360) * GLOW_AZ;
    const i = Math.floor(x) % GLOW_AZ;
    const i2 = (i + 1) % GLOW_AZ;
    const fx = x - Math.floor(x);
    const row = (r) => glow[r * GLOW_AZ + i] * (1 - fx) + glow[r * GLOW_AZ + i2] * fx;
    // Brightness on screen, before tone mapping: a mid-tone sky and up wants dark text.
    return (row(j) * (1 - fy) + row(j + 1) * fy) * exposure > 0.22;
  }

  // ---- Resize ----
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    labels.resize(w, h);
    shared.uPixelRatio.value = renderer.getPixelRatio();
  }
  window.addEventListener("resize", resize);
  resize();

  // Handy from the browser console, e.g. planetarium.clock.set(Date.parse("2027-08-02T10:00Z"))
  window.planetarium = {
    clock,
    view,
    scene,
    setLocation: (l) => setLocation(l, true),
    getSky: () => sky,
    getSkyline: () => skyline,
    getAloft: () => aloft,
  };

  // ---- The land falling away as you rise ----
  // From h km higher, land d km away sinks from angle a to atan(tan a − h/d). The
  // whole skyline sinks together, as if it were all at the skyline's typical
  // distance, so it keeps its shape as it drops (the real near ridges would drop
  // faster than the far mountains beside them, tearing the skyline into walls).
  // With no hills, the land meets the sky about 5 km away (the horizon, standing).
  const FLAT_KM = 5;
  const sunk = new Float32Array(SKYLINE_SAMPLES);
  let landSunk = false;
  let landDistance = { profile: undefined, km: FLAT_KM };
  /** The skyline's typical distance (km): its median, within reason. */
  function typicalDistance(p) {
    if (landDistance.profile !== p) {
      const d = p ? Array.from(p.distance).filter((x) => x > 0) : [];
      d.sort((a, b) => a - b);
      landDistance = { profile: p, km: d.length ? Math.min(30, Math.max(3, d[d.length >> 1])) : FLAT_KM };
    }
    return landDistance.km;
  }
  /** The land's angle (degrees) seen from `km` higher than standing. */
  const sinkAngle = (deg, km, d) => Math.atan(Math.tan(deg * D2R) - km / d) * R2D;
  function sinkLand(km) {
    const p = skylineFade > 0.5 ? skyline : null;
    const d = typicalDistance(p);
    let top = -90;
    for (let j = 0; j < SKYLINE_SAMPLES; j++) {
      sunk[j] = sinkAngle(p ? p.altitude[j] : 0, km, d);
      top = Math.max(top, sunk[j]);
    }
    ground.setSkylineAltitudes(sunk, Math.max(top, 0));
    landSunk = true;
  }

  // ---- Frame loop ----
  const ZENITH = new THREE.Vector3(0, 1, 0);
  const GROUND_ALBEDO = 0.11; // as drawn in bodies.js
  let last = performance.now();
  let firstFrame = true;
  let lastNight = -1;
  let lastAverage = 0;
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock.update(dt);
    updateLocationTween(dt);
    view.update(dt);
    projection.update(view.state.fov, camera.aspect);

    updateAloft(dt);
    sky = computeSky(clock.ms, loc, abovePoint());
    followSun();
    // Rising, you look out through less and less air: from about 100 km up, none.
    const km = isAloft() ? aloft.km : 0;
    const air = Math.exp(-km / 8);
    const skyFade = 1 - smooth(60, 120, km);
    const atm = !layers.atmosphere
      ? NONE
      : km > 0
        ? {
            ...ATMOSPHERES.earth,
            observerHeight: Math.min(Math.max(km, 0.01), 90),
            nightGlow: ATMOSPHERES.earth.nightGlow.map((g) => g * skyFade),
          }
        : ATMOSPHERES.earth;
    atmosphere.setParams(atm);
    shared.uRefract.value = layers.atmosphere && layers.refraction && km < 2 ? 1 : 0;
    shared.uExtK.value = atm.extinctionK * air;

    // During an eclipse only the uncovered part of the Sun lights the sky. Even in
    // totality some light reaches us from beyond the Moon's shadow, so keep a little.
    const eclipse = sky.sun.visibleFraction < 1 ? Math.max(sky.sun.visibleFraction, 1e-5) : 1;
    const fullSunE = sky.sun.illuminance * eclipse;
    const sunE = fullSunE * sunLevel;
    // Skylight illuminance for the multiple-scattering term (from last frame's sky).
    const ambient = layers.atmosphere ? Math.PI * lastAverage : 0;
    const moonE = sky.moon.illuminance;
    atmosphere.render(sky.sun.trueDir, sunE * skyFade, sky.moon.trueDir, moonE * skyFade, ambient);

    // Eye adaptation from the average sky brightness.
    const lights = [
      { dir: sky.sun.trueDir, e: sunE * skyFade },
      { dir: sky.moon.trueDir, e: moonE * skyFade },
    ];
    const { average, zenith, peak } = averageSkyLuminance(atm, lights, ambient);
    lastAverage = average;

    // Seen through the earth, the Sun and Moon are drawn as if from above the air.
    const throughEarth = (b) => !isAloft() && !layers.ground && b.alt < skylineAlt(b.az) - 0.3;
    const sunThrough = throughEarth(sky.sun);
    const moonThrough = throughEarth(sky.moon);
    const tSun = transmittance(atm, sunThrough ? ZENITH : sky.sun.trueDir);
    const tMoon = transmittance(atm, moonThrough ? ZENITH : sky.moon.trueDir);
    const mean = (t) => (t[0] + t[1] + t[2]) / 3;
    // Direct light only reaches the ground once the Sun or Moon is over the hills.
    const overHills = (b) => smooth(-0.3, 0.3, b.alt - skylineAlt(b.az));
    const groundLight = (e) =>
      Math.PI * average +
      e * Math.max(0, sky.sun.trueDir.y) * mean(tSun) * overHills(sky.sun) +
      moonE * Math.max(0, sky.moon.trueDir.y) * mean(tMoon) * overHills(sky.moon);
    const groundE = groundLight(sunE);
    // Eye adaptation, worked out fresh every frame (no lag, so changing the time
    // never makes the sky dip and then brighten back). Adapting to the average
    // plus a share of the brightest part keeps brightness falling steadily
    // through sunset, rather than switching between the two.
    const adaptTo = (avg, pk) => avg + 0.25 * pk;
    let adapt = adaptTo(average, peak);
    if (sunLevel < 1 && fullSunE > 0) {
      // The dimmer only partly adapts, so sliding it down always makes the scene darker.
      const full = averageSkyLuminance(atm, [{ dir: sky.sun.trueDir, e: fullSunE * skyFade }, lights[1]], ambient);
      adapt = adaptTo(full.average, full.peak) ** 0.4 * adapt ** 0.6;
    }
    // With no atmosphere the sky is black, so the eye adapts to the sunlit ground
    // instead, which would otherwise glare white. It shows a mid grey, as on the Moon.
    if (!layers.atmosphere && layers.ground) {
      let groundL = (GROUND_ALBEDO * groundE) / Math.PI;
      if (sunLevel < 1) groundL = ((GROUND_ALBEDO * groundLight(fullSunE)) / Math.PI) ** 0.4 * groundL ** 0.6;
      adapt = Math.max(adapt, 3 * groundL);
    }
    // Up high, the eye adapts to the sunlit Earth as much of it as fills the view
    // (look away from it into the black, and the stars come out).
    updateEarth(sunE, skyFade);
    let earthSeen = 0;
    if (isAloft()) {
      const look = dirFromAltAz(view.state.alt, view.state.az);
      const half = (view.state.fov / 2) * D2R;
      const rho = aloft.earthRadius;
      const overlap = Math.min(1, Math.max(0, (rho + half - look.angleTo(aloft.earthDir)) / (2 * Math.min(rho, half))));
      const fills = overlap * Math.min(1, (rho / half) ** 2);
      const sunlit = 0.5 - 0.5 * sky.sun.trueDir.dot(aloft.earthDir);
      // A bright Earth anywhere in view sets the eye (like the daytime sky does), more
      // so the more of the view it fills.
      earthSeen = smooth(1, 40, km) * ((0.25 * sunE) / Math.PI) * (0.6 * overlap + 0.4 * fills) * sunlit;
      adapt += earthSeen;
    }
    // The constant stops the eye "turning up the gain" too far on dark nights; without
    // it, faint moonlight scattered near the horizon shows as a grey glowing band.
    exposure = 0.7 / (adapt + 0.5);
    // A solar eclipse you can see: offer the glasses. Once on, they stay on until you take them off.
    const eclipseUp = sky.sun.visibleFraction < 1 && sky.sun.alt > -1 && !sunThrough;
    const offerGlasses = eclipseUp || glasses;
    if (glassesBtn.hidden === offerGlasses) glassesBtn.hidden = !offerGlasses;
    // In totality the glasses show nothing at all: it's the one time to take them off.
    const glassesText = !glasses
      ? "Eclipse glasses"
      : sky.sun.visibleFraction < 1e-4
        ? "Totality! Take them off"
        : "Take glasses off";
    if (glassesLabel.textContent !== glassesText) glassesLabel.textContent = glassesText;
    // Through the glasses the eye adapts to the Sun's disc itself; everything else is black.
    // (Floored, so a Sun that has set, or been dimmed right down, can't send it soaring.)
    if (glasses) exposure = 1.5 / (SUN_LUMINANCE * Math.max(sunLevel, 1e-3) * Math.max(mean(tSun), 1e-3));
    shared.uExposure.value = exposure;
    shared.uScotopic.value = 0.6 * (1 - smooth(0.005, 1, average + earthSeen));
    // Labels and figures recede in daylight, like a printed overlay on a bright sky.
    const night = 1 - smooth(0.3, 300, average);
    if (Math.abs(night - lastNight) > 0.01) {
      lastNight = night;
      overlays.layers.constellations.material.uniforms.uOpacity.value = 0.14 + 0.24 * night;
    }
    globalLimit = 7.93 - 5 * Math.log10(1 + 63 * Math.sqrt(zenith));
    updateGlow(now, atm, lights, ambient);

    updateSkyline(dt);
    // Light reaching the water for its glitter: through the air, and over the hills.
    const lightOn = (b, e, t) => ({ dir: b.trueDir, light: t.map((c) => c * e * overHills(b)) });
    // Rising, the hills, lakes and sea fall away below you, and once they're far
    // below, the land fades into the Earth beneath (and the other way coming down).
    const fall = smooth(3, 15, km);
    ground.mesh.visible = fall < 1;
    if (isAloft() && fall < 1) sinkLand(km);
    else if (landSunk && !isAloft()) {
      landSunk = false;
      ground.setSkyline(flight ? null : skyline); // back on the ground: the land as it is
    }
    const eyeKm = Math.max(GROUND_KM, ((skyline?.ground ?? 0) + 2) / 1000);
    ground.update(groundE, skylineFade, lightOn(sky.sun, sunE, tSun), lightOn(sky.moon, moonE, tMoon), {
      fall,
      floor: isAloft() ? -Math.PI / 2 : 0,
      rise: isAloft() ? eyeKm / (eyeKm + km) : 1,
    });
    // Up above, nothing is hidden by the land: the Earth itself hides what's behind it
    // (and the sky below the level shows the air's glow, not the dark of see-through ground).
    shared.uSeeThrough.value = layers.ground || isAloft() ? 0 : 1;

    sun.update(sky.sun, tSun, sunLevel, exposure, camera, eclipse, bodyScale(), sunThrough, glasses, isAloft());
    moon.update(sky.moon, sky, tMoon, exposure, camera, bodyScale(), moonThrough, isAloft());
    planetPoints.update(sky.planets);
    overlays.updateFrames(sky);
    updatePlaceLayers(km);
    if (onGround > 0) updatePaths(now);

    renderer.render(scene, camera);
    labels.render(buildLabels(), projection.project);

    timebar.update();
    info.update();
    const { alt, az } = view.state;
    const up = lookingUp();
    const changed = up || awayFromDefault();
    if (resetBtn.disabled === changed) resetBtn.disabled = !changed;
    if (up !== (lookUpBtn.getAttribute("aria-pressed") === "true")) {
      lookUpBtn.setAttribute("aria-pressed", String(up));
      lookUpBtn.querySelector("span").textContent = up ? "Back to horizon" : "Look up";
    }
    const hfov = 2 * projection.halfFovX();
    compass.update({
      az,
      alt,
      hfov,
      sunAz: sky.sun.az,
      sunAlt: sky.sun.alt,
      moonAz: sky.moon.az,
      moonAlt: sky.moon.alt,
    });
    $("fov-label").textContent = `${view.state.fov < 10 ? view.state.fov.toFixed(1) : view.state.fov.toFixed(0)}°`;
    if (isAloft()) $("alt-label").textContent = altitudeText(aloft.km);

    if (firstFrame) {
      firstFrame = false;
      view.lookTo(defaultView(sky));
      view.update(10);
      applyLink(link, { animate: false });
      $("loading").classList.add("done");
    } else updateLink(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Re-sync to the real clock when returning to a background tab.
  let wasFollowing = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) wasFollowing = clock.following;
    else if (wasFollowing) clock.set(Date.now(), { animate: false });
  });
}

main().catch((err) => {
  console.error(err);
  const box = $("loading");
  box.querySelector("p").textContent = `Sorry, the sky failed to load: ${err.message || err}`;
});
