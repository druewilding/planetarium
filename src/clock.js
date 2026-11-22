export const SECOND = 1000;
export const DAY = 86400 * SECOND;
export const FIRST_DAY = Date.UTC(1900, 0, 1) / DAY;
export const LAST_DAY = Date.UTC(2100, 11, 31) / DAY;

export function civilClock(zone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  });

  function parts(instant) {
    const values = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, Number(p.value)]));
    const day = Date.UTC(values.year, values.month - 1, values.day) / DAY;
    const seconds = values.hour * 3600 + values.minute * 60 + values.second;
    const wall = day * DAY + seconds * SECOND;
    return { day, seconds, offset: wall - Math.floor(instant / SECOND) * SECOND };
  }

  function resolve(day, seconds = 0) {
    const wall = day * DAY + seconds * SECOND;
    const offsets = new Set();
    const transitions = [];
    const step = 6 * 3600 * SECOND;
    let previous;
    // Find offsets on both sides of the requested civil reading. Also locate forward jumps
    // to resolve gaps (including date-line jumps) to the first representable local second.
    for (let sample = wall - 2 * DAY; sample <= wall + 2 * DAY; sample += step) {
      const { offset } = parts(sample);
      offsets.add(offset);
      if (previous !== undefined && previous < offset) {
        let a = (sample - step) / SECOND;
        let b = sample / SECOND;
        while (b - a > 1) {
          const mid = Math.floor((a + b) / 2);
          if (parts(mid * SECOND).offset === previous) a = mid;
          else b = mid;
        }
        if (wall >= b * SECOND + previous && wall < b * SECOND + offset) transitions.push(b * SECOND);
      }
      previous = offset;
    }
    const exact = [...offsets].map(offset => wall - offset)
      .filter(instant => instant + parts(instant).offset === wall).sort((a, b) => a - b);
    if (exact.length) return { instant: exact[0], adjusted: false, repeated: exact.length > 1 };
    if (transitions.length) return { instant: Math.min(...transitions), adjusted: true, repeated: false };
    throw new RangeError('Civil reading could not be resolved');
  }

  return { zone, parts, resolve, dayBounds: day => [resolve(day).instant, resolve(day + 1).instant] };
}

const pad = number => String(number).padStart(2, '0');
export const dateText = day => new Date(day * DAY).toISOString().slice(0, 10);
export function timeText(seconds) {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
export const offsetText = offset => `UTC${offset < 0 ? '−' : '+'}${timeText(Math.abs(offset) / SECOND).replace(/:00$/, '')}`;
