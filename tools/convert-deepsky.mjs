// Builds data/deepsky.json: the Messier objects and the brightest of the rest
// (mostly southern), from d3-celestial's messier.json and dsos.bright.json, plus a
// few famous ones those lists leave out. For star clusters it works out how much of
// their light is left over once the stars we already draw (data/stars.json) are
// taken away: that's the faint glow of the stars too faint to draw one by one.
//
// Usage: node tools/convert-deepsky.mjs <folder with d3-celestial data files> data

import fs from "node:fs";

const [, , src, out] = process.argv;
const rd = (f) => JSON.parse(fs.readFileSync(`${src}/${f}`, "utf8"));
const norm = (ra) => +(((ra % 360) + 360) % 360).toFixed(4);

// d3-celestial's types, and ours.
const TYPES = {
  oc: "oc", // open cluster
  gc: "gc", // globular cluster
  s: "sg", // spiral galaxy
  e: "eg", // elliptical galaxy
  i: "ig", // irregular galaxy
  sd: "ig",
  sfr: "en", // star-forming region: an emission nebula
  en: "en",
  rn: "rn", // reflection nebula
  pn: "pn", // planetary nebula
  snr: "sn", // supernova remnant
  pos: "as", // a star cloud, a double star or an asterism
};

/** "13", "6x4" → [major, minor] in arcminutes. */
function dims(dim) {
  const [a, b] = String(dim || "")
    .split("x")
    .map(Number)
    .filter((v) => v > 0);
  return a ? [a, b ?? a] : [1, 1];
}

const objects = new Map();
function add(id, desig, ra, dec, type, mag, [major, minor]) {
  if (objects.has(id)) return;
  objects.set(id, { id, desig, ra: norm(ra), dec: +dec.toFixed(4), type, mag, major, minor });
}

for (const f of rd("messier.json").features) {
  const p = f.properties;
  const [ra, dec] = f.geometry.coordinates;
  add(f.id, p.desig.replace("/", " & "), ra, dec, TYPES[p.type], +p.mag, dims(p.dim));
}

// The bright list repeats some Messier objects (and has M4 in the wrong place): skip those.
const MESSIER_NGC = new Set([...objects.values()].map((o) => o.desig).filter(Boolean));
const RENAME = {
  "PGC 17223": ["LMC", "PGC 17223"],
  "NGC 292": ["SMC", "NGC 292"],
  "C 41": ["Mel25", "Melotte 25"],
  "Cr 39": ["Mel20", "Melotte 20"],
  "Cr 256": ["Mel111", "Melotte 111"],
  GC: ["GC", "Sagittarius A*"],
};
for (const f of rd("dsos.bright.json").features) {
  const p = f.properties;
  // (Its id is the catalogue number; desig is what it's known as, "M 4", "h Per"…)
  if (MESSIER_NGC.has(f.id) || p.desig.startsWith("M ")) continue;
  if (f.id === "NGC 884") continue; // half of the Double Cluster (below)
  const [ra, dec] = f.geometry.coordinates;
  const [id, desig] = RENAME[f.id] ?? [f.id.replace(" ", ""), f.id];
  add(id, desig, ra, dec, TYPES[p.type], +p.mag, dims(p.dim));
}

// The Double Cluster, h and χ Persei, as one: you see them together.
Object.assign(objects.get("NGC869"), {
  desig: "NGC 869 & 884",
  ra: 34.94,
  dec: 57.13,
  mag: 3.1,
  major: 60,
  minor: 30,
});
// d3-celestial has the Alpha Persei Cluster 1.7° south of Mirfak, the star at its heart.
Object.assign(objects.get("Mel20"), { ra: 51.5, dec: 49.1 });
// The galactic centre is a place, not something you can see.
Object.assign(objects.get("GC"), { type: "pl", mag: null, major: 1, minor: 1 });

