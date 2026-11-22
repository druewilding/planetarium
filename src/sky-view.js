import { patterns, RAD } from './astronomy.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const direction = ({ azimuth, altitude }) => {
  const a = azimuth * RAD, e = altitude * RAD;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(' ')})`;

export function skyView(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  function draw(sky, camera, options, width, height, dpi) {
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    const f = height / (2 * Math.tan(32 * RAD));
    const az = camera.az * RAD, pitch = camera.alt * RAD;
    const forward = direction({ azimuth: camera.az, altitude: camera.alt });
    const right = [Math.cos(az), 0, -Math.sin(az)];
    const up = [-Math.sin(pitch) * Math.sin(az), Math.cos(pitch), -Math.sin(pitch) * Math.cos(az)];
    const horizon = clamp(height / 2 + f * Math.tan(pitch), 0, height);
    const glare = options.glare * clamp((sky.sun.altitude + 13) / 19, 0, 1);
    const grad = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    grad.addColorStop(0, mix([4, 9, 20], [32, 87, 141], glare));
    grad.addColorStop(1, mix([16, 30, 47], [113, 162, 185], glare));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    function project(v) {
      const depth = dot(v, forward);
      return depth > 0.015 ? { x: width / 2 + f * dot(v, right) / depth,
        y: height / 2 - f * dot(v, up) / depth, depth } : null;
    }
    function label(text, x, y) {
      ctx.strokeStyle = '#101926'; ctx.lineWidth = 3;
      ctx.strokeText(text, x, y); ctx.fillStyle = '#f1f6ff'; ctx.fillText(text, x, y);
    }
    function circle(x, y, r, color) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, horizon); ctx.clip();
    ctx.font = '14px system-ui';
    ctx.globalAlpha = Math.max(0, 1 - glare * 1.14);
    if (options.lines) {
      const byName = new Map(sky.stars.map(star => [star.name, star]));
      ctx.strokeStyle = '#76a6bd'; ctx.lineWidth = 1;
      for (const names of patterns) {
        for (let i = 1; i < names.length; i++) {
          const a = direction(byName.get(names[i - 1])), b = direction(byName.get(names[i]));
          // Project segments of the great-circle chord; the horizon clip removes the hidden part.
          let previous = project(a);
          for (let j = 1; j <= 12; j++) {
            const next = project(a.map((v, k) => v + (b[k] - v) * j / 12));
            if (previous && next) {
              ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(next.x, next.y); ctx.stroke();
            }
            previous = next;
          }
        }
      }
    }
    const occupied = [];
    for (const obj of [...sky.planets, ...sky.stars]) {
      if (obj.altitude <= 0) continue;
      const p = project(direction(obj));
      if (!p || p.x < 0 || p.x > width || p.y < 0 || p.y > horizon) continue;
      const planet = obj.diameter !== undefined;
      circle(p.x, p.y, clamp((planet ? 3.4 : 2.3) - obj.magnitude * .29, 1, 5), planet ? '#ffddb0' : '#eaf5ff');
      if (options.labels && (planet || obj.magnitude < 1.5 || obj.name === 'Polaris')) {
        const x = p.x + 8, y = p.y - 5, w = ctx.measureText(obj.name).width;
        if (x + w < width && y > 14 && !occupied.some(b => x < b.x + b.w && x + w > b.x && Math.abs(y - b.y) < 15)) {
          label(obj.name, x, y); occupied.push({ x, y, w });
        }
      }
    }
    ctx.globalAlpha = 1;
    const sunVector = direction(sky.sun);
    for (const obj of [sky.sun, sky.moon]) {
      if (obj.altitude < -obj.diameter / 2) continue;
      const v = direction(obj), p = project(v);
      if (!p) continue;
      const r = f * Math.tan(obj.diameter * RAD / 2) / p.depth;
      if (p.x + r < 0 || p.x - r > width || p.y + r < 0 || p.y - r > horizon) continue;
      if (obj === sky.sun) circle(p.x, p.y, r, '#fff0bd');
      else {
        const toward = sunVector.map((x, i) => v[i] + .01 * (x - dot(sunVector, v) * v[i]));
        const light = project(toward);
        circle(p.x, p.y, r, '#34404e');
        ctx.save(); ctx.translate(p.x, p.y);
        if (light) ctx.rotate(Math.atan2(light.y - p.y, light.x - p.x));
        ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
        for (let i = 1; i <= 24; i++) {
          const a = Math.PI * i / 24;
          ctx.lineTo((1 - 2 * sky.illumination) * r * Math.sin(a), r * Math.cos(a));
        }
        ctx.closePath(); ctx.fillStyle = '#f4ead7'; ctx.fill(); ctx.restore();
      }
      if (options.labels) label(obj.name, p.x + r + 6, p.y - 4);
    }
    ctx.restore();

    ctx.fillStyle = '#111d22'; ctx.fillRect(0, horizon, width, height - horizon);
    if (horizon > 0 && horizon < height) {
      ctx.fillStyle = '#6b9292'; ctx.fillRect(0, horizon, width, 1);
      ctx.font = '14px system-ui';
      for (const [azimuth, name] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
        const p = project(direction({ azimuth, altitude: 0 }));
        if (p) label(name, p.x - 4, horizon + (horizon > height - 24 ? -8 : 22));
      }
    }
  }
  return { draw };
}
