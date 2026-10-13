// The Shape tool (rectangle, ellipse, polygon/star, line) and the Pen tool.
// Both create shape layers (see shapes.js), which stay editable vectors.

import { Selection } from "./selection.js";
import { snapPoint } from "./guides.js";
import {
  corner, rectPoints, ellipsePoints, polygonPoints, shapePath, renderShape, drawPathEditor,
} from "./shapes.js";

const KIND_NAMES = { rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", line: "Line", path: "Shape" };

// Fill/stroke options shared by both tools.
const STYLE_OPTIONS = [
  { key: "fillOn", label: "Fill", type: "checkbox" },
  { key: "fill", label: "", type: "color", when: (s) => s.fillOn },
  { key: "strokeOn", label: "Stroke", type: "checkbox" },
  { key: "stroke", label: "", type: "color", when: (s) => s.strokeOn },
  { key: "strokeWidth", label: "Width", type: "range", min: 1, max: 100, unit: "px", when: (s) => s.strokeOn },
];

// The style part of a shape from tool settings. Lines (and open paths with
// no fill) are drawn with a stroke, falling back to the fill color.
function styleOf(s, open = false) {
  const style = { fill: s.fillOn ? s.fill : null, stroke: s.strokeOn ? s.stroke : null, strokeWidth: s.strokeWidth };
  if (open && !style.stroke) style.stroke = style.fill ?? "#000000";
  if (open) style.fill = null;
  return style;
}

const nextName = (doc, kind) => {
  const base = KIND_NAMES[kind] ?? "Shape";
  const n = doc.leaves().filter((l) => l.name.startsWith(base)).length + 1;
  return `${base} ${n}`;
};

// While a shape layer is selected (and nothing is being drawn), style
// changes in the options bar apply to it. Rapid changes such as a slider
// drag are coalesced into one history entry.
function makeRestyler(settings) {
  let pending = null;
  return {
    apply(app) {
      const layer = app.doc.activeLayer;
      if (!layer.shape || (app.busy && !pending)) return;
      if (!pending && app.refuseLocked(layer, "pixels")) return;
      if (!pending) {
        app.history.begin("Edit Shape", [layer], { keepText: true });
        pending = { timer: 0 };
      }
      layer.shape = { ...layer.shape, ...styleOf(settings, layer.shape.kind === "line") };
      renderShape(layer, app.doc);
      app.requestRender();
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => this.flush(app), 500);
    },
    flush(app) {
      if (!pending) return;
      clearTimeout(pending.timer);
      pending = null;
      app.history.commit();
    },
    get busy() {
      return !!pending;
    },
  };
}

// Show a selected shape layer's style in the options bar.
function syncFromLayer(app, settings, layer) {
  const s = layer?.shape;
  if (!s) return;
  const line = s.kind === "line" || !s.closed;
  Object.assign(settings, {
    fillOn: line ? false : !!s.fill,
    fill: (line ? s.stroke : s.fill) ?? settings.fill,
    strokeOn: line ? true : !!s.stroke,
    stroke: s.stroke ?? settings.stroke,
    strokeWidth: Math.max(1, Math.round(s.strokeWidth)),
  });
  app.emit("options");
}

const toScreen = (app) => (x, y) => ({ sx: app.view.x + x * app.view.zoom, sy: app.view.y + y * app.view.zoom });

// ---------- Shape tool ----------

