// Info panel: an overview of today (Sun, Moon, visible planets) or details for
// whatever is selected. Expensive searches are cached per local day.

import { A, AU_KM, Body, compassPoint, MOON_RADIUS_KM, planetPole, PLANETS, R2D, SUN_RADIUS_KM } from "../astro.js";
import { lunarEclipsesFrom, nextTotalSolarEclipse, solarEclipsesFrom } from "../eclipses.js";
import { glare, moonEventsBetween, MOONS_OF, moonsOf, nextMoonEvents } from "../satellites.js";
import { seasonAt } from "../season.js";
import { bodyPosition, distanceAU, LIGHT_SPEED_KM_S, LIGHT_YEAR_AU, LIGHT_YEAR_KM, starPosition } from "../space.js";
import { skylineAt, spansAboveSkyline } from "../terrain.js";
import {
  formatDateTime,
  formatDuration,
  formatShortDate,
  formatTime,
  formatYearDate,
  startOfLocalDay,
} from "../timezone.js";

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
const STARS_TIP =
  "<p class=note>Turn off the <strong>Atmosphere</strong> layer to see the stars and planets that are up there right now.</p>";

const YEAR_MS = 365.25 * 86400000;
/** A number rounded to `digits` significant figures, with English separators like the rest of the panel. */
const sig = (v, digits) => Number(v.toPrecision(digits)).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const year = (y) => (y > 0 ? String(y) : `${1 - y} BCE`);

/**
 * How far away a star is, from where you're standing, as rows for the info
 * panel and a short form for lists. Parallaxes get less certain with distance,
 * so the wording does too.
 */
export function starDistance(s, star) {
  const pos = starPosition(star);
  if (!pos) {
    const why = star.plx == null ? "Not measured" : "Too far to measure";
    return { rows: `<dt>Distance</dt><dd>${why}</dd>`, short: "" };
  }
  const ly = distanceAU(pos, bodyPosition(s.standingOn, s.ms)) / LIGHT_YEAR_AU;
  const trillionKm = (lightYears, digits) => sig((lightYears * LIGHT_YEAR_KM) / 1e12, digits);
  const now = 1970 + s.ms / YEAR_MS;

  // Laid out like the Sun's: the distance, then how long its light takes. A
  // light-year is how far light goes in a year, so the years are light-years.
  if (pos.relError > 0.25) {
    // Too uncertain for one number: give the range the parallax allows.
    const near = (ly * star.plx) / (star.plx + star.ePlx);
    const far = star.plx > star.ePlx ? (ly * star.plx) / (star.plx - star.ePlx) : Infinity;
    const range = (f) => (Number.isFinite(far) ? `between ${f(near)} and ${f(far)}` : `more than ${f(near)}`);
    return {
      rows: `<dt>Distance</dt><dd>${range((v) => trillionKm(v, 2))} trillion km (hard to measure)</dd>
        <dt>Light travel time</dt><dd>${range((v) => sig(v, 2))} years</dd>`,
      short: "",
    };
  }

  const about = pos.relError > 0.1 ? "about " : "";
  const digits = about ? 2 : ly < 10 ? 2 : 3;
  const left = Math.round(now - ly);
  return {
    rows: `<dt>Distance</dt><dd>${about}${trillionKm(ly, digits)} trillion km</dd>
      <dt>Light travel time</dt><dd>${about}${sig(ly, digits)} years</dd>
      <dt>Light you see left</dt><dd>${about ? "around" : "in"} ${year(left)}</dd>`,
    short: `${about ? "~" : ""}${sig(ly, digits)} ly`,
    left,
    about: !!about,
  };
}

// Things that happened, to set a star's light against: [year, what happened].
const HISTORY = [
  [-9700, "the end of the last ice age"],
  [-2560, "the Great Pyramid was built"],
  [-776, "the first Olympic Games"],
  [79, "Vesuvius buried Pompeii"],
  [1066, "the Normans took England"],
  [1492, "Columbus sailed to America"],
  [1610, "Galileo first turned a telescope on the sky"],
  [1687, "Newton explained gravity"],
  [1781, "William Herschel found Uranus"],
  [1903, "the Wright brothers first flew"],
  [1969, "people first walked on the Moon"],
  [1990, "the Hubble Space Telescope was launched"],
  [2021, "the James Webb Space Telescope was launched"],
];

/** "It set off 14 years before Columbus sailed to America." For light that left in `left`. */
export function lightLeftNote(left, about) {
  const [y, what] = HISTORY.reduce((a, b) => (Math.abs(b[0] - left) < Math.abs(a[0] - left) ? b : a));
  const gap = Math.abs(left - y);
  const years = (n) => `${n.toLocaleString("en-GB")} year${n === 1 ? "" : "s"}`;
  const when =
    gap === 0 ? `the year ${what}` : `${about ? "about " : ""}${years(gap)} ${left < y ? "before" : "after"} ${what}`;
  return `The light you’re seeing set off ${when}.`;
}

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

