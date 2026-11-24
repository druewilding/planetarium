// The view from space: rise straight up from where you're standing and see the
// Earth below, turning, lit by the Sun, with your spot marked on it.
//
// Everything is in the J2000 frame (see space.js), centred on the Earth, in Earth
// radii. The camera stays still against the stars while the Earth turns beneath
// it, so your marker drifts round with the day. Drag to fly round the Earth,
// scroll or pinch to go higher or lower.

import * as THREE from "three";

import { earthAxes, sunDirection, surfaceDirection } from "../space.js";
import { bvToRgb } from "./points.js";

const EARTH_RADIUS_KM = 6371;
const START = 1 + 300 / EARTH_RADIUS_KM; // where the rise starts: 300 km up, like the space station
const HIGH = 3.6; // where it ends: the whole Earth in view
const MIN_DISTANCE = 1 + 150 / EARTH_RADIUS_KM;
const MAX_DISTANCE = 60; // the Moon is about 60 Earth radii away
const SKY = 2000; // radius of the star sphere around the camera (beyond everything else)

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const vec = (v) => new THREE.Vector3(v.x, v.y, v.z);

export function createOrbitView(renderer, canvas, { starData, milkyWayTexture, loadTextures }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.001, SKY * 2);
  camera.up.set(0, 0, 1); // the north celestial pole is up

  // ---- The Earth: daylight, city lights at night, sunglint on the sea ----
  const earthUniforms = {
    uDay: { value: null },
    uNight: { value: null },
    uOcean: { value: null },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uReady: { value: 0 },
  };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vLocal;  // on the Earth's own axes, for the maps
        varying vec3 vNormal; // in the J2000 frame, for the light
        varying vec3 vView;
        void main() {
          vLocal = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform sampler2D uOcean;
        uniform vec3 uSunDir;
        uniform float uReady;
        varying vec3 vLocal;
        varying vec3 vNormal;
        varying vec3 vView;
        const float PI = 3.14159265359;
        void main() {
          vec3 p = normalize(vLocal);
          // The maps run from 180° W at the left edge to 180° E, the North Pole at the top.
          float u = 0.5 + atan(p.y, p.x) / (2.0 * PI);
          // Where the map's edges meet (180°), u jumps from 1 back to 0, and the
          // texture lookup there smears a seam. Shifting by half a turn moves the jump
          // elsewhere, so use whichever version doesn't jump at this pixel.
          float u2 = fract(u + 0.5) - 0.5;
          if (fwidth(u2) < fwidth(u) - 0.001) u = u2;
          vec2 uv = vec2(u, 0.5 + asin(clamp(p.z, -1.0, 1.0)) / PI);
          vec3 n = normalize(vNormal);
          float sun = dot(n, uSunDir);
          vec3 day = pow(texture2D(uDay, uv).rgb, vec3(2.2));
          // City lights, without the map's dim blue land behind them.
          vec3 lights = max(texture2D(uNight, uv).rgb - vec3(0.12, 0.12, 0.2), 0.0);
          lights = pow(lights, vec3(1.4)) * vec3(2.2, 1.8, 1.2);
          float ocean = texture2D(uOcean, uv).r;
          // Daylight, softened across the terminator (twilight reaches about 6° past it).
          float lit = smoothstep(-0.1, 0.25, sun);
          vec3 c = day * (0.02 + 1.6 * max(sun, 0.0) * lit);
          // The Sun's reflection off the sea.
          vec3 r = reflect(-uSunDir, n);
          c += ocean * pow(max(dot(r, normalize(vView)), 0.0), 60.0) * 0.6 * lit;
          // Lights where it's dark.
          c += lights * (1.0 - smoothstep(-0.12, 0.04, sun));
          // Blue haze towards the edge on the day side.
          float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
          c += vec3(0.25, 0.45, 1.0) * rim * 0.5 * smoothstep(-0.2, 0.3, sun);
          c = pow(c, vec3(1.0 / 2.2));
          gl_FragColor = vec4(mix(vec3(0.05, 0.07, 0.12), c, uReady), 1.0);
        }
      `,
    })
  );
  earth.matrixAutoUpdate = false;
  scene.add(earth);

  // The air: a thin glowing shell, brightest at the edge on the sunlit side.
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSunDir: earthUniforms.uSunDir },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec3 n = normalize(vNormal);
          float edge = 1.0 - abs(dot(n, normalize(vView)));
          float glow = pow(edge, 5.0) * smoothstep(-0.35, 0.2, dot(n, uSunDir));
          gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * glow * 1.4, 1.0); // added to what is behind (AdditiveBlending scales by alpha)
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(air);

  // ---- Your spot on the Earth: a ring that turns with it ----
  const marker = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 16 * renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        uniform float uSize;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize;
        }
      `,
      fragmentShader: /* glsl */ `
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float ring = smoothstep(0.55, 0.65, r) * (1.0 - smoothstep(0.85, 1.0, r));
          float dot = 1.0 - smoothstep(0.2, 0.3, r);
          float a = max(ring, dot);
          if (a < 0.01) discard;
          gl_FragColor = vec4(1.0, 0.78, 0.35, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    })
  );
  marker.renderOrder = 2;
  scene.add(marker);

  // ---- The stars and the Milky Way, on a sphere that moves with the camera ----
  const sky = new THREE.Group();
  scene.add(sky);
  {
    const n = starData.stars.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const D2R = Math.PI / 180;
    starData.stars.forEach(([, ra, dec, m, bv], i) => {
      const cd = Math.cos(dec * D2R);
      pos.set([SKY * cd * Math.cos(ra * D2R), SKY * cd * Math.sin(ra * D2R), SKY * Math.sin(dec * D2R)], i * 3);
      col.set(bvToRgb(bv), i * 3);
      mag[i] = m;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geometry.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
    const stars = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
        vertexShader: /* glsl */ `
          attribute vec3 color;
          attribute float mag;
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vBright;
          void main() {
            // No air in the way up here: every star shines steadily, brightest largest.
            float b = pow(10.0, -0.4 * (mag - 1.0));
            vBright = clamp(b, 0.12, 1.0);
            vColor = color;
            gl_PointSize = clamp(1.6 + 1.6 * sqrt(b), 1.6, 5.0) * uPixelRatio;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vBright;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = (1.0 - smoothstep(0.3, 1.0, r)) * vBright;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor * a, 1.0); // added to what is behind (AdditiveBlending scales by alpha)
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    stars.renderOrder = -1;
    sky.add(stars);

    const milkyWay = new THREE.Mesh(
      new THREE.SphereGeometry(SKY * 1.01, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: milkyWayTexture } },
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec3 vLocal;
          const float PI = 3.14159265359;
          void main() {
            vec3 l = normalize(vLocal);
            // NASA's map: RA 0h in the middle, increasing to the left (as in milkyway.js).
            vec2 uv = vec2(fract(0.5 - atan(l.y, l.x) / (2.0 * PI)), 0.5 + asin(clamp(l.z, -1.0, 1.0)) / PI);
            // Faint (with the sunlit Earth in view your eyes are adapted to daylight),
            // and without the map's grainy background: only its brightest parts show.
            vec3 c = max(texture2D(uMap, uv).rgb - vec3(0.12), 0.0);
            gl_FragColor = vec4(pow(c, vec3(1.5)) * 0.35, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    milkyWay.renderOrder = -2;
    sky.add(milkyWay);
  }

  // ---- The Sun: a bright disc with a glow, far off in its true direction ----
  const sunUniforms = { uColor: { value: new THREE.Vector3(1, 0.97, 0.9) } };
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: sunUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float r = length(vUv) * 8.0; // 1.0 at the disc's edge
          float disc = 1.0 - smoothstep(0.9, 1.0, r);
          float glow = 0.6 / (1.0 + r * r * 0.8) * (1.0 - smoothstep(4.0, 8.0, r));
          vec3 c = uColor * (disc + glow);
          gl_FragColor = vec4(c, 1.0); // added to what is behind (AdditiveBlending scales by alpha)
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sun.renderOrder = 1;
  scene.add(sun);
  const SUN_RADIUS = 0.8 * (Math.PI / 180); // three times its true size (0.27°), so it reads as the Sun

  // ---- Where the camera is: a direction from the Earth's centre and a distance ----
  const cam = { dir: new THREE.Vector3(1, 0, 0), dist: HIGH };
  let flight = null; // { from, to, t, duration, done }
  let active = false;

  function place() {
    camera.position.copy(cam.dir).multiplyScalar(cam.dist);
    // Straight over a pole, "north is up" has no meaning: keep the last sideways direction.
    if (Math.abs(cam.dir.z) > 0.999) camera.up.set(0, 1, 0);
    else camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  /** Glide to a new direction and distance (distance changes evenly in scale, not in km). */
  function flyTo(dir, dist, duration, done) {
    flight = {
      from: { dir: cam.dir.clone(), dist: cam.dist },
      to: { dir: dir.clone().normalize(), dist },
      t: 0,
      duration,
      done,
    };
  }

  function stepFlight(dt) {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    const k = ease(flight.t);
    const { from, to } = flight;
    const angle = from.dir.angleTo(to.dir);
    if (angle > 1e-6) {
      const axis = new THREE.Vector3().crossVectors(from.dir, to.dir).normalize();
      if (axis.lengthSq() > 0) cam.dir.copy(from.dir).applyAxisAngle(axis, angle * k);
    }
    cam.dist = Math.exp(Math.log(from.dist) + (Math.log(to.dist) - Math.log(from.dist)) * k);
    if (flight.t >= 1) {
      const done = flight.done;
      flight = null;
      done?.();
    }
  }

  // ---- Controls: drag to fly round, scroll or pinch to go up or down ----
  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (!active) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!active || !p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    flight = null;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setDistance(pinch.dist * (pinch.d / Math.max(d, 1)));
      return;
    }
    // Grab the globe: it turns with your finger, faster the higher you are.
    // (Far out the globe is small, so keeping it under your finger would spin it wildly: cap it.)
    const perPixel = (camera.fov * Math.PI) / 180 / canvas.clientHeight;
    const k = Math.min(perPixel * Math.max(0.15, cam.dist - 1) * 0.9, Math.PI / canvas.clientWidth);
    const right = new THREE.Vector3().crossVectors(camera.up, cam.dir).normalize();
    const up = new THREE.Vector3().crossVectors(cam.dir, right).normalize();
    cam.dir
      .addScaledVector(right, -dx * k)
      .addScaledVector(up, dy * k)
      .normalize();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!active) return;
      e.preventDefault();
      flight = null;
      setDistance(cam.dist * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    },
    { passive: false }
  );

  function setDistance(d) {
    // Measured from the surface, so zooming in slows down near the ground.
    const h = Math.min(MAX_DISTANCE - 1, Math.max(MIN_DISTANCE - 1, d - 1));
    cam.dist = 1 + h;
  }

  /** Go higher (factor < 1) or lower, as the zoom buttons do. */
  function zoom(factor) {
    flight = null;
    setDistance(1 + (cam.dist - 1) / factor);
  }

  // ---- Textures load the first time you rise ----
  let loading = null;
  function ensureTextures() {
    loading ??= loadTextures().then(([day, night, ocean]) => {
      for (const t of [day, night, ocean]) {
        t.colorSpace = THREE.NoColorSpace;
        t.wrapS = THREE.RepeatWrapping; // see the seam note in the Earth's shader
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      earthUniforms.uDay.value = day;
      earthUniforms.uNight.value = night;
      earthUniforms.uOcean.value = ocean;
      earthUniforms.uReady.value = 1;
    });
    return loading;
  }

  // ---- Each frame ----
  const axes = new THREE.Matrix4();
  const markerAt = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function update(dt, ms, loc) {
    stepFlight(dt);
    place();
    // The Earth turned the way it is at this moment.
    const { x, y, z } = earthAxes(ms);
    axes.makeBasis(vec(x), vec(y), vec(z));
    earth.matrix.copy(axes);
    earth.matrixWorldNeedsUpdate = true;
    markerAt.copy(vec(surfaceDirection(loc.lat, loc.lon, ms))).multiplyScalar(1.001);
    marker.position.copy(markerAt);
    sunDir.copy(vec(sunDirection(ms)));
    earthUniforms.uSunDir.value.copy(sunDir);
    // The sky and the Sun are "at infinity": they travel with the camera.
    sky.position.copy(camera.position);
    const far = SKY * 0.9;
    sun.position.copy(camera.position).addScaledVector(sunDir, far);
    sun.lookAt(camera.position);
    sun.scale.setScalar(2 * far * Math.tan(SUN_RADIUS) * 8); // the disc is the middle eighth of the card
  }

  /** Screen position of a point in this view, or null when it's off screen or behind the Earth. */
  function project(p) {
    // Hidden by the Earth: the line from the camera to the point passes through it first.
    const toPoint = tmp.copy(p).sub(camera.position);
    const len = toPoint.length();
    toPoint.divideScalar(len);
    const b = camera.position.dot(toPoint);
    const c = camera.position.lengthSq() - 1;
    const disc = b * b - c;
    if (disc > 0) {
      const hit = -b - Math.sqrt(disc);
      if (hit > 0 && hit < len - 0.01) return null;
    }
    const v = p.clone().project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: v.x, y: v.y };
  }

  /** Labels for this view, for labels.js. */
  function labels(placeName) {
    return [
      {
        key: "space-you",
        text: placeName,
        dir: markerAt.clone(),
        cls: "body you",
        priority: 100,
        always: true,
        offset: [12, -12],
      },
      {
        key: "space-sun",
        text: "Sun",
        dir: camera.position.clone().addScaledVector(sunDir, SKY * 0.9),
        cls: "body sun",
        priority: 99,
        always: true,
        offset: [16, -16],
      },
    ];
  }

  /** Start: straight above `loc`, then rise until the whole Earth is in view. */
  function rise(ms, loc, done) {
    active = true;
    ensureTextures();
    cam.dir.copy(vec(surfaceDirection(loc.lat, loc.lon, ms)));
    cam.dist = START;
    flyTo(cam.dir, HIGH, 3.5, done);
  }

  /** Come back down over `loc` (wherever the Earth has turned it to). Call leave() once the ground can take over. */
  function descend(ms, loc, done) {
    flyTo(vec(surfaceDirection(loc.lat, loc.lon, ms)), START, 2.5, done);
  }

  function leave() {
    active = false;
    flight = null;
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    update,
    project,
    labels,
    rise,
    descend,
    leave,
    zoom,
    resize,
    get active() {
      return active;
    },
    /** Height above the ground, in km. */
    get altitudeKm() {
      return (cam.dist - 1) * EARTH_RADIUS_KM;
    },
    get flying() {
      return flight !== null;
    },
  };
}
