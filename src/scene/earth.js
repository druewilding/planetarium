// The Earth seen from above: drawn into the sky like everything else, so the
// stars, the Moon, the labels and the lines all stay where they are as you rise.
//
// It's a shell around the viewer (in front of the sky, the Sun and the Moon),
// and each pixel works out where its line of sight meets the Earth: exactly, so
// the horizon stays smooth however low you are. Brightness is in cd/m² like the
// rest of the sky, so the eye adapts to it the same way.

import * as THREE from "three";

import { EARTH_RADIUS_KM, MOON_RADIUS_KM, SUN_RADIUS_KM } from "../constants.js";

const SHELL = 920; // in front of the Sun (990), the Moon (980) and the stars, behind the ground (900)

export function createEarth(shared, glsl) {
  const uniforms = {
    ...shared,
    uDay: { value: null },
    uNight: { value: null },
    uOcean: { value: null },
    uReady: { value: 0 },
    uEarthDir: { value: new THREE.Vector3(0, -1, 0) }, // from you to the Earth's centre
    uHeight: { value: 0 }, // above the ground, in Earth radii
    uToEarth: { value: new THREE.Matrix3() }, // view frame → the Earth's own axes
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunE: { value: 0 }, // sunlight on the Earth, lux
    uSunDist: { value: 23455 }, // to the Sun, in Earth radii
    uMoonPos: { value: new THREE.Vector3(0, 0, 60) }, // the Moon, from the Earth's centre, in Earth radii
    uAirGlow: { value: 1 }, // 1 while you're in the air and the sky glows around you, 0 in space
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${glsl.PROJECTION}
      varying vec3 vClip;
      void main() {
        gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
        vClip = gl_Position.xyw;
      }
    `,
    fragmentShader: /* glsl */ `
      ${glsl.DISPLAY}
      ${glsl.SKY_LOOKUP}
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform sampler2D uOcean;
      uniform float uReady;
      uniform vec3 uEarthDir;
      uniform float uHeight;
      uniform mat3 uToEarth;
      uniform vec3 uSunDir;
      uniform float uSunE;
      uniform float uSunDist;
      uniform vec3 uMoonPos;

      // How much of the Sun shows from a point p on the Earth (in Earth radii, from
      // its centre): where the Moon covers it, that's the Moon's shadow. The
      // overlap of the two discs, as in astro.js sunVisibleFraction.
      float sunShowing(vec3 p) {
        vec3 s = uSunDir * uSunDist - p;
        vec3 m = uMoonPos - p;
        if (dot(s, m) <= 0.0) return 1.0;
        float rs = ${(SUN_RADIUS_KM / EARTH_RADIUS_KM).toFixed(4)} / length(s);
        float rm = ${(MOON_RADIUS_KM / EARTH_RADIUS_KM).toFixed(6)} / length(m);
        float d = atan(length(cross(s, m)), dot(s, m)); // (keeps its precision at small angles)
        if (d >= rs + rm) return 1.0;
        if (d <= rm - rs) return 0.0; // total
        if (d <= rs - rm) return 1.0 - (rm * rm) / (rs * rs); // annular
        float a1 = rs * rs * acos(clamp((d * d + rs * rs - rm * rm) / (2.0 * d * rs), -1.0, 1.0));
        float a2 = rm * rm * acos(clamp((d * d + rm * rm - rs * rs) / (2.0 * d * rm), -1.0, 1.0));
        float a3 = 0.5 * sqrt(max(0.0, (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm)));
        return 1.0 - (a1 + a2 - a3) / (3.14159265 * rs * rs);
      }
      uniform float uAirGlow;
      uniform float uStereo;
      uniform float uProjScale;
      uniform float uAspect;
      varying vec3 vClip;

      // The line of sight through this pixel, worked out from where the pixel is
      // on screen (the projection, undone as in projection.js unproject). Blending
      // it from the shell's corners instead is slightly off inside each triangle
      // once the view curves (stereographic), and the Earth shows the facets.
      vec3 lineOfSight() {
        vec2 ndc = vClip.xy / vClip.z;
        vec2 p = vec2(ndc.x * uAspect, ndc.y);
        float rho = length(p);
        float r = rho / uProjScale;
        float theta;
        if (uStereo <= 0.0) theta = atan(r);
        else {
          float lo = 0.0;
          float hi = mix(1.5, 2.6, uStereo);
          for (int i = 0; i < 24; i++) {
            float mid = 0.5 * (lo + hi);
            if (mix(tan(min(mid, 1.55)), 2.0 * tan(0.5 * mid), uStereo) < r) lo = mid;
            else hi = mid;
          }
          theta = 0.5 * (lo + hi);
        }
        vec3 v = rho < 1e-9 ? vec3(0.0, 0.0, -1.0) : vec3(p / rho * sin(theta), -cos(theta));
        return normalize(v * mat3(viewMatrix)); // (view → world: the rotation's transpose)
      }

      // Close up, one pixel of a map covers many of the screen, and plain (bilinear)
      // filtering shows them as squares, which the city lights make worse. There,
      // a smooth (cubic B-spline) filter instead, from four bilinear lookups (only
      // there: it's four times the work). gx, gy: uv's gradients across the screen.
      const vec2 MAP = vec2(2048.0, 1024.0);
      vec4 smoothly(sampler2D map, vec2 uv, vec2 gx, vec2 gy) {
        vec2 st = uv * MAP - 0.5;
        vec2 i = floor(st);
        vec2 f = st - i;
        vec2 f2 = f * f;
        vec2 f3 = f2 * f;
        vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
        vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
        vec2 w3 = f3 / 6.0;
        vec2 g0 = w0 + w1;
        vec2 g1 = 1.0 - g0;
        vec2 h0 = (i - 0.5 + w1 / g0) / MAP;
        vec2 h1 = (i + 1.5 + w3 / g1) / MAP;
        return g0.y * (g0.x * textureGrad(map, vec2(h0.x, h0.y), gx, gy) + g1.x * textureGrad(map, vec2(h1.x, h0.y), gx, gy))
             + g1.y * (g0.x * textureGrad(map, vec2(h0.x, h1.y), gx, gy) + g1.x * textureGrad(map, vec2(h1.x, h1.y), gx, gy));
      }
      vec4 mapAt(sampler2D map, vec2 uv, vec2 gx, vec2 gy, bool close) {
        return close ? smoothly(map, uv, gx, gy) : textureGrad(map, uv, gx, gy);
      }
      // The whole map's average (its smallest mipmap).
      vec4 average(sampler2D map) {
        return textureLod(map, vec2(0.5), 20.0);
      }
      const float PI = 3.14159265359;
      void main() {
        vec3 d = lineOfSight();
        // Where the line of sight meets a sphere of radius 1, centred 1 + h away.
        // (c is written as h(2 + h), not k² − 1, to keep precision close to the ground.)
        float k = 1.0 + uHeight;
        float b = dot(d, uEarthDir) * k;
        float c = uHeight * (2.0 + uHeight);
        float disc = b * b - c;
        if (disc <= 0.0 || b <= 0.0) discard;
        vec3 n = normalize(d * (b - sqrt(disc)) - uEarthDir * k);

        // On the maps: 180° W at the left edge, the North Pole at the top. Where the
        // edges meet the longitude jumps, which smears a seam; shifting it half a turn
        // moves the jump elsewhere, so use whichever doesn't jump at this pixel.
        vec3 p = uToEarth * n;
        float u = 0.5 + atan(p.y, p.x) / (2.0 * PI);
        float u2 = fract(u + 0.5) - 0.5;
        if (fwidth(u2) < fwidth(u) - 0.001) u = u2;
        vec2 uv = vec2(u, 0.5 + asin(clamp(p.z, -1.0, 1.0)) / PI);

        // Low down, a pixel of the map spans far more than a pixel of screen: blur it
        // (a coarser mipmap) rather than show its squares.
        float km = uHeight * ${EARTH_RADIUS_KM.toFixed(1)};
        float blur = clamp(6.0 - log2(max(km, 0.01) / 2.0), 0.0, 9.0);
        // Lower still, the maps (about 20 km a pixel) just smear into blotches: the
        // land, and the city lights (later, being starker), only come in once you're
        // high enough to see them as a whole. Until then, the Earth's average colour.
        float detail = smoothstep(200.0, 2500.0, km);
        float cities = smoothstep(1000.0, 5000.0, km);
        // (Worked out here, where every pixel does it, for the lookups below, which
        // only some pixels need.)
        vec2 gx = dFdx(uv) * exp2(blur);
        vec2 gy = dFdy(uv) * exp2(blur);
        bool close = max(length(gx * MAP), length(gy * MAP)) < 0.5; // a map pixel over two or more of the screen's

        float sun = dot(n, uSunDir);
        // Under the Moon's shadow, less: squared, so the soft outer shadow (where the
        // Sun is partly covered) reads as clearly as it does in photos from space.
        float shown = sunShowing(n);
        shown *= shown;
        float lit = smoothstep(-0.1, 0.2, sun);
        vec3 day = average(uDay).rgb;
        if (detail > 0.0 && sun > -0.1) day = mix(day, mapAt(uDay, uv, gx, gy, close).rgb, detail);
        vec3 albedo = pow(day, vec3(2.2)) * 0.9;
        vec3 L = albedo * uSunE / PI * max(sun, 0.0) * lit * shown;
        // The Sun's reflection off the sea.
        vec3 r = reflect(-uSunDir, n);
        float glint = pow(max(dot(r, -d), 0.0), 80.0) * lit;
        if (glint > 0.0) {
          float ocean = average(uOcean).r;
          if (detail > 0.0) ocean = mix(ocean, mapAt(uOcean, uv, gx, gy, close).r, detail);
          L += ocean * glint * uSunE * 0.004 * shown;
        }
        // City lights where it's dark, without the map's dim blue land behind them.
        float dark = (1.0 - smoothstep(-0.12, 0.04, sun)) * cities;
        if (dark > 0.0) {
          vec3 lights = max(mapAt(uNight, uv, gx, gy, close).rgb - vec3(0.12, 0.12, 0.2), 0.0);
          // (Never dimmer than shows on screen: with a sunlit crescent in view the eye
          // adapts to that, and the lights, at their true brightness, would vanish.)
          float glow = max(3.0, 0.5 / max(uExposure, 1e-6));
          L += pow(lights, vec3(1.4)) * vec3(1.0, 0.8, 0.55) * glow * dark;
        }
        // The air: blue haze, strongest towards the edge on the day side.
        float rim = pow(1.0 - max(dot(n, -d), 0.0), 4.0);
        L += vec3(0.25, 0.45, 1.0) * uSunE / PI * 0.04 * (0.2 + 1.5 * rim) * smoothstep(-0.2, 0.3, sun) * shown;
        L = mix(vec3(0.02, 0.025, 0.04) * uSunE / PI * 0.05, L, uReady);
        // Looking through the air: the land fades into the haze along the horizon,
        // the more air the line of sight crosses (all of it near the ground; from
        // space, just the layer near the surface, thicker towards the edge).
        float dist = (b - sqrt(disc)) * ${EARTH_RADIUS_KM.toFixed(1)}; // km to the ground
        float slant = 8.0 / max(dot(n, -d), 0.03); // km of dense air above that spot, along the line of sight
        float haze = (1.0 - exp(-min(dist, slant) / 150.0)) * uAirGlow;
        L = mix(L, skyAt(normalize(vec3(d.x, 0.003, d.z))), haze);
        gl_FragColor = display(L);
      }
    `,
    side: THREE.BackSide,
    depthWrite: true,
  });
  material.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SHELL, 96, 48), material);
  mesh.renderOrder = -5; // after the sky, before everything it hides
  mesh.frustumCulled = false;
  mesh.visible = false;

  /**
   * Load the maps (the first time you rise). If they don't come (offline, say),
   * the Earth stays plain, and the next time you rise they're tried again.
   */
  let loading = null;
  function load(loadTextures, renderer) {
    loading ??= loadTextures()
      .then((maps) => {
        for (const t of maps) {
          t.colorSpace = THREE.NoColorSpace;
          t.wrapS = THREE.RepeatWrapping; // see the seam note in the shader
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        [uniforms.uDay.value, uniforms.uNight.value, uniforms.uOcean.value] = maps;
        uniforms.uReady.value = 1;
      })
      .catch((err) => {
        console.warn("Couldn't load the Earth's maps", err);
        loading = null;
      });
    return loading;
  }

  /**
   * earthDir: world direction to the Earth's centre; heightRadii: how high you are;
   * toEarth: Matrix3 from the world frame to the Earth's own axes; sunDir, sunE.
   */
  /** sunDist: to the Sun, and moonPos: the Moon from the Earth's centre (world frame), both in Earth radii. */
  function update({ earthDir, heightRadii, toEarth, sunDir, sunE, airGlow = 0, sunDist, moonPos }) {
    if (sunDist) uniforms.uSunDist.value = sunDist;
    if (moonPos) uniforms.uMoonPos.value.copy(moonPos);
    uniforms.uAirGlow.value = airGlow;
    uniforms.uEarthDir.value.copy(earthDir);
    uniforms.uHeight.value = heightRadii;
    uniforms.uToEarth.value.copy(toEarth);
    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uSunE.value = sunE;
  }

  return { mesh, load, update };
}
