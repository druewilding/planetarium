// Adds Hipparcos parallaxes to data/stars.json, so each star has a distance.
// Usage: node tools/add-parallaxes.mjs <hip2.csv> data/stars.json
//
// hip2.csv comes from the Hipparcos new reduction (van Leeuwen 2007), for
// example from ESA's Gaia archive (https://gea.esac.esa.int/tap-server/tap/sync):
//
//   REQUEST=doQuery LANG=ADQL FORMAT=csv MAXREC=200000
//   QUERY=SELECT hip, plx, e_plx FROM public.hipparcos_newreduction WHERE hp_mag < 8
//
// Each star row becomes [hip, ra, dec, mag, bv, plx, e_plx], with the
// parallax and its error in milliarcseconds (null when there isn't one).

import fs from "node:fs";

const [, , csv, starsFile] = process.argv;
const parallax = new Map();
const [, ...rows] = fs.readFileSync(csv, "utf8").trim().split("\n");
for (const row of rows) {
  const [hip, plx, ePlx] = row.split(",").map(Number);
  if (Number.isFinite(plx) && Number.isFinite(ePlx)) parallax.set(hip, [plx, ePlx]);
}

const data = JSON.parse(fs.readFileSync(starsFile, "utf8"));
let found = 0;
data.stars = data.stars.map((star) => {
  const p = parallax.get(star[0]);
  if (p) found++;
  return [...star.slice(0, 5), ...(p ?? [null, null])];
});
fs.writeFileSync(starsFile, JSON.stringify(data));
console.log(`${found} of ${data.stars.length} stars have a parallax`);
