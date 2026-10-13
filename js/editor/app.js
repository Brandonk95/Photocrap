import { Doc, Layer, LayerMask, Group } from "./doc.js";
import { hasStyles } from "./styles.js";
import { transformShape, translateShape, renderShape } from "./shapes.js";
import { History } from "./history.js";
import { RULER, DEFAULT_VIEW_PREFS, loadViewPrefs, saveViewPrefs, guideAt, rulerAt, guidePos, drawGuides, drawRulers } from "./guides.js";
import { resetDialogLayout } from "./dialogs.js";
import { Selection } from "./selection.js";
import { applyMask } from "./filters.js";
import { isProjectFile, deserializeDoc } from "./project.js";
import {
  createCanvas, cloneCanvas, copyImageData, clamp, clampRect, unionRect, downloadBlob, stripExtension, grayHex,
} from "./util.js";

const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export class App {
  constructor({ workspace, canvas }) {
    this.workspace = workspace;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.doc = null;
    this.history = new History(this);
    this.view = { zoom: 1, x: 0, y: 0 };
    this.fg = "#000000";
    this.bg = "#ffffff";
    this.tools = new Map();
    this.tool = null;
    this.live = null;            // { layer, render() } — a tool's preview standing in for a layer
    this.selectionOffset = null; // shifts the marching ants while a selection is being dragged
    this.hideSelection = false;  // free transform draws its own box instead
    this.viewMask = null;        // layer whose mask is shown alone in grayscale
    this.gesture = null;         // { type: "tool" | "pan" | "pinch" } while pointers are down
    this.touches = new Map();    // active touch pointers, for pinch zoom
    this.pointer = null;
    this.spaceDown = false;
    this.clipboard = null;
    this.clipboardFresh = false; // true until the window loses focus after an in-app copy
    this.listeners = new Map();
    this.dirty = true;           // composite needs rebuilding: true (all), a rect, or null
    this.frameRequested = false;
    this.ants = 0;
    this.workspaceColor = getComputedStyle(document.documentElement).getPropertyValue("--workspace").trim() || "#0b0d11";
    const css = getComputedStyle(document.documentElement), token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    this.rulerColors = {
      bg: token("--bg-2", "#14161b"), doc: token("--panel", "#1a1d23"), tick: "rgba(255,255,255,.28)",
      text: token("--muted", "#8b93a1"), border: token("--border", "#2a2e36"), accent: token("--accent", "#3d8bfd"),
    };
    this.prefs = loadViewPrefs(); // rulers, guides, snap
    this.snapLines = {};          // what the current drag snapped to, for display
    this.checker = this.makeChecker();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(workspace);
    this.bindPointer();
    setInterval(() => {
      if (!this.doc?.selection) return;
      this.ants = (this.ants + 1) % 8;
      this.requestRender(false);
    }, 120);
  }

  // ---------- Events ----------

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, detail) {
    for (const fn of this.listeners.get(type) ?? []) fn(detail);
  }

  toast(message) {
    this.emit("toast", message);
  }

  get busy() {
    return !!this.gesture || !!this.history.pending || this.working || this.editingText;
  }

  // Edit a type layer's text on the canvas.
  editText(layer) {
    if (!layer.text || this.gesture || this.history.pending || this.working) return;
    this.setTool("text");
    this.tools.get("text").edit(this, layer);
  }

  // Turn a type or shape layer into plain pixels (its pixels are already rendered).
  rasterizeLayer(layer = this.doc.activeLayer) {
    if (!(layer.text || layer.shape) || this.busy) return;
    this.history.begin(layer.text ? "Rasterize Type" : "Rasterize Shape");
    layer.text = layer.shape = null;
    this.history.commit();
  }

  // A long operation (e.g. a filter running in the worker) is in progress.
  setWorking(on) {
    this.working = on;
    this.emit("working", on);
  }

  // Pixels or structure changed for good (as opposed to a live preview frame).
  contentChanged() {
    this.requestRender(true);
    this.emit("layers");
  }

  // ---------- Documents ----------

  setDoc(doc, label) {
    this.doc = doc;
    this.live = null;
    this.viewMask = null;
    this.history.reset(label);
    this.fit();
    this.emit("doc");
  }

  newDoc(width, height, background, name = "Untitled") {
    const doc = new Doc(width, height, name);
    const layer = background ? new Layer(width, height, "Background") : doc.newLayer();
    if (background) {
      layer.ctx.fillStyle = background;
      layer.ctx.fillRect(0, 0, width, height);
    }
    doc.layers.push(layer);
    doc.activeLayer = layer;
    this.setDoc(doc, "New Document");
  }

  openImage(image, name) {
    const doc = new Doc(image.width, image.height, name || "Untitled");
    const layer = new Layer(image.width, image.height, "Background");
    layer.ctx.drawImage(image, 0, 0);
    doc.layers.push(layer);
    doc.activeLayer = layer;
    this.setDoc(doc, "Open");
  }

  // Opens an image or a .pcrap project, replacing the current document.
  async openFile(blob, name) {
    if (await isProjectFile(blob)) {
      const doc = await deserializeDoc(blob);
      if (name) doc.name = stripExtension(name);
      this.setDoc(doc, "Open Project");
      return;
    }
    const bitmap = await createImageBitmap(blob);
    this.openImage(bitmap, stripExtension(name));
  }

  async placeFile(blob, name, label = "Place") {
    const bitmap = await createImageBitmap(blob);
    if (this.busy) return false;
    this.placeImage(bitmap, stripExtension(name) || "Placed Image", label);
    return true;
  }

  // Add an image as a new layer. Placed images are scaled down to fit the
  // canvas; pasted ones keep their full size (any overflow is kept off-canvas).
  // Without a position the image is centered.
  placeImage(image, name, label, x, y) {
    const doc = this.doc;
    let w = image.width, h = image.height;
    if (x == null) {
      const s = label === "Place" ? Math.min(1, doc.width / w, doc.height / h) : 1;
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
      x = Math.round((doc.width - w) / 2);
      y = Math.round((doc.height - h) / 2);
    }
    const layer = doc.newLayer(name);
    layer.ensure({ x, y, w, h });
    layer.ctx.imageSmoothingQuality = "high";
    layer.ctx.drawImage(image, x, y, w, h);
    this.history.begin(label);
    doc.insertAbove(doc.activeLayer, layer);
    doc.activeLayer = layer;
    doc.selection = null;
    this.history.commit();
  }

  async exportImage(type, quality, filename) {
    const doc = this.doc;
    const flat = doc.compose();
    this.dirty = true;
    const out = createCanvas(doc.width, doc.height);
    const ctx = out.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#ffffff"; // JPEG has no alpha
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    ctx.drawImage(flat, 0, 0);
    const blob = await new Promise((resolve) => out.toBlob(resolve, type, quality));
    if (!blob) throw new Error("Export failed");
    downloadBlob(blob, filename);
  }

  // ---------- Rendering ----------

  makeChecker() {
    const tile = createCanvas(16, 16);
    const t = tile.getContext("2d");
    t.fillStyle = "#ffffff";
    t.fillRect(0, 0, 16, 16);
    t.fillStyle = "#d9dce3";
    t.fillRect(0, 0, 8, 8);
    t.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(tile, "repeat");
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    // Keep the document centered as the workspace grows or shrinks.
    if (this.cssW && this.doc) {
      this.view.x = Math.round(this.view.x + (r.width - this.cssW) / 2);
      this.view.y = Math.round(this.view.y + (r.height - this.cssH) / 2);
    }
    this.rect = r;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.requestRender(false);
  }

  // composite: true rebuilds the whole composite, a {x,y,w,h} rect rebuilds
  // just that area (used while painting), false only redraws the view.
  requestRender(composite = true) {
    if (composite === true) this.dirty = true;
    else if (composite && this.dirty !== true) this.dirty = unionRect(this.dirty, composite);
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => this.render());
  }

  render() {
    this.frameRequested = false;
    const doc = this.doc;
    if (!doc) return;
    if (this.dirty) {
      const rect = this.dirty === true ? null : clampRect(this.dirty, doc.width, doc.height);
      if (!rect || (rect.w && rect.h)) doc.compose(this.live, rect, this.viewMask);
      this.dirty = null;
    }

    const { ctx } = this;
    const { zoom, x, y } = this.view;
    const dw = doc.width * zoom, dh = doc.height * zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.workspaceColor;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, dw, dh);
    ctx.restore();
    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, dw, dh);

    ctx.imageSmoothingEnabled = zoom < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(doc.composite, x, y, dw, dh);
    if (doc.quickMask && doc.quickOverlay) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(doc.quickOverlay, x, y, dw, dh);
      ctx.globalAlpha = 1;
    }
    // A dialog's view of the image (e.g. Refine Edge's "On Black").
    if (this.viewOverlay) {
      ctx.globalAlpha = this.viewOverlay.alpha ?? 1;
      ctx.drawImage(this.viewOverlay.canvas, x, y, dw, dh);
      ctx.globalAlpha = 1;
    }

    // Overlays, drawn in document coordinates.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(zoom, zoom);
    if (doc.selection && !this.hideSelection) this.drawAnts(doc.selection.outline);
    this.tool?.drawOverlay?.(ctx, this);
    ctx.restore();

    drawGuides(this, ctx);
    this.tool?.drawScreenOverlay?.(ctx, this);
    if (this.prefs.rulers) drawRulers(this, ctx, this.rulerColors);
    const overRuler = this.pointer && rulerAt(this, this.pointer.sx, this.pointer.sy);
    if (this.pointer && !overRuler && !this.spaceDown && !["pan", "guide"].includes(this.gesture?.type)) this.tool?.drawCursor?.(ctx, this);
  }

  // ---------- Rulers, guides & snapping ----------

  setPref(key, value) {
    this.prefs[key] = value;
    saveViewPrefs(this.prefs);
    this.emit("prefs");
    this.requestRender(false);
  }

  // View › Reset Layout: panels, toolbar, options bar, dialog positions and
  // view settings go back to their defaults. The image is not touched.
  resetLayout() {
    this.prefs = { ...DEFAULT_VIEW_PREFS };
    saveViewPrefs(this.prefs);
    resetDialogLayout();
    this.emit("reset-layout");
    this.emit("prefs");
    this.requestRender(false);
    this.toast("Layout reset to the default.");
  }

  setGuides(guides, label) {
    if (this.busy && this.gesture?.type !== "guide") return;
    this.history.begin(label);
    this.doc.guides = guides;
    this.history.commit();
  }

  addGuide(axis, pos) {
    this.setGuides([...this.doc.guides, { axis, pos }], "New Guide");
  }

  clearGuides() {
    if (this.doc.guides.length) this.setGuides([], "Clear Guides");
  }

  endGuideDrag(g) {
    const guides = this.doc.guides;
    if (g.index < 0) {
      if (g.pos != null && !g.remove) this.setGuides([...guides, { axis: g.axis, pos: g.pos }], "New Guide");
    } else if (g.remove) {
      this.setGuides(guides.filter((_, i) => i !== g.index), "Delete Guide");
    } else if (g.pos != null && g.pos !== guides[g.index].pos) {
      this.setGuides(guides.map((x, i) => (i === g.index ? { axis: x.axis, pos: g.pos } : x)), "Move Guide");
    }
    this.requestRender(false);
  }

  drawAnts(path) {
    const { ctx } = this;
    const z = this.view.zoom;
    ctx.save();
    if (this.selectionOffset) ctx.translate(this.selectionOffset.x, this.selectionOffset.y);
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.strokeStyle = "#000";
    ctx.lineDashOffset = -this.ants / z;
    ctx.stroke(path);
    ctx.strokeStyle = "#fff";
    ctx.lineDashOffset = (4 - this.ants) / z;
    ctx.stroke(path);
    ctx.restore();
  }

  // ---------- View ----------

  setView(zoom, x, y) {
    this.view = { zoom, x: Math.round(x), y: Math.round(y) };
    this.emit("view");
    this.requestRender(false);
  }

  fit() {
    const doc = this.doc;
    if (!doc) return;
    if (!this.cssW) this.resize();
    const pad = 40;
    const zoom = Math.min((this.cssW - pad * 2) / doc.width, (this.cssH - pad * 2) / doc.height, 1);
    const z = zoom > 0 ? zoom : 1;
    this.setView(z, (this.cssW - doc.width * z) / 2, (this.cssH - doc.height * z) / 2);
  }

  actualSize() {
    const doc = this.doc;
    this.setView(1, (this.cssW - doc.width) / 2, (this.cssH - doc.height) / 2);
  }

  zoomTo(zoom, sx = this.cssW / 2, sy = this.cssH / 2) {
    const z = clamp(zoom, 0.01, 64);
    const { zoom: cur, x, y } = this.view;
    const px = (sx - x) / cur, py = (sy - y) / cur;
    this.setView(z, sx - px * z, sy - py * z);
  }

  zoomStep(dir, sx, sy) {
    const cur = this.view.zoom;
    const next = dir > 0
      ? ZOOM_STEPS.find((s) => s > cur * 1.001) ?? ZOOM_STEPS.at(-1)
      : [...ZOOM_STEPS].reverse().find((s) => s < cur / 1.001) ?? ZOOM_STEPS[0];
    this.zoomTo(next, sx, sy);
  }

  panBy(dx, dy) {
    this.setView(this.view.zoom, this.view.x + dx, this.view.y + dy);
  }

  // ---------- Pointer input ----------

  pointerEvent(ev) {
    const sx = ev.clientX - this.rect.left, sy = ev.clientY - this.rect.top;
    const { zoom, x, y } = this.view;
    return {
      sx, sy,
      x: (sx - x) / zoom,
      y: (sy - y) / zoom,
      pressure: ev.pressure ?? 0.5,
      pointerType: ev.pointerType,
      shift: ev.shiftKey,
      alt: ev.altKey,
      mod: ev.ctrlKey || ev.metaKey,
    };
  }

  bindPointer() {
    const c = this.canvas;
    const capture = (id) => {
      try { c.setPointerCapture(id); } catch { /* pointer already gone */ }
    };
    c.addEventListener("pointerdown", (ev) => {
      if (!this.doc) return;
      ev.preventDefault(); // no text selection or focus shuffling from canvas presses
      this.rect = c.getBoundingClientRect();
      const e = this.pointerEvent(ev);

      // A second finger turns whatever the first one started into a pinch.
      if (ev.pointerType === "touch") {
        this.touches.set(ev.pointerId, e);
        if (this.touches.size === 2) {
          this.cancelGesture();
          capture(ev.pointerId);
          this.gesture = { type: "pinch", ...this.pinchState(), view: { ...this.view } };
          return;
        }
      }
      if (this.gesture) return;
      if (document.activeElement !== document.body) document.activeElement?.blur?.();
      if (ev.button === 1 || (ev.button === 0 && (this.spaceDown || this.tool.id === "hand"))) {
        capture(ev.pointerId);
        this.gesture = { type: "pan", last: e };
        this.updateCursor();
        return;
      }
      if (ev.button !== 0 || this.working || (this.history.pending && !this.tool.modal)) return;
      this.snapLines = {};
      // Drag out of a ruler to make a guide; drag a guide (Move tool, or
      // Ctrl with any tool) to move it, or back onto a ruler to remove it.
      const fromRuler = !this.history.pending && rulerAt(this, e.sx, e.sy);
      const guide = fromRuler || this.history.pending || !(this.tool.id === "move" || e.mod) ? -1 : guideAt(this, e.sx, e.sy);
      if (fromRuler || guide >= 0) {
        capture(ev.pointerId);
        this.gesture = { type: "guide", pointerId: ev.pointerId, axis: fromRuler || this.doc.guides[guide].axis, index: guide, pos: null };
        this.updateCursor();
        return;
      }
      capture(ev.pointerId);
      this.gesture = { type: "tool", pointerId: ev.pointerId };
      this.tool.down?.(this, e);
    });

    c.addEventListener("pointermove", (ev) => {
      const e = this.pointerEvent(ev);
      if (this.touches.has(ev.pointerId)) this.touches.set(ev.pointerId, e);
      this.pointer = e;
      this.emit("pointer", e);
      const g = this.gesture;
      if (g?.type === "pinch") {
        const { mid, dist } = this.pinchState();
        const zoom = clamp(g.view.zoom * (dist / g.dist), 0.01, 64);
        const px = (g.mid.sx - g.view.x) / g.view.zoom, py = (g.mid.sy - g.view.y) / g.view.zoom;
        this.setView(zoom, mid.sx - px * zoom, mid.sy - py * zoom);
        return;
      }
      if (g?.type === "pan") {
        this.panBy(e.sx - g.last.sx, e.sy - g.last.sy);
        g.last = e;
        return;
      }
      if (g?.type === "guide") {
        g.pos = guidePos(this, g.axis, e);
        // Back over its ruler (or the corner) removes it.
        g.remove = g.axis === "x" ? e.sx < RULER : e.sy < RULER;
        this.requestRender(false);
        return;
      }
      if (g?.type === "tool") {
        if (ev.pointerId !== g.pointerId) return;
        const events = ev.getCoalescedEvents?.() ?? [];
        for (const ce of events.length ? events : [ev]) this.tool.move?.(this, this.pointerEvent(ce));
      } else {
        this.updateCursor();
      }
      if (this.tool.drawCursor) this.requestRender(false);
    });

    const end = (ev) => {
      this.touches.delete(ev.pointerId);
      const g = this.gesture;
      if (!g) return;
      if (g.type === "pinch") {
        if (this.touches.size < 2) this.gesture = null;
        return;
      }
      if ((g.type === "tool" || g.type === "guide") && ev.pointerId !== g.pointerId) return;
      if (g.type === "guide") this.endGuideDrag(g);
      this.gesture = null;
      this.snapLines = {};
      if (g.type === "tool") this.tool.up?.(this, this.pointerEvent(ev));
      this.updateCursor();
      this.emit("gestureend");
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => {
      if (this.gesture) return;
      this.pointer = null;
      this.emit("pointer", null);
      this.requestRender(false);
    });

    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      if (!this.doc) return;
      const e = this.pointerEvent(ev);
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        const speed = ev.deltaMode === 1 ? 0.05 : 0.0025;
        this.zoomTo(this.view.zoom * Math.exp(-ev.deltaY * speed), e.sx, e.sy);
      } else if (ev.shiftKey) {
        this.panBy(-ev.deltaY, -ev.deltaX);
      } else {
        this.panBy(-ev.deltaX, -ev.deltaY);
      }
    }, { passive: false });
  }

  pinchState() {
    const [a, b] = [...this.touches.values()];
    return { mid: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }, dist: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)) };
  }

  // Abandon an in-progress drag (Escape, or a second finger landing) and
  // put everything back the way it was before it started.
  cancelGesture() {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.type === "tool") {
      this.tool.cancel?.(this);
      this.live = null;
      this.selectionOffset = null;
      if (this.history.pending && !this.tool.modal) this.history.cancel();
    }
    this.requestRender();
    this.updateCursor();
    this.emit("gestureend");
  }

  setSpace(down) {
    if (this.spaceDown === down) return;
    this.spaceDown = down;
    this.updateCursor();
    this.requestRender(false);
  }

  updateCursor() {
    const t = this.tool;
    if (!t) return;
    let cursor;
    const p = this.pointer, g = this.gesture;
    const guide = !g && p && (t.id === "move" || p.mod) ? guideAt(this, p.sx, p.sy) : -1;
    if (g?.type === "pan") cursor = "grabbing";
    else if (g?.type === "guide") cursor = g.axis === "x" ? "col-resize" : "row-resize";
    else if (this.spaceDown || t.id === "hand") cursor = "grab";
    else if (!g && p && rulerAt(this, p.sx, p.sy)) cursor = "default";
    else if (guide >= 0) cursor = this.doc.guides[guide].axis === "x" ? "col-resize" : "row-resize";
    else cursor = typeof t.cursor === "function" ? t.cursor(this, this.pointer) : t.cursor;
    this.canvas.style.cursor = cursor ?? "default";
  }

  // ---------- Tools & colors ----------

  registerTools(tools) {
    for (const t of tools) this.tools.set(t.id, t);
  }

  setTool(id) {
    const next = this.tools.get(id);
    if (!next || next === this.tool || this.gesture) return;
    this.tool?.deactivate?.(this);
    this.tool = next;
    next.activate?.(this);
    this.emit("tool");
    this.updateCursor();
    this.requestRender(false);
  }

  beginTransform() {
    if (this.busy || !this.ensureVisible(this.doc.activeLayer, { whole: true, locks: ["pixels", "position"] })) return;
    const prev = this.tool;
    prev.deactivate?.(this); // e.g. commit pending text before the transform opens its history entry
    if (this.tools.get("transform").start(this, prev)) this.setTool("transform");
  }

  setColor(which, hex) {
    this[which] = hex;
    this.emit("colors");
  }

  swapColors() {
    [this.fg, this.bg] = [this.bg, this.fg];
    this.emit("colors");
  }

  resetColors() {
    this.fg = "#000000";
    this.bg = "#ffffff";
    this.emit("colors");
  }

  // ---------- Selection ----------

  setSelection(sel, label) {
    const next = sel && !sel.isEmpty ? sel : null;
    if (!next && !this.doc.selection) return;
    this.history.begin(label);
    this.doc.selection = next;
    this.history.commit();
  }

  // ---------- Quick Mask ----------

  // Quick Mask mode turns the selection into a grayscale mask you edit with
  // any painting tool (white selects, black deselects); unselected areas are
  // tinted red. Leaving it turns the mask back into a selection.
  toggleQuickMask() {
    if (this.busy) return;
    const doc = this.doc;
    if (doc.quickMask) {
      const m = doc.quickMask.mask;
      const sel = new Selection(m.alphaFor({ x: 0, y: 0, w: doc.width, h: doc.height }));
      this.history.begin("Exit Quick Mask");
      doc.quickMask = null;
      doc.selection = sel.isEmpty ? null : sel;
    } else {
      // No selection: everything is selected (nothing tinted), like Photoshop.
      const mask = new LayerMask(doc.width, doc.height, doc.selection ? "#000000" : "#ffffff");
      if (doc.selection) {
        mask.ctx.drawImage(doc.selection.mask, 0, 0); // white where selected
        mask.refresh();
      }
      this.history.begin("Quick Mask");
      doc.quickMask = { id: "quick-mask", name: "Quick Mask", mask, visible: true, opacity: 1, isGroup: false };
      doc.selection = null;
    }
    this.history.commit();
    this.emit("options");
  }

  combineSelection(sel, mode, label) {
    const cur = this.doc.selection;
    let next = sel;
    if (mode !== "new") {
      if (cur) next = cur.combine(sel, mode);
      else if (mode !== "add") next = null;
    }
    this.setSelection(next, label);
  }

  selectAll() {
    this.setSelection(Selection.all(this.doc.width, this.doc.height), "Select All");
  }

  deselect() {
    this.setSelection(null, "Deselect");
  }

  invertSelection() {
    if (this.doc.selection) this.setSelection(this.doc.selection.inverted(), "Select Inverse");
  }

  // ---------- Edit target: a layer's pixels or its mask ----------

  // What tools and filters edit right now. Adjustment layers only have a
  // mask to paint on; groups have no pixels (surface is null unless their
  // mask is targeted).
  target() {
    // In Quick Mask mode every pixel tool edits the quick mask.
    const quick = this.doc.quickMask;
    if (quick) return { layer: quick, surface: quick.mask, isMask: true, quick: true };
    const layer = this.doc.activeLayer;
    const mask = layer.mask && (layer.editMask || layer.adjustment) ? layer.mask : null;
    const pixelless = layer.isGroup || !!layer.adjustment;
    return { layer, surface: mask ?? (pixelless ? null : layer), isMask: !!mask };
  }

  // What moves together, as [{ surface, owner, isMask }]: editing pixels
  // drags the layer's mask along (as in Photoshop), editing a mask moves only
  // the mask, and a group moves everything inside it.
  linkedSurfaces() {
    const { layer, isMask } = this.target();
    if (isMask) return [{ surface: layer.mask, owner: layer, isMask: true }];
    const nodes = layer.isGroup ? [layer, ...this.doc.allNodes(layer.layers)] : [layer];
    const pieces = [];
    for (const n of nodes) {
      if (!n.isGroup && !n.adjustment) pieces.push({ surface: n, owner: n, isMask: false });
      if (n.mask) pieces.push({ surface: n.mask, owner: n, isMask: true });
    }
    return pieces;
  }

  // Bounds of a node's visible content, in document space (null if empty).
  contentBoundsOf(node) {
    if (node.isGroup) {
      let b = null;
      for (const leaf of this.doc.allNodes(node.layers)) {
        if (!leaf.isGroup && !leaf.adjustment) b = unionRect(b, leaf.contentBounds());
      }
      return b;
    }
    if (node.adjustment) return node.mask?.bounds ?? { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    return node.contentBounds();
  }

  // Masks are grayscale, so colors painted onto them use their luminance.
  paintColor(hex) {
    return this.target().isMask ? grayHex(hex) : hex;
  }

  setEditTarget(layer, editMask) {
    if (this.busy) return;
    this.doc.activeLayer = layer;
    layer.editMask = editMask && !!layer.mask;
    this.emit("layers");
    this.emit("options");
  }

  // ---------- Pixel operations on the edit target ----------
  // Surfaces carry a document-space transform, so drawing below uses
  // document coordinates; raw pixel reads go through get/putDocImageData.

  // The area an operation touches: the selection's bounds (padded for filters
  // that sample neighbours) or the whole document.
  region(pad = 0) {
    const doc = this.doc;
    const b = doc.selection?.bounds;
    if (!b) return { x: 0, y: 0, w: doc.width, h: doc.height };
    return clampRect({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, doc.width, doc.height);
  }

  // Run fn over a document region of a surface, respecting the selection.
  // `src` lets live previews always start from the original pixels.
  filterRegion(surface, r, fn, src) {
    const orig = src ?? surface.getDocImageData(r);
    const out = fn(copyImageData(orig));
    if (this.doc.selection) applyMask(orig, out, this.doc.selection.region(r));
    surface.putDocImageData(out, r.x, r.y);
  }

  applyFilter(label, fn) {
    const { layer, surface } = this.target();
    if (!this.ensureVisible(layer)) return;
    const r = this.region();
    this.history.begin(label, [surface]);
    this.filterRegion(surface, r, fn);
    this.history.commit(r);
  }

  // Can the active layer be edited? whole: the operation acts on the whole
  // node (move/transform), so groups and adjustment layers are fine.
  // Can the active layer be edited this way? Toasts the reason if not.
  // `locks` lists the kinds of change ("pixels", "position") the edit makes;
  // by default pixel edits, or nothing for whole-layer operations.
  ensureVisible(layer, { whole = false, locks = whole ? [] : ["pixels"] } = {}) {
    if (!this.doc.isVisible(layer)) {
      this.toast("The active layer is hidden.");
      return false;
    }
    if (!whole && !this.target().surface) {
      this.toast(layer.isGroup
        ? "That's a group — select a layer inside it to edit pixels."
        : "Adjustment layers have no pixels. Add a mask to paint where the adjustment applies.");
      return false;
    }
    const onMask = this.target().isMask; // masks stay editable when pixels are locked
    for (const kind of locks) {
      if (kind === "pixels" && onMask) continue;
      if (this.refuseLocked(layer, kind)) return false;
    }
    return true;
  }

  // True (with a toast saying why) if `kind` is locked for node.
  refuseLocked(node, kind) {
    const locked = this.lockedIn(node, kind);
    if (locked) this.toast(`“${locked.name}” is locked — ${kind === "pixels" ? "its pixels can't be edited" : "it can't be moved"}. Unlock it in the Layers panel.`);
    return !!locked;
  }

  // ---------- Locks ----------

  // The node (or the group containing it) that locks `kind` for it, or null.
  lockOf(node, kind) {
    for (let n = node; n; n = this.doc.parentOf(n)) if (n.locks?.[kind]) return n;
    return null;
  }

  // Like lockOf, but for a group also anything inside it.
  lockedIn(node, kind) {
    return this.lockOf(node, kind)
      ?? (node.isGroup ? this.doc.allNodes(node.layers).find((n) => n.locks?.[kind]) ?? null : null);
  }

  // kind: "transparency" | "pixels" | "position" | "all".
  toggleLock(node, kind) {
    if (this.busy) return;
    const locks = { transparency: false, pixels: false, position: false, ...node.locks };
    const all = locks.transparency && locks.pixels && locks.position;
    if (kind === "all") locks.transparency = locks.pixels = locks.position = !all;
    else locks[kind] = !locks[kind];
    const any = locks.transparency || locks.pixels || locks.position;
    this.setLayerProps(node, { locks: any ? locks : null }, any ? "Lock Layer" : "Unlock Layer");
  }

  // ---------- Clipping masks ----------

  // Can `node` be clipped to the layer below it? (Not the bottom one.)
  canClip(node) {
    return this.doc.siblingsOf(node).indexOf(node) > 0;
  }

  // The layer a clipped node is clipped to, or null.
  clipBase(node) {
    if (!node.clipped) return null;
    const list = this.doc.siblingsOf(node);
    for (let i = list.indexOf(node) - 1; i >= 0; i--) if (!list[i].clipped || i === 0) return list[i];
    return null;
  }

  toggleClipping(node = this.doc.activeLayer) {
    if (this.busy) return;
    if (!node.clipped && !this.canClip(node)) {
      this.toast("There's no layer below to clip to.");
      return;
    }
    this.setLayerProps(node, { clipped: !node.clipped }, node.clipped ? "Release Clipping Mask" : "Create Clipping Mask");
  }

  fill(color, label) {
    const doc = this.doc, sel = doc.selection;
    const { layer, surface } = this.target();
    if (!this.ensureVisible(layer)) return;
    const paint = this.paintColor(color);
    this.history.begin(label, [surface]);
    if (sel) {
      const tmp = createCanvas(doc.width, doc.height);
      const t = tmp.getContext("2d");
      t.fillStyle = paint;
      t.fillRect(0, 0, doc.width, doc.height);
      t.globalCompositeOperation = "destination-in";
      t.drawImage(sel.mask, 0, 0);
      surface.ctx.drawImage(tmp, 0, 0);
    } else {
      surface.ctx.fillStyle = paint;
      surface.ctx.fillRect(0, 0, doc.width, doc.height);
    }
    this.history.commit(this.region());
  }

  // Erase the selected pixels (or the whole canvas area). On a mask,
  // "erasing" fills with the background color like Photoshop does.
  clearArea(label = "Clear") {
    const { layer, surface, isMask } = this.target();
    if (!this.ensureVisible(layer)) return;
    if (isMask) return this.fill(this.bg, label);
    const doc = this.doc, sel = doc.selection;
    this.history.begin(label, [surface]);
    if (sel) {
      surface.ctx.globalCompositeOperation = "destination-out";
      surface.ctx.drawImage(sel.mask, 0, 0);
      surface.ctx.globalCompositeOperation = "source-over";
    } else {
      surface.ctx.clearRect(0, 0, doc.width, doc.height);
    }
    this.history.commit(this.region());
  }

  copy(cut = false) {
    const doc = this.doc, sel = doc.selection;
    const { layer, surface } = this.target();
    if (!this.ensureVisible(layer, { locks: cut ? ["pixels"] : [] })) return;
    const r = sel ? sel.bounds : { x: 0, y: 0, w: doc.width, h: doc.height };
    const canvas = createCanvas(r.w, r.h);
    const c = canvas.getContext("2d");
    c.drawImage(surface.canvas, surface.x - r.x, surface.y - r.y);
    if (sel) {
      c.globalCompositeOperation = "destination-in";
      c.drawImage(sel.mask, -r.x, -r.y);
    }
    this.clipboard = { canvas, x: r.x, y: r.y };
    this.clipboardFresh = true;
    // Mirror to the system clipboard so the copy can be pasted into other apps.
    if (navigator.clipboard?.write && window.ClipboardItem) {
      canvas.toBlob((blob) => {
        if (blob) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
      });
    }
    if (cut) this.clearArea("Cut");
  }

  pasteInternal() {
    if (!this.clipboard) return false;
    const { canvas, x, y } = this.clipboard;
    // Paste in place when it came from this canvas size; otherwise center it.
    const fits = x >= 0 && y >= 0 && x + canvas.width <= this.doc.width && y + canvas.height <= this.doc.height;
    this.placeImage(canvas, "Pasted Layer", "Paste", fits ? x : undefined, fits ? y : undefined);
    return true;
  }

  async pasteFromMenu() {
    if (this.clipboard && this.clipboardFresh) return this.pasteInternal();
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return this.placeFile(await item.getType(type), "Pasted Layer", "Paste");
      }
    } catch {
      // Clipboard read refused or unsupported; fall back to the internal clipboard.
    }
    if (!this.pasteInternal()) this.toast("Nothing to paste.");
  }

  // Scale/rotate/flip the selection (or each surface's whole content) about
  // the center of the selection or of the target's content. Content may land
  // off-canvas; it is kept. Does not record history; callers wrap it.
  transformSurfaces(surfaces, sel, sx, sy, angle, bounds) {
    const doc = this.doc;
    const b = sel?.bounds ?? bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const m = new DOMMatrix().translate(cx, cy).rotate(angle).scale(sx, sy).translate(-cx, -cy);
    for (const surface of surfaces) surface.stamp(surface.lift(sel), m, doc.width, doc.height);
    if (sel) doc.selection = sel.transformed(m);
  }

  flipLayer(axis) {
    const layer = this.doc.activeLayer;
    if (!this.ensureVisible(layer, { whole: true, locks: ["pixels", "position"] })) return;
    const surfaces = this.linkedSurfaces().map((p) => p.surface);
    this.history.begin(axis === "h" ? "Flip Layer Horizontal" : "Flip Layer Vertical", surfaces);
    this.transformSurfaces(surfaces, this.doc.selection, axis === "h" ? -1 : 1, axis === "v" ? -1 : 1, 0, this.contentBoundsOf(layer));
    this.history.commit();
  }

  // ---------- Whole-image operations ----------

  // Every canvas in the document: pixel layers and all masks.
  allSurfaces() {
    return this.doc.allNodes().flatMap((n) => [n.isGroup || n.adjustment ? null : n, n.mask].filter(Boolean));
  }

  // Rebuild every surface for a new document size. map(rect) gives a
  // surface's new canvas rect (document space); draw(ctx, oldCanvas, old,
  // next) paints it in canvas-local coordinates.
  // textMap(text) returns the updated text for a type layer, or null to
  // convert it to pixels (e.g. rotation, which type layers don't support).
  // matrix maps old document coordinates to new ones; shape layers are
  // transformed by it exactly and re-rendered, so they stay editable.
  remapSurfaces(label, width, height, map, draw, textMap = () => null, matrix = null) {
    const doc = this.doc;
    const surfaces = this.allSurfaces();
    this.history.begin(label, surfaces, { keepText: true });
    let rasterized = 0;
    for (const layer of doc.leaves()) {
      if (!layer.text) continue;
      layer.text = textMap(layer.text);
      if (!layer.text) rasterized++;
    }
    if (rasterized) this.toast(`${rasterized === 1 ? "A type layer was" : `${rasterized} type layers were`} converted to pixels.`);
    for (const s of surfaces) {
      const old = s.bounds;
      const copy = cloneCanvas(s.canvas);
      const next = map(old);
      s.setGeometry(next.x, next.y, next.w, next.h);
      s.ctx.save();
      s.ctx.setTransform(1, 0, 0, 1, 0, 0);
      draw(s.ctx, copy, old, next);
      s.ctx.restore();
      s.ensure({ x: 0, y: 0, w: width, h: height }); // rounding must never leave a gap
      s.geometryChanged();
    }
    doc.width = width;
    doc.height = height;
    doc.selection = null;
    doc.syncSize();
    for (const layer of doc.leaves()) {
      if (!layer.shape) continue;
      if (matrix) {
        layer.shape = transformShape(layer.shape, matrix);
        renderShape(layer, doc);
      } else {
        layer.shape = null;
      }
    }
    this.history.commit();
    this.fit();
  }

  resizeImage(width, height) {
    const kx = width / this.doc.width, ky = height / this.doc.height;
    this.remapSurfaces("Image Size", width, height,
      (r) => {
        const x = Math.round(r.x * kx), y = Math.round(r.y * ky);
        return { x, y, w: Math.max(1, Math.round((r.x + r.w) * kx) - x), h: Math.max(1, Math.round((r.y + r.h) * ky) - y) };
      },
      (ctx, src, old, next) => {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, next.w, next.h);
      },
      // Uniform scaling keeps type editable; stretching it can't be represented.
      (t) => (Math.abs(kx - ky) < 0.001 ? { ...t, x: t.x * kx, y: t.y * ky, size: t.size * kx } : null),
      new DOMMatrix().scale(kx, ky));
  }

  // ax/ay: anchor (0, 0.5 or 1). Layers just shift (nothing is cut off) and
  // grow to cover the new canvas. fill: color for the new area behind the
  // bottom layer.
  resizeCanvas(width, height, ax, ay, fill) {
    const doc = this.doc;
    const dx = Math.round((width - doc.width) * ax), dy = Math.round((height - doc.height) * ay);
    const ow = doc.width, oh = doc.height, bottom = doc.leaves().find((l) => !l.adjustment);
    const surfaces = this.allSurfaces();
    this.history.begin("Canvas Size", surfaces, { keepText: true });
    for (const s of surfaces) {
      s.x += dx;
      s.y += dy;
      s.syncTransform();
      s.ensure({ x: 0, y: 0, w: width, h: height });
    }
    for (const layer of doc.leaves()) {
      if (layer.text) layer.text = { ...layer.text, x: layer.text.x + dx, y: layer.text.y + dy };
      if (layer.shape) layer.shape = translateShape(layer.shape, dx, dy);
    }
    if (fill && bottom) {
      const c = bottom.ctx;
      c.save();
      c.globalCompositeOperation = "destination-over";
      c.fillStyle = fill;
      c.beginPath();
      c.rect(0, 0, width, height);
      c.rect(dx, dy, ow, oh);
      c.fill("evenodd");
      c.restore();
    }
    doc.width = width;
    doc.height = height;
    doc.selection = null;
    doc.syncSize();
    this.history.commit();
    this.fit();
  }

  // Non-destructive: layers just move, so cropped-away pixels are kept and
  // can be moved back into view.
  crop(rect) {
    const doc = this.doc;
    const r = clampRect(rect, doc.width, doc.height);
    if (!r.w || !r.h) return;
    this.history.begin("Crop");
    for (const s of this.allSurfaces()) {
      s.x -= r.x;
      s.y -= r.y;
      s.syncTransform();
    }
    for (const layer of doc.leaves()) {
      if (layer.text) layer.text = { ...layer.text, x: layer.text.x - r.x, y: layer.text.y - r.y };
      if (layer.shape) layer.shape = translateShape(layer.shape, -r.x, -r.y);
    }
    doc.width = r.w;
    doc.height = r.h;
    doc.selection = null;
    doc.syncSize();
    this.history.commit();
    this.fit();
  }

  rotateImage(degrees) {
    const { width: W, height: H } = this.doc;
    const turn = ((degrees % 360) + 360) % 360;
    const swap = turn === 90 || turn === 270;
    const label = turn === 180 ? "Rotate 180°" : turn === 90 ? "Rotate 90° Clockwise" : "Rotate 90° Counter-Clockwise";
    this.remapSurfaces(label, swap ? H : W, swap ? W : H,
      (r) => {
        if (turn === 90) return { x: H - (r.y + r.h), y: r.x, w: r.h, h: r.w };
        if (turn === 270) return { x: r.y, y: W - (r.x + r.w), w: r.h, h: r.w };
        return { x: W - (r.x + r.w), y: H - (r.y + r.h), w: r.w, h: r.h };
      },
      (ctx, src, old) => {
        if (turn === 90) ctx.setTransform(0, 1, -1, 0, old.h, 0);
        else if (turn === 270) ctx.setTransform(0, -1, 1, 0, 0, old.w);
        else ctx.setTransform(-1, 0, 0, -1, old.w, old.h);
        ctx.drawImage(src, 0, 0);
      },
      undefined,
      // The same rotation in document coordinates, for shapes.
      turn === 90 ? new DOMMatrix([0, 1, -1, 0, H, 0])
        : turn === 270 ? new DOMMatrix([0, -1, 1, 0, 0, W])
          : new DOMMatrix([-1, 0, 0, -1, W, H]));
  }

  flipImage(axis) {
    const { width: W, height: H } = this.doc;
    this.remapSurfaces(axis === "h" ? "Flip Canvas Horizontal" : "Flip Canvas Vertical", W, H,
      (r) => (axis === "h" ? { ...r, x: W - (r.x + r.w) } : { ...r, y: H - (r.y + r.h) }),
      (ctx, src, old) => {
        if (axis === "h") ctx.setTransform(-1, 0, 0, 1, old.w, 0);
        else ctx.setTransform(1, 0, 0, -1, 0, old.h);
        ctx.drawImage(src, 0, 0);
      },
      undefined,
      axis === "h" ? new DOMMatrix([-1, 0, 0, 1, W, 0]) : new DOMMatrix([1, 0, 0, -1, 0, H]));
  }

  // ---------- Layers ----------

  // New layers go just above the active one, in the same group.
  addLayer(layer = this.doc.newLayer(), label = "New Layer") {
    const doc = this.doc;
    this.history.begin(label);
    doc.insertAbove(doc.activeLayer, layer);
    doc.activeLayer = layer;
    this.history.commit();
  }

  // Deep copy of a layer or group (masks, text, effects and all).
  cloneNode(node, rename = true) {
    const name = rename ? `${node.name} copy` : node.name;
    let copy;
    if (node.isGroup) {
      copy = new Group(name);
      copy.expanded = node.expanded;
      copy.layers = node.layers.map((n) => this.cloneNode(n, false));
    } else {
      const { x, y, w, h } = node.bounds;
      copy = new Layer(w, h, name, x, y);
      copy.drawLocal(node.canvas);
      // text/adjustment/styles objects are immutable, so sharing is safe
      Object.assign(copy, { text: node.text, shape: node.shape, adjustment: node.adjustment, styles: node.styles });
    }
    Object.assign(copy, {
      opacity: node.opacity, blend: node.blend, visible: node.visible, editMask: node.editMask,
      clipped: node.clipped, locks: node.locks ? { ...node.locks } : null,
    });
    copy.mask = node.mask?.clone() ?? null;
    return copy;
  }

  duplicateLayer() {
    const node = this.doc.activeLayer;
    this.addLayer(this.cloneNode(node), node.isGroup ? "Duplicate Group" : "Duplicate Layer");
  }

  deleteLayer() {
    const doc = this.doc, node = doc.activeLayer;
    if (doc.layers.length === 1 && doc.layers[0] === node) return; // keep at least one
    const list = doc.siblingsOf(node), parent = doc.parentOf(node);
    this.history.begin(node.isGroup ? "Delete Group" : "Delete Layer");
    const i = doc.remove(node);
    doc.activeLayer = list[Math.max(0, i - 1)] ?? parent ?? doc.layers.at(-1);
    if (this.viewMask === node) this.viewMask = null;
    this.history.commit();
  }

  // Move a node into `parent` (a group, or null for the top level) at slot
  // `index`, counted before the node is taken out of its current place.
  moveNode(node, parent, index) {
    const doc = this.doc;
    if (parent === node || (node.isGroup && parent && doc.allNodes(node.layers).includes(parent))) return; // not into itself
    const from = doc.siblingsOf(node), fromIndex = from.indexOf(node);
    const to = parent ? parent.layers : doc.layers;
    let i = clamp(index, 0, to.length);
    if (from === to) {
      if (fromIndex < i) i--;
      if (i === fromIndex) return;
    }
    this.history.begin("Move Layer");
    from.splice(fromIndex, 1);
    to.splice(i, 0, node);
    if (parent) parent.expanded = true;
    this.history.commit();
  }

  // A layer's pixels with its (enabled) mask applied, in the layer's own
  // canvas coordinates.
  maskedPixels(layer) {
    if (!layer.mask?.enabled) return layer.canvas;
    const c = cloneCanvas(layer.canvas);
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(layer.mask.alphaFor(layer.bounds), 0, 0);
    return c;
  }

  // Composite some nodes (with masks, effects and adjustments) into a new
  // document-sized canvas.
  renderNodes(nodes) {
    const doc = this.doc;
    const c = createCanvas(doc.width, doc.height);
    const ctx = c.getContext("2d");
    ctx.save();
    doc.composeList(ctx, nodes, { x: 0, y: 0, w: doc.width, h: doc.height }, null, 8);
    ctx.restore();
    return c;
  }

  // Merge the active layer into the one below (or merge a whole group).
  mergeDown() {
    const doc = this.doc, top = doc.activeLayer;
    if (top.isGroup) return this.mergeGroup();
    const list = doc.siblingsOf(top), i = list.indexOf(top);
    const below = list[i - 1];
    if (!below || below.isGroup || below.adjustment) return;
    if (this.refuseLocked(below, "pixels")) return;
    this.history.begin("Merge Down", [below]);
    // A layer clipped to the one below also needs the compositor to clip it.
    if (top.adjustment || hasStyles(top.styles) || hasStyles(below.styles) || (top.clipped && !below.clipped)) {
      // Effects and adjustments need the full compositor; the result keeps
      // the lower layer's opacity and blend mode, like Photoshop.
      const saved = { opacity: below.opacity, blend: below.blend };
      Object.assign(below, { opacity: 1, blend: "source-over" });
      const merged = this.renderNodes([below, top]);
      Object.assign(below, saved, { styles: null });
      below.setGeometry(0, 0, doc.width, doc.height);
      below.ctx.drawImage(merged, 0, 0);
    } else {
      // Plain pixels: merge without losing anything that's off-canvas.
      const base = this.maskedPixels(below);
      if (base !== below.canvas) below.drawLocal(base);
      if (top.visible) {
        below.ensure(top.bounds);
        below.ctx.globalAlpha = top.opacity;
        below.ctx.globalCompositeOperation = top.blend;
        below.ctx.drawImage(this.maskedPixels(top), top.x, top.y);
        below.ctx.globalAlpha = 1;
        below.ctx.globalCompositeOperation = "source-over";
      }
    }
    below.mask = null;
    below.editMask = false;
    list.splice(i, 1);
    doc.activeLayer = below;
    this.history.commit();
  }

  // Flatten a group into a single layer with the group's opacity and blend.
  mergeGroup() {
    const doc = this.doc, group = doc.activeLayer;
    if (!group.isGroup) return;
    const saved = { opacity: group.opacity, blend: group.blend, visible: group.visible };
    Object.assign(group, { opacity: 1, blend: "source-over", visible: true }); // isolated, mask applied
    const pixels = this.renderNodes([group]);
    Object.assign(group, saved);
    const layer = new Layer(doc.width, doc.height, group.name);
    layer.ctx.drawImage(pixels, 0, 0);
    Object.assign(layer, {
      opacity: saved.opacity, visible: saved.visible,
      blend: saved.blend === "pass-through" ? "source-over" : saved.blend,
    });
    this.history.begin("Merge Group");
    const list = doc.siblingsOf(group);
    list[list.indexOf(group)] = layer;
    doc.activeLayer = layer;
    this.history.commit();
  }

  flatten() {
    const doc = this.doc;
    this.viewMask = null;
    const flat = new Layer(doc.width, doc.height, "Background");
    flat.ctx.drawImage(doc.compose(), 0, 0);
    this.history.begin("Flatten Image");
    doc.layers = [flat];
    doc.activeLayer = flat;
    this.history.commit();
  }

  setLayerProps(layer, props, label) {
    this.history.begin(label);
    Object.assign(layer, props);
    this.history.commit();
  }

  setActiveLayer(layer) {
    if (this.busy || this.doc.activeLayer === layer) return;
    this.doc.activeLayer = layer;
    this.emit("layers");
    this.emit("options");
  }

  toggleVisibility(layer) {
    layer.visible = !layer.visible;
    this.contentChanged();
  }

  // ---------- Groups ----------

  newGroup() {
    this.addLayer(this.doc.newGroup(), "New Group");
  }

  // Put the active layer (or group) into a new group in its place.
  groupLayer() {
    const doc = this.doc, node = doc.activeLayer;
    if (this.busy) return;
    const group = doc.newGroup();
    this.history.begin("Group Layers");
    const list = doc.siblingsOf(node);
    list[list.indexOf(node)] = group;
    group.layers = [node];
    doc.activeLayer = group;
    this.history.commit();
  }

  // Replace the active group with its contents.
  ungroup() {
    const doc = this.doc, group = doc.activeLayer;
    if (!group.isGroup || this.busy) return;
    this.history.begin("Ungroup Layers");
    const list = doc.siblingsOf(group), i = list.indexOf(group);
    list.splice(i, 1, ...group.layers);
    doc.activeLayer = group.layers.at(-1) ?? list[Math.max(0, i - 1)] ?? doc.layers.at(-1);
    this.history.commit();
  }

  toggleExpanded(group) {
    group.expanded = !group.expanded;
    this.emit("layers");
  }

  // ---------- Adjustment layers & styles ----------

  // A new adjustment layer, not yet in the document. It has no pixels of its
  // own (a 1×1 placeholder canvas) and gets a mask, revealing the selection
  // if there is one.
  makeAdjustmentLayer(adjustment, name) {
    const doc = this.doc;
    const layer = new Layer(1, 1, name);
    layer.adjustment = adjustment;
    layer.mask = new LayerMask(doc.width, doc.height, doc.selection ? "#000000" : "#ffffff");
    if (doc.selection) {
      layer.mask.ctx.drawImage(doc.selection.mask, 0, 0);
      layer.mask.refresh();
    }
    layer.editMask = true;
    return layer;
  }

  setStyles(layer, styles, label = "Layer Style") {
    this.history.begin(label);
    layer.styles = hasStyles(styles) ? styles : null;
    this.history.commit();
  }

  // ---------- Layer masks ----------

  // mode: "reveal" (white), "hide" (black) or "selection" (reveal the
  // selection, hide the rest). The new mask becomes the edit target.
  addMask(mode = this.doc.selection ? "selection" : "reveal") {
    const doc = this.doc, layer = doc.activeLayer;
    if (layer.mask || this.busy) return;
    const fromSelection = mode === "selection" && doc.selection;
    const mask = new LayerMask(doc.width, doc.height, mode === "reveal" ? "#ffffff" : "#000000");
    if (fromSelection) {
      mask.ctx.drawImage(doc.selection.mask, 0, 0); // the selection mask is white where selected
      mask.refresh();
    }
    this.history.begin(fromSelection ? "Add Layer Mask (Selection)" : mode === "hide" ? "Add Layer Mask (Hide All)" : "Add Layer Mask");
    layer.mask = mask;
    layer.editMask = true;
    if (fromSelection) doc.selection = null;
    this.history.commit();
  }

  deleteMask() {
    const layer = this.doc.activeLayer;
    if (!layer.mask || this.busy) return;
    if (this.viewMask === layer) this.viewMask = null;
    this.history.begin("Delete Layer Mask");
    layer.mask = null;
    layer.editMask = false;
    this.history.commit();
  }

  // Bake the mask into the layer's pixels and remove it.
  applyMask() {
    const layer = this.doc.activeLayer;
    if (!layer.mask || this.busy || layer.isGroup || layer.adjustment) return; // nothing to bake into
    if (this.viewMask === layer) this.viewMask = null;
    this.history.begin("Apply Layer Mask", [layer]);
    const masked = this.maskedPixels(layer);
    if (masked !== layer.canvas) layer.drawLocal(masked);
    layer.mask = null;
    layer.editMask = false;
    this.history.commit();
  }

  toggleMaskEnabled(layer = this.doc.activeLayer) {
    if (!layer.mask || this.busy) return;
    const on = !layer.mask.enabled;
    this.history.begin(on ? "Enable Layer Mask" : "Disable Layer Mask");
    layer.mask.enabled = on;
    this.history.commit();
  }

  // Show a mask on its own in grayscale (Alt+click its thumbnail).
  toggleMaskView(layer = this.doc.activeLayer) {
    this.viewMask = this.viewMask === layer || !layer.mask ? null : layer;
    this.emit("layers");
    this.requestRender();
  }

  // Load a mask as a selection (Ctrl+click its thumbnail).
  selectionFromMask(layer = this.doc.activeLayer) {
    if (!layer.mask) return;
    const { width: w, height: h } = this.doc;
    const alpha = layer.mask.alphaFor({ x: 0, y: 0, w, h });
    this.setSelection(Selection.fromImageData(alpha.getContext("2d").getImageData(0, 0, w, h)), "Load Selection");
  }
}
