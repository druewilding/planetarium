// Location: defaults (browser time zone → nearest big city, then geolocation),
// a world map dialog with live day/night shading, city search and lat/lon entry.

import { A, Body, D2R } from "../astro.js";

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.textContent = "Use my location";
        // You are here, so the browser's own time zone is right.
        const loc = fromPoint(pos.coords.latitude, pos.coords.longitude, { tz: browserTz });
        onChange(loc, { animate: true });
        if (fromButton) dialog.close();
      },
      () => {
        btn.textContent = fromButton ? "Location unavailable" : "Use my location";
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

  const toX = (lon) => ((lon + 180) / 360) * canvas.width;
  const toY = (lat) => ((90 - lat) / 180) * canvas.height;

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
    // Subsolar point
    return { lat: subLat / D2R, lon: ((((subLon / D2R + 180) % 360) + 360) % 360) - 180 };
  }

  function drawMap() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#0d2a4a";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      ctx.beginPath();
      ctx.moveTo(toX(lon), 0);
      ctx.lineTo(toX(lon), h);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      ctx.moveTo(0, toY(lat));
      ctx.lineTo(w, toY(lat));
      ctx.stroke();
    }
    ctx.fillStyle = "#3f6b4a";
    ctx.strokeStyle = "#5d8c66";
    for (const poly of land) {
      ctx.beginPath();
      poly.forEach(([lon, lat], i) => (i ? ctx.lineTo(toX(lon), toY(lat)) : ctx.moveTo(toX(lon), toY(lat))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const sub = drawNightShade(getTime());
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, 0, 0, w, h);
    // Sun position
    ctx.fillStyle = "#ffd27a";
    ctx.beginPath();
    ctx.arc(toX(sub.lon), toY(sub.lat), 7, 0, Math.PI * 2);
    ctx.fill();
    // Current location
    if (current) {
      const x = toX(current.lon);
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

  $("location-btn").addEventListener("click", () => {
    setInputs(current);
    drawMap();
    dialog.showModal();
    $("city-search").value = "";
    $("city-results").hidden = true;
    $("city-search").focus(); // ready to type a city straight away
  });

  let dragging = false;
  const pickFromEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    const lon = ((e.clientX - r.left) / r.width) * 360 - 180;
    const lat = 90 - ((e.clientY - r.top) / r.height) * 180;
    return fromPoint(Math.max(-89.9, Math.min(89.9, lat)), Math.max(-180, Math.min(180, lon)));
  };
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    choose(pickFromEvent(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) choose(pickFromEvent(e));
  });
  canvas.addEventListener("pointerup", () => (dragging = false));

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
    choose({ lat: c.lat, lon: c.lon, name: `${c.name}, ${c.country}`, tz: c.tz });
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
