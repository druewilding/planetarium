// Astronomical seasons: each runs from an equinox or solstice to the next.
// The southern hemisphere has them the other way round.

import { A } from "./astro.js";

const cache = new Map();
function events(year) {
  if (!cache.has(year)) {
    try {
      const s = A.Seasons(year);
      cache.set(
        year,
        [s.mar_equinox, s.jun_solstice, s.sep_equinox, s.dec_solstice].map((t) => t.date.getTime())
      );
    } catch {
      cache.set(year, null); // Seasons() can throw for extreme years
    }
  }
  return cache.get(year);
}

// Season names in the north, starting from each event (Mar, Jun, Sep, Dec).
const NORTH = ["spring", "summer", "autumn", "winter"];
const SOUTH = ["autumn", "winter", "spring", "summer"];
const EVENT_NAMES = {
  north: ["spring equinox", "summer solstice", "autumn equinox", "winter solstice"],
  south: ["autumn equinox", "winter solstice", "spring equinox", "summer solstice"],
};

const NEUTRAL_EVENTS = ["March equinox", "June solstice", "September equinox", "December solstice"];

const TROPICS = 10; // degrees: closer to the equator than this, the four seasons barely apply

const capitalise = (t) => t[0].toUpperCase() + t.slice(1);

/** What a solstice or equinox means for the length of the day. */
function eventMeaning(eventIndex, south, tropical) {
  if (eventIndex === 0 || eventIndex === 2) return "day and night are about equal";
  if (tropical) return eventIndex === 1 ? "the Sun is furthest north" : "the Sun is furthest south";
  const longest = (eventIndex === 1) !== south; // June is the longest day in the north
  return longest ? "the longest day of the year" : "the shortest day of the year";
}

/**
 * The season at an instant and place (dayStart = local midnight, so a solstice or
 * equinox can be recognised for the whole calendar day it falls on):
 * { name, phase, start, end, nextEvent, daysToNext, label, event?, eventMeaning?, tropical? }
 */
export function seasonAt(ms, lat, dayStart = ms) {
  const year = new Date(ms).getUTCFullYear();
  const prev = events(year - 1);
  const cur = events(year);
  const next = events(year + 1);
  if (!prev || !cur || !next) return null;
  const south = lat < 0;
  const tropical = Math.abs(lat) < TROPICS;

  // Is today a solstice or equinox?
  for (const [k, t] of cur.entries()) {
    if (t >= dayStart && t < dayStart + 86400000) {
      const name = tropical ? NEUTRAL_EVENTS[k] : capitalise((south ? EVENT_NAMES.south : EVENT_NAMES.north)[k]);
      return {
        name: tropical ? "tropical" : (south ? SOUTH : NORTH)[k],
        label: name,
        event: name,
        eventTime: t,
        eventMeaning: eventMeaning(k, south, tropical),
        tropical,
      };
    }
  }
  if (tropical) return { tropical: true, name: "tropical", label: "Tropical" };

  const marks = [prev[3], ...cur, next[0]]; // Dec (last year), Mar, Jun, Sep, Dec, Mar (next year)
  let i = 0;
  while (i < marks.length - 2 && ms >= marks[i + 1]) i++;
  const start = marks[i];
  const end = marks[i + 1];
  // Index of the event that started this season, in Mar/Jun/Sep/Dec order.
  const startEvent = (i + 3) % 4;
  const name = (south ? SOUTH : NORTH)[startEvent];
  const f = (ms - start) / (end - start);
  const phase = f < 1 / 3 ? "Early" : f < 2 / 3 ? "Mid" : "Late";
  const nextEvent = (south ? EVENT_NAMES.south : EVENT_NAMES.north)[(startEvent + 1) % 4];
  return {
    name,
    phase,
    start,
    end,
    nextEvent,
    daysToNext: (end - ms) / 86400000,
    label: `${phase} ${name}`,
  };
}
