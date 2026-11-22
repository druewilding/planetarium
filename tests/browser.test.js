import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium, devices } from 'playwright-core';

const files = new Map([['', ['index.html', 'text/html']], ['styles.css', ['styles.css', 'text/css']],
  ['app.js', ['app.js', 'text/javascript']]]);
const prefix = '/planetarium/';
const fixed = '2024-04-08T12:00:00.000Z';
let server, browser, url;

before(async () => {
  server = createServer(async (request, response) => {
    const path = request.url.startsWith(prefix) && files.get(request.url.slice(prefix.length));
    if (!path) { response.writeHead(404).end(); return; }
    const [file, type] = path;
    try { response.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../dist/${file}`, import.meta.url))); }
    catch { response.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve) ?? resolve()); });

async function opened(t, settings, init, fixWallTime = true) {
  const context = await browser.newContext(settings);
  t.after(() => context.close());
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  if (fixWallTime) await page.clock.setFixedTime(new Date(fixed));
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push([request.method(), request.url()]));
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 5000 });
  return { page, errors, requests };
}
const region = page => page.getByRole('region', { name: 'Planetarium view' });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const clock = page => page.locator('#local-clock').getAttribute('datetime');
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).waitFor({ timeout: 5000 });
async function chooseCity(page, name) {
  await page.getByRole('searchbox', { name: 'Search built-in cities' }).fill(name);
  await button(page, 'Select').click();
  await page.locator('#site').getByText(name, { exact: true }).waitFor();
}

test('desktop project-subpath journey: time, sky, privacy, continuous flight, globe pin and return', async t => {
  const { page, errors, requests } = await opened(t, { viewport: { width: 1220, height: 900 } }, () => {
    window.locationCalls = 0;
    navigator.geolocation.getCurrentPosition = (_, reject) => { window.locationCalls++; reject({ code: 1 }); };
  });
  assert.match(await page.locator('#site').textContent(), /example city/);
  assert.equal(await page.evaluate(() => window.locationCalls), 0);
  await button(page, 'Pause').click();
  assert.equal(await clock(page), fixed);
  await region(page).press('ArrowDown');
  await region(page).press('ArrowDown');
  await page.getByLabel('Object labels').uncheck();
  await page.getByLabel('Constellation lines').uncheck();
  const phase = await page.locator('#phase').textContent();
  const pixels = () => page.locator('#sky').evaluate(canvas => {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const starPixels = ctx.getImageData(0, 0, w, h).data;
    let light = 0;
    for (let i = 0; i < starPixels.length; i += 4) {
      if (starPixels[i] === 234 && starPixels[i + 1] === 245 && starPixels[i + 2] === 255) light++;
    }
    return { light, ground: [...ctx.getImageData(w / 2, h - 5, 1, 1).data] };
  });
  const bright = await pixels();
  await page.getByRole('slider', { name: 'Daylight glare' }).fill('0');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const dim = await pixels();
  assert.ok(dim.light > bright.light, `revealed star pixels: ${JSON.stringify({ bright, dim })}`);
  assert.deepEqual(dim.ground, bright.ground);
  assert.equal(await page.locator('#phase').textContent(), phase);
  assert.equal(await clock(page), fixed);
  await button(page, 'Use my location').click();
  assert.match(await page.locator('#location-status').textContent(), /not granted/);
  await chooseCity(page, 'Tokyo');
  await page.locator('#local-clock').getByText(/21:00:00/).waitFor();
  assert.equal(await clock(page), fixed);
  await page.getByLabel('Enter local date').fill('2024-04-09');
  await page.getByLabel('Enter local time').fill('22:10:00');
  await page.waitForFunction(() => document.getElementById('local-clock').dateTime === '2024-04-09T13:10:00.000Z');
  const paused = await clock(page);
  await button(page, 'Lift off ↗').click();
  await heading(page, 'Lifting off');
  await heading(page, 'Globe view');
  assert.match(await page.locator('#view-badge').textContent(), /True Earth–Moon scale/);
  const globePixels = await region(page).screenshot();
  assert.ok(await page.evaluate(async png => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const center = ctx.getImageData(image.width / 2 - 25, image.height / 2 - 25, 50, 50).data;
    return new Set(Array.from({ length: center.length / 4 }, (_, i) => center[i * 4 + 2])).size > 4;
  }, globePixels.toString('base64')), 'the globe center contains rendered detail');
  const bounds = await region(page).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + bounds.height / 2 + 20, { steps: 6 }); await page.mouse.up();
  await button(page, 'Zoom out').click();
  await button(page, 'Orbit overview').click();
  await page.locator('#view-badge').getByText(/Not to scale/).waitFor();
  await button(page, 'Frame Moon').click();
  await button(page, 'Frame Earth').click();
  await button(page, 'Place globe pin').click();
  await region(page).press('Enter');
  assert.equal(await page.locator('#site').textContent(), 'Globe pin');
  assert.equal(await page.locator('#coordinates').textContent(), '35.681°, 139.767°');
  await page.locator('#zone').getByText(/^UTC/).waitFor();
  await button(page, 'Return to surface ↓').click();
  await heading(page, 'Surface sky');
  assert.equal(await clock(page), paused);
  await page.getByLabel('Playback speed').selectOption('3600');
  await button(page, 'Play').click();
  await page.waitForFunction(previous => document.getElementById('local-clock').dateTime !== previous, paused);
  await button(page, 'Now').click();
  await page.waitForFunction(now => document.getElementById('local-clock').dateTime === now, fixed);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, ['', 'styles.css', 'app.js'].map(path => ['GET', url + path]));
});

test('emulated phone: touch drag/pinch/orbit/return, no overflow, no stale location override', async t => {
  const { page, errors } = await opened(t, { ...devices['iPhone 13'], defaultBrowserType: undefined, reducedMotion: 'reduce' }, () => {
    navigator.geolocation.getCurrentPosition = (success, reject) => {
      window.locationCallback = success; window.locationFailure = reject;
    };
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const bearing = await page.locator('#bearing').textContent();
  const session = await page.context().newCDPSession(page);
  async function gesture(steps) {
    for (let i = 0; i < steps.length; i++) await session.send('Input.dispatchTouchEvent', {
      type: i === 0 ? 'touchStart' : 'touchMove', touchPoints: steps[i].map(([x, y], id) => ({ x, y, id })),
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const bounds = await region(page).boundingBox(), x = bounds.x + 120, y = bounds.y + 120;
  await gesture([[[x, y]], [[x + 50, y + 22]]]);
  await page.waitForFunction(before => document.getElementById('bearing').textContent !== before, bearing);
  await button(page, 'Use my location').tap();
  await chooseCity(page, 'Sydney');
  await page.evaluate(() => window.locationCallback({ coords: { latitude: 1, longitude: -130 } }));
  assert.equal(await page.locator('#site').textContent(), 'Sydney');
  await button(page, 'Use my location').tap();
  await page.evaluate(() => window.locationFailure({ code: 3 }));
  assert.match(await page.locator('#location-status').textContent(), /timed out/);
  assert.equal(await page.locator('#site').textContent(), 'Sydney');
  await button(page, 'Use my location').tap();
  await page.evaluate(() => window.locationCallback({ coords: { latitude: 12, longitude: -130 } }));
  assert.equal(await page.locator('#site').textContent(), 'Your location');
  await button(page, 'Lift off ↗').tap();
  await heading(page, 'Globe view');
  const orbit = await region(page).boundingBox(), ox = orbit.x + 120, oy = orbit.y + 100;
  await gesture([[[ox, oy]], [[ox + 40, oy + 15]]]);
  await gesture([[[ox, oy], [ox + 40, oy]], [[ox - 20, oy], [ox + 60, oy]]]);
  await button(page, 'Zoom in').tap();
  await button(page, 'Return to surface ↓').tap();
  await heading(page, 'Surface sky');
  assert.equal(await page.locator('#site').textContent(), 'Your location');
  assert.deepEqual(errors, []);
});

test('WebGL unavailable leaves working sky, clock and manual location', async t => {
  const { page, errors } = await opened(t, {}, () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args);
    };
    Object.defineProperty(navigator, 'geolocation', { value: undefined });
  });
  assert.match(await page.locator('#compatibility').textContent(), /needs WebGL 2/);
  assert.equal(await button(page, 'Lift off ↗').isDisabled(), true);
  await button(page, 'Use my location').click();
  assert.match(await page.locator('#location-status').textContent(), /unavailable/);
  await chooseCity(page, 'London');
  await page.locator('#zone').getByText(/Europe\/London/).waitFor();
  assert.deepEqual(errors, []);
});

test('globe bounds playback samples without delaying camera input or paused edits', async t => {
  const { page, errors } = await opened(t, { reducedMotion: 'reduce' }, () => {
    let now = 0;
    let callbacks = [];
    Date.now = () => Date.parse('2024-04-08T12:00:00.000Z');
    performance.now = () => now;
    requestAnimationFrame = callback => callbacks.push(callback);
    window.stepFrames = (count, delta) => {
      for (let i = 0; i < count; i++) {
        now += delta;
        const frame = callbacks;
        callbacks = [];
        frame.forEach(callback => callback(now));
      }
    };
  }, false);
  const frames = (count = 1, delta = 10) => page.evaluate(([n, ms]) => window.stepFrames(n, ms), [count, delta]);
  const badge = page.locator('#view-badge');
  const speed = page.getByLabel('Playback speed');
  await button(page, 'Lift off ↗').dispatchEvent('click');
  await frames();
  await heading(page, 'Globe view');
  const initial = await badge.textContent();
  await speed.evaluate(select => { select.value = '3600'; select.dispatchEvent(new Event('change')); });
  const updates = await badge.evaluate(element => {
    const observer = new MutationObserver(() => {});
    observer.observe(element, { childList: true });
    window.stepFrames(100, 10);
    const count = observer.takeRecords().length;
    observer.disconnect();
    return count;
  });
  t.diagnostic(`Distance badge updates in 100 frames over 1 s: ${updates}`);
  assert.ok(updates >= 10 && updates <= 20, `globe samples in 100 frames over 1 s: ${updates}`);
  assert.notEqual(await badge.textContent(), initial);
  const beforeOrbit = await region(page).screenshot();
  await region(page).dispatchEvent('keydown', { key: 'ArrowRight' });
  await frames(1, 1); // Only 1 ms since last astronomy sample; camera must still repaint.
  assert.notDeepEqual(await region(page).screenshot(), beforeOrbit);
  await button(page, 'Pause').dispatchEvent('click');
  await frames(1, 1);
  const beforeEdit = await badge.textContent();
  await page.getByLabel('Enter local date').evaluate(input => {
    input.value = '2024-05-26'; input.dispatchEvent(new Event('change'));
  });
  await frames(1, 1);
  assert.notEqual(await badge.textContent(), beforeEdit);
  assert.match(await clock(page), /^2024-05-26T/);
  await button(page, 'Now').dispatchEvent('click');
  await frames(1, 1);
  assert.equal(await badge.textContent(), initial);
  assert.equal(await clock(page), fixed);
  assert.deepEqual(errors, []);
});
