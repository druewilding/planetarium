// Layers panel (toggles, remembered per browser) and the object search box.

import { ORBIT_COLORS } from "../scene/orbits.js";
import { OVERLAY_COLORS } from "../scene/overlays.js";
import { VERSION } from "../version.js";

// Some layers only make sense standing on the ground, and some only up in space
// (`where`); the panel shows the ones for where you are.

export const LAYER_GROUPS = [
  {
    title: "Sky",
    items: [
      { key: "milkyWay", label: "Milky Way", hint: "Shows up on dark, moonless nights, or with the Sun dimmed" },
      { key: "atmosphere", label: "Atmosphere", hint: "Turn off to see a Moon-like black sky" },
      {
        key: "ground",
        where: "ground",
        label: "Solid ground",
        hint: "Turn off to see through the earth: the sky below is always dark, with the hills outlined",
      },
      {
        key: "terrain",
        where: "ground",
        label: "Hills & mountains",
        hint: "The real skyline around you, from elevation maps (Terrain Tiles: SRTM, EU-DEM, Kartverket and others). Needs a connection",
      },
      { key: "refraction", where: "ground", label: "Refraction near horizon" },
      {
        key: "bigBodies",
        label: "Enlarge Sun & Moon",
        hint: "Zoomed out, a true-size Moon is a speck on a screen. Zoom in to see its real size",
      },
    ],
  },
  {
    title: "Labels",
    items: [
      { key: "planetLabels", label: "Sun, Moon & planets" },
      { key: "starNames", label: "Star names" },
      { key: "constellationNames", label: "Constellation names" },
      {
        key: "peakNames",
        where: "ground",
        label: "Mountain names",
        color: "#8fe39a",
        hint: "Named peaks you can see from here. Names © OpenStreetMap contributors",
      },
      {
        key: "placeNames",
        where: "ground",
        label: "Places & landmarks",
        color: "#dcc2ff",
        hint: "Towns, villages, lighthouses, observatories, towers and masts you can see from here. © OpenStreetMap contributors",
      },
      { key: "compass", where: "ground", label: "Horizon & compass", color: OVERLAY_COLORS.horizon },
      { key: "spot", where: "space", label: "Where you came from", color: "var(--accent)" },
      { key: "monthMarks", where: "space", label: "Months along the Earth’s orbit", color: ORBIT_COLORS.earth },
    ],
  },
  {
    title: "Lines",
    items: [
      { key: "constellations", label: "Constellation figures", color: OVERLAY_COLORS.constellations },
      { key: "sunPath", where: "ground", label: "Sun’s path today", color: OVERLAY_COLORS.sunPath },
      { key: "seasonPaths", where: "ground", label: "Solstice & equinox paths", color: OVERLAY_COLORS.juneSolstice },
      { key: "moonPath", where: "ground", label: "Moon’s path (±12 h)", color: OVERLAY_COLORS.moonPath },
      { key: "moonOrbit", where: "space", label: "Moon’s orbit round the Earth", color: ORBIT_COLORS.moon },
      { key: "earthOrbit", where: "space", label: "Earth’s orbit round the Sun", color: ORBIT_COLORS.earth },
      { key: "planetOrbits", where: "space", label: "Planets’ orbits", color: ORBIT_COLORS.Mars },
      {
        key: "moonOrbits",
        label: "Moons’ orbits round their planets",
        color: ORBIT_COLORS.Jupiter,
        hint: "Zoom in close to a planet to see them",
      },
      { key: "ecliptic", label: "Ecliptic (planets’ highway)", color: OVERLAY_COLORS.ecliptic },
      { key: "equator", label: "Celestial equator", color: OVERLAY_COLORS.equator },
      { key: "altAzGrid", where: "ground", label: "Altitude / azimuth grid", color: OVERLAY_COLORS.altAzGrid },
      { key: "eqGrid", label: "RA / Dec grid", color: OVERLAY_COLORS.eqGrid },
    ],
  },
];

export const DEFAULT_LAYERS = {
  milkyWay: true,
  atmosphere: true,
  ground: true,
  terrain: true,
  refraction: true,
  bigBodies: true,
  planetLabels: true,
  starNames: true,
  constellationNames: true,
  peakNames: true,
  placeNames: true,
  compass: true,
  constellations: true,
  sunPath: true,
  seasonPaths: false,
  moonPath: false,
  spot: true,
  monthMarks: true,
  moonOrbit: true,
  earthOrbit: true,
  planetOrbits: true,
  moonOrbits: true,
  ecliptic: false,
  equator: false,
  altAzGrid: false,
  eqGrid: false,
};

