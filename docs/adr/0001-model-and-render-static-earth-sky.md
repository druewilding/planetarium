# 0001: Use local astronomy calculations and separate sky and globe renderers

Status: Accepted
Date: 2026-11-22
Author: Frontend Implementer

## Context
Earth Sky needs a responsive apparent-sky display and an Earth–Moon scene without exposing coordinates, depending on a runtime astronomy service, or requiring a backend. A phone must still be able to use the sky and readouts when the 3D renderer is not available. Civil clock rules and identifying a zone from coordinates are separate data problems.

## Decision
Use Astronomy Engine 2.1.19 behind pure model functions, Canvas 2D for the local sky, and Three.js 0.187.0 for the WebGL 2 globe with World Atlas 2.0.2 / TopoJSON Client 3.1.0 for land outlines. Use browser `Intl` rules for curated city zones and explicitly fall back to UTC for coordinates without a sourced zone match. Pin versions in npm's lockfile, build a relative static bundle with esbuild 0.28.2, and use Node's test runner with Playwright Core 1.65.1 driving installed Chrome for browser smoke tests.

## Alternatives considered
- Handwrite ephemerides and WebGL machinery: more numerical and rendering risk than audited upstream packages.
- Use one WebGL renderer for everything: simpler scene transitions, but loses the surface sky on devices without WebGL 2.
- Guess a zone from a nearest city, longitude, or compressed global polygons: gives unwarranted confidence offshore and across borders; global data also needs source-license and coverage review.
- Use runtime APIs or a CDN: adds external availability and privacy dependencies; Pages only needs static files.

## Consequences
The model is locally testable and coordinates never enter a URL or request body. Two renderers need an explicit transition; the real-scale globe may not naturally frame both bodies, so the overview changes scale and is labeled. The minified bundle is roughly 670 KiB before transfer compression; phone frame-time and broader renderer compatibility still need testing. Arbitrary coordinates have no inferred civil zone until a vetted offline dataset is selected. Astronomy Engine and World Atlas had no recent npm releases in the consulted metadata; monitor advisories and upstream activity before release.
