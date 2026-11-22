// DOM labels positioned over the canvas. Each frame the app submits a list of
// candidate labels; higher-priority labels claim screen space first and
// overlapping lower-priority ones are hidden.

const CELL_W = 40;
const CELL_H = 16;

export function createLabels(container) {
  const elements = new Map(); // key → { el, text, cls }
  let width = 0;
  let height = 0;

  function resize(w, h) {
    width = w;
    height = h;
  }

  /**
   * items: [{ key, text, dir (world Vector3 unit), cls, priority, offset: [dx, dy], always }]
   */
  /** project(dir) → normalised device coords {x, y}, or null when not drawn. */
  function render(items, project) {
    items.sort((a, b) => b.priority - a.priority);
    const occupied = new Set();
    const used = new Set();
    for (const it of items) {
      const p = project(it.dir);
      if (!p) continue;
      const x = (p.x * 0.5 + 0.5) * width + (it.offset?.[0] ?? 8);
      const y = (-p.y * 0.5 + 0.5) * height + (it.offset?.[1] ?? -8);
      if (x < -50 || x > width + 10 || y < -10 || y > height + 10) continue;
      const w = it.width ?? it.text.length * 7 + 4;
      const cells = [];
      let blocked = false;
      for (let cx = Math.floor(x / CELL_W); cx <= Math.floor((x + w) / CELL_W); cx++) {
        const k = `${cx},${Math.floor(y / CELL_H)}`;
        if (occupied.has(k)) blocked = true;
        cells.push(k);
      }
      if (blocked && !it.always) continue;
      if (!it.noCollide) for (const k of cells) occupied.add(k);
      let rec = elements.get(it.key);
      if (!rec) {
        const el = document.createElement("div");
        container.appendChild(el);
        rec = { el, text: null, cls: null };
        elements.set(it.key, rec);
      }
      if (rec.text !== it.text) {
        rec.el.textContent = it.text;
        rec.text = it.text;
      }
      const cls = `label ${it.cls || ""}`;
      if (rec.cls !== cls) {
        rec.el.className = cls;
        rec.cls = cls;
      }
      rec.el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
      rec.el.style.display = "";
      used.add(it.key);
    }
    for (const [key, rec] of elements) {
      if (!used.has(key) && rec.el.style.display !== "none") rec.el.style.display = "none";
    }
  }

  return { render, resize };
}
