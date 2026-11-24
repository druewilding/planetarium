// There's no build step: the browser loads the files as they are. So instead
// of building, check that everything the page asks for is there, and that the
// libraries it loads from the CDN are the ones the tests ran against.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { importMap } from "../tools/sync-importmap.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const html = read("index.html");
const pkg = JSON.parse(read("package.json"));

const sources = readdirSync(join(root, "src"), { recursive: true })
  .filter((file) => file.endsWith(".js"))
  .map((file) => join("src", file));

describe("the page", () => {
  test("loads files that exist", () => {
    const local = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(([, path]) => path);
    expect(local).toContain("src/main.js");
    for (const path of local) expect(existsSync(join(root, path)), path).toBe(true);
  });

  test("loads data and textures that exist", () => {
    const loaded = sources.flatMap((file) =>
      [...read(file).matchAll(/["'`]((?:data|textures)\/[\w./-]+)["'`]/g)].map(([, path]) => path)
    );
    expect(loaded).toContain("data/stars.json");
    for (const path of loaded) expect(existsSync(join(root, path)), path).toBe(true);
  });

  test("imports modules that exist", () => {
    for (const file of sources) {
      for (const [, path] of read(file).matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = join(dirname(file), path);
        expect(existsSync(join(root, target)), `${file} imports ${relative(".", target)}`).toBe(true);
      }
    }
  });

  test("deploys every folder and file it loads", () => {
    const [, copied] = read(".github/workflows/deploy-please.yml").match(/cp -R (.+) _site\//);
    const deployed = copied.split(" ");
    const loaded = [
      ...[...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(([, path]) => path),
      ...sources.flatMap((file) =>
        [...read(file).matchAll(/["'`]((?:data|textures)\/[\w./-]+)["'`]/g)].map(([, p]) => p)
      ),
    ];
    for (const path of loaded) expect(deployed, path).toContain(path.split("/")[0]);
  });

  test.each(Object.entries(importMap(html)))("loads %s from the CDN at the version in package.json", (name, url) => {
    const version = pkg.devDependencies[name];
    expect(version, `${name} should be a dev dependency, so the tests can use it`).toBeDefined();
    expect(url, "run `npm run importmap` to update index.html").toContain(`/${name}@${version}/`);
  });
});
