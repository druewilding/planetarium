import { skyAt, solarEvents, spaceAt, EARTH_KM, RAD } from './astronomy.js';
import { civilClock, dateText, timeText, offsetText, SECOND, DAY, FIRST_DAY, LAST_DAY } from './clock.js';
import { cities, coordinateSite, example, findCities } from './places.js';
import { globeView } from './globe-view.js';
import { skyView } from './sky-view.js';

const $ = id => document.getElementById(id);
const view = $('viewport');
const skyCanvas = $('sky');
const spaceCanvas = $('space');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const wrap = degrees => (degrees % 360 + 360) % 360;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const SPACE_SAMPLE_INTERVAL = 50; // Real milliseconds; input and flight still render on animation frames.
const surface = { az: 180, alt: 12 };
const orbit = { theta: 0, latitude: 0, distance: 4.3, focus: 'earth', overview: false };
const options = { glare: 1, labels: true, lines: true };
let instant = Date.now(), rate = 1, playing = true, live = true;
let startReal = performance.now(), startSim = instant;
let site = example, clock = civilClock(site.zone), range = clockRange();
let sky, skySecond, space, spaceInstant, spaceSampleTime, shownDay, shownSecond;
let pendingLocation = null, flight = null, mode = 'surface', pinning = false;
let width, height, dpi, dirty = true;

