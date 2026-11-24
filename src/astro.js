// Astronomy layer: wraps astronomy-engine and converts everything into the
// scene's "world" frame, which is the observer's horizon:
//   x = east, y = up (zenith), z = south   (so -z is north)
// astronomy-engine's HOR frame is x = north, y = west, z = zenith.

import * as A from "astronomy-engine";
import { Matrix4, Vector3 } from "three";

import { earthShadow, moonInShadow } from "./eclipses.js";

export const Body = A.Body;
export const AU_KM = 149597870.7;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const SUN_RADIUS_KM = 695700;
export const MOON_RADIUS_KM = 1737.4;
export const SUN_ILLUMINANCE = 127000; // lux at 1 AU, top of atmosphere

export const PLANETS = [
  { id: "Mercury", name: "Mercury", radiusKm: 2439.7, color: [0.9, 0.86, 0.8] },
  { id: "Venus", name: "Venus", radiusKm: 6051.8, color: [1.0, 0.97, 0.88] },
  { id: "Mars", name: "Mars", radiusKm: 3389.5, color: [1.0, 0.6, 0.4] },
  { id: "Jupiter", name: "Jupiter", radiusKm: 69911, color: [1.0, 0.93, 0.8] },
  { id: "Saturn", name: "Saturn", radiusKm: 58232, color: [1.0, 0.9, 0.68] },
  { id: "Uranus", name: "Uranus", radiusKm: 25362, color: [0.72, 0.92, 1.0] },
  { id: "Neptune", name: "Neptune", radiusKm: 24622, color: [0.55, 0.7, 1.0] },
];

/**
 * Which way the lit side of a body faces, as you see it standing on the ground:
 * degrees anticlockwise from "lit on the right", with up being towards the zenith.
 * Near the equator a crescent Moon lies on its back, lit from below.
 */
export function litAngle(dir, sunDir) {
  const up = new Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
  if (up.lengthSq() < 1e-8) up.set(0, 0, -1).addScaledVector(dir, dir.z); // overhead: north is up
  up.normalize();
  const right = new Vector3().crossVectors(dir, up);
  return Math.atan2(sunDir.dot(up), sunDir.dot(right)) * R2D;
}

/** astronomy-engine rotation (frame → HOR) as a Matrix4 (frame → world). */
export function rotationToWorld(rotation, out = new Matrix4()) {
  const r = rotation.rot;
  // hor_i = Σ_j r[j][i] v_j ; world = (−hor_y, hor_z, −hor_x)
  out.set(-r[0][1], -r[1][1], -r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, -r[0][0], -r[1][0], -r[2][0], 0, 0, 0, 0, 1);
  return out;
}

/** Atmospheric refraction in degrees for an apparent-from-true altitude (Saemundsson, as in astronomy-engine). */
export function refractionDeg(altDeg) {
  if (altDeg < -90 || altDeg > 90) return 0;
  const hd = Math.max(altDeg, -1);
  let r = 1.02 / Math.tan((hd + 10.3 / (hd + 5.11)) * D2R) / 60;
  if (altDeg < -1) r *= (altDeg + 90) / 89;
  return r;
}

/** Lift a unit world direction by refraction (in place). */
export function refract(v) {
  const alt = Math.asin(Math.max(-1, Math.min(1, v.y)));
  const alt2 = alt + refractionDeg(alt * R2D) * D2R;
  const h = Math.hypot(v.x, v.z);
  if (h < 1e-9) return v;
  const k = Math.cos(alt2) / h;
  v.x *= k;
  v.z *= k;
  v.y = Math.sin(alt2);
  return v;
}

export function altAz(v) {
  const alt = Math.asin(Math.max(-1, Math.min(1, v.y))) * R2D;
  let az = Math.atan2(v.x, -v.z) * R2D;
  if (az < 0) az += 360;
  return { alt, az };
}

export function dirFromAltAz(altDeg, azDeg, out = new Vector3()) {
  const a = altDeg * D2R;
  const z = azDeg * D2R;
  return out.set(Math.cos(a) * Math.sin(z), Math.sin(a), -Math.cos(a) * Math.cos(z));
}

