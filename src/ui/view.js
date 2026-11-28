// Look-around camera for standing on the ground: drag to turn, scroll / pinch
// to zoom (field of view), arrows and +/- on the keyboard, with gentle inertia.
// With a sensor switched on (see sensor.js), the phone's own orientation aims
// the camera instead, and sideways drags nudge the compass into line.
// Up in space (setFree) there's no up or down: the camera turns freely, and a
// drag slides the sky under your finger in any direction, rather than swinging
// it round the point straight below.

import { Euler, MathUtils, Quaternion, Vector3 } from "three";

import { altAz } from "../astro.js";

export const MIN_FOV = 0.04; // as through a big telescope: close enough to pick out Pluto
const MAX_FOV = 180; // wide views switch to a stereographic projection (see projection.js)

/** The usual view on the ground (degrees across, top to bottom). */
export const DEFAULT_FOV = 80;
/** Up above the Earth, zoomed back out: as far as Face the Earth leaves it, 50° to 100°. */
export const orbitFov = (fov) => Math.max(50, Math.min(fov, 100));

/**
 * The zoom to go to when the info panel goes back to its overview: back out to the usual
 * view (in orbit, as Reset zoom does), or null to stay as you are, when you're already
 * zoomed out that far or wider (like Look up's whole-sky view). The direction never changes.
 */
export function overviewZoom(fov, aloft) {
  const to = aloft ? orbitFov(fov) : DEFAULT_FOV;
  return fov < to ? to : null;
}

/**
 * grab: optional { start(x, y), move(x, y, dt), end(gliding) }: while free (up in
 * space), a drag that `start` accepts (it returns true, e.g. one that begins on
 * the Earth) is handed over to it instead of turning the view.
 */
