// Info panel: an overview of today (Sun, Moon, visible planets) or details for
// whatever is selected. Expensive searches are cached per local day.

import { A, AU_KM, Body, compassPoint, R2D } from "../astro.js";
import { seasonAt } from "../season.js";
import { skylineAt, spansAboveSkyline } from "../terrain.js";
import { formatDateTime, formatDuration, formatShortDate, formatTime, startOfLocalDay } from "../timezone.js";

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\u0022": "&quot;" };
const esc = (s) => String(s).replace(/[&<>\u0022]/g, (c) => ENTITIES[c]);

const goButton = (text) => `<button class='chip small' data-action=go>${text}</button>`;
const FEATURE_KIND = {
  peak: "Mountain",
  city: "City",
  town: "Town",
  village: "Village",
  lighthouse: "Lighthouse",
  observatory: "Observatory",
  tower: "Tower",
  mast: "Mast",
};
const NO_PLANETS = "<p class=note>None above the horizon right now.</p>";
const DIM_TIP =
  "<p class=note>Slide <strong>Sunlight</strong> down to see the stars and planets that are up there right now.</p>";

export function phaseName(angle) {
  const names = [
    "New Moon",
    "Waxing crescent",
    "First quarter",
    "Waxing gibbous",
    "Full Moon",
    "Waning gibbous",
    "Last quarter",
    "Waning crescent",
  ];
  return names[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
}

/**
 * Small SVG of the Moon's phase. With `litAngle` (see astro.js) it's turned the way
 * it looks in the sky right now; without, as usually drawn for this hemisphere.
 */
export function phaseIcon(angle, southern, litAngle) {
  const r = 20;
  const a = (angle * Math.PI) / 180;
  const rx = Math.abs(Math.cos(a)) * r;
  const waxing = angle < 180;
  const gibbous = Math.cos(a) < 0;
  const flip = waxing !== !southern; // lit side on the right when waxing (north)
  // The path is drawn lit on the right; SVG turns clockwise, the sky angle anticlockwise.
  const transform = litAngle == null ? `scale(${flip ? -1 : 1},1)` : `rotate(${-Math.round(litAngle)})`;
  const d = `M0,${-r}A${r},${r} 0 0 1 0,${r}A${rx.toFixed(2)},${r} 0 0 ${gibbous ? 1 : 0} 0,${-r}Z`;
  return `<svg class="phase-icon" viewBox="-22 -22 44 44" aria-hidden="true">
    <circle r="${r}" fill="#1b2133"/>
    <path d="${d}" fill="#f1ecdf" transform="${transform}"/>
  </svg>`;
}

export function createInfo({ container, getState, onLook, onClear, onSelect, onGo, catalog }) {
  const cache = new Map();
  let lastHtml = "";
  let lastBuild = 0;

  function cached(key, fn) {
    if (!cache.has(key)) {
      if (cache.size > 64) cache.clear();
      cache.set(key, fn());
    }
    return cache.get(key);
  }

  // Accepts an AstroTime or an event holding one in `.time`.
  const t = (d, loc) => (d ? formatTime((d.date ?? d.time.date).getTime(), loc) : "—");

  function riseSet(body, obs, start) {
    const d0 = new Date(start);
    return {
      rise: A.SearchRiseSet(body, obs, +1, d0, 1),
      set: A.SearchRiseSet(body, obs, -1, d0, 1),
      transit: A.SearchHourAngle(body, obs, 0, d0, +1),
    };
  }

  function position(obj, skyline) {
    let where = obj.alt >= 0 ? "up" : "below horizon";
    if (obj.alt >= 0 && skyline && obj.alt < skylineAt(skyline, obj.az)) where = "up, behind the mountains";
    return `<dt>Now</dt><dd>${obj.alt.toFixed(1)}° ${where}, ${compassPoint(obj.az)} (${obj.az.toFixed(0)}°)</dd>`;
  }

  /** When the body is actually in sight over the hills today (only if they hide it a while). */
  function skylineRow(body, s, start, radiusDeg) {
    const { sky, loc, skyline } = s;
    if (!skyline) return "";
    const r = cached(`skyline|${body}|${start}|${skyline.key}`, () =>
      spansAboveSkyline(body, sky.obs, start, skyline, radiusDeg)
    );
    if (r.hiddenMinutes < 4) return "";
    const tm = (ms) => formatTime(ms, loc);
    const span = ([a, b]) => (a <= start ? `until ${tm(b)}` : b >= r.endMs ? `from ${tm(a)}` : `${tm(a)} – ${tm(b)}`);
    const text = r.spans.length
      ? r.spans.slice(0, 3).map(span).join(", ") + (r.spans.length > 3 ? ", …" : "")
      : "Hidden all day";
    return `<dt>Over the mountains</dt><dd>${text}</dd>`;
  }

  function riseSetRows(rs, loc, obj, label = "") {
    if (!rs.rise && !rs.set) {
      const up = rs.transit && rs.transit.hor.altitude > 0;
      return `<dt>${label}Rise / set</dt><dd>${up ? "Up all day" : "Below the horizon all day"}</dd>`;
    }
    return `
      <dt>${label}Rises</dt><dd>${t(rs.rise, loc)}${rs.rise ? ` · ${compassPoint(A.Horizon(rs.rise, obj.obs, obj.raOf(rs.rise), obj.decOf(rs.rise), "normal").azimuth)}` : ""}</dd>
      <dt>${label}Highest</dt><dd>${t(rs.transit, loc)} · ${(Math.round(rs.transit.hor.altitude) || 0).toString()}°</dd>
      <dt>${label}Sets</dt><dd>${t(rs.set, loc)}${rs.set ? ` · ${compassPoint(A.Horizon(rs.set, obj.obs, obj.raOf(rs.set), obj.decOf(rs.set), "normal").azimuth)}` : ""}</dd>`;
  }

  const bodyRef = (body, obs) => ({
    obs,
    raOf: (d) => A.Equator(body, d, obs, true, true).ra,
    decOf: (d) => A.Equator(body, d, obs, true, true).dec,
  });

  function daylightBar(start, obs, ms) {
    // 24h strip coloured by the Sun's altitude.
    const stops = [];
    for (let h = 0; h <= 24; h += 0.5) {
      const d = new Date(start + h * 3600000);
      const eq = A.Equator(Body.Sun, d, obs, true, true);
      const alt = A.Horizon(d, obs, eq.ra, eq.dec, "normal").altitude;
      let c = "#0a0f1c";
      if (alt > 6) c = "#7fb4ff";
      else if (alt > 0) c = "#f2b46b";
      else if (alt > -6) c = "#5a5f9a";
      else if (alt > -12) c = "#2b3266";
      else if (alt > -18) c = "#161c3c";
      stops.push(`${c} ${((h / 24) * 100).toFixed(1)}%`);
    }
    const now = ((ms - start) / 86400000) * 100;
    return `<div class="daylight-bar" style="background:linear-gradient(90deg,${stops.join(",")})">
      <span class="now" style="left:${Math.max(0, Math.min(99.5, now)).toFixed(2)}%"></span></div>`;
  }

  // ---------------------------------------------------------------- Sections
  function sunDetails(s, full) {
    const { sky, loc, ms } = s;
    const obs = sky.obs;
    const start = startOfLocalDay(ms, loc);
    const key = `sun|${start}|${loc.lat.toFixed(3)}|${loc.lon.toFixed(3)}`;
    const ev = cached(key, () => {
      const d0 = new Date(start);
      const rs = riseSet(Body.Sun, obs, start);
      const tw = (alt) => [
        A.SearchAltitude(Body.Sun, obs, +1, d0, 1, alt),
        A.SearchAltitude(Body.Sun, obs, -1, d0, 1, alt),
      ];
      return { rs, civil: tw(-6), nautical: tw(-12), astro: tw(-18) };
    });
    const sun = sky.sun;
    let dayLen = "";
    if (ev.rs.rise && ev.rs.set && ev.rs.set.date > ev.rs.rise.date) {
      dayLen = `<dt>Day length</dt><dd>${formatDuration((ev.rs.set.date - ev.rs.rise.date) / 60000)}</dd>`;
    }
    const covered = 1 - sun.visibleFraction;
    const eclipseRow =
      covered > 0 && sun.alt > -1
        ? `<dt>Eclipse</dt><dd>${covered >= 0.9999 ? "Total!" : `${(covered * 100).toFixed(covered > 0.99 ? 1 : 0)}% covered`}</dd>`
        : "";
    let html = `<dl>${position(sun, s.skyline)}${eclipseRow}${riseSetRows(ev.rs, loc, bodyRef(Body.Sun, obs))}${skylineRow(Body.Sun, s, start, 0.27)}${dayLen}</dl>`;
    html += daylightBar(start, obs, ms);
    if (!full) return html;
    const twRow = (name, pair) => `<dt>${name}</dt><dd>${t(pair[0], loc)} – ${t(pair[1], loc)}</dd>`;
    html += `<div class="section"><h4>Twilight (dawn – dusk)</h4><dl>
      ${twRow("Civil (−6°)", ev.civil)}${twRow("Nautical (−12°)", ev.nautical)}${twRow("Astronomical (−18°)", ev.astro)}
    </dl></div>`;
    const seasons = cached(`seasons|${new Date(ms).getUTCFullYear()}`, () => {
      const y = new Date(ms).getUTCFullYear();
      const list = [];
      for (const yy of [y, y + 1]) {
        const ss = A.Seasons(yy);
        list.push(
          ["March equinox", ss.mar_equinox],
          ["June solstice", ss.jun_solstice],
          ["September equinox", ss.sep_equinox],
          ["December solstice", ss.dec_solstice]
        );
      }
      return list;
    });
    const next = seasons.find(([, tt]) => tt.date.getTime() > ms);
    html += `<div class="section"><h4>Facts</h4><dl>
      <dt>Distance</dt><dd>${((sun.dist * AU_KM) / 1e6).toFixed(2)} million km</dd>
      <dt>Light travel time</dt><dd>${formatDuration((sun.dist * AU_KM) / 299792.458 / 60)}</dd>
      <dt>Apparent size</dt><dd>${(sun.angularRadius * 2 * R2D * 60).toFixed(1)}′</dd>
      ${next ? `<dt>${next[0]}</dt><dd>${formatShortDate(next[1].date.getTime(), loc)}</dd>` : ""}
    </dl></div>`;
    return html;
  }

  function moonDetails(s, full) {
    const { sky, loc, ms } = s;
    const obs = sky.obs;
    const start = startOfLocalDay(ms, loc);
    const moon = sky.moon;
    const rs = cached(`moon|${start}|${loc.lat.toFixed(3)}|${loc.lon.toFixed(3)}`, () =>
      riseSet(Body.Moon, obs, start)
    );
    const headInner = `${phaseIcon(moon.phaseAngle, loc.lat < 0, moon.litAngle)}<div>
      <strong>${phaseName(moon.phaseAngle)}</strong><br><span class="kind">${(moon.phaseFraction * 100).toFixed(0)}% lit</span></div>`;
    // In the overview the phase is a button that takes you to the Moon.
    const head = full
      ? `<div class="info-head">${headInner}</div>`
      : `<button class="info-head jump" data-select="moon" title="Look at the Moon">${headInner}</button>`;
    let html = `${head}<dl>${position(moon, s.skyline)}${riseSetRows(rs, loc, bodyRef(Body.Moon, obs))}${skylineRow(Body.Moon, s, start, 0.26)}</dl>`;
    if (!full) return html;
    const phases = cached(`quarters|${Math.floor(ms / 3600000)}`, () => {
      const list = [];
      let q = A.SearchMoonQuarter(new Date(ms));
      for (let i = 0; i < 4; i++) {
        list.push(q);
        q = A.NextMoonQuarter(q);
      }
      const prevNew = A.SearchMoonPhase(0, new Date(ms - 30 * 86400000), 31);
      let age = prevNew ? (ms - prevNew.date.getTime()) / 86400000 : null;
      if (age !== null && age > 29.6) age -= 29.53;
      return { list, age };
    });
    const qn = ["New Moon", "First quarter", "Full Moon", "Last quarter"];
    html += `<div class="section"><h4>Coming up</h4><dl>
      ${phases.list.map((q) => `<dt>${qn[q.quarter]}</dt><dd>${formatDateTime(q.time.date.getTime(), loc)}</dd>`).join("")}
    </dl></div>
    <div class="section"><h4>Facts</h4><dl>
      ${phases.age !== null ? `<dt>Age</dt><dd>${phases.age.toFixed(1)} days</dd>` : ""}
      <dt>Distance</dt><dd>${Math.round(moon.dist * AU_KM).toLocaleString()} km</dd>
      <dt>Apparent size</dt><dd>${(moon.angularRadius * 2 * R2D * 60).toFixed(1)}′</dd>
      <dt>Brightness</dt><dd>mag ${moon.mag.toFixed(1)}</dd>
    </dl>
    <p class="note">The phase is just geometry: you always see the half of the Moon facing the Sun, from a changing angle.</p></div>`;
    return html;
  }

  function planetDetails(s, p) {
    const { sky, loc, ms } = s;
    const obs = sky.obs;
    const start = startOfLocalDay(ms, loc);
    const body = Body[p.id];
    const rs = cached(`${p.id}|${start}|${loc.lat.toFixed(3)}|${loc.lon.toFixed(3)}`, () => riseSet(body, obs, start));
    const elong = A.AngleFromSun(body, new Date(ms));
    const con = A.Constellation(p.ra, p.dec);
    const visible = p.mag < 6;
    const lightMin = (p.dist * AU_KM) / 299792.458 / 60;
    return `<dl>${position(p, s.skyline)}${riseSetRows(rs, loc, bodyRef(body, obs))}${skylineRow(body, s, start, 0)}</dl>
      <div class="section"><h4>Facts</h4><dl>
        <dt>Brightness</dt><dd>mag ${p.mag.toFixed(1)}${visible ? "" : " (needs a telescope)"}</dd>
        <dt>Distance</dt><dd>${p.dist.toFixed(3)} AU · ${((p.dist * AU_KM) / 1e6).toFixed(0)} M km</dd>
        <dt>Light travel time</dt><dd>${lightMin < 60 ? `${lightMin.toFixed(1)} min` : formatDuration(lightMin)}</dd>
        <dt>Apparent size</dt><dd>${(p.angularRadius * 2 * R2D * 3600).toFixed(1)}″</dd>
        <dt>Lit</dt><dd>${(p.phaseFraction * 100).toFixed(0)}%</dd>
        <dt>Angle from Sun</dt><dd>${elong.toFixed(0)}°</dd>
        <dt>In</dt><dd>${esc(con.name)}</dd>
      </dl>
      ${elong < 15 ? `<p class="note">${esc(p.name)} is too close to the Sun to see right now.</p>` : ""}</div>`;
  }

  function starDetails(s, star) {
    const { sky, loc, ms } = s;
    const obs = sky.obs;
    const start = startOfLocalDay(ms, loc);
    const rs = cached(`star${star.hip}|${start}|${loc.lat.toFixed(3)}|${loc.lon.toFixed(3)}`, () => {
      A.DefineStar(Body.Star1, star.ra / 15, star.dec, 1000);
      return riseSet(Body.Star1, obs, start);
    });
    A.DefineStar(Body.Star1, star.ra / 15, star.dec, 1000);
    const pos = star.position(sky);
    const always = !rs.rise && !rs.set;
    const ref = bodyRef(Body.Star1, obs);
    return `<dl>${position(pos, s.skyline)}${always ? `<dt>Rise / set</dt><dd>${rs.transit.hor.altitude > 0 ? "Never sets here" : "Never rises here"}</dd>` : riseSetRows(rs, loc, ref)}</dl>
      <div class="section"><h4>Facts</h4><dl>
        <dt>Brightness</dt><dd>mag ${star.mag.toFixed(2)}</dd>
        <dt>Colour (B−V)</dt><dd>${star.bv.toFixed(2)}</dd>
        <dt>RA / Dec</dt><dd>${(star.ra / 15).toFixed(2)}h / ${star.dec.toFixed(1)}°</dd>
        <dt>Catalogue</dt><dd>HIP ${star.hip}</dd>
      </dl></div>`;
  }

  /** A mountain, town or landmark on the land. */
  function featureDetails(s, f) {
    const m = (v) => `${Math.round(v).toLocaleString()} m`;
    let rows = "";
    if (f.group === "peak") rows += `<dt>Height</dt><dd>${m(f.ele ?? f.height)}</dd>`;
    else if (f.tall) rows += `<dt>Height</dt><dd>${m(f.tall)} tall</dd>`;
    if (f.population) rows += `<dt>Population</dt><dd>${f.population.toLocaleString()}</dd>`;
    rows += `<dt>Distance</dt><dd>${f.distance < 10 ? f.distance.toFixed(1) : Math.round(f.distance)} km</dd>`;
    if (f.otherNames) rows += `<dt>Also called</dt><dd>${esc(f.otherNames)}</dd>`;
    return `<dl>${position(f, null)}${rows}</dl><p class="note">From OpenStreetMap.</p>`;
  }

  function constellationDetails(s, c) {
    const pos = c.position(s.sky);
    const stars = catalog.starsIn(c.id).slice(0, 5);
    return `<dl>${position(pos, s.skyline)}</dl>
      ${stars.length ? `<div class="section"><h4>Brightest stars</h4><dl>${stars.map((st) => `<dt>${esc(st.label)}</dt><dd>mag ${st.mag.toFixed(1)}</dd>`).join("")}</dl></div>` : ""}`;
  }

  function overview(s) {
    const { sky, loc } = s;
    const visible = sky.planets
      .filter((p) => p.alt > 0 && p.mag < 6)
      .sort((a, b) => a.mag - b.mag)
      .map(
        (p) =>
          `<dt><button class="jump" data-select="planet" data-id="${p.id}" title="Look at ${p.name}">${p.name}</button></dt><dd>${compassPoint(p.az)}, ${p.alt.toFixed(0)}° up</dd>`
      )
      .join("");
    const sunUp = sky.sun.alt > -6;
    const season = seasonAt(s.ms, loc.lat, startOfLocalDay(s.ms, loc));
    let seasonText = "Today at a glance";
    if (season?.event) seasonText = `${season.event} today · ${season.eventMeaning}`;
    else if (season?.tropical) seasonText = "Tropical: no real summer or winter here";
    else if (season) {
      const days = Math.ceil(season.daysToNext);
      seasonText = `${season.label} · ${days === 1 ? "1 day" : `${days} days`} to the ${season.nextEvent}`;
    }
    return `<h3>${esc(loc.name)}</h3><p class="kind">${seasonText}</p>
      <div class="section"><h4><button class="jump" data-select="sun" title="Look at the Sun">Sun</button></h4>${sunDetails(s, false)}</div>
      <div class="section"><h4><button class="jump" data-select="moon" title="Look at the Moon">Moon</button></h4>${moonDetails(s, false)}</div>
      <div class="section"><h4>Planets up now</h4>${visible ? `<dl>${visible}</dl>` : NO_PLANETS}</div>
      ${sunUp ? DIM_TIP : ""}
      <p class="note">Tap anything to look at it.</p>`;
  }

  function build() {
    const s = getState();
    const sel = s.selection;
    if (!sel) return overview(s);
    const title = sel.name;
    let kind = "";
    let body = "";
    if (sel.type === "sun") {
      kind = "Our star";
      body = sunDetails(s, true);
    } else if (sel.type === "moon") {
      kind = "Earth’s moon";
      body = moonDetails(s, true);
    } else if (sel.type === "planet") {
      const p = s.sky.planets.find((x) => x.id === sel.id);
      kind = "Planet";
      body = planetDetails(s, p);
    } else if (sel.type === "star") {
      kind = sel.star.subtitle;
      body = starDetails(s, sel.star);
    } else if (sel.type === "constellation") {
      kind = "Constellation";
      body = constellationDetails(s, sel.constellation);
    } else if (sel.type === "feature") {
      kind = FEATURE_KIND[sel.feature.kind];
      body = featureDetails(s, sel.feature);
    }
    return `<h3>${esc(title)}</h3><p class="kind">${esc(kind)}</p>${body}
      <div class="info-actions">
        <button class="chip small" data-action="look">Look at it</button>
        ${sel.type === "feature" ? goButton(sel.feature.group === "peak" ? "Go to the summit" : "Go there") : ""}
        <button class="chip small" data-action="clear">Back to overview</button>
      </div>`;
  }

  container.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "look") onLook();
    if (action === "clear") onClear();
    if (action === "go") onGo?.();
    const jump = e.target.closest("[data-select]");
    if (jump) onSelect(jump.dataset.select, jump.dataset.id);
  });

  function update(force = false) {
    const now = performance.now();
    if (!force && now - lastBuild < 400) return;
    lastBuild = now;
    let html;
    try {
      html = build();
    } catch (err) {
      console.error(err);
      return;
    }
    if (html !== lastHtml) {
      container.innerHTML = html;
      lastHtml = html;
    }
  }

  return { update };
}