const STORAGE_KEY = "planetarium.layers.v1";

function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_LAYERS, ...saved };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

export function createLayersPanel({ onChange }) {
  const layers = loadLayers();
  const panel = document.getElementById("layers");
  const content = document.getElementById("layers-content");
  const rows = []; // { where, el }, to show the ones for where you are
  for (const group of LAYER_GROUPS) {
    const h = document.createElement("h3");
    h.textContent = group.title;
    content.appendChild(h);
    for (const item of group.items) {
      const label = document.createElement("label");
      label.className = "toggle";
      rows.push({ where: item.where, el: label });
      if (item.hint) label.title = item.hint;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = layers[item.key];
      input.addEventListener("change", () => {
        layers[item.key] = input.checked;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(layers));
        } catch {
          /* storage unavailable */
        }
        onChange(layers);
      });
      const span = document.createElement("span");
      span.textContent = item.label;
      label.append(input, span);
      if (item.color) {
        const sw = document.createElement("i");
        sw.className = "swatch";
        sw.style.background = item.color;
        label.appendChild(sw);
      }
      content.appendChild(label);
    }
  }

  // Which version this is, linking to what's new in it.
  const version = document.createElement("p");
  version.className = "version";
  const notes = document.createElement("a");
  notes.href = `https://github.com/druewilding/planetarium/releases/tag/v${VERSION}`;
  notes.target = "_blank";
  notes.rel = "noopener";
  notes.title = "What's new in this version";
  notes.textContent = `Planetarium ${VERSION}`;
  version.appendChild(notes);
  content.appendChild(version);

  const btn = document.getElementById("layers-btn");
  const toggle = (open = panel.hidden) => {
    panel.hidden = !open;
    btn.setAttribute("aria-pressed", String(open));
  };
  btn.addEventListener("click", () => toggle());
  panel.querySelector("[data-close]").addEventListener("click", () => toggle(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) toggle(false);
  });

  /** Show the layers for standing on the ground ("ground") or being up in space ("space"). */
  function setPlace(place) {
    for (const r of rows) r.el.hidden = !!r.where && r.where !== place;
    panel.querySelector("h2").textContent = place === "space" ? "Layers in space" : "Layers";
  }
  setPlace("ground");

  onChange(layers);
  return { layers, setPlace };
}

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** items: [{ name, kind, select() }] */
export function createSearch(items) {
  const input = document.getElementById("search");
  const list = document.getElementById("search-results");
  const records = items.map((it) => ({ ...it, key: fold(it.name) }));
  let matches = [];
  let active = 0;

  function render() {
    list.replaceChildren(
      ...matches.map((m, i) => {
        const li = document.createElement("li");
        li.setAttribute("aria-selected", String(i === active));
        const a = document.createElement("span");
        a.textContent = m.name;
        const b = document.createElement("small");
        b.textContent = m.kind;
        li.append(a, b);
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          choose(m);
        });
        return li;
      })
    );
    list.hidden = matches.length === 0;
  }

  function choose(m) {
    m.select();
    input.value = "";
    matches = [];
    render();
    input.blur();
  }

  input.addEventListener("input", () => {
    const q = fold(input.value.trim());
    if (!q) matches = [];
    else {
      const here = records.filter((r) => !r.shown || r.shown());
      const starts = here.filter((r) => r.key.startsWith(q) || r.key.split(/\s+/).some((w) => w.startsWith(q)));
      const contains = here.filter((r) => !starts.includes(r) && r.key.includes(q));
      matches = [...starts, ...contains].slice(0, 8);
    }
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!matches.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      input.value = "";
      matches = [];
      render();
      input.blur();
    }
  });
  // Cmd-K, from anywhere: straight to the box. (Ctrl-K off a Mac, but not while typing
  // somewhere else; and never on a Mac, where Ctrl-K deletes to the end of the line.)
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  window.addEventListener("keydown", (e) => {
    const typing = e.target !== input && e.target.closest?.("input, textarea, select, [contenteditable]");
    const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey && !typing;
    if (command && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  input.addEventListener("focus", () => render());
}