export function createView(camera, canvas, { onClick, unproject, sensor, grab } = {}) {
  const state = { az: 180, alt: 20, fov: 70, roll: 0 }; // (roll: only up in space, turned on its side)
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
  let grabbing = false; // a drag handed over to `grab`
  const sensorOn = () => sensor?.active;

  let free = false;
  const orient = new Quaternion(); // the camera's turn, while free
  const spin = { yaw: 0, pitch: 0 }; // its glide after a drag (rad/s, about its own axes)
  const turn = new Quaternion();
  const AXIS_X = new Vector3(1, 0, 0);
  const AXIS_Y = new Vector3(0, 1, 0);
  const euler = new Euler(0, 0, 0, "YXZ");
  /** The camera's turn to face an altitude and azimuth, upright. */
  const aimFor = (alt, az, roll = 0) =>
    new Quaternion().setFromEuler(
      euler.set(alt * MathUtils.DEG2RAD, -az * MathUtils.DEG2RAD, roll * MathUtils.DEG2RAD, "YXZ")
    );
  /** Turn the free camera about its own axes (radians). */
  function turnBy(yaw, pitch) {
    orient.multiply(turn.setFromAxisAngle(AXIS_Y, yaw));
    orient.multiply(turn.setFromAxisAngle(AXIS_X, pitch)).normalize();
  }

  function degPerPixel() {
    return state.fov / canvas.clientHeight;
  }

  function apply() {
    state.fov = MathUtils.clamp(state.fov, MIN_FOV, MAX_FOV);
    camera.fov = Math.min(state.fov, 150); // three's own projection is only used when zoomed in
    if (free) {
      camera.quaternion.copy(orient);
      forward.set(0, 0, -1).applyQuaternion(orient);
      state.alt = Math.asin(MathUtils.clamp(forward.y, -1, 1)) * MathUtils.RAD2DEG;
      state.az = (((Math.atan2(forward.x, -forward.z) * MathUtils.RAD2DEG) % 360) + 360) % 360;
      state.roll = euler.setFromQuaternion(orient, "YXZ").z * MathUtils.RAD2DEG;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return;
    }
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
    state.roll = 0;
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
    spin.yaw = spin.pitch = 0;
    canvas.classList.add("dragging");
    const local = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top];
    };
    if (pointers.size === 1 && free && grab) grabbing = !!grab.start(...local(e));
    if (pointers.size === 2) {
      if (grabbing) grab.end(false); // two fingers: pinching to zoom instead
      grabbing = false;
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
    if (grabbing) {
      const now = performance.now();
      const rect = canvas.getBoundingClientRect();
      grab.move(e.clientX - rect.left, e.clientY - rect.top, Math.max(1, now - lastMove) / 1000);
      lastMove = now;
      return;
    }
    if (free) {
      const yaw = dx * k * MathUtils.DEG2RAD;
      const pitch = dy * k * MathUtils.DEG2RAD;
      turnBy(yaw, pitch);
      const now = performance.now();
      const dt = Math.max(1, now - lastMove) / 1000;
      lastMove = now;
      spin.yaw = MathUtils.lerp(spin.yaw, yaw / dt, 0.5);
      spin.pitch = MathUtils.lerp(spin.pitch, pitch / dt, 0.5);
      return;
    }
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
      const recent = performance.now() - lastMove <= 80;
      if (!recent) vel.az = vel.alt = spin.yaw = spin.pitch = 0;
      if (grabbing) grab.end(recent); // let go mid-turn: it glides on
      grabbing = false;
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
    const r = step * MathUtils.DEG2RAD;
    const keys = free
      ? {
          ArrowLeft: () => turnBy(r, 0),
          ArrowRight: () => turnBy(-r, 0),
          ArrowUp: () => turnBy(0, r),
          ArrowDown: () => turnBy(0, -r),
          "+": () => zoom(0.8),
          "=": () => zoom(0.8),
          "-": () => zoom(1.25),
        }
      : {
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
  function lookTo({ alt, az, fov = state.fov, roll = 0 }, { duration = 0.9 } = {}) {
    fov = MathUtils.clamp(fov, MIN_FOV, MAX_FOV);
    // Turning a long way and zooming a long way in (to a planet, say): zoom as you
    // turn and what you're turning to is off the edge of the narrowing view, as if
    // heading the wrong way. So turn first, then zoom in.
    const turning = alt !== undefined && az !== undefined && !sensorOn();
    if (turning && fov < state.fov / 4 && angleTo(alt, az, roll) > fov) {
      lookTo({ alt, az, roll }, { duration });
      const zoom = Math.min(2.5, 0.5 + 0.12 * Math.log2(state.fov / fov));
      tween.then = () => lookTo({ fov }, { duration: zoom });
      return;
    }
    if (free) {
      // Turning to a direction comes back upright; only zooming keeps the turn as it is.
      const keep = alt === undefined && az === undefined;
      alt ??= state.alt;
      az ??= state.az;
      spin.yaw = spin.pitch = 0;
      tween = {
        free: true,
        from: orient.clone(),
        aim: keep ? orient.clone() : aimFor(alt, az, roll),
        fovFrom: state.fov,
      };
      Object.assign(tween, { to: { alt, az, fov, roll }, t: 0, duration });
      return;
    }
    alt ??= state.alt;
    az ??= state.az;
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
      to: { alt, az: state.az + dAz, fov },
      t: 0,
      duration,
    };
  }

  /** How far (degrees) the view would turn to face alt/az. */
  function angleTo(alt, az, roll) {
    if (free) return (orient.angleTo(aimFor(alt, az, roll)) * 180) / Math.PI;
    const r = Math.PI / 180;
    const c =
      Math.sin(alt * r) * Math.sin(state.alt * r) +
      Math.cos(alt * r) * Math.cos(state.alt * r) * Math.cos((az - state.az) * r);
    return Math.acos(MathUtils.clamp(c, -1, 1)) / r;
  }

  function finishTween() {
    const then = tween.then;
    tween = null;
    then?.();
  }

  /** Turn the view by this much, including any turn in progress (to follow something that moves). */
  function shift(dAlt, dAz) {
    if (sensorOn() || free) return; // the phone does the aiming (or there's no up in space)
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
      if (tween.free) {
        orient.slerpQuaternions(tween.from, tween.aim, k);
        state.fov = tween.fovFrom * (tween.to.fov / tween.fovFrom) ** k;
        if (tween.t >= 1) finishTween();
        apply();
        return;
      }
      if (!following) state.alt = MathUtils.lerp(tween.from.alt, tween.to.alt, k);
      if (!following) state.az = MathUtils.lerp(tween.from.az, tween.to.az, k);
      // Zoom geometrically so it feels even.
      state.fov = tween.from.fov * (tween.to.fov / tween.from.fov) ** k;
      if (tween.t >= 1) finishTween();
    } else if (free) {
      if (pointers.size === 0 && (spin.yaw || spin.pitch)) {
        turnBy(spin.yaw * dt, spin.pitch * dt);
        const decay = Math.exp(-dt * 4);
        spin.yaw *= decay;
        spin.pitch *= decay;
        if (Math.abs(spin.yaw) + Math.abs(spin.pitch) < 0.001) spin.yaw = spin.pitch = 0;
      }
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

  /**
   * Turn freely (up in space) or upright (on the ground). Leaving free, the camera
   * stands upright again: any turn under way carries on, in the upright way.
   */
  function setFree(on) {
    if (on === free) return;
    vel.az = vel.alt = spin.yaw = spin.pitch = 0;
    if (on) {
      orient.copy(camera.quaternion);
      const to = tween && { ...tween.to, left: (1 - tween.t) * tween.duration };
      tween = null;
      free = true;
      if (to && to.left > 0.05) lookTo(to, { duration: to.left });
      return;
    }
    const to = tween?.free && { ...tween.to, left: (1 - tween.t) * tween.duration };
    tween = null;
    free = false;
    apply();
    if (to && to.left > 0.05) lookTo(to, { duration: to.left });
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
    setFree,
    /** When you last turned or zoomed the view yourself (performance.now()). */
    touchedAt: () => touchedAt,
  };
}
