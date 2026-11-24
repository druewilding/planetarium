// The Earth seen from above: drawn into the sky like everything else, so the
// stars, the Moon, the labels and the lines all stay where they are as you rise.
//
// It's a shell around the viewer (in front of the sky, the Sun and the Moon),
// and each pixel works out where its line of sight meets the Earth: exactly, so
// the horizon stays smooth however low you are. Brightness is in cd/m² like the
// rest of the sky, so the eye adapts to it the same way.

import * as THREE from "three";

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
    uAirGlow: { value: 1 }, // 1 while you're in the air and the sky glows around you, 0 in space
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${glsl.PROJECTION}
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectView(modelViewMatrix * vec4(position, 1.0));
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
      uniform float uAirGlow;
      varying vec3 vDir;
      const float PI = 3.14159265359;
      void main() {
        vec3 d = normalize(vDir);
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
        float km = uHeight * 6371.0;
        float blur = clamp(6.0 - log2(max(km, 0.01) / 2.0), 0.0, 9.0);

        float sun = dot(n, uSunDir);
        float lit = smoothstep(-0.1, 0.2, sun);
        vec3 albedo = pow(texture2D(uDay, uv, blur).rgb, vec3(2.2)) * 0.9;
        vec3 L = albedo * uSunE / PI * max(sun, 0.0) * lit;
        // The Sun's reflection off the sea.
        float ocean = texture2D(uOcean, uv, blur).r;
        vec3 r = reflect(-uSunDir, n);
        L += ocean * pow(max(dot(r, -d), 0.0), 80.0) * uSunE * 0.004 * lit;
        // City lights where it's dark, without the map's dim blue land behind them.
        vec3 lights = max(texture2D(uNight, uv, blur).rgb - vec3(0.12, 0.12, 0.2), 0.0);
        // (Never dimmer than shows on screen: with a sunlit crescent in view the eye
        // adapts to that, and the lights, at their true brightness, would vanish.)
        float glow = max(3.0, 0.5 / max(uExposure, 1e-6));
        L += pow(lights, vec3(1.4)) * vec3(1.0, 0.8, 0.55) * glow * (1.0 - smoothstep(-0.12, 0.04, sun));
        // The air: blue haze, strongest towards the edge on the day side.
        float rim = pow(1.0 - max(dot(n, -d), 0.0), 4.0);
        L += vec3(0.25, 0.45, 1.0) * uSunE / PI * 0.04 * (0.2 + 1.5 * rim) * smoothstep(-0.2, 0.3, sun);
        L = mix(vec3(0.02, 0.025, 0.04) * uSunE / PI * 0.05, L, uReady);
        // Looking through the air: the land fades into the haze along the horizon,
        // the more air the line of sight crosses (all of it near the ground; from
        // space, just the layer near the surface, thicker towards the edge).
        float dist = (b - sqrt(disc)) * 6371.0; // km to the ground
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

  /** Load the maps (the first time you rise). */
  let loading = null;
  function load(loadTextures, renderer) {
    loading ??= loadTextures().then((maps) => {
      for (const t of maps) {
        t.colorSpace = THREE.NoColorSpace;
        t.wrapS = THREE.RepeatWrapping; // see the seam note in the shader
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      [uniforms.uDay.value, uniforms.uNight.value, uniforms.uOcean.value] = maps;
      uniforms.uReady.value = 1;
    });
    return loading;
  }

  /**
   * earthDir: world direction to the Earth's centre; heightRadii: how high you are;
   * toEarth: Matrix3 from the world frame to the Earth's own axes; sunDir, sunE.
   */
  function update({ earthDir, heightRadii, toEarth, sunDir, sunE, airGlow = 0 }) {
    uniforms.uAirGlow.value = airGlow;
    uniforms.uEarthDir.value.copy(earthDir);
    uniforms.uHeight.value = heightRadii;
    uniforms.uToEarth.value.copy(toEarth);
    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uSunE.value = sunE;
  }

  return { mesh, load, update };
}
