// Wall-clock helpers for a location. A location either has an IANA time zone
// (cities, or the browser's own zone) or falls back to a whole-hour offset
// derived from longitude (≈ local solar time).

const formatterCache = new Map();

function partsFormatter(tz) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function isValidZone(tz) {
  if (!tz) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes to add to UTC to get local wall-clock time at `ms`. */
export function offsetMinutes(ms, loc) {
  if (loc.tz && isValidZone(loc.tz)) {
    const p = {};
    for (const { type, value } of partsFormatter(loc.tz).formatToParts(new Date(ms))) p[type] = +value;
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  return Math.round(loc.lon / 15) * 60;
}

/** A Date whose UTC fields read as the local wall-clock time. */
export function shifted(ms, loc) {
  return new Date(ms + offsetMinutes(ms, loc) * 60000);
}

export function localMinutesOfDay(ms, loc) {
  const d = shifted(ms, loc);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

export function startOfLocalDay(ms, loc) {
  const d = shifted(ms, loc);
  const localMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Convert back using the offset at that moment (good across DST in practice).
  return localMidnight - offsetMinutes(localMidnight - offsetMinutes(ms, loc) * 60000, loc) * 60000;
}

export function dayOfYear(ms, loc) {
  const d = shifted(ms, loc);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (d.getTime() - start) / 86400000;
}

const locale = navigator.language || "en-GB";
const fmtTime = new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
const fmtTimeSec = new Intl.DateTimeFormat(locale, {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const fmtDate = new Intl.DateTimeFormat(locale, {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const fmtShortDate = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" });
const fmtYearDate = new Intl.DateTimeFormat(locale, {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const formatTime = (ms, loc, seconds = false) => (seconds ? fmtTimeSec : fmtTime).format(shifted(ms, loc));
export const formatDate = (ms, loc) => fmtDate.format(shifted(ms, loc));
export const formatShortDate = (ms, loc) => fmtShortDate.format(shifted(ms, loc));
export const formatYearDate = (ms, loc) => fmtYearDate.format(shifted(ms, loc));

export function formatDateTime(ms, loc) {
  return `${formatShortDate(ms, loc)} ${formatTime(ms, loc)}`;
}

export function zoneLabel(ms, loc) {
  const off = offsetMinutes(ms, loc);
  const sign = off < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  const utc = `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  if (loc.tz && isValidZone(loc.tz)) {
    const city = loc.tz.split("/").pop().replace(/_/g, " ");
    return `${city} time · ${utc}`;
  }
  return `≈ solar time · ${utc}`;
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 60 ? `${h + 1}h 00m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Value for <input type="datetime-local"> in the location's wall-clock time. */
export function toInputValue(ms, loc) {
  return shifted(ms, loc).toISOString().slice(0, 16);
}

export function fromInputValue(value, loc, refMs) {
  // Browsers parse almost anything (an empty field reads as 1 January 2000), so check the shape first.
  if (!/^-?\d{4,6}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const asUtc = Date.parse(`${value}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  return asUtc - offsetMinutes(refMs, loc) * 60000;
}
