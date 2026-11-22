// Converts Natural Earth land + populated places into data/land.json and data/cities.json.
// Usage: node tools/convert-geo.mjs <folder with ne_110m_land.geojson, ne_50m_populated_places.geojson> data

import fs from "node:fs";
const [, , src, out] = process.argv;
const rd = (f) => JSON.parse(fs.readFileSync(`${src}/${f}`, "utf8"));
const r = (v) => Math.round(v * 10) / 10;
const polys = [];
for (const f of rd("ne_110m_land.geojson").features) {
  const g = f.geometry;
  const list = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of list) polys.push(p[0].map(([x, y]) => [r(x), r(y)]));
}
fs.writeFileSync(`${out}/land.json`, JSON.stringify(polys));
// Natural Earth's points are sometimes off the town itself, which matters once the
// hills around you are drawn. Tromsø's sits 400 m up the mountain across the sound.
const PLACE_FIXES = { "Tromsø|Norway": [69.649, 18.955] };
const cities = rd("ne_50m_populated_places.geojson")
  .features.map((f) => {
    const p = f.properties;
    const [lon, lat] = PLACE_FIXES[`${p.NAME_EN || p.NAME}|${p.ADM0NAME}`]?.slice().reverse() ?? f.geometry.coordinates;
    return [p.NAME_EN || p.NAME, p.ADM0NAME, +lat.toFixed(3), +lon.toFixed(3), p.TIMEZONE || "", p.POP_MAX];
  })
  .sort((a, b) => b[5] - a[5])
  .map((c) => c.slice(0, 5));
for (const c of cities) {
  if (c[4]) continue;
  let best = null;
  let bd = Infinity;
  for (const o of cities) {
    if (!o[4] || o[1] !== c[1]) continue;
    const d = (o[2] - c[2]) ** 2 + ((o[3] - c[3]) * Math.cos((c[2] * Math.PI) / 180)) ** 2;
    if (d < bd) [bd, best] = [d, o];
  }
  if (best) c[4] = best[4];
}
fs.writeFileSync(`${out}/cities.json`, JSON.stringify(cities));
console.log(polys.length, "land polys,", cities.length, "cities,", cities.filter((c) => !c[4]).length, "without tz");
console.log(cities.filter((c) => /Copenhagen|London|Sydney/.test(c[0])));
