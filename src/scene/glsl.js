// Shared GLSL snippets.

/** Display pipeline: luminance (cd/m²) → exposure → filmic tone map → sRGB. */
export const DISPLAY = /* glsl */ `
uniform float uExposure;
uniform float uScotopic;

float acesCurve(float x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Hue-preserving filmic curve: compress luminance, keep colour, and only roll
// into white once a channel overflows. Twilight glows stay orange instead of
// clipping to white.
vec3 acesFilm(vec3 x) {
  float y = dot(x, vec3(0.2126, 0.7152, 0.0722));
  if (y <= 0.0) return vec3(0.0);
  vec3 o = x * (acesCurve(y) / y);
  float m = max(o.r, max(o.g, o.b));
  if (m > 1.0) {
    float t = min(1.0, (m - 1.0) / 2.0);
    o = o / m * (1.0 - t) + t;
  }
  return clamp(o, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Night vision: colours wash out and shift blue when the eye is dark-adapted.
vec3 scotopic(vec3 c) {
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, y * vec3(0.82, 0.92, 1.18), uScotopic);
}

vec4 display(vec3 luminance) {
  vec3 c = acesFilm(scotopic(luminance) * uExposure);
  c = linearToSrgb(c);
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0; // dither away banding
  return vec4(c, 1.0);
}
`;

/** Sky texture lookup. The sky texture is equirectangular in azimuth, with
 *  altitude packed as sign(alt)·sqrt(|alt|/90°) so the horizon gets detail. */
export const SKY_LOOKUP = /* glsl */ `
uniform sampler2D uSky;

vec2 skyUv(vec3 d) {
  float az = atan(d.x, -d.z);
  float u = fract(az / 6.28318530718);
  float alt = asin(clamp(d.y, -1.0, 1.0));
  float t = sign(alt) * sqrt(abs(alt) / 1.57079632679);
  return vec2(u, 0.5 + 0.5 * t);
}

vec3 skyAt(vec3 d) {
  return texture2D(uSky, skyUv(d)).rgb;
}
`;

/** Atmospheric refraction, applied to directions near the horizon. */
export const REFRACTION = /* glsl */ `
uniform float uRefract;

vec3 refractDir(vec3 d) {
  if (uRefract < 0.5) return d;
  float alt = asin(clamp(d.y, -1.0, 1.0));
  float altDeg = degrees(alt);
  if (altDeg < -89.0) return d;
  float hd = max(altDeg, -1.0);
  float r = 1.02 / tan(radians(hd + 10.3 / (hd + 5.11))) / 60.0;
  if (altDeg < -1.0) r *= (altDeg + 90.0) / 89.0;
  float alt2 = alt + radians(r);
  float h = length(d.xz);
  if (h < 1e-6) return d;
  return vec3(d.x / h * cos(alt2), sin(alt2), d.z / h * cos(alt2));
}
`;

/** Projection (see src/projection.js): perspective when zoomed in, blending into
 *  stereographic for wide views. Depth comes from distance, so the usual
 *  layering (ground in front of stars, Moon in front of Sun) still works. */
export const PROJECTION = /* glsl */ `
uniform float uStereo;
uniform float uProjScale;
uniform float uAspect;

vec4 projectView(vec4 viewPos) {
  if (uStereo <= 0.0) return projectionMatrix * viewPos;
  vec3 p = viewPos.xyz;
  float dist = length(p);
  vec3 d = p / dist;
  float sinT = length(d.xy);
  float theta = atan(sinT, -d.z);
  float rp = tan(min(theta, 1.55));
  float rs = 2.0 * tan(theta * 0.5);
  float r = mix(rp, rs, uStereo);
  vec2 xy = sinT > 1e-6 ? d.xy / sinT * r * uProjScale : vec2(0.0);
  xy.x /= uAspect;
  // Anything too far behind is pushed past the far plane and clipped.
  float limit = mix(1.5, 2.6, uStereo);
  float z = theta > limit ? 2.0 : (dist - 1000.0) / 1100.0;
  return vec4(xy, z, 1.0);
}
`;
