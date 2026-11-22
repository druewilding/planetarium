// Time controls: a time-of-day track (shaded by where the Sun is at this
// location), a date track (shaded by day length through the year), a year
// stepper, play/speed buttons and a typed date/time entry.

import { A, Body, D2R } from "../astro.js";
import {
  dayOfYear,
  formatDate,
  formatTime,
  fromInputValue,
  localMinutesOfDay,
  shifted,
  startOfLocalDay,
  toInputValue,
  zoneLabel,
} from "../timezone.js";

const DAY_MS = 86400000;

/** Colour for the Sun's altitude: night → twilight → golden hour → day. */
function skyColour(alt) {
  if (alt > 6) return "#7fb4ff";
  if (alt > 0) return "#f2b46b";
  if (alt > -6) return "#5a5f9a";
  if (alt > -12) return "#2b3266";
  if (alt > -18) return "#161c3c";
  return "#0a0f1c";
}

/** Colour for day length (hours): long winter nights dark, long summer days golden. */
function dayLengthColour(hours) {
  const t = Math.min(1, Math.max(0, hours / 24));
  const a = [18, 24, 48];
  const b = [126, 170, 235];
  const c = [250, 210, 120];
  const mix = (x, y, k) => x.map((v, i) => Math.round(v + (y[i] - v) * k));
  const rgb = t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
  return `rgb(${rgb.join(",")})`;
}

/** Hours of daylight (Sun's centre above −0.83°) for a latitude and day of year. */
function dayLength(latDeg, doy) {
  const decl = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365.24) * D2R;
  const lat = latDeg * D2R;
  const cosH = (Math.sin(-0.833 * D2R) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  return (2 * Math.acos(cosH)) / D2R / 15;
}

/** Make a horizontal track draggable. onSet(fraction 0..1, isStart). */
function makeTrack(track, { onSet, onKey }) {
  const frac = (e) => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  let dragging = false;
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    track.classList.add("active");
    onSet(frac(e), true);
    e.preventDefault();
  });
  track.addEventListener("pointermove", (e) => {
    if (dragging) onSet(frac(e), false);
  });
  const stop = () => {
    dragging = false;
    track.classList.remove("active");
  };
  track.addEventListener("pointerup", stop);
  track.addEventListener("pointercancel", stop);
  track.addEventListener("keydown", (e) => {
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    onKey(dir, e.shiftKey);
  });
}

