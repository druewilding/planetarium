// Look-around camera for standing on the ground: drag to turn, scroll / pinch
// to zoom (field of view), arrows and +/- on the keyboard, with gentle inertia.

import { MathUtils } from "three";

import { altAz } from "../astro.js";

const MIN_FOV = 0.5;
const MAX_FOV = 180; // wide views switch to a stereographic projection (see projection.js)

export function createView(camera, canvas, { onClick, unproject } = {}) {
  const state = { az: 180, alt: 20, fov: 70 };
  const vel = { az: 0, alt: 0 };
  let tween = null;
  const pointers = new Map();
  let dragDist = 0;
  let pinchStart = null;
  let lastMove = 0;

  function degPerPixel() {
    return state.fov / canvas.clientHeight;
  }

  function apply() {
    state.alt = MathUtils.clamp(state.alt, -89.9, 89.9);
    state.fov = MathUtils.clamp(state.fov, MIN_FOV, MAX_FOV);
    state.az = ((state.az % 360) + 360) % 360;
    camera.fov = Math.min(state.fov, 150); // three's own projection is only used when zoomed in
    camera.rotation.order = "YXZ";
    camera.rotation.set(state.alt * MathUtils.DEG2RAD, -state.az * MathUtils.DEG2RAD, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragDist = 0;
    tween = null;
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

  function lookTo({ alt = state.alt, az = state.az, fov = state.fov }) {
    let dAz = az - state.az;
    dAz = ((dAz + 540) % 360) - 180;
    vel.az = vel.alt = 0;
    tween = {
      from: { ...state },
      to: { alt, az: state.az + dAz, fov: MathUtils.clamp(fov, MIN_FOV, MAX_FOV) },
      t: 0,
    };
  }

  function update(dt) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.9);
      const k = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - (-2 * tween.t + 2) ** 2 / 2;
      state.alt = MathUtils.lerp(tween.from.alt, tween.to.alt, k);
      state.az = MathUtils.lerp(tween.from.az, tween.to.az, k);
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
  return { state, update, lookAt, lookTo, zoom, dirAt };
}
