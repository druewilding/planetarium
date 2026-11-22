// Point your phone at the sky: turns the device's orientation sensors into a
// camera orientation in the world frame (x = east, y = up, z = south).
//
// Android Chrome sends `deviceorientationabsolute`, whose alpha is already
// measured from north. iOS Safari sends a relative alpha plus
// `webkitCompassHeading`, so we learn the offset between the two and keep it
// smoothed. Either way the compass points to magnetic north and phone
// magnetometers are often a little off, so a sideways nudge (in degrees of
// azimuth) can line the sky up by hand.

import { Euler, MathUtils, Quaternion, Vector3 } from "three";

const D2R = MathUtils.DEG2RAD;
const UP = new Vector3(0, 1, 0);
const SCREEN_Z = new Vector3(0, 0, 1);
// The camera looks out of the back of the phone, not out of its top edge.
const BACK_OF_PHONE = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

export function sensorSupported() {
  return typeof window.DeviceOrientationEvent !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export function createSensor() {
  const euler = new Euler();
  const q = new Quaternion();
  const tmp = new Quaternion();
  let reading = null; // { alpha, beta, gamma } in degrees, alpha measured from north
  let absolute = false; // seen a real absolute event (Android)
  let headingOffset = null; // iOS: smoothed (alpha + compass heading), as a unit vector
  let active = false;
  let nudge = 0;

  function onAbsolute(e) {
    if (e.alpha == null) return;
    absolute = true;
    reading = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  }

  function onRelative(e) {
    if (absolute || e.alpha == null) return;
    const heading = e.webkitCompassHeading;
    if (heading == null || !(e.webkitCompassAccuracy >= 0)) {
      // No compass at all: at least let the sky follow the phone.
      if (headingOffset == null) reading = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      else reading = { alpha: e.alpha - offsetDeg(), beta: e.beta, gamma: e.gamma };
      return;
    }
    // alpha_true = 360 − heading, so (alpha + heading) is how far the relative frame is turned.
    const o = (e.alpha + heading) * D2R;
    if (headingOffset == null) headingOffset = { x: Math.cos(o), y: Math.sin(o) };
    else {
      // Low-pass on the circle, so compass jitter doesn't shake the sky.
      headingOffset.x += (Math.cos(o) - headingOffset.x) * 0.05;
      headingOffset.y += (Math.sin(o) - headingOffset.y) * 0.05;
    }
    reading = { alpha: e.alpha - offsetDeg(), beta: e.beta, gamma: e.gamma };
  }

  const offsetDeg = () => Math.atan2(headingOffset.y, headingOffset.x) / D2R;

  /** Must be called from a tap: iOS only asks for permission inside a user gesture. */
  async function start() {
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE?.requestPermission === "function") {
      const answer = await DOE.requestPermission();
      if (answer !== "granted") {
        throw new Error(
          "Motion sensors are blocked for this site. Allow them in the browser's site settings (tap the icon left of the address), then reload."
        );
      }
    }
    window.addEventListener("deviceorientationabsolute", onAbsolute);
    window.addEventListener("deviceorientation", onRelative);
    active = true;
  }

  function stop() {
    window.removeEventListener("deviceorientationabsolute", onAbsolute);
    window.removeEventListener("deviceorientation", onRelative);
    active = false;
    reading = null;
  }

  /** The camera orientation the phone is asking for, or null if there's no reading yet. */
  function orientation(out) {
    if (!active || !reading) return null;
    const { alpha, beta, gamma } = reading;
    euler.set(beta * D2R, alpha * D2R, -gamma * D2R, "YXZ");
    q.setFromEuler(euler).multiply(BACK_OF_PHONE);
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
    q.multiply(tmp.setFromAxisAngle(SCREEN_Z, -screenAngle * D2R));
    // Turning the view by +az is a rotation of −az about the zenith.
    out.copy(tmp.setFromAxisAngle(UP, -nudge * D2R)).multiply(q);
    return out;
  }

  return {
    start,
    stop,
    orientation,
    get active() {
      return active;
    },
    /** Turn the whole sky by a few degrees, to correct the compass by hand. */
    nudge(dAz) {
      nudge += dAz;
    },
    get hasCompass() {
      return absolute || headingOffset != null;
    },
  };
}
