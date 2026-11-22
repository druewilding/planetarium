// Converts d3-celestial star/constellation data into data/stars.json and data/constellations.json.
// Usage: node tools/convert-stars.mjs <folder with d3-celestial data files> data

import fs from "node:fs";
const [, , src, out] = process.argv;
const rd = (f) => JSON.parse(fs.readFileSync(`${src}/${f}`, "utf8"));
const norm = (ra) => +(((ra % 360) + 360) % 360).toFixed(4);
const stars = rd("stars.6.json").features;
const names = rd("starnames.json");
const list = [];
const named = {};
for (const f of stars) {
  const [ra, dec] = f.geometry.coordinates;
  const bv = parseFloat(f.properties.bv);
  list.push([f.id, norm(ra), +dec.toFixed(4), f.properties.mag, Number.isFinite(bv) ? bv : 0.6]);
  const n = names[f.id];
  if (n) {
    const desig = n.bayer || n.flam || n.var || "";
    if (n.name || desig) named[f.id] = [n.name || "", desig, n.c || ""];
  }
}
list.sort((a, b) => a[3] - b[3]);
fs.writeFileSync(`${out}/stars.json`, JSON.stringify({ stars: list, names: named }));
const lines = Object.fromEntries(rd("constellations.lines.json").features.map((f) => [f.id, f.geometry.coordinates]));
const cons = rd("constellations.json").features.map((f) => ({
  id: f.id,
  name: f.properties.name,
  gen: f.properties.gen,
  label: [norm(f.geometry.coordinates[0]), f.geometry.coordinates[1]],
  lines: (lines[f.id] || []).map((l) => l.map(([ra, dec]) => [norm(ra), +dec.toFixed(4)])),
}));
fs.writeFileSync(`${out}/constellations.json`, JSON.stringify(cons));
console.log(list.length, "stars,", Object.keys(named).length, "named,", cons.length, "constellations");
console.log(Object.values(named).filter((n) => n[0]).length, "proper names");
