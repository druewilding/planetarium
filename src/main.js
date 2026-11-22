import * as THREE from "three";

import { A, altAz, Body, computeSky, dirFromAltAz, eqVector, PLANETS, R2D, refract } from "./astro.js";
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
import { createGround, createMoon, createSun } from "./scene/bodies.js";
import * as glsl from "./scene/glsl.js";
import { createMilkyWay } from "./scene/milkyway.js";
import { createOverlays } from "./scene/overlays.js";
import { createPlanetPoints, createPointsMaterial, createStars } from "./scene/points.js";
import { computeProfile, createTerrain, skylineAt } from "./terrain.js";
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
  };

  scene.add(createSkyDome(shared, glsl));
  const overlays = createOverlays(shared, glsl, constellationData);
  scene.add(...overlays.groups);

  const starMaterial = createPointsMaterial(shared, glsl, 1000);
  const milkyWay = createMilkyWay(shared, glsl, milkyWayTex);
  overlays.eqj.add(milkyWay);
  overlays.eqj.add(createStars(starData, starMaterial));
  const planetPoints = createPlanetPoints(PLANETS, createPointsMaterial(shared, glsl, 1000));
  scene.add(planetPoints.points);

  moonTex.texture.colorSpace = THREE.NoColorSpace;
  moonTex.texture.wrapS = THREE.RepeatWrapping;
  moonTex.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const moon = createMoon(shared, glsl, moonTex.texture, moonTex.mean);
  const sun = createSun(shared, glsl);
  const ground = createGround(shared, glsl);
  scene.add(moon.mesh, moon.glow, sun.mesh, ground.mesh);

  // Hills and mountains on the horizon, loaded for wherever you're standing.
  const terrain = createTerrain({ onReady: () => info?.update(true) });
  let skyline = null; // the profile the ground is showing
  let skylineFade = 0;
  let flight = null; // a flight to a summit: skylines along the way (see goToSummit)
  /** Altitude (degrees) of the land's skyline towards an azimuth; 0 for a flat horizon. */
  const skylineAlt = (az) => (skyline && skylineFade > 0.5 ? skylineAt(skyline, az) : 0);
  /** Is this direction behind solid ground (or the hills)? */
  function behindLand(dir, margin = 0.25) {
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
      skyline = flight.view;
      skylineFade = 1;
      if (!locTween) {
        skyline = flight.final; // landed
        ground.setSkyline(skyline);
        flight = null;
      }
      return;
    }
    const want = layers.ground && layers.terrain && !locTween ? terrain.profileFor(loc) : null;
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

  const location = createLocation({
    cities,
    land,
    getTime: () => clock.ms,
    onChange: (next, { animate } = {}) => setLocation(next, animate),
  });

  function setLocation(next, animate, { duration = 1.6 } = {}) {
    // Mountains belong to where you were standing.
    if (selection?.type === "peak") select(null);
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
  function defaultView(s, fov = DEFAULT_FOV) {
    const base = horizonAltitude(fov);
    const body = s.sun.alt > 3 ? s.sun : s.moon.alt > 3 ? s.moon : null;
    if (!body) return { alt: base, az: loc.lat >= 0 ? 180 : 0, fov };
    // Tilt up only as far as needed to keep the body comfortably on screen.
    return { alt: Math.max(base, body.alt - fov / 2 + 12), az: body.az, fov };
  }

  const sensor = createSensor();
  const view = createView(camera, canvas, { onClick: pick, unproject: projection.unproject, sensor });
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
    const azOff = Math.abs(((view.state.az - d.az + 540) % 360) - 180) > 4;
    return fovOff || azOff || Math.abs(view.state.alt - d.alt) > 4;
  }
  resetBtn.addEventListener("click", resetView);
  window.addEventListener("keydown", (e) => {
    if (e.key === "0" && !e.target.closest("input, textarea, select, dialog, [role=slider]")) resetView();
  });

  // ---- Panels ----
  createLayersPanel({
    onChange: (l) => {
      layers = { ...l };
      for (const [key, obj] of Object.entries(overlays.layers)) obj.visible = !!layers[key];
      milkyWay.visible = !!layers.milkyWay;
    },
  });

  const timebar = createTimebar({ clock, getLocation: () => loc });

  const infoPanel = $("info");
  info = createInfo({
    container: $("info-content"),
    catalog,
    getState: () => ({ sky, loc, ms: clock.ms, selection, skyline: !flight && skylineFade > 0.5 ? skyline : null }),
    onLook: () => lookAtSelection(),
    onClear: () => select(null),
    onSummit: () => selection?.type === "peak" && goToSummit(selection.peak),
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
      time: clock.ms,
      view: view.state,
      selection: selectionToLink(selection),
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
    select(selectionFromLink(l.selection));
    if (l.view) {
      if (sensor.active) stopSensor(); // a link says where to look
      beforeLookUp = null;
      view.lookTo(l.view);
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
    const what = selection ? `${selection.name} from ${loc.name}` : `The sky from ${loc.name}`;
    const text = `${what}, ${formatDateTime(clock.ms, loc)}`;
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
      case "peak":
        return (selection.peak.dir ??= dirFromAltAz(selection.peak.alt, selection.peak.az));
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
    if (selection.type !== "peak" && behindLand(d, 0))
      view.lookTo({ alt: Math.max(12, skylineAlt(az) + 8), az, fov: Math.max(fov, 60) });
    else view.lookAt(d, fov);
  }

  const selectSun = () => ({ type: "sun", name: "Sun" });
  const selectMoon = () => ({ type: "moon", name: "Moon" });
  const selectPlanet = (p) => ({ type: "planet", id: p.id, name: p.name });
  const selectStar = (s) => ({ type: "star", name: s.name, star: s });
  const selectConstellation = (c) => ({ type: "constellation", name: c.name, constellation: c });
  const selectPeak = (p) => ({ type: "peak", name: p.name, peak: p });

  /**
   * Fly to the top of a mountain, still facing the same way. Skylines are worked out
   * at points along the route first, climbing up and over and down onto the summit,
   * then the view blends through them as you go: peaks ahead grow, the land drops away.
   */
  let takingOff = false;
  async function goToSummit(p) {
    if (takingOff || flight) return;
    const dest = { ...location.fromPoint(p.lat, p.lon), name: p.name, ele: p.ele ?? p.height };
    const from = locTween ? locTween.to : loc;
    const start = skyline;
    if (!start || !layers.ground || !layers.terrain) return setLocation(dest, true);
    takingOff = true;
    showToast(`Taking off for ${p.name}…`, 30000);
    try {
      const steps = Math.max(6, Math.min(14, Math.round(p.distance * 1.2)));
      const startEye = start.ground + 2;
      const endEye = dest.ele + 2;
      const climb = Math.min(1200, 150 + 60 * p.distance); // metres above the straight line
      const frames = [start.altitude];
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const eye = startEye + (endEye - startEye) * t + climb * Math.sin(Math.PI * t);
        const lat = from.lat + (dest.lat - from.lat) * t;
        const lon = from.lon + (dest.lon - from.lon) * t;
        const frame = await computeProfile(lat, lon, { eye, fast: true });
        if (!frame) throw new Error("No terrain along the way");
        frames.push(frame.altitude);
      }
      const final = await terrain.ensure(dest);
      if (!final) throw new Error("No terrain at the summit");
      frames.push(final.altitude);
      let top = 0;
      for (const f of frames) for (const v of f) top = Math.max(top, v);
      const view = { altitude: new Float32Array(final.altitude.length), max: top, ground: final.ground };
      flight = { frames, final, top, view };
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
    // Mountain names: the label sits centred just above its summit.
    if (layers.peakNames && skyline?.peaks && skylineFade > 0.5) {
      for (const p of skyline.peaks) {
        const s = p.dir && screenOf(p.dir);
        if (!s) continue;
        const dx = x - s[0];
        const dy = y - (s[1] - 16);
        const onLabel = Math.abs(dx) < p.name.length * 3.5 + 6 && Math.abs(dy) < 10;
        if (!onLabel && Math.hypot(x - s[0], y - s[1]) > 12) continue;
        const score = Math.min(Math.hypot(dx, dy), Math.hypot(x - s[0], y - s[1])) - 8;
        if (score < bestScore) [bestScore, best] = [score, () => selectPeak(p)];
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
    if (layers.peakNames && skyline?.peaks && skylineFade > 0.5) {
      for (const p of skyline.peaks) {
        p.dir ??= dirFromAltAz(p.alt, p.az);
        const chosen = selection?.type === "peak" && selection.peak === p;
        items.push({
          key: `pk${p.id}`,
          text: p.name,
          dir: p.dir,
          cls: chosen ? "peak selected" : "peak",
          priority: chosen ? 1000 : 30 + Math.min(8, p.height / 200),
          always: chosen,
          offset: [-p.name.length * 3, -16],
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
    // (A chosen mountain's name is highlighted instead of ringed.)
    if (sd && selection.type !== "constellation" && selection.type !== "peak") {
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
  };

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
    // The constant stops the eye "turning up the gain" too far on dark nights; without
    // it, faint moonlight scattered near the horizon shows as a grey glowing band.
    exposure = 0.7 / (adapt + 0.5);
    shared.uExposure.value = exposure;
    shared.uScotopic.value = 0.6 * (1 - smooth(0.005, 1, average));
    // Labels and figures recede in daylight, like a printed overlay on a bright sky.
    const night = 1 - smooth(0.3, 300, average);
    if (Math.abs(night - lastNight) > 0.01) {
      lastNight = night;
      overlays.layers.constellations.material.uniforms.uOpacity.value = 0.14 + 0.24 * night;
    }
    globalLimit = 7.93 - 5 * Math.log10(1 + 63 * Math.sqrt(zenith));
    updateGlow(now, atm, lights, ambient);

    const tSun = transmittance(atm, sky.sun.trueDir);
    const tMoon = transmittance(atm, sky.moon.trueDir);
    const mean = (t) => (t[0] + t[1] + t[2]) / 3;
    // Direct light only reaches the ground once the Sun or Moon is over the hills.
    const overHills = (b) => smooth(-0.3, 0.3, b.alt - skylineAlt(b.az));
    const groundE =
      Math.PI * average +
      sunE * Math.max(0, sky.sun.trueDir.y) * mean(tSun) * overHills(sky.sun) +
      moonE * Math.max(0, sky.moon.trueDir.y) * mean(tMoon) * overHills(sky.moon);
    updateSkyline(dt);
    ground.update(groundE, layers.ground, skylineFade);

    sun.update(sky.sun, tSun, sunLevel, exposure, camera, eclipse, bodyScale());
    moon.update(sky.moon, sky, tMoon, exposure, camera, bodyScale());
    planetPoints.update(sky.planets);
    overlays.updateFrames(sky);
    updatePaths(now);

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
