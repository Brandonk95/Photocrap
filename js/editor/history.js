import { cloneCanvas, clampRect } from "./util.js";

// Pixel snapshots beyond this are dropped oldest-first.
const BUDGET_BYTES = 768 * 1024 * 1024;

// Undo history. Each entry stores the document structure (layer order, names,
// opacity, blend, masks, positions, active layer, selection, size) before and
// after, plus before/after pixels for the part of each surface that changed.
// A surface is a Layer or LayerMask (see doc.js).
//
// Usage: begin(label, surfacesToSnapshot) → mutate → commit(dirtyRect).
// begin() keeps a cheap canvas copy so the dirty rect can be decided at
// commit. If a surface's canvas was resized or moved, its whole canvas is
// recorded instead of a rect.
export class History {
  constructor(app) {
    this.app = app;
    this.entries = [];
    this.index = -1;
    this.pending = null;
  }

  reset(label) {
    this.pending = null;
    this.entries = [{ label, before: null, after: this.structure(), records: [], bytes: 0 }];
    this.index = 0;
    this.changed();
  }

  get canUndo() {
    return !this.pending && this.index > 0;
  }

  get canRedo() {
    return !this.pending && this.index < this.entries.length - 1;
  }

  // Snapshot of the layer tree: each node's properties, plus children for groups.
  snapshotNodes(list) {
    return list.map((node) => ({
      node,
      name: node.name,
      opacity: node.opacity,
      blend: node.blend,
      x: node.x,
      y: node.y,
      mask: node.mask,
      maskEnabled: node.mask?.enabled ?? true,
      mx: node.mask?.x ?? 0,
      my: node.mask?.y ?? 0,
      text: node.text ?? null,
      shape: node.shape ?? null,
      adjustment: node.adjustment ?? null,
      styles: node.styles ?? null,
      children: node.isGroup ? this.snapshotNodes(node.layers) : null,
    }));
  }

  restoreNodes(list) {
    return list.map(({ node, name, opacity, blend, x, y, mask, maskEnabled, mx, my, text, shape, adjustment, styles, children }) => {
      Object.assign(node, { name, opacity, blend, mask, text, shape, adjustment, styles });
      if (children) node.layers = this.restoreNodes(children);
      else {
        Object.assign(node, { x, y });
        node.syncTransform();
      }
      if (mask) {
        mask.enabled = maskEnabled;
        mask.x = mx;
        mask.y = my;
        mask.syncTransform();
      }
      return node;
    });
  }

  structure() {
    const doc = this.app.doc;
    return {
      width: doc.width,
      height: doc.height,
      layers: this.snapshotNodes(doc.layers),
      active: doc.activeLayer,
      selection: doc.selection,
    };
  }

  applyStructure(s) {
    const doc = this.app.doc;
    const resized = doc.width !== s.width || doc.height !== s.height;
    doc.width = s.width;
    doc.height = s.height;
    doc.layers = this.restoreNodes(s.layers);
    doc.activeLayer = s.active;
    doc.selection = s.selection;
    doc.syncSize();
    if (resized) this.app.fit();
  }

  // keepText: the operation keeps type and shape layers editable (it updates
  // their text/shape itself). Otherwise any type or shape layer whose pixels
  // it touches is converted to plain pixels.
  begin(label, surfaces = [], { keepText = false } = {}) {
    if (this.pending) this.commit();
    this.pending = {
      label,
      keepText,
      before: this.structure(),
      snaps: surfaces.map((surface) => ({ surface, copy: cloneCanvas(surface.canvas), x: surface.x, y: surface.y })),
    };
  }

  // Put everything back to how it was at begin(), keeping the entry open.
  // Used by live previews that re-render from scratch on every change.
  revert() {
    const p = this.pending;
    if (!p) return;
    for (const { surface, copy } of p.snaps) {
      if (surface.canvas.width !== copy.width || surface.canvas.height !== copy.height) {
        surface.canvas.width = copy.width;
        surface.canvas.height = copy.height;
      }
      surface.drawLocal(copy);
    }
    this.applyStructure(p.before);
    for (const { surface } of p.snaps) surface.refresh();
  }

