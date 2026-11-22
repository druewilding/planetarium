// Layers panel (toggles, remembered per browser) and the object search box.

import { OVERLAY_COLORS } from "../scene/overlays.js";

export const LAYER_GROUPS = [
  {
    title: "Sky",
    items: [
      { key: "milkyWay", label: "Milky Way", hint: "Shows up on dark, moonless nights, or with the Sun dimmed" },
      { key: "atmosphere", label: "Atmosphere", hint: "Turn off to see a Moon-like black sky" },
      { key: "ground", label: "Solid ground", hint: "Turn off to see below the horizon" },
      {
        key: "terrain",
        label: "Hills & mountains",
        hint: "The real skyline around you, from elevation maps (Terrain Tiles: SRTM, EU-DEM, Kartverket and others). Needs a connection",
      },
      { key: "refraction", label: "Refraction near horizon" },
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
        label: "Mountain names",
        color: "#8fe39a",
        hint: "Named peaks you can see from here. Names © OpenStreetMap contributors",
      },
      { key: "compass", label: "Horizon & compass", color: OVERLAY_COLORS.horizon },
    ],
  },
  {
    title: "Lines",
    items: [
      { key: "constellations", label: "Constellation figures", color: OVERLAY_COLORS.constellations },
      { key: "sunPath", label: "Sun’s path today", color: OVERLAY_COLORS.sunPath },
      { key: "seasonPaths", label: "Solstice & equinox paths", color: OVERLAY_COLORS.juneSolstice },
      { key: "moonPath", label: "Moon’s path (±12 h)", color: OVERLAY_COLORS.moonPath },
      { key: "ecliptic", label: "Ecliptic (planets’ highway)", color: OVERLAY_COLORS.ecliptic },
      { key: "equator", label: "Celestial equator", color: OVERLAY_COLORS.equator },
      { key: "altAzGrid", label: "Altitude / azimuth grid", color: OVERLAY_COLORS.altAzGrid },
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
  compass: true,
  constellations: true,
  sunPath: true,
  seasonPaths: false,
  moonPath: false,
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
  for (const group of LAYER_GROUPS) {
    const h = document.createElement("h3");
    h.textContent = group.title;
    content.appendChild(h);
    for (const item of group.items) {
      const label = document.createElement("label");
      label.className = "toggle";
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

  onChange(layers);
  return { layers };
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
      const starts = records.filter((r) => r.key.startsWith(q) || r.key.split(/\s+/).some((w) => w.startsWith(q)));
      const contains = records.filter((r) => !starts.includes(r) && r.key.includes(q));
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
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  input.addEventListener("focus", () => render());
}
