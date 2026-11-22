// Time controls: a 24-hour dial (midnight at the bottom, noon at the top, the
// Sun's day shaded on the ring), a year dial (January at the top), play/speed
// buttons and a typed date/time entry.

import { A, Body, observer } from "../astro.js";
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

const NS = "http://www.w3.org/2000/svg";
const TAU = Math.PI * 2;
const YEAR_DAYS = 365.2422;

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function arcPath(r, a0, a1, pointAt) {
  let sweep = a1 - a0;
  while (sweep < 0) sweep += TAU;
  if (sweep >= TAU - 1e-6) {
    const [x0, y0] = pointAt(a0, r);
    const [x1, y1] = pointAt(a0 + Math.PI, r);
    return `M${x0},${y0}A${r},${r} 0 1 1 ${x1},${y1}A${r},${r} 0 1 1 ${x0},${y0}`;
  }
  const [x0, y0] = pointAt(a0, r);
  const [x1, y1] = pointAt(a0 + sweep, r);
  return `M${x0},${y0}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
}

/** Attach "drag around the ring" behaviour. onDelta receives radians (clockwise positive). */
function makeRotatable(node, onDelta) {
  let last = null;
  const angleOf = (e) => {
    const r = node.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  node.addEventListener("pointerdown", (e) => {
    node.setPointerCapture(e.pointerId);
    last = angleOf(e);
    e.preventDefault();
  });
  node.addEventListener("pointermove", (e) => {
    if (last === null) return;
    const a = angleOf(e);
    let d = a - last;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    last = a;
    onDelta(d);
  });
  const stop = () => (last = null);
  node.addEventListener("pointerup", stop);
  node.addEventListener("pointercancel", stop);
}

export function createTimebar({ clock, getLocation }) {
  const $ = (id) => document.getElementById(id);

  // ---- Day dial: angle 0 = midnight at the bottom, clockwise. ----
  const dayPoint = (a, r) => [(-Math.sin(a) * r).toFixed(2), (Math.cos(a) * r).toFixed(2)];
  const daySvg = el(
    "svg",
    { viewBox: "-50 -50 100 100", role: "img", "aria-label": "Time of day dial" },
    $("day-dial")
  );
  el("circle", { r: 40, fill: "none", stroke: "#141b2e", "stroke-width": 9 }, daySvg);
  const twilightArc = el("path", { fill: "none", stroke: "#4a5a8a", "stroke-width": 9 }, daySvg);
  const dayArc = el("path", { fill: "none", stroke: "#f2c46b", "stroke-width": 9 }, daySvg);
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * TAU;
    const [x0, y0] = dayPoint(a, 33);
    const [x1, y1] = dayPoint(a, h % 6 === 0 ? 29 : 31);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#5d6a8a", "stroke-width": h % 6 === 0 ? 1.4 : 0.7 }, daySvg);
  }
  for (const h of [0, 6, 12, 18]) {
    const [x, y] = dayPoint((h / 24) * TAU, 22);
    el("text", { x, y }, daySvg).textContent = String(h);
  }
  const dayHandle = el("g", { class: "handle" }, daySvg);
  el("circle", { r: 6.5, fill: "#ffd27a", stroke: "#1a1206", "stroke-width": 1.5 }, dayHandle);
  const dayCenter = el("text", { class: "dial-center", y: 1 }, daySvg);
  dayCenter.textContent = "day";

  makeRotatable($("day-dial"), (d) => clock.nudge((d / TAU) * 86400000));

  // ---- Year dial: angle 0 = 1 January at the top, clockwise. ----
  const yearPoint = (a, r) => [(Math.sin(a) * r).toFixed(2), (-Math.cos(a) * r).toFixed(2)];
  const yearSvg = el("svg", { viewBox: "-50 -50 100 100", role: "img", "aria-label": "Date dial" }, $("year-dial"));
  el("circle", { r: 40, fill: "none", stroke: "#141b2e", "stroke-width": 9 }, yearSvg);
  const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  const monthNames = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(navigator.language, { month: "narrow", timeZone: "UTC" }).format(Date.UTC(2001, m, 15))
  );
  // Seasons tint on the ring: warm around June, cool around December (northern-hemisphere wording is avoided).
  for (let m = 0; m < 12; m++) {
    const a0 = (monthStarts[m] / 365) * TAU;
    const a1 = (monthStarts[m + 1] / 365) * TAU;
    const [x0, y0] = yearPoint(a0, 33);
    const [x1, y1] = yearPoint(a0, 30);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#5d6a8a", "stroke-width": 0.8 }, yearSvg);
    const [tx, ty] = yearPoint((a0 + a1) / 2, 23);
    el("text", { x: tx, y: ty }, yearSvg).textContent = monthNames[m];
  }
  const seasonMarks = el("g", {}, yearSvg);
  const yearHandle = el("g", { class: "handle" }, yearSvg);
  el("circle", { r: 6.5, fill: "#8fb8ff", stroke: "#06101a", "stroke-width": 1.5 }, yearHandle);
  const yearCenter = el("text", { class: "dial-center", y: 1 }, yearSvg);

  makeRotatable($("year-dial"), (d) => clock.nudge((d / TAU) * YEAR_DAYS * 86400000));

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
    if (e.target.closest("input, textarea, select, dialog")) return;
    if (e.key === " ") {
      e.preventDefault();
      clock.togglePlay();
    } else if (e.key === "]") clock.faster();
    else if (e.key === "[") clock.slower();
    else if (e.key.toLowerCase() === "n") clock.now();
  });

  // ---- Day/night shading on the day dial (recomputed per local day) ----
  let shadedKey = "";
  function updateDayShading(loc) {
    const start = startOfLocalDay(clock.ms, loc);
    const key = `${start}|${loc.lat.toFixed(2)}|${loc.lon.toFixed(2)}`;
    if (key === shadedKey) return;
    shadedKey = key;
    const obs = observer(loc);
    const t0 = new Date(start);
    const mins = (d) => (d ? (d.date.getTime() - start) / 60000 : null);
    const rise = mins(A.SearchRiseSet(Body.Sun, obs, +1, t0, 1));
    const set = mins(A.SearchRiseSet(Body.Sun, obs, -1, t0, 1));
    const dawn = mins(A.SearchAltitude(Body.Sun, obs, +1, t0, 1, -6));
    const dusk = mins(A.SearchAltitude(Body.Sun, obs, -1, t0, 1, -6));
    const ang = (m) => (m / 1440) * TAU;
    const noonAlt = A.Horizon(
      new Date(start + 12 * 3600000),
      obs,
      ...radec(start + 12 * 3600000, obs),
      "normal"
    ).altitude;
    const arc = (a, b, fallbackUp) => {
      if (a !== null && b !== null) return arcPath(40, ang(a), ang(b), dayPoint);
      if (a === null && b === null) return fallbackUp ? arcPath(40, 0, TAU, dayPoint) : "";
      // Only one event today: shade from/to midnight.
      return a !== null ? arcPath(40, ang(a), TAU - 1e-4, dayPoint) : arcPath(40, 0, ang(b), dayPoint);
    };
    dayArc.setAttribute("d", arc(rise, set, noonAlt > 0));
    twilightArc.setAttribute("d", arc(dawn, dusk, noonAlt > -6));

    // Season markers on the year dial for this year.
    const year = shifted(clock.ms, loc).getUTCFullYear();
    seasonMarks.replaceChildren();
    try {
      const s = A.Seasons(year);
      const marks = [
        [s.mar_equinox, "#8be08b", "March equinox"],
        [s.jun_solstice, "#ff7a59", "June solstice"],
        [s.sep_equinox, "#8be08b", "September equinox"],
        [s.dec_solstice, "#7ec8ff", "December solstice"],
      ];
      for (const [t, color, title] of marks) {
        const a = (dayOfYear(t.date.getTime(), loc) / YEAR_DAYS) * TAU;
        const [x, y] = yearPoint(a, 40);
        const c = el("circle", { cx: x, cy: y, r: 2.6, fill: color }, seasonMarks);
        el("title", {}, c).textContent = title;
      }
    } catch {
      /* Seasons() can throw for extreme years */
    }
  }

  function radec(ms, obs) {
    const eq = A.Equator(Body.Sun, new Date(ms), obs, true, true);
    return [eq.ra, eq.dec];
  }

  let lastText = "";
  function update() {
    const loc = getLocation();
    const m = localMinutesOfDay(clock.ms, loc);
    const [hx, hy] = dayPoint((m / 1440) * TAU, 40);
    dayHandle.setAttribute("transform", `translate(${hx} ${hy})`);
    const doy = dayOfYear(clock.ms, loc);
    const [yx, yy] = yearPoint((doy / YEAR_DAYS) * TAU, 40);
    yearHandle.setAttribute("transform", `translate(${yx} ${yy})`);

    const seconds = clock.playing && Math.abs(clock.rate) === 1;
    const text = `${formatTime(clock.ms, loc, seconds)}|${formatDate(clock.ms, loc)}|${zoneLabel(clock.ms, loc)}|${clock.rateLabel}|${clock.playing}`;
    if (text !== lastText) {
      lastText = text;
      $("time-clock").textContent = formatTime(clock.ms, loc, seconds);
      $("time-date").textContent = formatDate(clock.ms, loc);
      $("time-zone").textContent = zoneLabel(clock.ms, loc);
      $("rate-label").textContent = clock.rateLabel;
      yearCenter.textContent = String(shifted(clock.ms, loc).getUTCFullYear());
      $("play-icon").setAttribute("d", clock.playing ? "M6 5h4v14H6zm8 0h4v14h-4z" : "M7 4.5v15L19.5 12z");
      $("play").setAttribute("aria-label", clock.playing ? "Pause" : "Play");
      $("now").hidden = clock.following;
    }
    updateDayShading(loc);
  }

  return { update };
}