  cancel() {
    if (!this.pending) return;
    this.revert();
    this.pending = null;
    this.app.contentChanged();
  }

  commit(rect) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;

    const records = [];
    for (const { surface: s, copy, x, y } of p.snaps) {
      const moved = s.x !== x || s.y !== y || s.canvas.width !== copy.width || s.canvas.height !== copy.height;
      if (moved) {
        records.push({
          surface: s, x: 0, y: 0, full: true,
          before: copy.getContext("2d").getImageData(0, 0, copy.width, copy.height),
          after: s.ctx.getImageData(0, 0, s.canvas.width, s.canvas.height),
        });
        s.refresh();
      } else {
        // Dirty rect arrives in document space; records are canvas-local.
        const d = rect ?? s.bounds;
        const r = clampRect({ x: d.x - s.x, y: d.y - s.y, w: d.w, h: d.h }, copy.width, copy.height);
        if (!r.w || !r.h) continue;
        records.push({
          surface: s, x: r.x, y: r.y, full: false,
          before: copy.getContext("2d").getImageData(r.x, r.y, r.w, r.h),
          after: s.ctx.getImageData(r.x, r.y, r.w, r.h),
        });
        s.refresh({ x: r.x + s.x, y: r.y + s.y, w: r.w, h: r.h });
      }
    }
    const bytes = records.reduce((sum, rec) => sum + rec.before.data.length + rec.after.data.length, 0);

    if (!p.keepText) {
      const rasterized = p.snaps.filter(({ surface }) => (surface.text || surface.shape) && records.some((r) => r.surface === surface));
      for (const { surface } of rasterized) {
        const what = surface.text ? "text" : "a shape";
        surface.text = surface.shape = null;
        this.app.toast(`“${surface.name}” is now pixels — it's no longer editable as ${what}.`);
      }
    }

    this.entries.length = this.index + 1; // a new action discards the redo branch
    this.entries.push({ label: p.label, before: p.before, after: this.structure(), records, bytes });
    this.index++;
    this.trim();
    this.changed();
  }

  undo() {
    if (!this.canUndo) return;
    const entry = this.entries[this.index];
    for (const rec of entry.records) this.put(rec, rec.before);
    this.applyStructure(entry.before);
    this.refreshRecords(entry, "before");
    this.index--;
    this.changed();
  }

  redo() {
    if (!this.canRedo) return;
    this.index++;
    const entry = this.entries[this.index];
    for (const rec of entry.records) this.put(rec, rec.after);
    this.applyStructure(entry.after);
    this.refreshRecords(entry, "after");
    this.changed();
  }

  jumpTo(i) {
    while (this.index > i && this.canUndo) this.undo();
    while (this.index < i && this.canRedo) this.redo();
  }

  // Writes canvas-local pixels; positions are restored by applyStructure().
  put(rec, img) {
    const s = rec.surface;
    if (rec.full && (s.canvas.width !== img.width || s.canvas.height !== img.height)) {
      s.canvas.width = img.width;
      s.canvas.height = img.height;
    }
    s.ctx.putImageData(img, rec.x, rec.y);
  }

  refreshRecords(entry, side) {
    for (const rec of entry.records) {
      const s = rec.surface;
      if (rec.full) s.refresh();
      else s.refresh({ x: rec.x + s.x, y: rec.y + s.y, w: rec[side].width, h: rec[side].height });
    }
  }

  // Drop the oldest entries once over budget. The first remaining entry becomes
  // the new floor, so its own pixel records are no longer needed either.
  trim() {
    let total = this.entries.reduce((sum, e) => sum + e.bytes, 0);
    while (total > BUDGET_BYTES && this.index > 0 && this.entries.length > 2) {
      total -= this.entries.shift().bytes;
      this.index--;
      const floor = this.entries[0];
      total -= floor.bytes;
      floor.bytes = 0;
      floor.records = [];
    }
  }

  changed() {
    this.app.emit("history");
    this.app.contentChanged();
  }
}