export function createShapeTool(icon) {
  const settings = {
    type: "rect", radius: 0, sides: 5, star: false,
    fillOn: true, fill: "#000000", strokeOn: false, stroke: "#000000", strokeWidth: 4,
  };
  const restyler = makeRestyler(settings);
  let drag = null, hooked = false;

  // Points for the shape being dragged out. Shift constrains (square,
  // circle, 45° lines); Alt draws from the center.
  function geometry() {
    const { start: a, end: b, shift, alt } = drag;
    if (settings.type === "line") {
      let x1 = b.x, y1 = b.y;
      if (shift) {
        const step = Math.PI / 4, len = Math.hypot(x1 - a.x, y1 - a.y);
        const ang = Math.round(Math.atan2(y1 - a.y, x1 - a.x) / step) * step;
        x1 = a.x + Math.cos(ang) * len;
        y1 = a.y + Math.sin(ang) * len;
      }
      return { points: [corner(a.x, a.y), corner(x1, y1)], closed: false };
    }
    let w = b.x - a.x, h = b.y - a.y;
    if (shift) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    let x = a.x, y = a.y;
    if (alt) {
      x -= w;
      y -= h;
      w *= 2;
      h *= 2;
    }
    const rx = Math.min(x, x + w), ry = Math.min(y, y + h), rw = Math.abs(w), rh = Math.abs(h);
    const cx = rx + rw / 2, cy = ry + rh / 2;
    let points;
    if (settings.type === "ellipse") points = ellipsePoints(cx, cy, rw / 2, rh / 2);
    else if (settings.type === "polygon") points = polygonPoints(cx, cy, rw / 2, rh / 2, settings.sides, settings.star);
    else points = rectPoints(rx, ry, rw, rh, settings.radius);
    return { points, closed: true };
  }

  const currentShape = () => {
    const g = geometry();
    return { kind: settings.type, ...g, ...styleOf(settings, !g.closed) };
  };

  function hook(app) {
    if (hooked) return;
    hooked = true;
    app.on("layers", () => {
      if (app.tool?.id === "shape" && !drag && !restyler.busy) syncFromLayer(app, settings, app.doc.activeLayer);
    });
  }

  return {
    id: "shape", name: "Shape", key: "U", group: 2, icon,
    settings,
    options: [
      { key: "type", type: "segmented", options: [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["polygon", "Polygon"], ["line", "Line"]] },
      { key: "radius", label: "Corners", type: "range", min: 0, max: 200, unit: "px", when: (s) => s.type === "rect" },
      { key: "sides", label: "Sides", type: "range", min: 3, max: 24, when: (s) => s.type === "polygon" },
      { key: "star", label: "Star", type: "checkbox", when: (s) => s.type === "polygon" },
      ...STYLE_OPTIONS,
      { type: "hint", text: "Drag to draw · Shift constrains · Alt draws from the center" },
    ],
    cursor: "crosshair",
    activate(app) {
      hook(app);
      if (app.doc?.activeLayer?.shape) syncFromLayer(app, settings, app.doc.activeLayer);
      else if (!settings.touched) settings.fill = app.fg;
    },
    deactivate(app) {
      restyler.flush(app);
    },
    optionsChanged(app, key) {
      settings.touched = true;
      if (!drag && ["fillOn", "fill", "strokeOn", "stroke", "strokeWidth"].includes(key)) restyler.apply(app);
    },
    down(app, e) {
      restyler.flush(app);
      const p = snapPoint(app, { x: e.x, y: e.y });
      drag = { start: p, end: p, shift: e.shift, alt: e.alt };
    },
    move(app, e) {
      if (!drag) return;
      Object.assign(drag, { end: snapPoint(app, { x: e.x, y: e.y }), shift: e.shift, alt: e.alt });
      app.requestRender(false);
    },
    up(app) {
      if (!drag) return;
      const tiny = Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) * app.view.zoom < 3;
      const shape = tiny ? null : currentShape();
      drag = null;
      app.requestRender(false);
      if (!shape) return;
      const layer = app.doc.newLayer(nextName(app.doc, shape.kind));
      layer.shape = shape;
      renderShape(layer, app.doc);
      app.addLayer(layer, KIND_NAMES[shape.kind]);
    },
    cancel() {
      drag = null;
    },
    // Preview the shape as it will look, plus a thin outline so it's visible
    // over any background.
    drawOverlay(ctx, app) {
      if (!drag) return;
      const shape = currentShape();
      const path = shapePath(shape);
      if (shape.fill) {
        ctx.fillStyle = shape.fill;
        ctx.fill(path);
      }
      if (shape.stroke) {
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = shape.strokeWidth;
        ctx.lineCap = shape.closed ? "butt" : "round";
        ctx.stroke(path);
      }
      ctx.lineWidth = 1 / app.view.zoom;
      ctx.strokeStyle = "rgba(61,139,253,.9)";
      ctx.stroke(path);
    },
  };
}

