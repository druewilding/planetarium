// The view's projection. Narrow views use ordinary perspective (straight lines
// stay straight); wide views blend into a stereographic projection, which keeps
// circles circular, so whole-sky views and the Sun's daily arc aren't stretched
// at the edges. A shader version of the same maths lives in glsl.js (PROJECTION).
//
// Both map the angle θ between a direction and the view axis to a screen radius
// r(θ) = mix(tan θ, 2·tan(θ/2), s), scaled so the top of the screen is half the
// vertical field of view away from the centre.

import { MathUtils, Vector3 } from "three";

const STEREO_FROM = 70; // degrees of vertical field of view
const STEREO_FULL = 110;
const MAX_PERSPECTIVE = 1.55; // radians; tan() is clamped beyond this

export function stereoAmount(fovDeg) {
  return MathUtils.smoothstep(fovDeg, STEREO_FROM, STEREO_FULL);
}

export function radiusFor(theta, s) {
  const rp = Math.tan(Math.min(theta, MAX_PERSPECTIVE));
  const rs = 2 * Math.tan(theta / 2);
  return rp + (rs - rp) * s;
}

/** Furthest angle from the view axis that is drawn at all. */
export const limitFor = (s) => 1.5 + (2.6 - 1.5) * s;

// How much of your own vision the screen's height takes up: a phone held in
// front of you, or a laptop at arm's length, covers roughly this much.
const SCREEN_ANGLE = 23; // degrees
const MAX_EYE_SCALE = 4;

/**
 * How many times bigger to draw something so that it looks the size it does to
 * your eye. A wide view squeezes the sky onto a screen that covers much less of
 * your vision, which shrinks everything. This undoes that (it compares sizes at
 * the middle of the screen) until the view is narrower than the screen, and from
 * there on it's 1: you're looking through a telescope, and sizes are true.
 * Capped, so a whole-sky view doesn't blow the Sun up to the size of a fist.
 */
export function eyeScale(fovDeg) {
  const half = (fovDeg / 2) * MathUtils.DEG2RAD;
  const squeeze = radiusFor(half, stereoAmount(fovDeg)) / Math.tan((SCREEN_ANGLE / 2) * MathUtils.DEG2RAD);
  return MathUtils.clamp(squeeze, 1, MAX_EYE_SCALE);
}

const MAX_GAIN = 9; // magnitudes
const PUPIL_MM = 7; // a dark-adapted eye's

/**
 * How many magnitudes fainter you can see, zoomed in: as with sizes, a view
 * narrower than the screen is like looking through binoculars or a telescope,
 * and each zoom gets the one that suits its magnification. 0 for wider views.
 */
export function telescopeGain(fovDeg) {
  const m = Math.max(1, SCREEN_ANGLE / fovDeg); // how many times it magnifies
  // Binoculars: roughly 2½ magnitudes for every tenfold.
  const binoculars = 2.5 * Math.log10(m);
  // A telescope is used up to about twice its aperture in mm, so this one is m/2 mm
  // across: it gathers (m/2 ÷ 7 mm)² times the light your pupil does, and magnifying
  // darkens the sky around a star (+0.3). At the closest zoom that's a 29 cm
  // telescope, which just shows Pluto from a dark site.
  const telescope = 5 * Math.log10(m / 2 / PUPIL_MM) + 0.3;
  return Math.min(MAX_GAIN, Math.max(0, binoculars, telescope));
}

/** Angle θ whose screen radius is r (r is monotonic in θ, so bisect). */
export function thetaFor(r, s) {
  let lo = 0;
  let hi = limitFor(s);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (radiusFor(mid, s) < r) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function createProjection(camera) {
  const uniforms = {
    uStereo: { value: 0 },
    uProjScale: { value: 1 },
    uAspect: { value: 1 },
  };
  let s = 0;
  let scale = 1;
  let aspect = 1;
  const v = new Vector3();

  /** Call when the field of view or aspect ratio changes. */
  function update(fovDeg, aspectRatio) {
    s = stereoAmount(fovDeg);
    scale = 1 / radiusFor((fovDeg / 2) * MathUtils.DEG2RAD, s);
    aspect = aspectRatio;
    uniforms.uStereo.value = s;
    uniforms.uProjScale.value = scale;
    uniforms.uAspect.value = aspect;
  }

  /** World direction → normalised device coords {x, y} (−1…1), or null if not drawn. */
  function project(dir) {
    v.copy(dir).transformDirection(camera.matrixWorldInverse);
    const sinT = Math.hypot(v.x, v.y);
    const theta = Math.atan2(sinT, -v.z);
    if (theta > limitFor(s) || (s === 0 && theta >= Math.PI / 2)) return null;
    if (sinT < 1e-9) return { x: 0, y: 0 };
    const k = (radiusFor(theta, s) * scale) / sinT;
    return { x: (v.x * k) / aspect, y: v.y * k };
  }

  /** Normalised device coords → world direction. */
  function unproject(x, y) {
    const px = x * aspect;
    const rho = Math.hypot(px, y);
    const theta = thetaFor(rho / scale, s);
    const sinT = Math.sin(theta);
    const out = rho < 1e-9 ? new Vector3(0, 0, -1) : new Vector3((px / rho) * sinT, (y / rho) * sinT, -Math.cos(theta));
    return out.transformDirection(camera.matrixWorld);
  }

  /** Half the horizontal field of view, in degrees. */
  function halfFovX() {
    return thetaFor(aspect / scale, s) * MathUtils.RAD2DEG;
  }

  /** View altitude that puts the horizon at a given normalised screen y (negative = below centre). */
  function altitudeForHorizonAt(ndcY, fovDeg) {
    const ss = stereoAmount(fovDeg);
    const sc = 1 / radiusFor((fovDeg / 2) * MathUtils.DEG2RAD, ss);
    return Math.sign(-ndcY) * thetaFor(Math.abs(ndcY) / sc, ss) * MathUtils.RAD2DEG;
  }

  return { uniforms, update, project, unproject, halfFovX, altitudeForHorizonAt };
}
