// Look-around camera for standing on the ground: drag to turn, scroll / pinch
// to zoom (field of view), arrows and +/- on the keyboard, with gentle inertia.
// With a sensor switched on (see sensor.js), the phone's own orientation aims
// the camera instead, and sideways drags nudge the compass into line.

import { MathUtils, Quaternion, Vector3 } from "three";

import { altAz } from "../astro.js";

const MIN_FOV = 0.5;
const MAX_FOV = 180; // wide views switch to a stereographic projection (see projection.js)

export function createView(camera, canvas, { onClick, unproject, sensor } = {}) {
  const state = { az: 180, alt: 20, fov: 70 };
  const vel = { az: 0, alt: 0 };
  let tween = null;
  const pointers = new Map();
  let dragDist = 0;
  let pinchStart = null;
  let lastMove = 0;
  const target = new Quaternion();
  const forward = new Vector3();
  let following = false; // camera currently aimed by the sensor
  let touchedAt = -Infinity; // when you last turned or zoomed the view yourself
  const sensorOn = () => sensor?.active;

  function degPerPixel() {
    return state.fov / canvas.clientHeight;
  }

  function apply() {
    state.fov = MathUtils.clamp(state.fov, MIN_FOV, MAX_FOV);
    camera.fov = Math.min(state.fov, 150); // three's own projection is only used when zoomed in
    if (following) {
      // The sensor sets the camera, roll and all; read back where it's facing.
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      state.alt = Math.asin(MathUtils.clamp(forward.y, -1, 1)) * MathUtils.RAD2DEG;
      state.az = Math.atan2(forward.x, -forward.z) * MathUtils.RAD2DEG;
    }
    state.alt = MathUtils.clamp(state.alt, -89.9, 89.9);
    state.az = ((state.az % 360) + 360) % 360;
    if (!following) {
      camera.rotation.order = "YXZ";
      camera.rotation.set(state.alt * MathUtils.DEG2RAD, -state.az * MathUtils.DEG2RAD, 0);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragDist = 0;
    tween = null;
    touchedAt = performance.now();
    vel.az = vel.alt = 0;
    canvas.classList.add("dragging");
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: state.fov };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.fov = pinchStart.fov * (pinchStart.d / Math.max(d, 1));
      dragDist += 10;
      return;
    }
    dragDist += Math.abs(dx) + Math.abs(dy);
    const k = degPerPixel();
    // Grab the sky: it follows your finger.
    const dAz = (-dx * k) / Math.max(0.2, Math.cos(state.alt * MathUtils.DEG2RAD));
    const dAlt = dy * k;
    if (sensorOn()) {
      // The phone does the aiming; a sideways drag turns the sky to fix the compass.
      sensor.nudge(dAz);
      return;
    }
    state.az += dAz;
    state.alt += dAlt;
    const now = performance.now();
    const dt = Math.max(1, now - lastMove) / 1000;
    lastMove = now;
    vel.az = MathUtils.lerp(vel.az, dAz / dt, 0.5);
    vel.alt = MathUtils.lerp(vel.alt, dAlt / dt, 0.5);
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      canvas.classList.remove("dragging");
      if (performance.now() - lastMove > 80) vel.az = vel.alt = 0;
      if (dragDist < 6 && e.type === "pointerup" && onClick) {
        const rect = canvas.getBoundingClientRect();
        onClick(e.clientX - rect.left, e.clientY - rect.top);
      }
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      tween = null;
      touchedAt = performance.now();
      state.fov *= Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, dialog")) return;
    const step = state.fov / 12;
    const keys = {
      ArrowLeft: () => (state.az -= step),
      ArrowRight: () => (state.az += step),
      ArrowUp: () => (state.alt += step),
      ArrowDown: () => (state.alt -= step),
      "+": () => zoom(0.8),
      "=": () => zoom(0.8),
      "-": () => zoom(1.25),
    };
    if (keys[e.key]) {
      e.preventDefault();
      tween = null;
      touchedAt = performance.now();
      keys[e.key]();
    }
  });

  function zoom(factor) {
    lookTo({ fov: state.fov * factor });
  }

  /** Smoothly turn to face a world direction (and optionally zoom). */
  function lookAt(dir, fov) {
    const { alt, az } = altAz(dir);
    lookTo({ alt, az, fov });
  }

  /** Smoothly turn (and zoom) to a view. `duration` in seconds: a slow drift, or a quick turn. */
  function lookTo({ alt = state.alt, az = state.az, fov = state.fov }, { duration = 0.9 } = {}) {
    if (sensorOn()) {
      // Only you can turn the phone, but we can still zoom.
      alt = state.alt;
      az = state.az;
    }
    let dAz = az - state.az;
    dAz = ((dAz + 540) % 360) - 180;
    vel.az = vel.alt = 0;
    tween = {
      from: { ...state },
      to: { alt, az: state.az + dAz, fov: MathUtils.clamp(fov, MIN_FOV, MAX_FOV) },
      t: 0,
      duration,
    };
  }

  /** Turn the view by this much, including any turn in progress (to follow something that moves). */
  function shift(dAlt, dAz) {
    if (sensorOn()) return; // the phone does the aiming
    state.alt += dAlt;
    state.az += dAz;
    if (tween) {
      tween.from.alt += dAlt;
      tween.to.alt += dAlt;
      tween.from.az += dAz;
      tween.to.az += dAz;
    }
    apply();
  }

  function update(dt) {
    const aimed = sensorOn() && sensor.orientation(target);
    if (aimed) {
      if (!following) camera.quaternion.copy(target);
      // Smooth out sensor jitter without lagging behind a quick turn.
      else camera.quaternion.slerp(target, 1 - Math.exp(-dt * 18));
      following = true;
      vel.az = vel.alt = 0;
    } else following = false;
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.duration);
      const k = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - (-2 * tween.t + 2) ** 2 / 2;
      if (!following) state.alt = MathUtils.lerp(tween.from.alt, tween.to.alt, k);
      if (!following) state.az = MathUtils.lerp(tween.from.az, tween.to.az, k);
      // Zoom geometrically so it feels even.
      state.fov = tween.from.fov * (tween.to.fov / tween.from.fov) ** k;
      if (tween.t >= 1) tween = null;
    } else if (pointers.size === 0 && (vel.az || vel.alt)) {
      state.az += vel.az * dt;
      state.alt += vel.alt * dt;
      const decay = Math.exp(-dt * 4);
      vel.az *= decay;
      vel.alt *= decay;
      if (Math.abs(vel.az) + Math.abs(vel.alt) < 0.05) vel.az = vel.alt = 0;
    }
    apply();
  }

  /** World direction under a screen point. */
  function dirAt(x, y) {
    return unproject((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
  }

  apply();
  return {
    state,
    update,
    lookAt,
    lookTo,
    zoom,
    dirAt,
    shift,
    /** When you last turned or zoomed the view yourself (performance.now()). */
    touchedAt: () => touchedAt,
  };
}