// Famous ones the lists leave out (J2000; magnitudes and sizes as usually given).
const EXTRA = [
  ["NGC4755", "NGC 4755", 193.41, -60.37, "oc", 4.2, [10, 10]],
  ["NGC5128", "NGC 5128", 201.365, -43.019, "eg", 6.8, [25.7, 20]],
  ["NGC253", "NGC 253", 11.888, -25.288, "sg", 7.1, [27.5, 6.8]],
  ["NGC2070", "NGC 2070", 84.675, -69.1, "en", 8, [40, 25]],
  ["NGC7000", "NGC 7000", 314.82, 44.52, "en", 5, [120, 100]],
  ["NGC6397", "NGC 6397", 265.175, -53.674, "gc", 5.7, [32, 32]],
  ["NGC6752", "NGC 6752", 287.717, -59.985, "gc", 5.4, [29, 29]],
  ["NGC752", "NGC 752", 29.42, 37.79, "oc", 5.7, [75, 75]],
  ["IC4665", "IC 4665", 266.575, 5.72, "oc", 4.2, [70, 70]],
  ["NGC7293", "NGC 7293", 337.41, -20.837, "pn", 7.6, [16, 12]],
  ["NGC457", "NGC 457", 19.88, 58.28, "oc", 6.4, [13, 13]],
  // A dark cloud of dust: it shows as a hole in the Milky Way (already in its map).
  ["Coalsack", "Caldwell 99", 192.5, -62.5, "dn", null, [420, 300]],
];
for (const [id, desig, ra, dec, type, mag, size] of EXTRA) add(id, desig, ra, dec, type, mag, size);

// ---- How much of a cluster's light is left once its drawn stars are taken away ----
const stars = JSON.parse(fs.readFileSync(`${out}/stars.json`, "utf8")).stars;
const D2R = Math.PI / 180;
const unit = (ra, dec) => [
  Math.cos(dec * D2R) * Math.cos(ra * D2R),
  Math.cos(dec * D2R) * Math.sin(ra * D2R),
  Math.sin(dec * D2R),
];
const flux = (m) => 10 ** (-0.4 * m);
const LEAST = 0.05; // always keep a little: the countless fainter stars, or nebulosity
// The light left over in an open cluster comes from fainter stars scattered across it,
// which the eye sees more as a sprinkling than as a haze: so it glows less than it would.
const SPRINKLE = 1.5; // magnitudes
for (const o of objects.values()) {
  o.glow = o.mag;
  if (o.mag == null || (o.type !== "oc" && o.type !== "gc")) continue;
  const c = unit(o.ra, o.dec);
  const r = Math.cos(((o.major / 2) * D2R) / 60);
  let drawn = 0;
  for (const [, ra, dec, mag] of stars) {
    const u = unit(ra, dec);
    if (u[0] * c[0] + u[1] * c[1] + u[2] * c[2] >= r) drawn += flux(mag);
  }
  const left = Math.max(flux(o.mag) - drawn, LEAST * flux(o.mag));
  o.glow = +(-2.5 * Math.log10(left) + (o.type === "oc" ? SPRINKLE : 0)).toFixed(2);
}

// The Milky Way's map already shows these, better than an oval would: no glow of their own.
const IN_MAP = ["LMC", "SMC", "NGC2070", "M24", "Coalsack", "GC"];
// And these are stars spread over degrees of sky, with no haze between them to the eye:
// big, near clusters, and a few stars that happen to line up.
const JUST_STARS = ["Mel25", "Mel20", "Mel111", "Cr399"];
for (const id of [...IN_MAP, ...JUST_STARS]) objects.get(id).glow = null;

const list = [...objects.values()].sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));
const rows = list.map((o) => [o.id, o.desig, o.ra, o.dec, o.type, o.mag, o.glow, o.major, o.minor]);
fs.writeFileSync(`${out}/deepsky.json`, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(rows.length, "objects");
for (const o of list) if (o.glow !== o.mag) console.log(o.id.padEnd(9), "mag", o.mag, "→ glow", o.glow);
