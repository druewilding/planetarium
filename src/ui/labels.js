// DOM labels positioned over the canvas. Each frame the app submits a list of
// candidate labels; higher-priority labels claim screen space first and
// overlapping lower-priority ones are hidden.
//
// Overlap is tested on the labels' real boxes (a coarse grid only finds the
// neighbours), so panning, which moves labels together, doesn't change which
// ones fit. Labels already showing get a small head start, so near-ties don't
// flicker as you turn.
//
// A label can carry `pick`, what tapping it chooses: `at()` finds the label under
// a point on its real box, so you can only tap the names you can see.

const CELL_W = 40;
const CELL_H = 16;
const LABEL_H = 14;
const STICKY = 3; // priority bonus for a label that was shown last frame

export function createLabels(container) {
  const elements = new Map(); // key → { el, text, cls }
  let width = 0;
  let height = 0;

  function resize(w, h) {
    width = w;
    height = h;
  }

  /**
   * items: [{ key, text, dir (world Vector3 unit), cls, priority, offset: [dx, dy], always, pick }]
   */
  /** project(dir) → normalised device coords {x, y}, or null when not drawn. */
  let shown = new Set();

  function render(items, project) {
    const rank = (it) => it.priority + (shown.has(it.key) ? STICKY : 0);
    items.sort((a, b) => rank(b) - rank(a));
    const occupied = new Map(); // cell → boxes touching it
    const used = new Set();
    for (const it of items) {
      const p = project(it.dir);
      if (!p) continue;
      const x = (p.x * 0.5 + 0.5) * width + (it.offset?.[0] ?? 8);
      const y = (-p.y * 0.5 + 0.5) * height + (it.offset?.[1] ?? -8);
      if (x < -50 || x > width + 10 || y < -10 || y > height + 10) continue;
      const w = it.width ?? it.text.length * 7 + 4;
      const box = [x, y - LABEL_H / 2, x + w, y + LABEL_H / 2];
      const cells = [];
      for (let cx = Math.floor(box[0] / CELL_W); cx <= Math.floor(box[2] / CELL_W); cx++) {
        for (let cy = Math.floor(box[1] / CELL_H); cy <= Math.floor(box[3] / CELL_H); cy++) cells.push(`${cx},${cy}`);
      }
      const hits = (b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3];
      const blocked = cells.some((k) => occupied.get(k)?.some(hits));
      if (blocked && !it.always) continue;
      if (!it.noCollide) {
        for (const k of cells) {
          if (occupied.has(k)) occupied.get(k).push(box);
          else occupied.set(k, [box]);
        }
      }
      let rec = elements.get(it.key);
      if (!rec) {
        const el = document.createElement("div");
        container.appendChild(el);
        rec = { el, text: null, cls: null, pick: null };
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
      rec.pick = it.pick ?? null;
      used.add(it.key);
    }
    for (const [key, rec] of elements) {
      if (!used.has(key) && rec.el.style.display !== "none") rec.el.style.display = "none";
    }
    shown = used;
  }

  /**
   * What tapping (x, y) on the canvas chooses: the `pick` of the shown label whose
   * box (with `pad` px to spare, for fingers) holds that point, the nearest if
   * several do. Null if none.
   */
  function at(x, y, pad = 4) {
    const origin = container.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    for (const key of shown) {
      const rec = elements.get(key);
      if (!rec?.pick) continue;
      const r = rec.el.getBoundingClientRect();
      const [l, t] = [r.left - origin.left, r.top - origin.top];
      if (x < l - pad || x > l + r.width + pad || y < t - pad || y > t + r.height + pad) continue;
      const d = Math.hypot(x - (l + r.width / 2), y - (t + r.height / 2));
      if (d < bestD) [bestD, best] = [d, rec.pick];
    }
    return best;
  }

  return { render, resize, at };
}