function notice(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function noGlobe() {
  globe = null; mode = 'surface'; flight = null; pinning = false;
  notice('compatibility', 'The 3D globe needs WebGL 2. The surface sky and manual location controls are still available.');
  viewControls();
}

const skyRenderer = skyView(skyCanvas);
let globe;
if (skyRenderer) {
  try { globe = globeView(spaceCanvas, noGlobe); }
  catch { globe = null; }
}
if (!globe) noGlobe();
if (!skyRenderer) notice('compatibility', 'This browser cannot draw the sky. Time, location and object readouts are still available.');

function clockRange() {
  return [clock.resolve(FIRST_DAY).instant, clock.resolve(LAST_DAY + 1).instant - 1];
}

function resetAnchor() {
  startReal = performance.now();
  startSim = instant;
}

function advance(real = performance.now()) {
  if (!playing) return;
  const next = live ? Date.now() : startSim + Math.max(0, real - startReal) * rate;
  if (next >= range[1] || next < range[0]) {
    instant = clamp(next, range[0], range[1]);
    playing = false; live = false;
    playButton();
    notice('clock-status', 'Playback stopped at the supported local date boundary.');
  } else instant = next;
}

function playButton() { $('play').textContent = playing ? 'Pause' : 'Play'; }

function editClock(day, seconds) {
  if (!Number.isInteger(day) || day < FIRST_DAY || day > LAST_DAY || !Number.isInteger(seconds) || seconds < 0 || seconds >= 86400) return;
  const result = clock.resolve(day, seconds);
  instant = clamp(result.instant, ...range); playing = false; live = false;
  shownSecond = undefined;
  playButton();
  notice('clock-status', result.adjusted ? 'That local time did not occur. Moved to the first valid local time.' :
    result.repeated ? 'That local time occurs twice. Showing the earlier occurrence.' : '');
}

function cancelLocation() {
  if (!pendingLocation) return;
  clearTimeout(pendingLocation.timer);
  pendingLocation = null;
  $('locate').disabled = false;
  $('locate').textContent = 'Use my location';
}

function selectSite(next, message = '') {
  // Capture the instant under the old clock before swapping civil rules.
  advance();
  cancelLocation();
  site = next;
  try { clock = civilClock(site.zone); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    site = { ...site, zone: 'UTC', fallback: true }; clock = civilClock('UTC');
  }
  range = clockRange();
  if (instant < range[0] || instant > range[1]) {
    playing = false; live = false; playButton();
    notice('clock-status', 'The same instant falls just outside this location’s supported dates. Choose a date to resume.');
  } else notice('clock-status', '');
  shownDay = shownSecond = skySecond = undefined;
  updateSky();
  if (!flight && mode === 'surface') aimSky();
  $('site').textContent = site.name;
  $('coordinates').textContent = `${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`;
  notice('location-status', message);
  setPin(false);
  dirty = true;
}

function aimSky() {
  const object = sky.sun.altitude > -3 ? sky.sun : sky.moon.altitude > 2 ? sky.moon : null;
  surface.az = object?.azimuth ?? (site.lat >= 0 ? 180 : 0);
  surface.alt = clamp(object?.altitude ?? 24, 8, 80);
}

function updateSky() {
  const second = Math.floor(instant / SECOND);
  if (skySecond === second) return;
  skySecond = second;
  sky = skyAt(second * SECOND, site);
  if (mode === 'surface' || flight) dirty = true;
}

function updateSpace(real = performance.now()) {
  if (spaceInstant === instant) return false;
  if (playing && spaceInstant !== undefined && real - spaceSampleTime < SPACE_SAMPLE_INTERVAL) return false;
  space = spaceAt(instant);
  spaceInstant = instant;
  spaceSampleTime = real;
  return true;
}

function updateReadouts() {
  if (shownSecond === skySecond) return;
  const { day, seconds, offset } = clock.parts(instant);
  const date = dateText(day), localTime = timeText(seconds);
  shownSecond = skySecond;
  $('local-clock').textContent = `${date} · ${localTime}`;
  $('local-clock').dateTime = new Date(instant).toISOString();
  $('zone').textContent = site.fallback ? 'UTC · no reliable civil zone for these coordinates' : `${clock.zone} · ${offsetText(offset)}`;
  $('date-dial').value = clamp(day, FIRST_DAY, LAST_DAY);
  $('date-dial').setAttribute('aria-valuetext', date);
  $('time-dial').value = seconds;
  $('time-dial').setAttribute('aria-valuetext', localTime);
  // Do not rewrite fields while typing; the change handlers normalize committed values.
  if (document.activeElement !== $('date-edit')) $('date-edit').value = date;
  if (document.activeElement !== $('time-edit')) $('time-edit').value = localTime;
  const waxing = sky.phase < 180;
  $('phase').textContent = `${Math.round(sky.illumination * 100)}% · ${waxing ? 'waxing' : 'waning'}`;
  if ($('directions').parentElement.open) updateDirections();

  if (shownDay !== day) {
    shownDay = day;
    const [start, end] = clock.dayBounds(day);
    const solar = solarEvents(start, end, site);
    for (const [id, type, missing] of [['sunrise', 'Sunrise', 'Does not rise'], ['sunset', 'Sunset', 'Does not set']]) {
      const readings = solar.events.filter(event => event.type === type).map(event => {
        const local = clock.parts(event.instant);
        return `${timeText(local.seconds).slice(0, 5)}${end - start === DAY ? '' : ` (${offsetText(local.offset)})`}`;
      });
      $(id).textContent = readings.join(', ') || missing;
    }
    const minutes = Math.round(solar.duration / (60 * SECOND));
    $('daylight').textContent = `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    const state = { 'polar day': 'Polar day. ', 'polar night': 'Polar night. ', skipped: 'This date was skipped locally. ' };
    $('solar-note').textContent = `${state[solar.state] ?? ''}Estimated for a level, sea-level horizon.`;
  }
}

function updateDirections() {
  const objects = [sky.sun, sky.moon, ...sky.planets, ...sky.stars.slice(0, 5)];
  $('directions').replaceChildren(...objects.map(obj => {
    const li = document.createElement('li');
    li.textContent = `${obj.name}: ${obj.azimuth.toFixed(1)}° az, ${obj.altitude.toFixed(1)}° alt` +
      (obj.diameter ? ` · ${obj.diameter.toFixed(2)}° diameter` : '');
    return li;
  }));
}

function resize() {
  width = view.clientWidth; height = view.clientHeight;
  if (!width || !height) return;
  dpi = Math.min(devicePixelRatio || 1, 2);
  skyCanvas.width = Math.round(width * dpi); skyCanvas.height = Math.round(height * dpi);
  globe?.resize(width, height, dpi);
  dirty = true;
}

function viewControls() {
  const inSpace = mode === 'globe';
  $('view-name').textContent = flight ? (flight.toSpace ? 'Lifting off' : 'Returning to surface') : inSpace ? 'Globe view' : 'Surface sky';
  $('flight').textContent = inSpace ? 'Return to surface ↓' : 'Lift off ↗';
  $('flight').disabled = !globe || Boolean(flight);
  $('pin').disabled = !globe || Boolean(flight);
  $('zoom').hidden = !inSpace || Boolean(flight);
  $('orbit-tools').hidden = !inSpace || Boolean(flight);
  $('overview').setAttribute('aria-pressed', String(orbit.overview));
  $('view-badge').hidden = !inSpace || Boolean(flight);
  $('view-help').textContent = pinning ? 'Tap or click Earth to place a pin. Escape cancels.' :
    inSpace ? 'Drag or use arrow keys to orbit. Pinch, scroll or use the zoom buttons.' : 'Drag or use arrow keys to look around.';
  spaceCanvas.hidden = !inSpace && !flight;
  skyCanvas.hidden = inSpace && !flight;
  if (!inSpace) $('view-badge').textContent = '';
  dirty = true;
}

function frameEarth() {
  updateSpace();
  orbit.theta = site.lon * RAD + space.spin;
  orbit.latitude = clamp(site.lat * RAD, -1.55, 1.55);
  orbit.distance = orbit.overview ? Math.max(10, 10 * height / width) : 4.3;
  orbit.focus = 'earth'; dirty = true;
}

function fly(toSpace, placePin = false) {
  if (!globe || flight) return;
  if (toSpace) { orbit.overview = false; frameEarth(); }
  else setPin(false);
  flight = { toSpace, placePin, start: performance.now(), duration: motion.matches ? 0 : 1150 };
  viewControls();
}

function setPin(enabled) {
  pinning = enabled;
  view.classList.toggle('pinning', enabled);
  $('pin').setAttribute('aria-pressed', String(enabled));
  viewControls();
}

function draw(real) {
  let progress = mode === 'globe' ? 1 : 0;
  if (flight) {
    const t = flight.duration ? clamp((real - flight.start) / flight.duration, 0, 1) : 1;
    const eased = t * t * (3 - 2 * t);
    progress = flight.toSpace ? eased : 1 - eased;
    if (t === 1) {
      const { toSpace, placePin } = flight;
      mode = toSpace ? 'globe' : 'surface'; flight = null;
      setPin(placePin);
    }
  }
  const spaceVisible = Boolean(flight) || mode === 'globe';
  if (!width || !height) return;
  const spaceChanged = spaceVisible && globe && updateSpace(real);
  if (dirty || flight || spaceChanged) {
    if (spaceVisible && globe) {
      globe.draw(space, site, surface, orbit, progress);
      if (mode === 'globe') {
        const badge = $('view-badge');
        const text = `${orbit.overview ? 'Not to scale' : 'True Earth–Moon scale'} · ${Math.round(Math.hypot(...space.moon) * EARTH_KM).toLocaleString('en-US')} km center to center`;
        if (badge.textContent !== text) badge.textContent = text;
      }
    }
    if (progress < 1) skyRenderer?.draw(sky, surface, options, width, height, dpi);
    const heading = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(surface.az / 45) % 8];
    $('bearing').textContent = mode === 'surface' && !flight ? `${heading} ${Math.round(surface.az) % 360}° · ${Math.round(surface.alt)}° altitude` : '';
    skyCanvas.style.opacity = String(1 - clamp((progress - .08) / .72, 0, 1));
    dirty = false;
  }
}

function tick(real) {
  advance(real); updateSky(); updateReadouts(); draw(real);
  requestAnimationFrame(tick);
}

$('locate').addEventListener('click', () => {
  const api = navigator.geolocation;
  if (!api || !isSecureContext) {
    notice('location-status', 'Location is unavailable here. Search for a city or place a pin instead.'); return;
  }
  const request = {};
  const reject = message => {
    if (pendingLocation !== request) return;
    cancelLocation(); notice('location-status', message);
  };
  request.timer = setTimeout(() => reject('Location timed out. Your current site is unchanged.'), 10000);
  pendingLocation = request;
  $('locate').disabled = true; $('locate').textContent = 'Locating…';
  notice('location-status', 'Waiting for browser location permission or a position…');
  api.getCurrentPosition(({ coords }) => {
    if (pendingLocation !== request) return;
    const next = coordinateSite('Your location', coords.latitude, coords.longitude);
    if (next) selectSite(next, 'Location applied for this visit only.');
    else reject('The browser returned an invalid position. Your current site is unchanged.');
  }, error => reject(error.code === 1 ? 'Location permission was not granted. Your current site is unchanged.' :
    error.code === 3 ? 'Location timed out. Your current site is unchanged.' :
      'The browser could not determine your location. Your current site is unchanged.'),
  { timeout: 9500, maximumAge: 0, enableHighAccuracy: false });
});

function listCities() {
  const matches = findCities($('city-search').value);
  $('city-results').replaceChildren(...(matches.length ? matches.map(city =>
    new Option(`${city.name}, ${city.country}`, String(cities.indexOf(city)))) : [new Option('No matching cities', '')]));
  $('city-results').disabled = $('city-select').disabled = !matches.length;
}
$('city-search').addEventListener('input', listCities);
$('city-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('city-results').disabled) selectSite(cities[Number($('city-results').value)]);
});
$('coordinate-form').addEventListener('submit', event => {
  event.preventDefault();
  const { lat, lon } = event.currentTarget.elements;
  const next = coordinateSite('Manual coordinates', lat.valueAsNumber, lon.valueAsNumber);
  if (next) selectSite(next);
});

$('play').addEventListener('click', () => {
  advance();
  if (!playing && (instant < range[0] || instant >= range[1])) {
    notice('clock-status', 'Choose a date or select Now to resume playback.'); return;
  }
  playing = !playing; live = false; resetAnchor(); playButton(); notice('clock-status', '');
});
$('now').addEventListener('click', () => {
  instant = Date.now(); playing = true; live = true; rate = 1;
  spaceInstant = undefined;
  $('speed').value = '1'; resetAnchor(); playButton(); notice('clock-status', '');
});
$('speed').addEventListener('change', () => {
  advance(); rate = Number($('speed').value); live = false; resetAnchor();
});
$('date-dial').min = FIRST_DAY; $('date-dial').max = LAST_DAY;
$('date-dial').addEventListener('input', event => editClock(event.target.valueAsNumber, clock.parts(instant).seconds));
$('time-dial').addEventListener('input', event => editClock(clock.parts(instant).day, event.target.valueAsNumber));
for (const [id, parse, format] of [
  ['date-edit', input => editClock(input.valueAsNumber / DAY, clock.parts(instant).seconds), () => dateText(clock.parts(instant).day)],
  ['time-edit', input => editClock(clock.parts(instant).day, input.valueAsNumber / SECOND), () => timeText(clock.parts(instant).seconds)],
]) {
  $(id).addEventListener('change', event => {
    if (event.target.validity.valid) parse(event.target);
    event.target.value = format();
  });
  $(id).addEventListener('blur', event => { event.target.value = format(); });
}
$('dimmer').addEventListener('input', event => { options.glare = event.target.valueAsNumber / 100; dirty = true; });
for (const key of ['labels', 'lines']) $(key).addEventListener('change', event => { options[key] = event.target.checked; dirty = true; });
$('directions').parentElement.addEventListener('toggle', event => { if (event.target.open) updateDirections(); });

$('flight').addEventListener('click', () => fly(mode === 'surface'));
$('pin').addEventListener('click', () => {
  if (mode === 'surface') fly(true, true);
  else {
    if (orbit.focus !== 'earth') frameEarth();
    setPin(!pinning);
  }
  view.scrollIntoView({ block: 'nearest' }); view.focus({ preventScroll: true });
});
$('overview').addEventListener('click', () => {
  orbit.overview = !orbit.overview; frameEarth(); viewControls();
});
$('earth-focus').addEventListener('click', frameEarth);
$('moon-focus').addEventListener('click', () => {
  setPin(false); updateSpace();
  const [x, y, z] = space.moon;
  orbit.focus = 'moon'; orbit.distance = 1.7;
  orbit.theta = Math.atan2(z, -x); orbit.latitude = clamp(Math.atan2(-y, Math.hypot(x, z)), -1.55, 1.55);
  dirty = true;
});

function rotate(dx, dy) {
  if (mode === 'surface') {
    surface.az = wrap(surface.az - dx * .22);
    surface.alt = clamp(surface.alt + dy * .22, -83, 83);
  } else {
    orbit.theta -= dx * .007;
    orbit.latitude = clamp(orbit.latitude + dy * .007, -1.55, 1.55);
  }
  dirty = true;
}
function zoom(factor) {
  orbit.distance = clamp(orbit.distance * factor, orbit.focus === 'earth' ? 1.09 : .49, 150);
  dirty = true;
}
$('zoom-in').addEventListener('click', () => zoom(.77));
$('zoom-out').addEventListener('click', () => zoom(1.3));
view.addEventListener('wheel', event => {
  if (mode !== 'globe' || flight) return;
  event.preventDefault(); zoom(Math.exp(clamp(event.deltaY * .002, -1, 1)));
}, { passive: false });
view.addEventListener('keydown', event => {
  if (event.target !== view || flight) return;
  const keys = { ArrowLeft: [28, 0], ArrowRight: [-28, 0], ArrowUp: [0, 28], ArrowDown: [0, -28] };
  if (Object.hasOwn(keys, event.key)) { event.preventDefault(); rotate(...keys[event.key]); }
  if (event.key === 'Escape') setPin(false);
  if (pinning && event.key === 'Enter') { event.preventDefault(); placePin(.5, .5); }
});

function placePin(x, y) {
  // Resolve against the latest camera frame even if a click immediately follows an orbit.
  draw(performance.now());
  const hit = globe.pick(x, y);
  if (hit) selectSite(coordinateSite('Globe pin', hit.lat, hit.lon), 'Globe pin applied.');
  else notice('location-status', 'No Earth surface at that point. Tap Earth to place the pin.');
}

const pointers = new Map();
let dragged = false;
view.addEventListener('pointerdown', event => {
  if (flight || event.target !== view || event.button !== 0 || pointers.size >= 2) return;
  if (!pointers.size) dragged = false;
  else dragged = true;
  view.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
});
view.addEventListener('pointermove', event => {
  const before = pointers.get(event.pointerId);
  if (!before || flight) return;
  const next = { x: event.clientX, y: event.clientY };
  const dx = next.x - before.x, dy = next.y - before.y;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  dragged = true;
  if (pointers.size === 1) rotate(dx, dy);
  else if (mode === 'globe') {
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
    zoom(Math.max(1, Math.hypot(before.x - other.x, before.y - other.y)) /
      Math.max(1, Math.hypot(next.x - other.x, next.y - other.y)));
  }
  pointers.set(event.pointerId, next);
});
view.addEventListener('pointerup', event => {
  const tracked = pointers.delete(event.pointerId);
  if (tracked && !dragged && pinning && globe && !flight) {
    const bounds = view.getBoundingClientRect();
    placePin((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }
});
for (const type of ['pointercancel', 'lostpointercapture']) view.addEventListener(type, event => pointers.delete(event.pointerId));

listCities(); viewControls(); selectSite(example); resize();
new ResizeObserver(resize).observe(view);
$('loading').hidden = true;
requestAnimationFrame(tick);
