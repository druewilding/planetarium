// On-screen compass, "heading up": the rose turns as you look around, a wedge
// shows the field of view, and the Sun and Moon sit on the rim at their
// azimuths. Drag the rose to turn; tap a direction, the Sun or the Moon to face it.

import { compassPoint } from "../astro.js";

const NS = "http://www.w3.org/2000/svg";
const R = 46;

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
};

export function createCompass(container, { onTurn, onFace, onFaceBody }) {
  const svg = el("svg", { viewBox: "-60 -60 120 120" }, container);
  el("circle", { r: 57, class: "compass-bg" }, svg);
  const wedge = el("path", { class: "compass-fov" }, svg);
  const rose = el("g", {}, svg);
  el("circle", { r: R, class: "compass-ring" }, rose);

  for (let a = 0; a < 360; a += 15) {
    const major = a % 45 === 0;
    const [x0, y0] = polar(a, R);
    const [x1, y1] = polar(a, R - (major ? 6 : 3));
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? "tick major" : "tick" }, rose);
  }

  const letters = [];
  for (const [a, t] of [
    [0, "N"],
    [45, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [225, "SW"],
    [270, "W"],
    [315, "NW"],
  ]) {
    const [x, y] = polar(a, t.length === 1 ? 33 : 35);
    const g = el("g", { class: `dir${t === "N" ? " north" : ""}${t.length > 1 ? " minor" : ""}`, "data-az": a }, rose);
    el("circle", { cx: x, cy: y, r: t.length === 1 ? 8 : 7, class: "hit" }, g);
    const text = el("text", { x, y }, g);
    text.textContent = t;
    letters.push({ g, text, x, y });
    const title = el("title", {}, g);
    title.textContent = `Face ${t}`;
  }

  const bodies = {};
  for (const id of ["sun", "moon"]) {
    const g = el("g", { class: `body ${id}`, "data-body": id }, rose);
    el("circle", { r: 9, class: "hit" }, g);
    el("circle", { r: id === "sun" ? 4.5 : 4, class: "disc" }, g);
    const title = el("title", {}, g);
    title.textContent = `Face the ${id === "sun" ? "Sun" : "Moon"}`;
    bodies[id] = g;
  }

  el("path", { d: "M0,-59 L-5,-50 L5,-50 Z", class: "compass-pointer" }, svg);
  const label = el("text", { y: 1, class: "compass-heading" }, svg);
  const sub = el("text", { y: 12, class: "compass-sub" }, svg);

  // ---- Interaction ----
  let drag = null;
  const angleOf = (e) => {
    const r = svg.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  svg.addEventListener("pointerdown", (e) => {
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    drag = { last: angleOf(e), moved: 0, target: e.target.closest("[data-az], [data-body]") };
    e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const a = angleOf(e);
    let d = a - drag.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.last = a;
    drag.moved += Math.abs(d);
    // Turning the rose clockwise brings what's on your left to the front.
    if (drag.moved > 3) onTurn(-d);
  });
  svg.addEventListener("pointerup", () => {
    if (drag && drag.moved <= 3 && drag.target) {
      if (drag.target.dataset.body) onFaceBody(drag.target.dataset.body);
      else onFace(Number(drag.target.dataset.az));
    }
    drag = null;
  });
  svg.addEventListener("pointercancel", () => (drag = null));

  // ---- Per-frame update ----
  let last = "";
  function update({ az, alt, hfov, sunAz, sunAlt, moonAz, moonAlt }) {
    const key = `${az.toFixed(1)}|${hfov.toFixed(1)}|${sunAz.toFixed(1)}|${moonAz.toFixed(1)}|${sunAlt > 0}|${moonAlt > 0}|${alt.toFixed(0)}`;
    if (key === last) return;
    last = key;
    rose.setAttribute("transform", `rotate(${-az})`);
    // Keep letters upright while the rose turns.
    for (const l of letters) l.text.setAttribute("transform", `rotate(${az} ${l.x} ${l.y})`);
    const half = Math.min(179, hfov / 2);
    const [x0, y0] = polar(-half, 55);
    const [x1, y1] = polar(half, 55);
    wedge.setAttribute("d", `M0,0 L${x0},${y0} A55,55 0 ${half > 90 ? 1 : 0} 1 ${x1},${y1} Z`);
    const place = (g, a, up) => {
      const [x, y] = polar(a, R);
      g.setAttribute("transform", `translate(${x} ${y})`);
      g.classList.toggle("below", !up);
    };
    place(bodies.sun, sunAz, sunAlt > 0);
    place(bodies.moon, moonAz, moonAlt > 0);
    label.textContent = `${Math.round(az) % 360}°`;
    sub.textContent = `${compassPoint(az)} · ${alt >= 0 ? "↑" : "↓"}${Math.abs(Math.round(alt))}°`;
  }

  return { update };
}
