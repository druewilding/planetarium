// Location: defaults (browser time zone → nearest big city, then geolocation),
// a world map dialog with live day/night shading, city search and lat/lon entry.

import { A, Body, D2R } from "../astro.js";

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Why the browser couldn't give a location, by GeolocationPositionError code: [button text, tooltip].
const GEO_ERRORS = {
  1: ["Location blocked", "Allow location for this site in your browser's settings"],
  2: [
    "Can't find you",
    "Your device can't tell where it is right now. Try again, or turn location services off and on",
  ],
  3: ["Timed out", "Finding your location took too long. Try again"],
};

export function formatLatLon(lat, lon) {
  const f = (v, p, n) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? p : n}`;
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export function createLocation({ cities, land, onChange, getTime }) {
  const $ = (id) => document.getElementById(id);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cityRecords = cities.map(([name, country, lat, lon, tz]) => ({ name, country, lat, lon, tz, key: fold(name) }));

  function nearestCity(lat, lon) {
    let best = null;
    let bd = Infinity;
    for (const c of cityRecords) {
      const d = distanceKm(lat, lon, c.lat, c.lon);
      if (d < bd) [bd, best] = [d, c];
    }
    return { city: best, km: bd };
  }

  /** Initial guess before (or without) geolocation: the biggest city in the browser's time zone. */
  function initialGuess() {
    const c = cityRecords.find((r) => r.tz === browserTz);
    if (c) return { lat: c.lat, lon: c.lon, name: `${c.name}, ${c.country}`, tz: c.tz, approximate: true };
    return { lat: 51.48, lon: 0, name: "Greenwich", tz: "Europe/London", approximate: true };
  }

  /** Build a location from a point on Earth, naming it after a nearby city. */
  function fromPoint(lat, lon, { tz } = {}) {
    const { city, km } = nearestCity(lat, lon);
    let name = formatLatLon(lat, lon);
    if (city && km < 40) name = `Near ${city.name}`;
    else if (city && km < 250) name = `${formatLatLon(lat, lon)} (${Math.round(km)} km from ${city.name})`;
    // Use the nearby city's time zone when close enough to be sure, else solar time.
    const zone = tz ?? (city && km < 300 ? city.tz : "");
    return { lat, lon, name, tz: zone };
  }

  /** A place from a shared link: the city itself if it's one of ours, else a named point. */
  function fromLink(lat, lon, tz) {
    const { city, km } = nearestCity(lat, lon);
    if (city && km < 2 && (!tz || tz === city.tz)) {
      return { lat: city.lat, lon: city.lon, name: `${city.name}, ${city.country}`, tz: city.tz };
    }
    return fromPoint(lat, lon, tz ? { tz } : {});
  }

  function requestGeolocation({ fromButton = false } = {}) {
    if (!navigator.geolocation) return;
    const btn = $("geo-btn");
    if (fromButton) btn.textContent = "Locating…";
    btn.title = "";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.textContent = "Use my location";
        // You are here, so the browser's own time zone is right.
        const loc = fromPoint(pos.coords.latitude, pos.coords.longitude, { tz: browserTz });
        onChange(loc, { animate: true });
        if (fromButton) dialog.close();
      },
      (err) => {
        if (!fromButton) {
          btn.textContent = "Use my location";
          return;
        }
        const [text, hint] = GEO_ERRORS[err.code] ?? GEO_ERRORS[2];
        btn.textContent = text;
        btn.title = hint;
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15000 }
    );
  }

  // ---- Dialog ----
  const dialog = $("location-dialog");
  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const shade = document.createElement("canvas");
  shade.width = 360;
  shade.height = 180;
  const shadeCtx = shade.getContext("2d");
  let current = null;

  // The map is equirectangular and can zoom and pan. It wraps east–west, so
  // the Pacific can sit in the middle.
  const MAX_ZOOM = 16;
  const map = { lon: 0, lat: 0, zoom: 1 };
  let W = 0; // map size in CSS pixels
  let H = 0;
  let dpr = 1;
  const scale = () => (map.zoom * W) / 360; // CSS pixels per degree
  const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
  const toX = (lon) => W / 2 + (lon - map.lon) * scale();
  const toY = (lat) => H / 2 - (lat - map.lat) * scale();
  // The copy of a longitude nearest the middle of the view.
  const nearX = (lon) => toX(map.lon + wrapLon(lon - map.lon));
  const lonAt = (x) => wrapLon(map.lon + (x - W / 2) / scale());
  const latAt = (y) => map.lat - (y - H / 2) / scale();

  function clampMap() {
    map.zoom = Math.max(1, Math.min(MAX_ZOOM, map.zoom));
    const half = 90 / map.zoom;
    map.lat = Math.max(-90 + half, Math.min(90 - half, map.lat));
    map.lon = wrapLon(map.lon);
  }

  /** Zoom by a factor, keeping the point under (x, y) where it is. */
  function zoomAt(factor, x = W / 2, y = H / 2) {
    const lon = map.lon + (x - W / 2) / scale();
    const lat = latAt(y);
    map.zoom *= factor;
    map.zoom = Math.max(1, Math.min(MAX_ZOOM, map.zoom));
    map.lon = lon - (x - W / 2) / scale();
    map.lat = lat + (y - H / 2) / scale();
    clampMap();
    redraw();
  }

  function panBy(dx, dy) {
    map.lon -= dx / scale();
    map.lat += dy / scale();
    clampMap();
    redraw();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = W / 2;
    if (!W) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    drawMap();
  }
  new ResizeObserver(resize).observe(canvas);

  function drawNightShade(ms) {
    const t = A.MakeTime(new Date(ms));
    const eq = A.Equator(Body.Sun, t, new A.Observer(0, 0, 0), true, true);
    const gast = A.SiderealTime(t);
    const subLat = eq.dec * D2R;
    const subLon = (eq.ra - gast) * 15 * D2R;
    const img = shadeCtx.createImageData(shade.width, shade.height);
    for (let y = 0; y < shade.height; y++) {
      const lat = (90 - (y + 0.5)) * D2R;
      for (let x = 0; x < shade.width; x++) {
        const lon = (x + 0.5 - 180) * D2R;
        const sinAlt = Math.sin(lat) * Math.sin(subLat) + Math.cos(lat) * Math.cos(subLat) * Math.cos(lon - subLon);
        const alt = Math.asin(sinAlt) / D2R;
        // Day 0, twilight ramps to full night at −18°.
        const night = alt > 0 ? 0 : Math.min(1, 0.35 + (-alt / 18) * 0.65);
        const i = (y * shade.width + x) * 4;
        img.data[i] = 2;
        img.data[i + 1] = 4;
        img.data[i + 2] = 16;
        img.data[i + 3] = night * 170;
      }
    }
    shadeCtx.putImageData(img, 0, 0);
  }

  // City dots: biggest cities first, skipping any that would crowd one
  // already placed, so zooming in brings in smaller places.
  const DOT_SPACING = 11;
  let dots = [];
  let pointer = null; // mouse position over the map, for hover
  let hovered = null;

  function placeDots() {
    dots = [];
    const cell = DOT_SPACING;
    const grid = new Map();
    for (const c of cityRecords) {
      const x = nearX(c.lon);
      const y = toY(c.lat);
      if (x < -cell || x > W + cell || y < -cell || y > H + cell) continue;
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let crowded = false;
      for (let i = -1; i <= 1 && !crowded; i++) {
        for (let j = -1; j <= 1 && !crowded; j++) {
          for (const d of grid.get(`${gx + i},${gy + j}`) ?? []) {
            if ((d.x - x) ** 2 + (d.y - y) ** 2 < cell * cell) {
              crowded = true;
              break;
            }
          }
        }
      }
      if (crowded) continue;
      const dot = { city: c, x, y };
      dots.push(dot);
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(dot);
    }
  }

  /** The dot within reach of (x, y), nearest first. */
  function dotNear(x, y, reach) {
    let best = null;
    let bd = reach * reach;
    for (const d of dots) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bd) [bd, best] = [dd, d];
    }
    return best;
  }

  function drawMap() {
    if (!W) return;
    const s = scale();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0d2a4a";
    ctx.fillRect(0, 0, W, H);

    // Every copy of the world that shows, east–west.
    const copies = [];
    for (let k = -2; k <= 2; k++) {
      const x0 = toX(-180 + 360 * k);
      if (x0 < W && x0 + 360 * s > 0) copies.push(360 * k);
    }

    const step = map.zoom < 3 ? 30 : map.zoom < 9 ? 10 : 5;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const k of copies) {
      for (let lon = -180; lon < 180; lon += step) {
        ctx.moveTo(toX(lon + k), 0);
        ctx.lineTo(toX(lon + k), H);
      }
    }
    for (let lat = -90 + step; lat < 90; lat += step) {
      ctx.moveTo(0, toY(lat));
      ctx.lineTo(W, toY(lat));
    }
    ctx.stroke();

    ctx.fillStyle = "#3f6b4a";
    ctx.strokeStyle = "#5d8c66";
    for (const k of copies) {
      for (const poly of land) {
        ctx.beginPath();
        poly.forEach(([lon, lat], i) => (i ? ctx.lineTo(toX(lon + k), toY(lat)) : ctx.moveTo(toX(lon + k), toY(lat))));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.imageSmoothingEnabled = true;
    for (const k of copies) ctx.drawImage(shade, toX(-180 + k), toY(90), 360 * s, 180 * s);

    // Cities: small dots that swell as the pointer comes near.
    placeDots();
    hovered = pointer ? dotNear(pointer.x, pointer.y, 14) : null;
    ctx.fillStyle = "rgba(255, 236, 200, 0.85)";
    ctx.beginPath();
    for (const d of dots) {
      const near = pointer ? Math.max(0, 1 - Math.hypot(d.x - pointer.x, d.y - pointer.y) / 60) : 0;
      const r = d === hovered ? 4.5 : 1.6 + 1.8 * near;
      ctx.moveTo(d.x + r, d.y);
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Current location
    if (current) {
      const x = nearX(current.lon);
      const y = toY(current.lat);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ff6b5a";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hovered) drawLabel(hovered);
  }

  function drawLabel({ city, x, y }) {
    ctx.font = "12px system-ui, sans-serif";
    const text = city.name;
    const tw = ctx.measureText(text).width;
    const pad = 5;
    let lx = x + 9;
    if (lx + tw + 2 * pad > W) lx = x - 9 - tw - 2 * pad;
    const ly = Math.max(2, Math.min(H - 22, y - 11));
    ctx.fillStyle = "rgba(8, 14, 30, 0.85)";
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw + 2 * pad, 20, 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, lx + pad, ly + 10);
  }

  let frame = 0;
  function redraw() {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawMap();
      });
    }
  }

  function setInputs(loc) {
    $("lat-input").value = loc.lat.toFixed(2);
    $("lon-input").value = loc.lon.toFixed(2);
  }

  function choose(loc) {
    current = loc;
    setInputs(loc);
    drawMap();
    onChange(loc, { animate: true });
  }

  const cityLocation = (c) => ({ lat: c.lat, lon: c.lon, name: `${c.name}, ${c.country}`, tz: c.tz });

  // Typing straight away suits a keyboard; on a phone it would pop up the
  // keyboard over the map.
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  $("location-btn").addEventListener("click", () => {
    setInputs(current);
    drawNightShade(getTime());
    dialog.showModal();
    resize();
    $("city-search").value = "";
    $("city-results").hidden = true;
    if (canHover.matches) $("city-search").focus(); // ready to type a city straight away
  });

  // Map gestures: tap or click to choose, drag to pan, wheel or pinch to zoom.
  const pointers = new Map();
  let moved = false;
  let pinch = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) moved = false;
    if (pointers.size === 2) {
      pinch = pinchState();
      moved = true; // a pinch never chooses a place
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        pointer = p;
        redraw();
      }
      return;
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 2 && pinch) {
      const next = pinchState();
      panBy(next.x - pinch.x, next.y - pinch.y);
      if (pinch.d > 0) zoomAt(next.d / pinch.d, next.x, next.y);
      pinch = next;
      return;
    }
    if (pointers.size !== 1) return;
    if (!moved && Math.hypot(p.x - prev.x, p.y - prev.y) < 4) {
      pointers.set(e.pointerId, prev); // not a drag yet: measure from where it started
      return;
    }
    moved = true;
    canvas.classList.add("panning");
    if (e.pointerType === "mouse") pointer = p;
    panBy(p.x - prev.x, p.y - prev.y);
  });

  const release = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size) return;
    canvas.classList.remove("panning");
    if (e.type !== "pointerup" || moved || !p) return;
    // A tap near a city takes the city itself; anywhere else is just that spot.
    const dot = dotNear(p.x, p.y, e.pointerType === "mouse" ? 14 : 22);
    if (dot) choose(cityLocation(dot.city));
    else choose(fromPoint(Math.max(-89.9, Math.min(89.9, latAt(p.y))), lonAt(p.x)));
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" || pointers.size) return;
    pointer = null;
    redraw();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const p = local(e);
      zoomAt(Math.exp(-dy * 0.002), p.x, p.y);
    },
    { passive: false }
  );

  $("map-zoom-in").addEventListener("click", () => zoomAt(2));
  $("map-zoom-out").addEventListener("click", () => zoomAt(0.5));
  $("map-zoom-reset").addEventListener("click", () => {
    map.zoom = 1;
    map.lat = 0;
    map.lon = 0;
    redraw();
  });

  for (const id of ["lat-input", "lon-input"]) {
    $(id).addEventListener("change", () => {
      const lat = parseFloat($("lat-input").value);
      const lon = parseFloat($("lon-input").value);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        choose(fromPoint(Math.max(-89.9, Math.min(89.9, lat)), lon));
      }
    });
  }

  $("geo-btn").addEventListener("click", () => requestGeolocation({ fromButton: true }));

  // City search
  const results = $("city-results");
  let matches = [];
  let active = 0;
  function renderResults() {
    results.replaceChildren(
      ...matches.map((c, i) => {
        const li = document.createElement("li");
        li.setAttribute("aria-selected", String(i === active));
        li.innerHTML = "<span></span><small></small>";
        li.firstChild.textContent = c.name;
        li.lastChild.textContent = c.country;
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pickCity(c);
        });
        return li;
      })
    );
    results.hidden = matches.length === 0;
  }
  function pickCity(c) {
    choose(cityLocation(c));
    $("city-search").value = "";
    results.hidden = true;
    dialog.close();
  }
  $("city-search").addEventListener("input", (e) => {
    const q = fold(e.target.value.trim());
    if (!q) {
      matches = [];
    } else {
      const starts = cityRecords.filter((c) => c.key.startsWith(q));
      const contains = cityRecords.filter((c) => !c.key.startsWith(q) && c.key.includes(q));
      matches = [...starts, ...contains].slice(0, 8);
    }
    active = 0;
    renderResults();
  });
  $("city-search").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length);
      renderResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) pickCity(matches[active]);
    }
  });

  function set(loc) {
    current = loc;
    $("location-name").textContent = loc.name;
  }

  return { initialGuess, requestGeolocation, set, fromPoint, fromLink };
}
