import * as THREE from "three";

import { A, altAz, Body, computeSky, dirFromAltAz, eqVector, PLANETS, R2D, refract } from "./astro.js";
import { Clock } from "./clock.js";
import { createProjection } from "./projection.js";
import {
  ATMOSPHERES,
  averageSkyLuminance,
  createAtmosphere,
  createSkyDome,
  NONE,
  transmittance,
} from "./scene/atmosphere.js";
import { createGround, createMoon, createSun } from "./scene/bodies.js";
import * as glsl from "./scene/glsl.js";
import { createOverlays } from "./scene/overlays.js";
import { createPlanetPoints, createPointsMaterial, createStars } from "./scene/points.js";
import { formatTime, startOfLocalDay } from "./timezone.js";
import { createCompass } from "./ui/compass.js";
import { createInfo } from "./ui/info.js";
import { createLabels } from "./ui/labels.js";
import { createLocation } from "./ui/location.js";
import { createLayersPanel, createSearch } from "./ui/panels.js";
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

  const stars = starData.stars.map(([hip, ra, dec, mag, bv]) => {
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
  const [starData, constellationData, cities, land, moonTex] = await Promise.all([
    loadJSON("data/stars.json"),
    loadJSON("data/constellations.json"),
    loadJSON("data/cities.json"),
    loadJSON("data/land.json"),
    loadTexture("textures/moon.jpg"),
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
  };

  scene.add(createSkyDome(shared, glsl));
  const overlays = createOverlays(shared, glsl, constellationData);
  scene.add(...overlays.groups);

  const starMaterial = createPointsMaterial(shared, glsl, 1000);
  overlays.eqj.add(createStars(starData, starMaterial));
  const planetPoints = createPlanetPoints(PLANETS, createPointsMaterial(shared, glsl, 1000));
  scene.add(planetPoints.points);

  moonTex.texture.colorSpace = THREE.NoColorSpace;
  moonTex.texture.wrapS = THREE.RepeatWrapping;
  moonTex.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const moon = createMoon(shared, glsl, moonTex.texture, moonTex.mean);
  const sun = createSun(shared, glsl);
  const ground = createGround(shared, glsl);
  scene.add(moon.mesh, sun.mesh, ground.mesh);

  const labels = createLabels($("labels"));

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

  const location = createLocation({
    cities,
    land,
    getTime: () => clock.ms,
    onChange: (next, { animate } = {}) => setLocation(next, animate),
  });

  function setLocation(next, animate) {
    location.set(next);
    if (!loc || !animate) {
      loc = { ...next };
      locTween = null;
      return;
    }
    let dLon = next.lon - loc.lon;
    dLon = ((dLon + 540) % 360) - 180;
    // Crossing the equator: turn around, so you keep facing the Sun's side of the sky
    // (south in the north, north in the south) and its daily path still makes sense.
    if (Math.sign(next.lat || 1) !== Math.sign(loc.lat || 1)) view.lookTo({ az: view.state.az + 180 });
    locTween = { from: { ...loc }, to: next, dLon, t: 0 };
  }

  function updateLocationTween(dt) {
    if (!locTween) return;
    locTween.t = Math.min(1, locTween.t + dt / 1.6);
    const k = locTween.t < 0.5 ? 2 * locTween.t ** 2 : 1 - (-2 * locTween.t + 2) ** 2 / 2;
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

  setLocation(location.initialGuess(), false);
  location.requestGeolocation();

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
  function defaultView(s, fov = DEFAULT_FOV) {
    const base = horizonAltitude(fov);
    const body = s.sun.alt > 3 ? s.sun : s.moon.alt > 3 ? s.moon : null;
    if (!body) return { alt: base, az: loc.lat >= 0 ? 180 : 0, fov };
    // Tilt up only as far as needed to keep the body comfortably on screen.
    return { alt: Math.max(base, body.alt - fov / 2 + 12), az: body.az, fov };
  }

  const view = createView(camera, canvas, { onClick: pick, unproject: projection.unproject });
  {
    view.lookTo(defaultView(computeSky(clock.ms, loc)));
    view.update(10);
    // (Aimed again after the first frame, once the time bar has its real height.)
  }
  $("zoom-in").addEventListener("click", () => view.zoom(0.6));
  $("zoom-out").addEventListener("click", () => view.zoom(1 / 0.6));

  // ---- Panels ----
  createLayersPanel({
    onChange: (l) => {
      layers = { ...l };
      for (const [key, obj] of Object.entries(overlays.layers)) obj.visible = !!layers[key];
    },
  });

  const timebar = createTimebar({ clock, getLocation: () => loc });

  const infoPanel = $("info");
  const info = createInfo({
    container: $("info-content"),
    catalog,
    getState: () => ({ sky, loc, ms: clock.ms, selection }),
    onLook: () => lookAtSelection(),
    onClear: () => select(null),
    onSelect: (type, id) => {
      if (type === "sun") select(selectSun(), { look: true });
      else if (type === "moon") select(selectMoon(), { look: true });
      else if (type === "planet") select(selectPlanet(PLANETS.find((p) => p.id === id)), { look: true });
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
      view.lookTo({ az: view.state.az + d });
      view.update(1); // apply immediately, no easing while dragging
    },
    onFace: (az) => view.lookTo({ az, alt: Math.max(view.state.alt, 5) }),
    onFaceBody: (id) => {
      const b = id === "sun" ? sky.sun : sky.moon;
      if (layers.ground && b.alt < 0) view.lookTo({ az: b.az, alt: 12 });
      else view.lookAt(b.dir);
    },
  });

  // ---- Look up: the whole dome of the sky at once ----
  const lookUpBtn = $("look-up");
  let beforeLookUp = null;
  const lookingUp = () => view.state.alt > 80 && view.state.fov > 140;
  lookUpBtn.addEventListener("click", () => {
    if (lookingUp()) {
      view.lookTo(beforeLookUp ?? defaultView(sky));
      beforeLookUp = null;
    } else {
      beforeLookUp = { alt: view.state.alt, az: view.state.az, fov: view.state.fov };
      // Facing direction ends up at the bottom of the screen, like lying on your back.
      view.lookTo({ alt: 89.9, fov: 180 });
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
    const { alt, az } = altAz(d);
    // Below a solid horizon: face its direction, just above the ground.
    if (layers.ground && alt < 0) view.lookTo({ alt: 12, az, fov: Math.max(fov, 60) });
    else view.lookAt(d, fov);
  }

  const selectSun = () => ({ type: "sun", name: "Sun" });
  const selectMoon = () => ({ type: "moon", name: "Moon" });
  const selectPlanet = (p) => ({ type: "planet", id: p.id, name: p.name });
  const selectStar = (s) => ({ type: "star", name: s.name, star: s });
  const selectConstellation = (c) => ({ type: "constellation", name: c.name, constellation: c });

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
    const below = (d) => layers.ground && d.y < -0.005;
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
    consider(sky.sun.dir, Math.max(20, sky.sun.angularRadius * pxPerRad + 6), 10, selectSun);
    consider(sky.moon.dir, Math.max(20, sky.moon.angularRadius * pxPerRad + 6), 10, selectMoon);
    for (const p of sky.planets) consider(p.dir, 18, 6, () => selectPlanet(p));
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
  function edgeOffset(body) {
    const px = body.angularRadius * (canvas.clientHeight / (view.state.fov * (Math.PI / 180)));
    const k = Math.max(12, px * 0.75 + 6);
    return [k, -k];
  }

  function buildLabels() {
    const items = [];
    const hidden = (d) => layers.ground && d.y < -0.004;
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
      if (!hidden(sky.moon.dir))
        items.push({
          key: "moon",
          text: "Moon",
          dir: sky.moon.dir,
          cls: "body moon",
          priority: 99,
          always: true,
          offset: edgeOffset(sky.moon),
        });
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
    if (layers.compass) {
      for (const c of COMPASS) items.push({ ...c, priority: 200, always: true, offset: [-5, -14] });
    }
    if (layers.sunPath) {
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
    if (layers.seasonPaths) {
      for (const s of overlays.seasonLabelDirs(loc.lat)) {
        if (hidden(s.dir)) continue;
        items.push({ key: s.key, text: s.text, dir: s.dir, cls: "path", priority: 25, offset: [6, -10] });
      }
    }
    const sd = selectionDir();
    if (sd && selection.type !== "constellation") {
      const angR =
        selection.type === "moon" ? sky.moon.angularRadius : selection.type === "sun" ? sky.sun.angularRadius : 0;
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
    return items;
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
  window.planetarium = { clock, view, scene, setLocation: (l) => setLocation(l, true), getSky: () => sky };

  // ---- Frame loop ----
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

    sky = computeSky(clock.ms, loc);
    const atm = layers.atmosphere ? ATMOSPHERES.earth : NONE;
    atmosphere.setParams(atm);
    shared.uRefract.value = layers.atmosphere && layers.refraction ? 1 : 0;
    shared.uExtK.value = atm.extinctionK;

    // During an eclipse only the uncovered part of the Sun lights the sky. Even in
    // totality some light reaches us from beyond the Moon's shadow, so keep a little.
    const eclipse = sky.sun.visibleFraction < 1 ? Math.max(sky.sun.visibleFraction, 1e-5) : 1;
    const fullSunE = sky.sun.illuminance * eclipse;
    const sunE = fullSunE * sunLevel;
    // Skylight illuminance for the multiple-scattering term (from last frame's sky).
    const ambient = layers.atmosphere ? Math.PI * lastAverage : 0;
    const moonE = sky.moon.illuminance;
    atmosphere.render(sky.sun.trueDir, sunE, sky.moon.trueDir, moonE, ambient);

    // Eye adaptation from the average sky brightness.
    const lights = [
      { dir: sky.sun.trueDir, e: sunE },
      { dir: sky.moon.trueDir, e: moonE },
    ];
    const { average, zenith, peak } = averageSkyLuminance(atm, lights, ambient);
    lastAverage = average;
    // Eye adaptation, worked out fresh every frame (no lag, so changing the time
    // never makes the sky dip and then brighten back). Adapting to the average
    // plus a share of the brightest part keeps brightness falling steadily
    // through sunset, rather than switching between the two.
    const adaptTo = (avg, pk) => avg + 0.25 * pk;
    let adapt = adaptTo(average, peak);
    if (sunLevel < 1 && fullSunE > 0) {
      // The dimmer only partly adapts, so sliding it down always makes the scene darker.
      const full = averageSkyLuminance(atm, [{ dir: sky.sun.trueDir, e: fullSunE }, lights[1]], ambient);
      adapt = adaptTo(full.average, full.peak) ** 0.4 * adapt ** 0.6;
    }
    exposure = 0.7 / (adapt + 0.03);
    shared.uExposure.value = exposure;
    shared.uScotopic.value = 0.6 * (1 - smooth(0.005, 1, average));
    // Labels and figures recede in daylight, like a printed overlay on a bright sky.
    const night = 1 - smooth(0.3, 300, average);
    if (Math.abs(night - lastNight) > 0.01) {
      lastNight = night;
      document.body.classList.toggle("bright-sky", night < 0.5);
      overlays.layers.constellations.material.uniforms.uOpacity.value = 0.14 + 0.24 * night;
    }
    globalLimit = 7.93 - 5 * Math.log10(1 + 63 * Math.sqrt(zenith));

    const tSun = transmittance(atm, sky.sun.trueDir);
    const tMoon = transmittance(atm, sky.moon.trueDir);
    const mean = (t) => (t[0] + t[1] + t[2]) / 3;
    const groundE =
      Math.PI * average +
      sunE * Math.max(0, sky.sun.trueDir.y) * mean(tSun) +
      moonE * Math.max(0, sky.moon.trueDir.y) * mean(tMoon);
    ground.update(groundE, layers.ground);

    sun.update(sky.sun, tSun, sunLevel, exposure, camera, eclipse);
    moon.update(sky.moon, sky, tMoon, exposure);
    planetPoints.update(sky.planets);
    overlays.updateFrames(sky);
    updatePaths(now);

    renderer.render(scene, camera);
    labels.render(buildLabels(), projection.project);

    timebar.update();
    info.update();
    const { alt, az } = view.state;
    const up = lookingUp();
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

    if (firstFrame) {
      firstFrame = false;
      view.lookTo(defaultView(sky));
      view.update(10);
      $("loading").classList.add("done");
    }
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