export function createInfo({
  container,
  getState,
  onLook,
  onClear,
  onSelect,
  onGo,
  onEclipse,
  onWhen,
  placeName,
  catalog,
}) {
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

  // ---------------------------------------------------------------- Eclipses
  // Searching takes a few milliseconds, so the answers are kept for the day.
  // The searches look years ahead (tens of milliseconds), but the answer only
  // changes once an eclipse is over, so it's kept until then: until the day after
  // the first one listed ends (it stays listed on its own day), or until you move
  // or go back before the day it was found from.
  let eclipseMemo = null;
  function eclipses(s) {
    const { loc, ms } = s;
    const place = `${loc.lat.toFixed(2)}|${loc.lon.toFixed(2)}|${loc.tz}`;
    const m = eclipseMemo;
    if (m && m.place === place && ms >= m.from && ms < m.until) return m.value;
    const from = startOfLocalDay(ms, loc);
    const solar = solarEclipsesFrom(from, loc, 3);
    const lunar = lunarEclipsesFrom(from, loc, 3);
    const total = nextTotalSolarEclipse(from);
    const firstEnd = Math.min(solar[0]?.end ?? Infinity, lunar[0]?.end ?? Infinity, total.peak);
    const until = Number.isFinite(firstEnd) ? startOfLocalDay(firstEnd, loc) + 86400000 : Infinity;
    const value = { solar, lunar, total: { ...total, where: placeName(total.lat, total.lon) } };
    eclipseMemo = { place, from, until, value };
    return value;
  }

  /** A button that jumps to an eclipse's peak: here, or at `place` ({ lat, lon }). */
  function eclipseButton(body, text, peak, title, place) {
    const at = place ? ` data-lat="${place.lat}" data-lon="${place.lon}"` : "";
    return `<button class="jump" data-eclipse="${body}" data-time="${peak}"${at} title="${esc(title)}">${text}</button>`;
  }

  function solarRow(e, loc) {
    const covered = e.kind === "Total" ? "" : ` · ${Math.round(e.covered * 100)}% covered`;
    const title = `Go to ${formatDateTime(e.peak, loc)}, when it's at its greatest`;
    return `<dt>${eclipseButton("sun", `${e.kind} solar`, e.peak, title)}</dt><dd>${formatYearDate(e.peak, loc)}${covered}</dd>`;
  }

  function lunarRow(e, loc) {
    const low = e.moonAltitude < 0 ? " · Moon rising or setting" : "";
    const title = `Go to ${formatDateTime(e.peak, loc)}, when it's at its greatest`;
    return `<dt>${eclipseButton("moon", `${e.kind} lunar`, e.peak, title)}</dt><dd>${formatYearDate(e.peak, loc)}${low}</dd>`;
  }

  function totalAnywhereRow(total, loc, solar) {
    // Already the next one here.
    if (solar.some((e) => e.kind === "Total" && Math.abs(e.peak - total.peak) < 86400000)) return "";
    const title = `Go to ${total.where}, at the peak of the eclipse`;
    return `<dt>${eclipseButton("sun", "Total, anywhere", total.peak, title, total)}</dt><dd>${formatYearDate(total.peak, loc)}</dd>`;
  }

  function moonEclipseRow(moon) {
    const { umbra, light } = moon.shadow;
    if (umbra >= 1) return "<dt>Eclipse</dt><dd>Total: in the Earth’s shadow</dd>";
    if (umbra > 0) return `<dt>Eclipse</dt><dd>Partial: ${Math.round(umbra * 100)}% in the Earth’s shadow</dd>`;
    if (light < 0.95) return "<dt>Eclipse</dt><dd>Penumbral: a little dimmed</dd>";
    return "";
  }

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
    const ecl = eclipses(s);
    const { where } = ecl.total;
    html += `<div class="section"><h4>Solar eclipses here</h4><dl>
      ${ecl.solar.map((e) => solarRow(e, loc)).join("")}
    </dl>
    <p class="note">The next total eclipse anywhere: ${formatYearDate(ecl.total.peak, loc)}, ${esc(where)}.
      ${eclipseButton("sun", "Go there", ecl.total.peak, `Go to ${where}, at the peak of the eclipse`, ecl.total)}</p></div>`;
    html += `<div class="section"><h4>Facts</h4><dl>
      <dt>Distance</dt><dd>${((sun.dist * AU_KM) / 1e6).toFixed(2)} million km</dd>
      <dt>Light travel time</dt><dd>${formatDuration((sun.dist * AU_KM) / LIGHT_SPEED_KM_S / 60)}</dd>
      <dt>Size</dt><dd>${sig(SUN_RADIUS_KM * 2, 4)} km across</dd>
      <dt>Apparent size</dt><dd>${(sun.angularRadius * 2 * R2D * 60).toFixed(1)}′</dd>
      ${next ? `<dt>${next[0]}</dt><dd>${formatShortDate(next[1].date.getTime(), loc)}</dd>` : ""}
      ${apsisRow(s)}
    </dl>
    <p class="note">The Earth’s orbit is a little oval: it’s nearest the Sun in early January, 147 million km away, and furthest in early July, 152 million km. So it’s not the distance that makes summer: it’s the Earth’s tilt, turning each half towards the Sun in turn.</p></div>`;
    return html;
  }

  /** When the Earth's next nearest the Sun, or furthest from it. */
  function apsisRow(s) {
    const a = cached(`apsis|${Math.floor(s.ms / DAY)}`, () =>
      A.SearchPlanetApsis(Body.Earth, A.MakeTime(new Date(s.ms)))
    );
    const what = a.kind === 0 ? "Nearest the Sun" : "Furthest from the Sun";
    return `<dt>${what}</dt><dd>${formatShortDate(a.time.date.getTime(), s.loc)} · ${(a.dist_km / 1e6).toFixed(1)} M km</dd>`;
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
    let html = `${head}<dl>${position(moon, s.skyline)}${moonEclipseRow(moon)}${riseSetRows(rs, loc, bodyRef(Body.Moon, obs))}${skylineRow(Body.Moon, s, start, 0.26)}</dl>`;
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
    const lunar = eclipses(s).lunar;
    html += `<div class="section"><h4>Coming up</h4><dl>
      ${phases.list.map((q) => `<dt>${qn[q.quarter]}</dt><dd>${formatDateTime(q.time.date.getTime(), loc)}</dd>`).join("")}
    </dl></div>
    <div class="section"><h4>Lunar eclipses here</h4>${lunar.length ? `<dl>${lunar.map((e) => lunarRow(e, loc)).join("")}</dl>` : "<p class=note>None in the next few years.</p>"}
      <p class="note">The Moon goes dark and red in the Earth’s shadow, lit only by sunlight bent through the Earth’s air.</p></div>
    <div class="section"><h4>Facts</h4><dl>
      ${phases.age !== null ? `<dt>Age</dt><dd>${phases.age.toFixed(1)} days</dd>` : ""}
      <dt>Distance</dt><dd>${Math.round(moon.dist * AU_KM).toLocaleString()} km</dd>
      <dt>Light travel time</dt><dd>${((moon.dist * AU_KM) / LIGHT_SPEED_KM_S).toFixed(2)} s</dd>
      <dt>Size</dt><dd>${sig(MOON_RADIUS_KM * 2, 4)} km across</dd>
      <dt>Apparent size</dt><dd>${(moon.angularRadius * 2 * R2D * 60).toFixed(1)}′</dd>
      <dt>Brightness</dt><dd>mag ${moon.mag.toFixed(1)}</dd>
    </dl>
    <p class="note">The phase is just geometry: you always see the half of the Moon facing the Sun, from a changing angle.</p>
    <p class="note">It always turns the same face to us: it spins once each time it goes round. And it’s slowly drifting away, about 3.8 cm a year, as the tides it raises slow the Earth’s spin.</p></div>`;
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
    const lightMin = (p.dist * AU_KM) / LIGHT_SPEED_KM_S / 60;
    return `<dl>${position(p, s.skyline)}${riseSetRows(rs, loc, bodyRef(body, obs))}${skylineRow(body, s, start, 0)}</dl>
      <div class="section"><h4>Facts</h4><dl>
        <dt>Brightness</dt><dd>mag ${p.mag.toFixed(1)}${visible ? "" : " (needs a telescope)"}</dd>
        <dt>Distance</dt><dd>${p.dist.toFixed(3)} AU · ${((p.dist * AU_KM) / 1e6).toFixed(0)} M km</dd>
        <dt>Light travel time</dt><dd>${lightMin < 60 ? `${lightMin.toFixed(1)} min` : formatDuration(lightMin)}</dd>
        <dt>Size</dt><dd>${sig(PLANETS.find((x) => x.id === p.id).radiusKm * 2, 4)} km across</dd>
        <dt>Apparent size</dt><dd>${(p.angularRadius * 2 * R2D * 3600).toFixed(1)}″</dd>
        <dt>Lit</dt><dd>${(p.phaseFraction * 100).toFixed(0)}%</dd>
        <dt>Angle from Sun</dt><dd>${elong.toFixed(0)}°</dd>
        <dt>In</dt><dd>${esc(con.name)}</dd>
        <dt>Against the stars</dt><dd>${goingBackwards(p.id, ms) ? "Going backwards (west)" : "Moving east, as usual"}</dd>
        ${nextBestRow(p.id, s)}
      </dl>
      ${elong < 15 ? `<p class="note">${esc(p.name)} is too close to the Sun to see right now.</p>` : ""}
      ${planetNote(s, p)}</div>
      ${p.id in MOONS_OF ? moonsSection(s, p) : ""}`;
  }

  const INNER = new Set(["Mercury", "Venus"]);

  /**
   * Whether a planet seems to go backwards (west) against the stars at `ms`: the
   * Earth overtaking it (or, for Mercury and Venus, it overtaking the Earth).
   */
  function goingBackwards(id, ms) {
    const lon = (t) => A.Ecliptic(A.GeoVector(Body[id], new Date(t), true)).elon;
    const d = lon(ms + DAY / 2) - lon(ms - DAY / 2);
    return ((d + 540) % 360) - 180 < 0;
  }

  /**
   * When a planet's next best for seeing: Mercury and Venus furthest from the Sun
   * in our sky, the others opposite the Sun (up all night, and nearest).
   */
  function nextBestRow(id, s) {
    const { ms, loc } = s;
    const day = Math.floor(ms / DAY);
    if (INNER.has(id)) {
      const e = cached(`elong|${id}|${day}`, () => A.SearchMaxElongation(Body[id], new Date(ms)));
      return `<dt>Furthest from the Sun</dt><dd>${formatShortDate(e.time.date.getTime(), loc)}, ${e.visibility} sky, ${e.elongation.toFixed(0)}°</dd>`;
    }
    const t = cached(`opp|${id}|${day}`, () => A.SearchRelativeLongitude(Body[id], 0, new Date(ms)).date.getTime());
    return `<dt>Next opposite the Sun</dt><dd>${formatYearDate(t, loc)}</dd>`;
  }

  /** A little more about each planet: some of it about how it is right now. */
  function planetNote(s, p) {
    const year = new Date(s.ms).getUTCFullYear();
    const note = (text) => `<p class="note">${text}</p>`;
    switch (p.id) {
      case "Mercury":
        return note(
          "The smallest planet, and the quickest, round the Sun in 88 days. It spins so slowly that a day there, sunrise to sunrise, lasts two of its years. Always near the Sun in our sky, it’s easiest to catch when it’s furthest from it, low in the twilight."
        );
      case "Venus": {
        const lit = p.phaseFraction;
        const now =
          lit < 0.5
            ? `Right now it’s on our side of the Sun: big (${(p.angularRadius * 2 * R2D * 3600).toFixed(0)}″) but only ${(lit * 100).toFixed(0)}% lit, a crescent in a telescope.`
            : `Right now it’s far round the Sun from us: small (${(p.angularRadius * 2 * R2D * 3600).toFixed(0)}″) but ${(lit * 100).toFixed(0)}% lit.`;
        return note(
          `${now} Galileo saw it go through phases like the Moon’s in 1610, growing as it thinned: proof that it goes round the Sun, not the Earth. It spins backwards, so slowly that one turn takes longer than its year.`
        );
      }
      case "Mars":
        return note(
          `${goingBackwards("Mars", s.ms) ? "Right now Mars is going backwards against the stars: the Earth, on the inside track, is overtaking it." : "Every two years or so, when the Earth overtakes it on the inside track, Mars seems to go backwards against the stars for a couple of months."} That loop puzzled astronomers for thousands of years, until it was seen that the Earth goes round the Sun too.`
        );
      case "Jupiter": {
        const lightMin = (p.dist * AU_KM) / LIGHT_SPEED_KM_S / 60;
        const later = lightMin - CLOSEST_JUPITER_MIN;
        return note(
          `In 1676 Ole Rømer noticed that Io’s eclipses came late when Jupiter was far from us, and early when it was near, and worked out why: light takes time to get here. It was the first measure of the speed of light. Right now Jupiter’s light takes ${lightMin.toFixed(0)} minutes, so we see its moons’ eclipses ${later.toFixed(0)} minutes later than we would at its very closest.`
        );
      }
      case "Saturn":
        return saturnNote(s, p, year);
      case "Uranus":
        return (
          note(
            "The first planet found with a telescope: William Herschel saw it in 1781 and at first took it for a comet."
          ) + uranusNote(s, p)
        );
      case "Neptune":
        return note(
          "Found by maths: in 1846 Urbain Le Verrier worked out where an unseen planet must be, from how it tugged on Uranus, and Johann Galle found it that night. Galileo had drawn it beside Jupiter in 1612, taking it for a star. It first got back round the Sun to where it was found in 2011."
        );
      case "Pluto":
        return plutoNote(s, year);
      default:
        return "";
    }
  }

  // Jupiter at its very closest (perihelion, at opposition): 3.95 AU, in light-minutes.
  const CLOSEST_JUPITER_MIN = (3.95 * AU_KM) / LIGHT_SPEED_KM_S / 60;

  /** "we saw them … in 2007" or "we'll see them … in 2049", told from the year you're looking at. */
  const tense = (year, y, what) =>
    year < y
      ? `we’ll see them ${what} in ${y}`
      : year > y
        ? `we saw them ${what} in ${y}`
        : `this year they’re ${what}`;
  const andList = (parts) => parts.join(", ").replace(/, ([^,]*)$/, ", and $1");

  /** Saturn's rings, tipped like its equator, open and close as it goes round the Sun. */
  function saturnNote(s, p, year) {
    // How far the rings are open to us: 0° edge-on, at most about 27°.
    const open = Math.asin(Math.abs(planetPole("Saturn", s.sky).dot(p.trueDir))) * R2D;
    const now =
      open < 4
        ? `Right now its rings are almost edge-on to us (${open.toFixed(0)}°), so thin they nearly vanish`
        : open > 22
          ? `Right now its rings are wide open to us (${open.toFixed(0)}°)`
          : `Right now its rings are ${open.toFixed(0)}° open to us`;
    const when = andList([tense(year, 2025, "edge-on"), tense(year, 2032, "widest"), tense(year, 2039, "edge-on")]);
    return `<p class="note">${now}. Saturn is tipped over 27°, and its rings with it, so as it goes round the Sun, every 29 years, we see them from above, edge-on, then from below: ${when}. It’s so light for its size that it would float in water.</p>`;
  }

  /** How far round the Sun Pluto has got since it was found. */
  function plutoNote(s, year) {
    const FOUND = Date.UTC(1930, 1, 18);
    let since;
    if (s.ms < FOUND) since = "Clyde Tombaugh will find it in 1930, on photographs taken weeks apart.";
    else if (year > 2178)
      since = "Clyde Tombaugh found it in 1930, and in 2178 it got back round the Sun to where it was found.";
    else {
      const swept =
        (A.EclipticLongitude(Body.Pluto, new Date(s.ms)) - A.EclipticLongitude(Body.Pluto, new Date(FOUND)) + 360) %
        360;
      since = `Clyde Tombaugh found it in 1930, spotting it move between photographs taken weeks apart. Since then it has gone ${(swept / 3.6).toFixed(0)}% of the way round the Sun: it gets back to where it was found in 2178.`;
    }
    return `<p class="note">${since} Its oval orbit brings it closer to the Sun than Neptune for 20 years in every 248: last from 1979 to 1999.</p>`;
  }

  /**
   * Uranus spins on its side, and its moons go round its equator, so how we see their
   * orbits changes over its 84-year year: as circles round a solstice (2030), as lines
   * at an equinox (2007, 2049).
   */
  function uranusNote(s, p) {
    // How far its pole points towards us (or away): 1 straight at us, 0 side-on.
    const towards = Math.abs(planetPole("Uranus", s.sky).dot(p.trueDir));
    const seen =
      towards > 0.8
        ? "Its pole points nearly our way just now, so we see its moons’ orbits almost face-on, as circles"
        : towards < 0.3
          ? "Its side faces us just now, so we see its moons’ orbits almost edge-on, as lines"
          : "Just now we see its moons’ orbits at a slant, as ovals";
    // Told from the year you're looking at.
    const year = new Date(s.ms).getUTCFullYear();
    const when = andList([tense(year, 2007, "edge-on"), tense(year, 2030, "face-on"), tense(year, 2049, "edge-on")]);
    return `<p class="note">Uranus spins on its side, tipped over by 98°, perhaps by a giant collision long ago, and its moons go round its equator, tipped over with it. ${seen}. That changes over its 84 years round the Sun: ${when}.</p>`;
  }

  // When a moon next crosses its planet, casts its shadow on it, and so on. Every
  // event from a few days back to three weeks ahead is worked out at once (tens of
  // milliseconds), so scrubbing back and forth through time doesn't search again.
  const DAY = 86400000;
  const MOON_DAYS = 20;
  const moonMemo = new Map();
  function moonEvents(id, ms) {
    let m = moonMemo.get(id);
    // (A day back from the window's start finds when one going on began.)
    if (!m || ms < m.from + DAY || ms > m.until - MOON_DAYS * DAY) {
      const from = ms - 3 * DAY;
      const until = ms + (MOON_DAYS + 3) * DAY;
      m = { from, until, all: moonEventsBetween(id, from, until) };
      moonMemo.set(id, m);
    }
    return nextMoonEvents(m.all, ms, MOON_DAYS);
  }

  const moonEventLabels = (planet) => [
    ["shadow", `Its shadow on ${planet}`],
    ["transit", `Crosses ${planet}`],
    ["eclipse", `In ${planet}’s shadow`],
    ["hidden", `Behind ${planet}`],
  ];

  function moonEventRow(key, label, e, s) {
    if (!e) return `<dt>${label}</dt><dd>Not in the next 20 days</dd>`;
    const { loc, ms } = s;
    const span = `${formatTime(e.start, loc)} – ${formatTime(e.end, loc)}`;
    if (e.start <= ms) return `<dt>${label}</dt><dd>Now, until ${formatTime(e.end, loc)}</dd>`;
    // Jump to the middle of it.
    const mid = Math.round((e.start + e.end) / 2);
    return `<dt>${label}</dt><dd><button class="jump" data-when="${mid}" title="Go there and look">${formatShortDate(e.start, loc)}, ${span}</button></dd>`;
  }

  /** Where a moon is, as you see it: "1.0′ east of Jupiter", "Hidden behind Jupiter", … */
  function moonWhere(m, planet, sky) {
    // Which side of the planet it's on, on the sky: east is the way the Earth turns.
    const sep = m.trueDir.angleTo(planet.trueDir) * R2D * 60;
    const ra = (planet.ra * 15) / R2D;
    const eqj = m.offsetAU.clone().applyMatrix4(sky.eqjToWorld.clone().transpose());
    const side = -eqj.x * Math.sin(ra) + eqj.y * Math.cos(ra) >= 0 ? "east" : "west";
    const name = planet.name;
    if (m.behind) return `Hidden behind ${name}`;
    if (m.inFront) return `Crossing in front of ${name}`;
    if (m.light < 0.5)
      return `In ${name}’s shadow${m.light < 0.02 ? ", dark" : m.entering ? ", fading out" : ", lighting up"}`;
    const shadow =
      m.light < 0.98
        ? m.entering
          ? ", going into its shadow"
          : ", coming out of its shadow"
        : glare(m, planet) >= 4
          ? ", lost in its glare"
          : "";
    return `${sep < 1 ? `${(sep * 60).toFixed(sep < 0.1 ? 1 : 0)}″` : `${sep.toFixed(1)}′`} ${side} of ${name}${shadow}`;
  }

  // How many moons each planet has, and why only these few are here.
  const MOONS_NOTE = {
    Mars: "Mars has just these two little moons. They’re so small, and so close to bright Mars, that they’re hard to see even in a big telescope.",
    Jupiter:
      "Jupiter has nearly a hundred known moons. The planetarium has the four big Galilean moons, little Amalthea and Thebe close in (lost in Jupiter’s glare in all but big telescopes) and Himalia and Elara far out: the rest are far too faint to see without a very big telescope.",
    Saturn:
      "Saturn has nearly three hundred known moons. Only the six brightest are in the planetarium: the rest are small and faint, or lost in the glare of Saturn and its rings.",
    Uranus:
      "Uranus has nearly thirty known moons. Only the five big ones are in the planetarium: the rest are small, dark and far too faint.",
    Neptune:
      "Neptune has sixteen known moons. Only Triton, by far the biggest, is in the planetarium: the next brightest, Nereid, is fainter than magnitude 19.",
    Pluto:
      "Pluto has five known moons. Only Charon, half Pluto’s size, is in the planetarium: the other four are tiny. Charon only just shows, zoomed in all the way, when it’s furthest from Pluto.",
  };

  /** A planet's moons, each a link, and where they are now. */
  function moonsSection(s, planet) {
    const rows = moonsOf(s.sky, planet.id)
      .map(
        (m) =>
          `<dt><button class="jump" data-select="satellite" data-id="${m.id}" title="Look at ${m.name}">${m.name}</button></dt><dd>${moonWhere(m, planet, s.sky)}</dd>`
      )
      .join("");
    return `<div class="section"><h4>Moons</h4><dl>${rows}</dl>
      <p class="note">${MOONS_NOTE[planet.id]}</p></div>`;
  }

  const GALILEAN = "One of the four big moons Galileo found in 1610.";
  const MOON_ABOUT = {
    Io: `The most volcanic place known, with hundreds of volcanoes kept molten by Jupiter’s tides squeezing it. ${GALILEAN}`,
    Europa: `Under its cracked ice lies a salty ocean holding more water than all the Earth’s seas: one of the best places to look for life beyond the Earth. ${GALILEAN}`,
    Ganymede: `The biggest moon in the Solar System, bigger than the planet Mercury, and the only one with a magnetic field of its own. ${GALILEAN}`,
    Callisto: `Craters from end to end: its surface has hardly changed in four billion years. ${GALILEAN}`,
    Amalthea:
      "A small, red, potato-shaped moon close in to Jupiter. Edward Barnard found it in 1892, the last moon anyone found by eye, without a camera.",
    Thebe: "A small, dark moon just outside Amalthea’s orbit, found in Voyager 1’s pictures in 1979.",
    Himalia:
      "The biggest of Jupiter’s far-out moons, probably a caught asteroid, on a tilted, oval orbit the Sun pulls about. Charles Perrine found it in 1904.",
    Elara: "Himalia’s smaller neighbour, found by Charles Perrine in 1905.",
    Phobos:
      "Mars’ bigger moon, a lumpy rock found by Asaph Hall in 1877. It goes round faster than Mars turns, so seen from Mars it rises in the west, and it’s slowly spiralling in.",
    Deimos: "Mars’ smaller, outer moon, found by Asaph Hall six days before Phobos, in 1877.",
    Enceladus:
      "One of the whitest things in the Solar System: fresh snow from geysers at its south pole. William Herschel found it in 1789.",
    Tethys: "Found by Giovanni Cassini in 1684, with Dione.",
    Dione: "Found by Giovanni Cassini in 1684, with Tethys.",
    Rhea: "Saturn’s second biggest moon, found by Giovanni Cassini in 1672.",
    Titan:
      "Saturn’s biggest moon, bigger than the planet Mercury, wrapped in thick orange haze. Christiaan Huygens found it in 1655.",
    Iapetus:
      "One side is as bright as snow, the side it leads with as dark as coal, so it’s much brighter west of Saturn, going away from you, than east of it. Found by Giovanni Cassini in 1671.",
    Miranda:
      "The smallest of Uranus’ big moons, patched together with grooves, ridges and cliffs up to 20 km high. Gerard Kuiper found it in 1948.",
    Ariel: "The brightest of Uranus’ moons, found by William Lassell in 1851, with Umbriel.",
    Umbriel: "The darkest of Uranus’ big moons, found by William Lassell in 1851, with Ariel.",
    Titania: "Uranus’ biggest moon, found by William Herschel in 1787, with Oberon.",
    Oberon: "The furthest out of Uranus’ big moons, found by William Herschel in 1787, with Titania.",
    Triton:
      "Neptune’s big moon goes round backwards, against Neptune’s spin, so it was probably caught from beyond Neptune. William Lassell found it in 1846, just 17 days after Neptune itself.",
    Charon:
      "Half as wide as Pluto, so big that the two swing round a point between them, each always turning the same face to the other. James Christy found it in 1978.",
  };

  /** "1 day 18 hours", or "7 hours 39 minutes". */
  function periodText(days) {
    const hoursAll = days * 24;
    if (hoursAll < 24) {
      const h = Math.floor(hoursAll);
      return `${h} hours ${Math.round((hoursAll - h) * 60)} minutes`;
    }
    const whole = Math.floor(days);
    const hours = Math.round((days - whole) * 24);
    return `${whole} day${whole === 1 ? "" : "s"} ${hours} hours`;
  }

  /** One of the planets' moons. */
  function satelliteDetails(s, id, parent) {
    const { sky } = s;
    const m = moonsOf(sky, parent).find((x) => x.id === id);
    const def = m.def;
    const planet = sky.planets.find((p) => p.id === parent);
    const planetKm = PLANETS.find((p) => p.id === parent).radiusKm;
    const fromPlanetKm = m.offsetAU.length() * AU_KM;
    const where = moonWhere(m, planet, sky);
    const lightMin = (m.dist * AU_KM) / LIGHT_SPEED_KM_S / 60;
    const events = moonEvents(id, s.ms);
    // Placed by its average orbit: say how far out that can be, here and in seconds of arc from you.
    let accuracy = "";
    if (def.fitKm) {
      const arcsec = (def.fitKm / (m.dist * AU_KM)) * R2D * 3600;
      const year = new Date(s.ms).getUTCFullYear();
      const how = def.states
        ? "from JPL’s positions for it a year and a half apart, with Jupiter’s and the Sun’s pull in between"
        : "from its average orbit";
      accuracy = `<p class="note">Its place is worked out ${how}, which keeps it within about ${sig(def.fitKm, 2)} km (${arcsec < 0.01 ? "under 0.01" : arcsec < 0.1 ? arcsec.toFixed(2) : arcsec.toFixed(1)}″ from here) of where it really is${year < 1950 || year >= 2100 ? " between 1950 and 2100. This far from them, it may be further out" : ""}.</p>`;
    }
    return `<dl>${position(m, s.skyline)}
        <dt>Seen from here</dt><dd>${where}</dd>
        ${m.shadowOnPlanet ? `<dt>Its shadow</dt><dd>On ${planet.name}${PLANETS.find((p) => p.id === parent).rocky ? "" : "’s clouds"}</dd>` : ""}</dl>
      <div class="section"><h4>Coming up</h4><dl>
        ${moonEventLabels(planet.name)
          .map(([key, label]) => moonEventRow(key, label, events[key], s))
          .join("")}
      </dl></div>
      <div class="section"><h4>Facts</h4><dl>
        <dt>Brightness</dt><dd>mag ${m.mag.toFixed(1)}</dd>
        <dt>From ${planet.name}</dt><dd>${sig(fromPlanetKm, 3)} km · ${(fromPlanetKm / planetKm).toFixed(1)} ${planet.name} radii</dd>
        <dt>Goes round in</dt><dd>${periodText(def.periodDays)}</dd>
        <dt>Size</dt><dd>${sig(def.radiusKm * 2, 4)} km across</dd>
        <dt>Distance</dt><dd>${m.dist.toFixed(3)} AU · ${((m.dist * AU_KM) / 1e6).toFixed(0)} M km</dd>
        <dt>Light travel time</dt><dd>${lightMin < 60 ? `${lightMin.toFixed(1)} min` : formatDuration(lightMin)}</dd>
      </dl>
      <p class="note">${MOON_ABOUT[id]}</p>${accuracy}</div>`;
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
        ${starDistance(s, star).rows}
        <dt>Colour (B−V)</dt><dd>${star.bv.toFixed(2)}</dd>
        <dt>RA / Dec</dt><dd>${(star.ra / 15).toFixed(2)}h / ${star.dec.toFixed(1)}°</dd>
        <dt>Catalogue</dt><dd>HIP ${star.hip}</dd>
      </dl>${starLightNote(s, star)}</div>`;
  }

  /** When the star's light set off, set against history (if its distance is known well enough). */
  function starLightNote(s, star) {
    const d = starDistance(s, star);
    return d.left == null ? "" : `<p class="note">${lightLeftNote(d.left, d.about)}</p>`;
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

  /** The Earth, seen from up above it. */
  function earthDetails(e) {
    if (!e) return "";
    const km = (v) => (v < 1e6 ? `${Math.round(v).toLocaleString()} km` : `${(v / 1e6).toFixed(1)} million km`);
    return `<dl>
        <dt>Below you</dt><dd>${esc(e.below)}, ${e.daylight}</dd>
        <dt>Height</dt><dd>${km(e.km)} up</dd>
        <dt>Across the sky</dt><dd>${e.across.toFixed(e.across < 10 ? 1 : 0)}°</dd>
        <dt>Lit</dt><dd>${(e.lit * 100).toFixed(0)}% of the side facing you</dd>
      </dl>
      <div class="section"><h4>Facts</h4><dl>
        <dt>To the Sun</dt><dd>${km(e.sunKm)}</dd>
        <dt>To the Moon</dt><dd>${km(e.moonKm)}</dd>
        <dt>Size</dt><dd>${km(12742)} across</dd>
        <dt>A day</dt><dd>23 h 56 min to turn once</dd>
        <dt>A year</dt><dd>365.26 days round the Sun</dd>
      </dl></div>`;
  }

  /** "α Orionis · Star in Orion", with the constellation a link to it. */
  function starKind(star) {
    const con =
      star.con &&
      `Star in <button class="jump" data-select="constellation" data-id="${esc(star.con)}" title="Look at ${esc(star.conName)}">${esc(star.conName)}</button>`;
    return [star.proper && esc(star.designation), con].filter(Boolean).join(" · ") || "Star";
  }

  function constellationDetails(s, c) {
    const pos = c.position(s.sky);
    const stars = catalog.starsIn(c.id).slice(0, 5);
    return `<dl>${position(pos, s.skyline)}</dl>
      ${stars.length ? `<div class="section"><h4>Brightest stars</h4><dl>${stars.map((st) => `<dt><button class="jump" data-select="star" data-id="${st.hip}" title="Look at ${esc(st.name)}">${esc(st.label)}</button></dt><dd>${["mag " + st.mag.toFixed(1), starDistance(s, st).short].filter(Boolean).join(" · ")}</dd>`).join("")}</dl></div>` : ""}`;
  }

  function eclipseOverview(s) {
    const { loc } = s;
    const { solar, lunar, total } = eclipses(s);
    const rows = [
      solar[0] && solarRow(solar[0], loc),
      lunar[0] && lunarRow(lunar[0], loc),
      totalAnywhereRow(total, loc, solar.slice(0, 1)),
    ];
    return `<div class="section"><h4>Next eclipses</h4><dl>${rows.filter(Boolean).join("")}</dl></div>`;
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
      ${eclipseOverview(s)}
      ${sunUp ? STARS_TIP : ""}
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
      kind = PLANETS.find((x) => x.id === sel.id).dwarf ? "Dwarf planet" : "Planet";
      body = planetDetails(s, p);
    } else if (sel.type === "satellite") {
      kind = `Moon of <button class='jump' data-select='planet' data-id='${sel.parent}' title='Look at ${sel.parent}'>${sel.parent}</button>`;
      body = satelliteDetails(s, sel.id, sel.parent);
    } else if (sel.type === "star") {
      kind = starKind(sel.star);
      body = starDetails(s, sel.star);
    } else if (sel.type === "constellation") {
      kind = "Constellation";
      body = constellationDetails(s, sel.constellation);
    } else if (sel.type === "feature") {
      kind = FEATURE_KIND[sel.feature.kind];
      body = featureDetails(s, sel.feature);
    } else if (sel.type === "earth") {
      kind = "Our home planet";
      body = earthDetails(s.earth);
    }
    // A star's kind links to its constellation, and a moon's to its planet, so they're already HTML.
    const kindHtml = sel.type === "star" || sel.type === "satellite" ? kind : esc(kind);
    return `<h3>${esc(title)}</h3><p class="kind">${kindHtml}</p>${body}
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
    const when = e.target.closest("[data-when]")?.dataset.when;
    if (when) onWhen?.(+when);
    const eclipse = e.target.closest("[data-eclipse]")?.dataset;
    if (eclipse) {
      const place = eclipse.lat != null ? { lat: +eclipse.lat, lon: +eclipse.lon } : null;
      onEclipse(eclipse.eclipse, +eclipse.time, place);
    }
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
