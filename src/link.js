// Shareable links: where you're standing, when, which way you're looking and
// what you've picked out, kept in the URL fragment so a friend can open exactly
// what you saw. Layer toggles stay out: those are each viewer's own preferences.
//
//   #body=earth&lat=59.91&lon=10.75&tz=Europe/Oslo&t=2026-12-04T19:22:12Z
//    &az=180.0&alt=20.0&fov=80.0&sel=star:Sirius
//
// `body` is the world you're standing on, so lat/lon mean the same thing on
// the Moon or Mars once those exist. Unknown keys are ignored, so links stay
// readable by older and newer versions alike. While the clock follows real
// time, `t` is left out, so the link opens on the moment it's followed.

export const DEFAULT_BODY = "earth";

const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);

/** Parse a location.hash into whatever parts it has (all optional), or null if it's not a link. */
export function readLink(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const link = {};
  link.body = p.get("body")?.toLowerCase() || null;

  const lat = num(p.get("lat"));
  const lon = num(p.get("lon"));
  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    link.place = { lat, lon, tz: p.get("tz") || "" };
  }

  const t = p.get("t");
  if (t) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) link.time = ms;
  }

  const az = num(p.get("az"));
  const alt = num(p.get("alt"));
  const fov = num(p.get("fov"));
  if (az != null || alt != null || fov != null) {
    link.view = {};
    if (az != null) link.view.az = az;
    if (alt != null) link.view.alt = Math.max(-90, Math.min(90, alt));
    if (fov != null) link.view.fov = fov;
  }

  const sel = p.get("sel");
  if (sel) {
    const i = sel.indexOf(":");
    link.selection = i < 0 ? { type: sel } : { type: sel.slice(0, i), id: sel.slice(i + 1) };
  }

  return Object.keys(link).length > 1 || link.body ? link : null;
}

/** Build the fragment (without '#') for the current state. */
export function writeLink({ body = DEFAULT_BODY, place, time, view, selection }) {
  const p = new URLSearchParams();
  p.set("body", body);
  if (place) {
    // About a kilometre: plenty for the sky, and doesn't give away your front door.
    p.set("lat", place.lat.toFixed(2));
    p.set("lon", place.lon.toFixed(2));
    if (place.tz) p.set("tz", place.tz);
  }
  if (time != null) p.set("t", new Date(Math.round(time / 1000) * 1000).toISOString().replace(".000Z", "Z"));
  if (view) {
    p.set("az", view.az.toFixed(1));
    p.set("alt", view.alt.toFixed(1));
    p.set("fov", view.fov < 10 ? view.fov.toFixed(2) : view.fov.toFixed(1));
  }
  if (selection) p.set("sel", selection.id != null ? `${selection.type}:${selection.id}` : selection.type);
  // Slashes and colons read fine in a fragment; keep them unescaped.
  return p.toString().replace(/%2F/gi, "/").replace(/%3A/gi, ":");
}
