import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, FIRST_DAY, LAST_DAY, civilClock, dateText, offsetText } from '../src/clock.js';
import { skyAt, solarEvents, spaceAt, EARTH_KM, MOON_KM } from '../src/astronomy.js';
import { cities, coordinateSite, findCities } from '../src/places.js';

const day = value => Date.parse(value) / DAY;
const city = name => cities.find(place => place.name === name);
const iso = instant => new Date(instant).toISOString();
const close = (actual, expected, tolerance, name) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} not within ${tolerance} of ${expected}`);

test('city selection changes civil time and sky without changing the instant', () => {
  const reykjavik = city('Reykjavik'), tokyo = city('Tokyo');
  const date = day('2024-04-08');
  const { instant } = civilClock(reykjavik.zone).resolve(date, 12 * 3600);
  const reading = civilClock(tokyo.zone).parts(instant);
  assert.equal(iso(instant), '2024-04-08T12:00:00.000Z');
  assert.equal(reading.seconds, 21 * 3600);
  assert.equal(offsetText(reading.offset), 'UTC+09:00');
  assert.ok(skyAt(instant, reykjavik).sun.altitude > 0);
  assert.ok(skyAt(instant, tokyo).sun.altitude < 0);
  assert.equal(coordinateSite('Ocean', 0, -140).zone, 'UTC');
  assert.equal(coordinateSite('Invalid', 91, 0), null);
  assert.equal(findCities('tromso')[0].name, 'Tromsø');
});

test('civil edits preserve clock time across offsets, snap gaps forward and choose the earlier fold', () => {
  const ny = civilClock('America/New_York');
  const before = ny.resolve(day('2024-03-09'), 12 * 3600);
  const after = ny.resolve(day('2024-03-10'), ny.parts(before.instant).seconds);
  assert.equal(after.instant - before.instant, 23 * 3600000);
  const gap = ny.resolve(day('2024-03-10'), 2 * 3600 + 15 * 60);
  assert.equal(iso(gap.instant), '2024-03-10T07:00:00.000Z');
  assert.equal(gap.adjusted, true);
  const fold = ny.resolve(day('2024-11-03'), 90 * 60);
  assert.equal(iso(fold.instant), '2024-11-03T05:30:00.000Z');
  assert.equal(fold.repeated, true);
  assert.equal(ny.parts(fold.instant + 3600000).seconds, 90 * 60);
  assert.equal(offsetText(ny.parts(fold.instant + 3600000).offset), 'UTC−05:00');
  assert.equal(ny.dayBounds(day('2024-11-03'))[1] - ny.dayBounds(day('2024-11-03'))[0], 25 * 3600000);
  const apia = civilClock('Pacific/Apia');
  assert.equal(apia.dayBounds(day('2011-12-30'))[0], apia.dayBounds(day('2011-12-30'))[1]);
});

test('civil midnight, leap day, and both date range boundaries round-trip', () => {
  const clock = civilClock('Asia/Tokyo');
  for (const d of [FIRST_DAY, day('2000-02-29'), LAST_DAY]) {
    const [start, end] = clock.dayBounds(d);
    assert.equal(clock.parts(start - 1).day, d - 1);
    assert.equal(clock.parts(start).day, d);
    assert.equal(clock.parts(start).seconds, 0);
    assert.equal(clock.parts(end - 1).seconds, 86399);
    assert.equal(clock.parts(end).day, d + 1);
  }
  assert.equal(dateText(FIRST_DAY), '1900-01-01');
  assert.equal(dateText(LAST_DAY), '2100-12-31');
});

test('sampled apparent positions, sizes and lunar light agree with independent Horizons and USNO fixtures', () => {
  // Horizons API DE441: CENTER=coord@399, QUANTITIES=4,10,13, APPARENT=REFRACTED,
  // TLIST=timestamp, SITE_COORD=lon,lat,0. Body IDs 10, 301, 599, 499; retrieved 2026-11-22.
  for (const [timestamp, lat, lon, rows, percent] of [
    ['2024-04-08T18:43Z', 32.78, -96.8, [['Sun', 188.212001, 64.611485, 1915.640],
      ['Moon', 188.195956, 64.608779, 2024.310]], 0],
    ['1900-01-03T02:00Z', -33.869, 151.209, [['Sun', 359.491244, 79.017681, 1951.198],
      ['Jupiter', 278.608688, 48.733671]]],
    ['2100-12-28T10:00Z', 69.649, 18.955, [['Moon', 205.667957, -7.472235, 1975.489],
      ['Mars', 194.810225, -1.976478]], 9.72527],
  ]) {
    const s = skyAt(Date.parse(timestamp), { lat, lon });
    for (const [name, az, alt, arcseconds] of rows) {
      const object = [s.sun, s.moon, ...s.planets].find(item => item.name === name);
      close(object.azimuth, az, .1, `${timestamp} ${name} azimuth`);
      close(object.altitude, alt, .1, `${timestamp} ${name} altitude`);
      if (arcseconds) close(object.diameter * 3600, arcseconds, arcseconds * .05, `${name} diameter`);
    }
    if (percent !== undefined) close(s.illumination * 100, percent, 2, 'Moon illumination');
  }
  // USNO celnav?date=2024-04-08&time=18:43:00&coords=32.78,-96.8;
  // star altitude = computed Hc minus the published refraction correction.
  const { stars } = skyAt(Date.parse('2024-04-08T18:43Z'), { lat: 32.78, lon: -96.8 });
  for (const [name, az, alt] of [['Capella', 55.414647, 44.239891 + .017004], ['Rigel', 116.047031, 21.755957 + .041066]]) {
    const star = stars.find(item => item.name === name);
    close(star.azimuth, az, .1, `${name} azimuth`);
    close(star.altitude, alt, .1, `${name} altitude`);
  }
});

test('London solstice events agree with USNO; polar cases include a 1-crossing day', () => {
  // USNO rstt/oneday: coords=51.507,-0.128, tz=0, rounded UTC minute.
  const london = city('London');
  for (const [date, rise, set] of [['2024-06-20', '03:43', '20:21'], ['2024-12-21', '08:04', '15:54']]) {
    const result = solarEvents(...civilClock(london.zone).dayBounds(day(date)), london);
    const bounds = [rise, set].map(time => Date.parse(`${date}T${time}Z`));
    assert.deepEqual(result.events.map(event => event.type), ['Sunrise', 'Sunset']);
    result.events.forEach((event, i) => close(event.instant, bounds[i], 120000, event.type));
    close(result.duration, bounds[1] - bounds[0], 120000, 'daylight duration');
  }
  const site = city('Tromsø');
  const events = date => solarEvents(...civilClock(site.zone).dayBounds(day(date)), site);
  assert.deepEqual(events('2024-06-21'), { events: [], duration: DAY, state: 'polar day' });
  assert.deepEqual(events('2024-12-21'), { events: [], duration: 0, state: 'polar night' });
  const single = events('2024-05-16');
  assert.deepEqual(single.events.map(event => event.type), ['Sunrise']);
  assert.ok(single.duration < DAY && single.duration > 22 * 3600000);
});

test('quarter moons have comparable illumination but opposite phase; globe distances are physical', () => {
  const first = skyAt(Date.parse('2024-04-15T19:13Z'), city('Tokyo'));
  const last = skyAt(Date.parse('2024-05-01T11:27Z'), city('Tokyo'));
  close(first.illumination, last.illumination, .03, 'quarter illumination');
  close(first.phase, 90, .1, 'first quarter');
  close(last.phase, 270, .1, 'last quarter');
  const t = Date.parse('2024-04-08T18:43Z');
  const a = spaceAt(t), b = spaceAt(t + DAY / 2);
  close(MOON_KM / EARTH_KM, .2727, .0001, 'lunar radius in Earth radii');
  assert.ok(Math.hypot(...a.moon) * EARTH_KM > 350000 && Math.hypot(...a.moon) * EARTH_KM < 410000);
  close(Math.abs(a.spin - b.spin), Math.PI, .01, 'sidereal rotation in 12 hours');
  assert.ok(Math.hypot(...a.moon.map((value, i) => value - b.moon[i])) > 3);
});