export function createTimebar({ clock, getLocation }) {
  const $ = (id) => document.getElementById(id);
  const dayTrack = $("day-track");
  const yearTrack = $("year-track");
  const dayThumb = dayTrack.querySelector(".thumb");
  const yearThumb = yearTrack.querySelector(".thumb");

  // ---- Tick labels ----
  $("day-ticks").replaceChildren(
    ...[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => {
      const s = document.createElement("span");
      s.style.left = `${(h / 24) * 100}%`;
      s.textContent = String(h).padStart(2, "0");
      return s;
    })
  );
  const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const monthFmt = new Intl.DateTimeFormat(navigator.language, { month: "short", timeZone: "UTC" });
  $("year-ticks").replaceChildren(
    ...monthStarts.map((d, m) => {
      const s = document.createElement("span");
      s.className = "month";
      s.style.left = `${((d + 15) / 365) * 100}%`;
      s.textContent = monthFmt.format(Date.UTC(2001, m, 15));
      return s;
    })
  );

  // ---- Time of day ----
  let dragDayStart = null;
  makeTrack(dayTrack, {
    onSet: (f, start) => {
      if (start || dragDayStart === null) dragDayStart = startOfLocalDay(clock.ms, getLocation());
      clock.set(dragDayStart + Math.min(f, 0.99999) * DAY_MS, { animate: false });
    },
    onKey: (dir, big) => clock.nudge(dir * (big ? 60 : 10) * 60000),
  });
  dayTrack.addEventListener("pointerup", () => (dragDayStart = null));

  // ---- Date ----
  function daysInLocalYear(loc) {
    const y = shifted(clock.ms, loc).getUTCFullYear();
    return (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS;
  }
  makeTrack(yearTrack, {
    onSet: (f) => {
      const loc = getLocation();
      const n = daysInLocalYear(loc);
      const target = Math.min(n - 1, Math.floor(f * n));
      const current = Math.floor(dayOfYear(clock.ms, loc));
      if (target !== current) clock.set(clock.ms + (target - current) * DAY_MS, { animate: false });
    },
    onKey: (dir, big) => clock.nudge(dir * (big ? 7 : 1) * DAY_MS),
  });

  function stepYear(dir) {
    const d = shifted(clock.ms, getLocation());
    const y = d.getUTCFullYear();
    const args = [d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
    clock.set(clock.ms + (Date.UTC(y + dir, ...args) - Date.UTC(y, ...args)), { animate: false });
  }
  $("year-prev").addEventListener("click", () => stepYear(-1));
  $("year-next").addEventListener("click", () => stepYear(1));

  // ---- Buttons ----
  $("play").addEventListener("click", () => clock.togglePlay());
  $("faster").addEventListener("click", () => clock.faster());
  $("slower").addEventListener("click", () => clock.slower());
  $("now").addEventListener("click", () => clock.now());

  const input = $("datetime-input");
  $("time-readout").addEventListener("click", () => {
    input.value = toInputValue(clock.ms, getLocation());
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  });
  input.addEventListener("change", () => {
    const ms = fromInputValue(input.value, getLocation(), clock.ms);
    if (ms !== null) clock.set(ms);
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, dialog, [role=slider]")) return;
    if (e.key === " ") {
      e.preventDefault();
      clock.togglePlay();
    } else if (e.key === "]") clock.faster();
    else if (e.key === "[") clock.slower();
    else if (e.key.toLowerCase() === "n") clock.now();
  });

  // ---- Track shading (recomputed when the day / place changes) ----
  let dayKey = "";
  function shadeDay(loc) {
    const start = startOfLocalDay(clock.ms, loc);
    const key = `${start}|${loc.lat.toFixed(2)}|${loc.lon.toFixed(2)}`;
    if (key === dayKey) return;
    dayKey = key;
    const obs = new A.Observer(loc.lat, loc.lon, 0);
    const stops = [];
    for (let i = 0; i <= 96; i++) {
      const d = new Date(start + (i / 96) * DAY_MS);
      const eq = A.Equator(Body.Sun, d, obs, true, true);
      const alt = A.Horizon(d, obs, eq.ra, eq.dec, "normal").altitude;
      stops.push(`${skyColour(alt)} ${((i / 96) * 100).toFixed(2)}%`);
    }
    dayTrack.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  }

  let yearKey = "";
  function shadeYear(loc) {
    const year = shifted(clock.ms, loc).getUTCFullYear();
    const key = `${year}|${loc.lat.toFixed(1)}`;
    if (key === yearKey) return;
    yearKey = key;
    const stops = [];
    for (let d = 0; d <= 365; d += 5)
      stops.push(`${dayLengthColour(dayLength(loc.lat, d))} ${((d / 365) * 100).toFixed(2)}%`);
    yearTrack.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
    const marks = $("season-marks");
    marks.replaceChildren();
    try {
      const s = A.Seasons(year);
      const n = daysInLocalYear(loc);
      for (const [t, cls, title] of [
        [s.mar_equinox, "equinox", "March equinox"],
        [s.jun_solstice, "june", "June solstice"],
        [s.sep_equinox, "equinox", "September equinox"],
        [s.dec_solstice, "december", "December solstice"],
      ]) {
        const m = document.createElement("i");
        m.className = `season ${cls}`;
        m.title = `${title}: ${formatDate(t.date.getTime(), loc)}`;
        m.style.left = `${(dayOfYear(t.date.getTime(), loc) / n) * 100}%`;
        marks.appendChild(m);
      }
    } catch {
      /* Seasons() can throw for extreme years */
    }
  }

  let lastText = "";
  function update() {
    const loc = getLocation();
    shadeDay(loc);
    shadeYear(loc);
    const m = localMinutesOfDay(clock.ms, loc);
    dayThumb.style.left = `${(m / 1440) * 100}%`;
    dayTrack.setAttribute("aria-valuetext", formatTime(clock.ms, loc));
    const n = daysInLocalYear(loc);
    yearThumb.style.left = `${(dayOfYear(clock.ms, loc) / n) * 100}%`;

    const seconds = clock.playing && Math.abs(clock.rate) === 1;
    const text = `${formatTime(clock.ms, loc, seconds)}|${formatDate(clock.ms, loc)}|${zoneLabel(clock.ms, loc)}|${clock.rateLabel}|${clock.playing}`;
    if (text !== lastText) {
      lastText = text;
      $("time-clock").textContent = formatTime(clock.ms, loc, seconds);
      $("time-date").textContent = formatDate(clock.ms, loc);
      $("time-zone").textContent = zoneLabel(clock.ms, loc);
      $("rate-label").textContent = clock.rateLabel;
      $("year-label").textContent = String(shifted(clock.ms, loc).getUTCFullYear());
      yearTrack.setAttribute("aria-valuetext", formatDate(clock.ms, loc));
      $("play-icon").setAttribute("d", clock.playing ? "M6 5h4v14H6zm8 0h4v14h-4z" : "M7 4.5v15L19.5 12z");
      $("play").setAttribute("aria-label", clock.playing ? "Pause" : "Play");
      $("now").hidden = clock.following;
    }
  }

  return { update };
}
