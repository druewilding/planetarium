import * as THREE from "three";

import { A, Body, D2R, dirFromAltAz, eqVector, refract, rotationToWorld } from "../astro.js";
import { createLineMaterial, latitudeCircle, lines, longitudeArc, polylineGeometry } from "./lines.js";

export const OVERLAY_COLORS = {
  constellations: "#6f8fd8",
  constellationSelected: "#ffc76b",
  altAzGrid: "#c0a080",
  horizon: "#ff9c7a",
  eqGrid: "#6aa8ff",
  equator: "#4fa0ff",
  ecliptic: "#ffd166",
  sunPath: "#ffb347",
  juneSolstice: "#ff7a59",
  decemberSolstice: "#7ec8ff",
  equinox: "#8be08b",
  moonPath: "#c9d6ff",
};

const OBLIQUITY_J2000 = 23.4392911;

export function createOverlays(shared, glsl, constellations) {
  const mat = (key, opts = {}) => createLineMaterial(shared, glsl, { color: OVERLAY_COLORS[key], ...opts });

  // Frames ------------------------------------------------------------------
  const eqj = new THREE.Group(); // J2000 equatorial: stars, constellations, ecliptic
  const eqd = new THREE.Group(); // equator of date: grid, equator, Sun's daily circles
  const hor = new THREE.Group(); // horizon: alt/az grid
  for (const g of [eqj, eqd]) g.matrixAutoUpdate = false;

  // Constellation figures ----------------------------------------------------
  const conLines = constellations.map((c) => c.lines.map((l) => l.map(([ra, dec]) => eqVector(ra, dec))));
  const constellationLines = lines(polylineGeometry(conLines.flat()), mat("constellations", { opacity: 0.38 }));
  eqj.add(constellationLines);
  const selectedMaterial = mat("constellationSelected", { opacity: 0.8 });
  let selectedConstellation = null;
  function selectConstellation(id) {
    if (selectedConstellation) {
      eqj.remove(selectedConstellation);
      selectedConstellation.geometry.dispose();
      selectedConstellation = null;
    }
    // Some constellations (Serpens) come in more than one piece.
    const parts = conLines.filter((_, i) => constellations[i].id === id).flat();
    if (!parts.length) return;
    selectedConstellation = lines(polylineGeometry(parts), selectedMaterial, 3);
    eqj.add(selectedConstellation);
  }

  // Ecliptic (J2000) -----------------------------------------------------------
  const eps = OBLIQUITY_J2000 * D2R;
  const ecl = [];
  for (let i = 0; i < 360; i++) {
    const l = i * D2R;
    ecl.push(new THREE.Vector3(Math.cos(l), Math.sin(l) * Math.cos(eps), Math.sin(l) * Math.sin(eps)));
  }
  const ecliptic = lines(polylineGeometry([ecl], { closed: true }), mat("ecliptic", { opacity: 0.7 }));
  eqj.add(ecliptic);

  // Equatorial grid & celestial equator (of date) ------------------------------
  const eqGridLines = [];
  for (let dec = -75; dec <= 75; dec += 15) if (dec !== 0) eqGridLines.push(latitudeCircle(dec));
  for (let ra = 0; ra < 360; ra += 30) eqGridLines.push(longitudeArc(ra, 90, -88, 88));
  const eqGrid = lines(polylineGeometry(eqGridLines.slice(0, 10), { closed: true }), mat("eqGrid", { opacity: 0.22 }));
  const eqGridMeridians = lines(polylineGeometry(eqGridLines.slice(10)), mat("eqGrid", { opacity: 0.22 }));
  const eqGridGroup = new THREE.Group();
  eqGridGroup.add(eqGrid, eqGridMeridians);
  eqd.add(eqGridGroup);
  const equator = lines(polylineGeometry([latitudeCircle(0)], { closed: true }), mat("equator", { opacity: 0.65 }));
  eqd.add(equator);

  // Sun's daily circles (declination circles in the equator-of-date frame) ----
  const seasonGroup = new THREE.Group();
  const seasonDec = 23.436;
  seasonGroup.add(
    lines(polylineGeometry([latitudeCircle(seasonDec)], { closed: true }), mat("juneSolstice", { opacity: 0.55 })),
    lines(polylineGeometry([latitudeCircle(-seasonDec)], { closed: true }), mat("decemberSolstice", { opacity: 0.55 })),
    lines(polylineGeometry([latitudeCircle(0)], { closed: true }), mat("equinox", { opacity: 0.45 }))
  );
  eqd.add(seasonGroup);

  const sunPathMaterial = mat("sunPath", { opacity: 0.85 });
  const sunPath = lines(new THREE.BufferGeometry(), sunPathMaterial, 3);
  eqd.add(sunPath);
  let sunPathDec = null;

  // Alt/az grid & horizon -------------------------------------------------------
  const azGrid = [];
  for (let alt = 15; alt <= 75; alt += 15) azGrid.push(latitudeCircle(alt));
  const azMeridians = [];
  for (let az = 0; az < 360; az += 30) azMeridians.push(longitudeArc(az, 45, 0, 88));
  // Grid built with z as the pole: rotate into world (y up).
  const zUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const altAzGrid = new THREE.Group();
  altAzGrid.add(
    lines(
      polylineGeometry(azGrid, { closed: true }),
      createLineMaterial(shared, glsl, { color: OVERLAY_COLORS.altAzGrid, opacity: 0.22, refract: false })
    ),
    lines(
      polylineGeometry(azMeridians),
      createLineMaterial(shared, glsl, { color: OVERLAY_COLORS.altAzGrid, opacity: 0.22, refract: false })
    )
  );
  altAzGrid.applyMatrix4(zUp);
  const horizonLine = lines(
    polylineGeometry([latitudeCircle(0, 360)], { closed: true }),
    createLineMaterial(shared, glsl, { color: OVERLAY_COLORS.horizon, opacity: 0.5, refract: false, radius: 890 }),
    11
  );
  horizonLine.applyMatrix4(zUp);
  hor.add(altAzGrid, horizonLine);

  // Moon path (world frame, rebuilt as time passes) ------------------------------
  const moonPath = lines(
    new THREE.BufferGeometry(),
    createLineMaterial(shared, glsl, { color: OVERLAY_COLORS.moonPath, opacity: 0.6, refract: false }),
    3
  );
  hor.add(moonPath);

  // Updates ------------------------------------------------------------------
  function updateFrames(sky) {
    eqj.matrix.copy(sky.eqjToWorld);
    eqd.matrix.copy(sky.eqdToWorld);
    eqj.matrixWorldNeedsUpdate = true;
    eqd.matrixWorldNeedsUpdate = true;
  }

  /** Today's solar declination circle (rebuilt only when it changes). */
  function updateSunPath(sunDecOfDate) {
    if (sunPathDec !== null && Math.abs(sunPathDec - sunDecOfDate) < 0.02) return;
    sunPathDec = sunDecOfDate;
    sunPath.geometry.dispose();
    sunPath.geometry = polylineGeometry([latitudeCircle(sunDecOfDate, 240)], { closed: true });
  }

  /** Apparent positions of a body over a span of time, as world directions. */
  function track(body, obs, startMs, hours, stepMinutes) {
    const pts = [];
    for (let m = 0; m <= hours * 60; m += stepMinutes) {
      const t = A.MakeTime(new Date(startMs + m * 60000));
      const eq = A.Equator(body, t, obs, false, true);
      const w = new THREE.Vector3(eq.vec.x, eq.vec.y, eq.vec.z)
        .applyMatrix4(rotationToWorld(A.Rotation_EQJ_HOR(t, obs)))
        .normalize();
      pts.push({ ms: startMs + m * 60000, dir: refract(w) });
    }
    return pts;
  }

  function updateMoonPath(obs, centerMs) {
    const pts = track(Body.Moon, obs, centerMs - 12 * 3600000, 24, 20);
    moonPath.geometry.dispose();
    moonPath.geometry = polylineGeometry([pts.map((p) => p.dir)]);
    return pts;
  }

  /** Where the Sun is at each whole hour of the local day. */
  function sunHours(obs, dayStartMs) {
    return track(Body.Sun, obs, dayStartMs, 24, 60);
  }

  /** Points on the meridian where each seasonal circle peaks (for labels). */
  function seasonLabelDirs(lat) {
    const peak = (dec) => {
      const alt = 90 - Math.abs(lat - dec);
      return dirFromAltAz(alt, dec < lat ? 180 : 0);
    };
    return [
      { key: "june", text: "June solstice", dir: peak(seasonDec) },
      { key: "december", text: "December solstice", dir: peak(-seasonDec) },
      { key: "equinox", text: "Equinoxes", dir: peak(0) },
    ];
  }

  const layers = {
    constellations: constellationLines,
    ecliptic,
    eqGrid: eqGridGroup,
    equator,
    seasonPaths: seasonGroup,
    sunPath,
    altAzGrid,
    compass: horizonLine,
    moonPath,
  };

  return {
    groups: [eqj, eqd, hor],
    eqj,
    layers,
    updateFrames,
    updateSunPath,
    updateMoonPath,
    sunHours,
    seasonLabelDirs,
    selectConstellation,
  };
}
