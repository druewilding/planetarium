// The page loads three and astronomy-engine straight from a CDN, through the
// import map in index.html. They're also dev dependencies, so the tests run
// against the same code. This writes the versions in package.json into the
// import map, so the two stay in step after an update.
// Usage: npm run importmap

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The import map in a page, as { name: url }. */
export function importMap(html) {
  const [, json] = html.match(/<script type="importmap">([\s\S]*?)<\/script>/) ?? [];
  if (!json) throw new Error("No import map in the page");
  return JSON.parse(json).imports;
}

/** The page with each CDN url pointing at the version in `versions`. */
export function syncImportMap(html, versions) {
  let synced = html;
  for (const [name, url] of Object.entries(importMap(html))) {
    if (!versions[name]) continue;
    const pinned = url.replace(new RegExp(`/${name}@[^/]+/`), `/${name}@${versions[name]}/`);
    synced = synced.replace(url, pinned);
  }
  return synced;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = new URL("../index.html", import.meta.url);
  const { devDependencies } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const html = readFileSync(page, "utf8");
  const synced = syncImportMap(html, devDependencies);
  if (synced === html) {
    console.log("The import map already matches package.json");
  } else {
    writeFileSync(page, synced);
    console.log("Updated the import map:", importMap(synced));
  }
}
