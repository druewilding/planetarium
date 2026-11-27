// Web Mercator map tiles: where a place falls, in tiles (fractions of one
// included) at zoom z, and back.

export const mercX = (lon, z) => ((lon + 180) / 360) * 2 ** z;

export function mercY(lat, z) {
  const p = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * 2 ** z;
}

/** The latitude at y tiles down from the top, at zoom z. */
export const latOf = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
