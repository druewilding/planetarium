// How high you are, second by second, as you rise off the ground (and, run
// backwards, as you come back down).
//
// It's worked out in powers of ten, so a kilometre near the ground counts as much
// as a thousand far out, and shaped so something happens at once: you're a
// kilometre up within half a second, so the hills are already falling away; ten
// kilometres up a second later; then the sky darkens to black through the next
// hundred; and the rest is a long glide out, slowing to a stop.

export const GROUND_KM = 0.002; // eye height, standing

/** [seconds, log10(km)]: the start of every climb. */
const KEYS = [
  [0, Math.log10(GROUND_KM)],
  [0.4, 0], // 1 km
  [1.2, 1], // 10 km
  [2.1, Math.log10(40)],
  [3.5, Math.log10(120)], // above the air: the sky has turned black
];
const SECONDS_PER_DECADE = 1.5; // after that

/**
 * A climb from the ground to `topKm`: { duration (s), kmAt(seconds) }. To come
 * down, run it backwards: kmAt(duration − seconds).
 */
export function climb(topKm) {
  const top = Math.log10(Math.max(topKm, GROUND_KM));
  const keys = [KEYS[0]];
  for (const [t, v] of KEYS.slice(1)) {
    const [pt, pv] = keys[keys.length - 1];
    if (v >= top) {
      keys.push([pt + ((t - pt) * (top - pv)) / (v - pv), top]);
      break;
    }
    keys.push([t, v]);
  }
  const [lt, lv] = keys[keys.length - 1];
  if (lv < top) keys.push([lt + SECONDS_PER_DECADE * (top - lv), top]);
  if (keys.length < 2 || keys[keys.length - 1][0] <= 0) return { duration: 0, kmAt: () => 10 ** top };

  // A smooth curve through the keys that never overshoots (Fritsch–Carlson): off
  // at full speed, easing to a stop at the top.
  const n = keys.length;
  const slope = [];
  for (let i = 0; i < n - 1; i++) slope.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  // (Off the ground faster still: you're tens of metres up in a tenth of a second.)
  const tangent = keys.map((_, i) => (i === 0 ? 2 * slope[0] : i === n - 1 ? 0 : (slope[i - 1] + slope[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const r = a * a + b * b;
    if (r > 9) {
      tangent[i] *= 3 / Math.sqrt(r);
      tangent[i + 1] *= 3 / Math.sqrt(r);
    }
  }
  const duration = keys[n - 1][0];

  function kmAt(seconds) {
    const t = Math.min(duration, Math.max(0, seconds));
    let i = 0;
    while (i < n - 2 && t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    const h = t1 - t0;
    const s = (t - t0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const v =
      (2 * s3 - 3 * s2 + 1) * v0 +
      (s3 - 2 * s2 + s) * h * tangent[i] +
      (-2 * s3 + 3 * s2) * v1 +
      (s3 - s2) * h * tangent[i + 1];
    return 10 ** v;
  }
  return { duration, kmAt };
}