// ---------- Pen tool ----------

export function createPenTool(icon) {
  const settings = { mode: "shape", fillOn: true, fill: "#000000", strokeOn: false, stroke: "#000000", strokeWidth: 3 };
  const restyler = makeRestyler(settings);
  let draft = null; // { points, dragging } while drawing a new path
  let edit = null;  // { layer, index, part } while dragging a point of the selected shape
  let hooked = false;
  const HIT = 8;

  const near = (app, x, y, e) => {
    const p = toScreen(app)(x, y);
    return Math.hypot(p.sx - e.sx, p.sy - e.sy) <= HIT;
  };

  const editableLayer = (app) => {
    const layer = app.doc.activeLayer;
    return layer.shape && app.doc.isVisible(layer) ? layer : null;
  };

  // Which anchor or handle of a shape is under the pointer (handles first).
  function hitPoint(app, shape, e) {
    for (let i = 0; i < shape.points.length; i++) {
      const p = shape.points[i];
      if ((p.ox !== p.x || p.oy !== p.y) && near(app, p.ox, p.oy, e)) return { index: i, part: "out" };
      if ((p.ix !== p.x || p.iy !== p.y) && near(app, p.ix, p.iy, e)) return { index: i, part: "in" };
    }
    for (let i = 0; i < shape.points.length; i++) {
      if (near(app, shape.points[i].x, shape.points[i].y, e)) return { index: i, part: "anchor" };
    }
    return null;
  }

  // Drag a handle; the opposite handle mirrors it unless Alt is held (which
  // makes a sharp corner).
  function setHandle(p, part, x, y, independent) {
    const other = part === "out" ? "i" : "o";
    p[`${part[0]}x`] = x;
    p[`${part[0]}y`] = y;
    if (!independent) {
      p[`${other}x`] = 2 * p.x - x;
      p[`${other}y`] = 2 * p.y - y;
    }
  }

  function finish(app, closed) {
    const pts = draft?.points ?? [];
    draft = null;
    app.requestRender(false);
    if (pts.length < 2) return;
    const doc = app.doc;
    if (settings.mode === "selection") {
      app.combineSelection(Selection.fromPath(doc.width, doc.height, shapePath({ points: pts, closed: true })), "new", "Pen Selection");
      return;
    }
    const shape = { kind: "path", points: pts, closed, ...styleOf(settings, !closed) };
    const layer = doc.newLayer(nextName(doc, "path"));
    layer.shape = shape;
    renderShape(layer, doc);
    app.addLayer(layer, "Pen Shape");
  }

  function hook(app) {
    if (hooked) return;
    hooked = true;
    app.on("layers", () => {
      if (app.tool?.id === "pen" && !draft && !edit && !restyler.busy) syncFromLayer(app, settings, app.doc.activeLayer);
    });
  }

  return {
    id: "pen", name: "Pen", key: "P", group: 2, icon,
    settings,
    options: [
      { key: "mode", type: "segmented", options: [["shape", "Shape"], ["selection", "Selection"]] },
      ...STYLE_OPTIONS.map((o) => ({ ...o, when: (s) => s.mode === "shape" && (!o.when || o.when(s)) })),
      { type: "hint", text: "Click for corners, drag for curves · click the first point to close · Enter finishes · Esc cancels" },
    ],
    cursor: "crosshair",
    activate(app) {
      hook(app);
      if (app.doc?.activeLayer?.shape) syncFromLayer(app, settings, app.doc.activeLayer);
      else if (!settings.touched) settings.fill = app.fg;
    },
    deactivate(app) {
      restyler.flush(app);
      if (draft) finish(app, false);
    },
    optionsChanged(app, key) {
      settings.touched = true;
      if (!draft && settings.mode === "shape" && ["fillOn", "fill", "strokeOn", "stroke", "strokeWidth"].includes(key)) restyler.apply(app);
    },
    down(app, e) {
      restyler.flush(app);
      if (draft) {
        if (draft.points.length >= 2 && near(app, draft.points[0].x, draft.points[0].y, e)) {
          finish(app, true);
          return;
        }
        draft.points.push(corner(e.x, e.y));
        draft.dragging = draft.points.length - 1;
        app.requestRender(false);
        return;
      }
      // Grab a point of the selected shape layer to reshape it.
      const layer = editableLayer(app);
      const hit = layer && hitPoint(app, layer.shape, e);
      if (hit && app.refuseLocked(layer, "pixels")) return;
      if (hit) {
        app.history.begin("Edit Path", [layer], { keepText: true });
        edit = { layer, ...hit, start: { x: e.x, y: e.y }, orig: layer.shape };
        return;
      }
      draft = { points: [corner(e.x, e.y)], dragging: 0 };
      app.requestRender(false);
    },
    move(app, e) {
      if (edit) {
        const s = edit.orig;
        const pts = s.points.map((p) => ({ ...p }));
        const p = pts[edit.index];
        if (edit.part === "anchor") {
          const dx = e.x - edit.start.x, dy = e.y - edit.start.y;
          const o = s.points[edit.index];
          Object.assign(p, { x: o.x + dx, y: o.y + dy, ix: o.ix + dx, iy: o.iy + dy, ox: o.ox + dx, oy: o.oy + dy });
        } else {
          setHandle(p, edit.part, e.x, e.y, e.alt);
        }
        edit.layer.shape = { ...s, points: pts };
        renderShape(edit.layer, app.doc);
        app.requestRender();
        return;
      }
      if (draft && draft.dragging !== null) {
        const p = draft.points[draft.dragging];
        if (Math.hypot(e.x - p.x, e.y - p.y) * app.view.zoom > 2) setHandle(p, "out", e.x, e.y, e.alt);
        app.requestRender(false);
      }
    },
    up(app) {
      if (edit) {
        edit = null;
        app.history.commit();
      }
      if (draft) draft.dragging = null;
    },
    cancel(app) {
      if (edit) {
        edit.layer.shape = edit.orig;
        renderShape(edit.layer, app.doc);
        edit = null;
      }
      if (draft) draft.dragging = null;
    },
    keydown(app, ev) {
      if (!draft) return false;
      if (ev.key === "Enter") finish(app, false);
      else if (ev.key === "Escape") {
        draft = null;
        app.requestRender(false);
      } else if (ev.key === "Backspace" || ev.key === "Delete") {
        draft.points.pop();
        if (!draft.points.length) draft = null;
        app.requestRender(false);
      } else return false;
      return true;
    },
    // The path being drawn, or the selected shape's anchors and handles.
    drawScreenOverlay(ctx, app) {
      const map = toScreen(app);
      if (draft) drawPathEditor(ctx, { points: draft.points, closed: false }, map, { active: draft.points.length - 1 });
      else {
        const layer = editableLayer(app);
        if (layer) drawPathEditor(ctx, layer.shape, map, { active: edit?.part === "anchor" ? edit.index : -1 });
      }
    },
    // Rubber band from the last point to the pointer, and a "close" ring
    // when hovering the first point.
    drawCursor(ctx, app) {
      if (!draft || draft.dragging !== null) return;
      const map = toScreen(app);
      const last = draft.points.at(-1), first = draft.points[0];
      const ptr = app.pointer;
      const a = map(last.x, last.y), o = map(last.ox, last.oy);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.quadraticCurveTo(o.sx, o.sy, ptr.sx, ptr.sy);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#3d8bfd";
      ctx.stroke();
      ctx.setLineDash([]);
      if (draft.points.length >= 2 && near(app, first.x, first.y, ptr)) {
        const f = map(first.x, first.y);
        ctx.beginPath();
        ctx.arc(f.sx, f.sy, 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    },
  };
}