/** Unit vector in an equatorial frame from RA (degrees) and Dec (degrees). */
export function eqVector(raDeg, decDeg, out = new Vector3()) {
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compassPoint = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

export function observer(loc) {
  return new A.Observer(loc.lat, loc.lon, 0);
}

function bodyState(body, time, obs, toWorld) {
  const eq = A.Equator(body, time, obs, false, true);
  const v = new Vector3(eq.vec.x, eq.vec.y, eq.vec.z).applyMatrix4(toWorld);
  const trueDir = v.clone().normalize();
  const apparent = refract(trueDir.clone());
  return { vecAU: v, dist: eq.dist, ra: eq.ra, dec: eq.dec, trueDir, dir: apparent, ...altAz(apparent) };
}

/**
 * Everything that moves, for one instant and place. Called every frame.
 */
export function computeSky(ms, loc) {
  const time = A.MakeTime(new Date(ms));
  const obs = observer(loc);
  const eqjToWorld = rotationToWorld(A.Rotation_EQJ_HOR(time, obs));
  const eqdToWorld = rotationToWorld(A.Rotation_EQD_HOR(time, obs));

  const sun = bodyState(Body.Sun, time, obs, eqjToWorld);
  sun.angularRadius = Math.asin(SUN_RADIUS_KM / (sun.dist * AU_KM));
  sun.mag = -26.74 + 5 * Math.log10(sun.dist);
  sun.illuminance = SUN_ILLUMINANCE / (sun.dist * sun.dist);

  const moon = bodyState(Body.Moon, time, obs, eqjToWorld);
  const moonIllum = A.Illumination(Body.Moon, time);
  moon.angularRadius = Math.asin(MOON_RADIUS_KM / (moon.dist * AU_KM));
  moon.mag = moonIllum.mag;
  moon.phaseFraction = moonIllum.phase_fraction;
  moon.phaseAngle = A.MoonPhase(time); // 0 new, 90 first quarter, 180 full…
  // The Earth's shadow, for lunar eclipses: in the world frame for drawing, and how much it dims the Moon.
  const shadow = earthShadow(time);
  moon.shadow = {
    axis: new Vector3(shadow.axis.x, shadow.axis.y, shadow.axis.z).applyMatrix4(eqjToWorld),
    centreKm: new Vector3(shadow.moon.x, shadow.moon.y, shadow.moon.z).applyMatrix4(eqjToWorld),
    umbraKm: shadow.umbraKm,
    penumbraKm: shadow.penumbraKm,
    ...moonInShadow(shadow),
  };
  if (moon.shadow.light < 1) moon.mag -= 2.5 * Math.log10(moon.shadow.light);
  moon.illuminance = sun.illuminance * 10 ** (-0.4 * (moon.mag - sun.mag));
  moon.sunDir = sun.vecAU.clone().sub(moon.vecAU).normalize();
  moon.axis = A.RotationAxis(Body.Moon, time);
  moon.litAngle = litAngle(moon.dir, moon.sunDir);
  sun.visibleFraction = sunVisibleFraction(sun.angularRadius, moon.angularRadius, sun.trueDir.angleTo(moon.trueDir));

  const planets = PLANETS.map((p) => {
    const s = bodyState(Body[p.id], time, obs, eqjToWorld);
    const ill = A.Illumination(Body[p.id], time);
    s.id = p.id;
    s.name = p.name;
    s.color = p.color;
    s.mag = ill.mag;
    s.phaseFraction = ill.phase_fraction;
    s.angularRadius = Math.asin(p.radiusKm / (s.dist * AU_KM));
    return s;
  });

  return { ms, time, obs, eqjToWorld, eqdToWorld, sun, moon, planets };
}

/** Fraction of the solar disc not covered by the Moon (discs of angular radius rs, rm, centres d apart). */
export function sunVisibleFraction(rs, rm, d) {
  if (d >= rs + rm) return 1;
  if (d <= rm - rs) return 0; // total
  if (d <= rs - rm) return 1 - (rm * rm) / (rs * rs); // annular
  const a1 = rs * rs * Math.acos((d * d + rs * rs - rm * rm) / (2 * d * rs));
  const a2 = rm * rm * Math.acos((d * d + rm * rm - rs * rs) / (2 * d * rm));
  const a3 = 0.5 * Math.sqrt((-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm));
  return 1 - (a1 + a2 - a3) / (Math.PI * rs * rs);
}

/** Orientation (body-fixed axes) of the Moon as a world-space Matrix4 for a three.js SphereGeometry. */
export function moonOrientation(axis, eqjToWorld, out = new Matrix4()) {
  const a0 = axis.ra * 15 * D2R;
  const n = new Vector3(axis.north.x, axis.north.y, axis.north.z);
  const node = new Vector3(-Math.sin(a0), Math.cos(a0), 0); // ascending node of body equator on ICRF equator
  const w = (axis.spin % 360) * D2R;
  const nxq = new Vector3().crossVectors(n, node);
  const prime = node
    .clone()
    .multiplyScalar(Math.cos(w))
    .add(nxq.multiplyScalar(Math.sin(w)));
  // SphereGeometry local axes: +x = longitude 0 (texture centre), +y = north, +z = longitude −90°.
  const lx = prime.applyMatrix4(eqjToWorld);
  const ly = n.clone().applyMatrix4(eqjToWorld);
  const lz = new Vector3().crossVectors(lx, ly);
  return out.makeBasis(lx, ly, lz);
}

export { A };
