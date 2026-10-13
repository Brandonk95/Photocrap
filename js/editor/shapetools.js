// The Shape tool (rectangles, ellipses, triangles, polygons, stars, arrows,
// hearts, speech bubbles and lines) and the Pen tool. Both create shape
// layers (see shapes.js), which stay editable vectors.

import { Selection } from "./selection.js";
import { snapPoint } from "./guides.js";
import { openDialog } from "./dialogs.js";
import { HANDLE_FRACTIONS, hitHandle, drawBox, drawHandles, resizeCursor } from "./handles.js";
import {
  corner, shapePath, renderShape, paintShape, drawPathEditor, livePoints, withLive,
} from "./shapes.js";

const KIND_NAMES = {
  rect: "Rectangle", ellipse: "Ellipse", triangle: "Triangle", polygon: "Polygon", star: "Star",
  arrow: "Arrow", heart: "Heart", bubble: "Speech Bubble", line: "Line", path: "Shape",
};

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SHAPE_ICONS = {
  rect: svg('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="7"/>'),
  triangle: svg('<path d="M12 4 21 20H3z"/>'),
  polygon: svg('<path d="m12 3 8.5 6.2-3.2 10H6.7l-3.2-10z"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>'),
  line: svg('<path d="M5 19 19 5"/>'),
  arrow: svg('<path d="M3 9.5h11V5l7 7-7 7v-4.5H3z"/>'),
  heart: svg('<path d="M12 20s-8-5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20z"/>'),
  bubble: svg('<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>'),
};

// Fill/stroke options shared by both tools.
const STYLE_OPTIONS = [
  { key: "fillOn", label: "Fill", type: "checkbox", when: (s) => s.type !== "line" },
  { key: "fill", label: "", type: "color", when: (s) => s.fillOn && s.type !== "line" },
  { key: "strokeOn", label: "Stroke", type: "checkbox", when: (s) => s.type !== "line" },
  { key: "stroke", label: "", type: "color", when: (s) => s.strokeOn || s.type === "line" },
  { key: "strokeWidth", label: "Width", type: "range", min: 1, max: 100, unit: "px", when: (s) => s.strokeOn || s.type === "line" },
  {
    key: "dash", type: "select", label: "", when: (s) => s.strokeOn || s.type === "line",
    options: [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]],
  },
];
const STYLE_KEYS = ["fillOn", "fill", "strokeOn", "stroke", "strokeWidth", "dash", "arrowStart", "arrowEnd"];
const GEOMETRY_KEYS = ["radius", "sides", "points", "indent"];

// The style part of a shape from tool settings. Lines (and open paths with
// no fill) are drawn with a stroke, falling back to the fill color.
function styleOf(s, open = false) {
  const style = {
    fill: s.fillOn ? s.fill : null, stroke: s.strokeOn ? s.stroke : null,
    strokeWidth: s.strokeWidth, dash: s.dash ?? "solid",
  };
  if (open) {
    if (!style.stroke) style.stroke = s.type === "line" ? s.stroke : style.fill ?? "#000000";
    style.fill = null;
    style.arrowStart = !!s.arrowStart;
    style.arrowEnd = !!s.arrowEnd;
  }
  return style;
}

// The live-shape parameters the tool settings ask for.
function liveParams(s, type = s.type) {
  if (type === "polygon") return { sides: s.sides };
  if (type === "star") return { sides: s.points, inner: 1 - s.indent / 100 };
  if (type === "rect" || type === "bubble") return { radius: s.radius };
  return {};
}

const nextName = (doc, kind) => {
  const base = KIND_NAMES[kind] ?? "Shape";
  const n = doc.leaves().filter((l) => l.name.startsWith(base)).length + 1;
  return `${base} ${n}`;
};

// While a shape layer is selected (and nothing is being drawn), changes in
// the options bar apply to it: its style, and for live shapes their corner
// radius, sides and so on. Rapid changes such as a slider drag are
// coalesced into one history entry.
function makeRestyler(settings) {
  let pending = null;
  return {
    apply(app, key) {
      const layer = app.doc.activeLayer;
      const shape = layer.shape;
      if (!shape || (app.busy && !pending)) return;
      const geometry = GEOMETRY_KEYS.includes(key);
      // Only geometry that applies to this kind of shape.
      if (geometry && !(shape.live && key in paramKeys(shape.live.type))) return;
      if (!pending && app.refuseLocked(layer, "pixels")) return;
      if (!pending) {
        app.history.begin("Edit Shape", [layer], { keepText: true });
        pending = { timer: 0 };
      }
      if (geometry) layer.shape = withLive(shape, liveParams(settings, shape.live.type));
      else layer.shape = { ...shape, ...styleOf({ ...settings, type: shape.kind }, !shape.closed) };
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

// Which settings keys change which live-shape types.
function paramKeys(type) {
  if (type === "polygon") return { sides: 1 };
  if (type === "star") return { points: 1, indent: 1 };
  if (type === "rect" || type === "bubble") return { radius: 1 };
  return {};
}

// Show a selected shape layer's settings in the options bar.
function syncFromLayer(app, settings, layer, { type = false } = {}) {
  const s = layer?.shape;
  if (!s) return;
  const open = !s.closed;
  Object.assign(settings, {
    fillOn: open ? settings.fillOn : !!s.fill,
    fill: (open ? null : s.fill) ?? settings.fill,
    strokeOn: open ? settings.strokeOn : !!s.stroke, // a line's stroke says nothing about filled shapes
    stroke: s.stroke ?? settings.stroke,
    strokeWidth: Math.max(1, Math.round(s.strokeWidth)),
    dash: s.dash ?? "solid",
  });
  if (open) Object.assign(settings, { arrowStart: !!s.arrowStart, arrowEnd: !!s.arrowEnd });
  if (type) {
    const live = s.live;
    if (live) {
      settings.type = live.type;
      if (live.type === "polygon") settings.sides = live.sides;
      if (live.type === "star") Object.assign(settings, { points: live.sides, indent: Math.round((1 - live.inner) * 100) });
      if (live.type === "rect" || live.type === "bubble") settings.radius = Math.round(live.radius ?? 0);
    } else if (s.kind === "line") {
      settings.type = "line";
    }
  }
  app.emit("options");
}

const toScreen = (app) => (x, y) => ({ sx: app.view.x + x * app.view.zoom, sy: app.view.y + y * app.view.zoom });

// ---------- Shape tool ----------

// A live shape's own frame: (0, 0) at its center, axes along its sides.
const frame = (live) => {
  const a = ((live.angle ?? 0) * Math.PI) / 180;
  return { cos: Math.cos(a), sin: Math.sin(a) };
};
const toWorld = (live, lx, ly) => {
  const { cos, sin } = frame(live);
  return { x: live.cx + cos * lx - sin * ly, y: live.cy + sin * lx + cos * ly };
};
const toLocal = (live, x, y) => {
  const { cos, sin } = frame(live), dx = x - live.cx, dy = y - live.cy;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
};

export function createShapeTool(icon) {
  const settings = {
    type: "rect", radius: 0, sides: 6, points: 5, indent: 50,
    fillOn: true, fill: "#000000", strokeOn: false, stroke: "#000000", strokeWidth: 4, dash: "solid",
    arrowStart: false, arrowEnd: true,
  };
  const restyler = makeRestyler(settings);
  let drag = null;  // drawing a new shape
  let edit = null;  // resizing the selected one, or dragging its corner radius
  let hooked = false;

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
    const rw = Math.max(1, Math.abs(w)), rh = Math.max(1, Math.abs(h));
    const live = {
      type: settings.type, cx: Math.min(x, x + w) + rw / 2, cy: Math.min(y, y + h) + rh / 2,
      w: rw, h: rh, angle: 0, flip: false, ...liveParams(settings),
    };
    return { live, points: livePoints(live), closed: true };
  }

  const newShape = (g) => ({ kind: settings.type, ...g, ...styleOf(settings, !g.closed) });

  function create(app, shape) {
    const layer = app.doc.newLayer(nextName(app.doc, shape.kind));
    layer.shape = shape;
    renderShape(layer, app.doc);
    app.addLayer(layer, `New ${KIND_NAMES[shape.kind]}`);
  }

  // Clicking without dragging asks for an exact size, like Photoshop.
  async function createBySize(app, at) {
    const type = settings.type;
    const extra = [];
    if (type === "rect" || type === "bubble") extra.push({ key: "radius", label: "Corner radius", type: "number", min: 0, max: 10000, value: settings.radius, unit: "px" });
    if (type === "polygon") extra.push({ key: "sides", label: "Sides", type: "number", min: 3, max: 64, value: settings.sides });
    if (type === "star") {
      extra.push({ key: "points", label: "Points", type: "number", min: 3, max: 64, value: settings.points });
      extra.push({ key: "indent", label: "Indent", type: "number", min: 1, max: 99, value: settings.indent, unit: "%" });
    }
    const v = await openDialog({
      title: `Create ${KIND_NAMES[type]}`,
      okLabel: "Create",
      fields: [
        { key: "w", label: "Width", type: "number", min: 1, max: 100000, value: settings.lastW ?? 200, unit: "px" },
        { key: "h", label: "Height", type: "number", min: 1, max: 100000, value: settings.lastH ?? 200, unit: "px" },
        ...extra,
        { key: "center", label: "From center", type: "checkbox", value: false },
      ],
    });
    if (!v) return;
    Object.assign(settings, { lastW: v.w, lastH: v.h });
    for (const k of ["radius", "sides", "points", "indent"]) if (k in v) settings[k] = v[k];
    app.emit("options");
    const live = {
      type, cx: v.center ? at.x : at.x + v.w / 2, cy: v.center ? at.y : at.y + v.h / 2,
      w: Math.max(1, v.w), h: Math.max(1, v.h), angle: 0, flip: false, ...liveParams(settings),
    };
    create(app, newShape({ live, points: livePoints(live), closed: true }));
  }

  // ---- Editing the selected shape on the canvas ----

  // The selected live shape, if it can be edited here.
  function editable(app) {
    const layer = app.doc?.activeLayer;
    return layer?.shape?.live && app.doc.isVisible(layer) ? layer : null;
  }
  function handlePoints(app, live) {
    const map = toScreen(app);
    return HANDLE_FRACTIONS.map(([fx, fy]) => {
      const p = toWorld(live, (fx - 0.5) * live.w, (fy - 0.5) * live.h);
      return { fx, fy, ...map(p.x, p.y) };
    });
  }
  const hasRadius = (live) => live.type === "rect";
  // The corner-radius widget sits inside the top-left corner.
  function radiusWidget(app, live) {
    if (!hasRadius(live) || Math.min(live.w, live.h) * app.view.zoom < 36) return null;
    const d = Math.max(live.radius ?? 0, 14 / app.view.zoom);
    const p = toWorld(live, -live.w / 2 + d, -live.h / 2 + d);
    return toScreen(app)(p.x, p.y);
  }
  function hitEdit(app, e) {
    const layer = editable(app);
    if (!layer) return null;
    const live = layer.shape.live;
    const rw = radiusWidget(app, live);
    if (rw && Math.hypot(rw.sx - e.sx, rw.sy - e.sy) <= 7) return { layer, type: "radius" };
    const hit = hitHandle(handlePoints(app, live), e.sx, e.sy);
    return hit ? { layer, type: "resize", hit } : null;
  }

  function editMove(app, e) {
    const L = edit.orig.live;
    const p = L.angle ? e : snapPoint(app, e);
    const pl = toLocal(L, p.x, p.y);
    let changes;
    if (edit.type === "radius") {
      const r = Math.min(pl.x + L.w / 2, pl.y + L.h / 2);
      changes = { radius: Math.round(Math.max(0, Math.min(r, Math.min(L.w, L.h) / 2))) };
    } else {
      // Resize with the opposite handle pinned, in the shape's own frame.
      const { fx, fy } = edit.hit;
      let x0 = -L.w / 2, x1 = L.w / 2, y0 = -L.h / 2, y1 = L.h / 2;
      if (fx !== 0.5) { x0 = (0.5 - fx) * L.w; x1 = pl.x; }
      if (fy !== 0.5) { y0 = (0.5 - fy) * L.h; y1 = pl.y; }
      if (e.shift && fx !== 0.5 && fy !== 0.5) {
        const k = Math.max(Math.abs(x1 - x0) / L.w, Math.abs(y1 - y0) / L.h);
        x1 = x0 + Math.sign(x1 - x0 || 1) * L.w * k;
        y1 = y0 + Math.sign(y1 - y0 || 1) * L.h * k;
      }
      const c = toWorld(L, (x0 + x1) / 2, (y0 + y1) / 2);
      changes = { cx: c.x, cy: c.y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }
    edit.layer.shape = withLive(edit.orig, changes);
    renderShape(edit.layer, app.doc);
    if (changes.radius != null && settings.radius !== changes.radius) {
      settings.radius = changes.radius;
      app.emit("options");
    }
    app.requestRender();
  }

  function hook(app) {
    if (hooked) return;
    hooked = true;
    app.on("layers", () => {
      if (app.tool?.id === "shape" && !drag && !edit && !restyler.busy) syncFromLayer(app, settings, app.doc.activeLayer);
    });
  }

  return {
    id: "shape", name: "Shape", key: "U", group: 2, icon,
    settings,
    options: [
      { key: "type", type: "segmented", options: Object.keys(SHAPE_ICONS).map((k) => [k, KIND_NAMES[k], SHAPE_ICONS[k]]) },
      { key: "radius", label: "Corners", type: "range", min: 0, max: 200, unit: "px", when: (s) => s.type === "rect" || s.type === "bubble" },
      { key: "sides", label: "Sides", type: "range", min: 3, max: 24, when: (s) => s.type === "polygon" },
      { key: "points", label: "Points", type: "range", min: 3, max: 24, when: (s) => s.type === "star" },
      { key: "indent", label: "Indent", type: "range", min: 5, max: 95, unit: "%", when: (s) => s.type === "star" },
      { key: "arrowStart", label: "Start arrow", type: "checkbox", when: (s) => s.type === "line" },
      { key: "arrowEnd", label: "End arrow", type: "checkbox", when: (s) => s.type === "line" },
      ...STYLE_OPTIONS,
      { type: "hint", text: "Drag to draw · click for an exact size · Shift constrains · Alt from the center · drag the handles to resize" },
    ],
    cursor(app, p) {
      if (!p || drag) return "crosshair";
      if (edit) return edit.type === "radius" ? "grabbing" : "crosshair";
      const hit = hitEdit(app, p);
      if (!hit) return "crosshair";
      if (hit.type === "radius") return "grab";
      const L = hit.layer.shape.live;
      return resizeCursor(toScreen(app)(L.cx, L.cy), hit.hit);
    },
    activate(app) {
      hook(app);
      if (app.doc?.activeLayer?.shape) syncFromLayer(app, settings, app.doc.activeLayer, { type: true });
      else if (!settings.touched) settings.fill = app.fg;
    },
    deactivate(app) {
      restyler.flush(app);
    },
    optionsChanged(app, key) {
      settings.touched = true;
      if (!drag && !edit && (STYLE_KEYS.includes(key) || GEOMETRY_KEYS.includes(key))) restyler.apply(app, key);
    },
    down(app, e) {
      restyler.flush(app);
      const hit = hitEdit(app, e);
      if (hit) {
        if (app.refuseLocked(hit.layer, "pixels")) return;
        app.history.begin(hit.type === "radius" ? "Corner Radius" : "Resize Shape", [hit.layer], { keepText: true });
        edit = { ...hit, orig: hit.layer.shape };
        return;
      }
      const p = snapPoint(app, { x: e.x, y: e.y });
      drag = { start: p, end: p, shift: e.shift, alt: e.alt };
    },
    move(app, e) {
      if (edit) {
        editMove(app, e);
        return;
      }
      if (!drag) return;
      Object.assign(drag, { end: snapPoint(app, { x: e.x, y: e.y }), shift: e.shift, alt: e.alt });
      app.requestRender(false);
    },
    up(app) {
      if (edit) {
        edit = null;
        app.history.commit();
        return;
      }
      if (!drag) return;
      const tiny = Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) * app.view.zoom < 3;
      const at = drag.start;
      const shape = tiny ? null : newShape(geometry());
      drag = null;
      app.requestRender(false);
      if (shape) create(app, shape);
      else if (settings.type !== "line") createBySize(app, at);
    },
    cancel(app) {
      drag = null;
      if (edit) {
        edit.layer.shape = edit.orig;
        renderShape(edit.layer, app.doc);
        edit = null;
      }
    },
    // Preview the shape as it will look, plus a thin outline so it's visible
    // over any background.
    drawOverlay(ctx, app) {
      if (!drag) return;
      const shape = newShape(geometry());
      ctx.save();
      paintShape(ctx, shape);
      ctx.restore();
      ctx.lineWidth = 1 / app.view.zoom;
      ctx.strokeStyle = "rgba(61,139,253,.9)";
      ctx.stroke(shapePath(shape));
    },
    // The selected shape's box, resize handles and corner-radius widget.
    drawScreenOverlay(ctx, app) {
      if (drag) return;
      const layer = editable(app);
      if (!layer) return;
      const live = layer.shape.live;
      const pts = handlePoints(app, live);
      drawBox(ctx, pts.slice(0, 4));
      drawHandles(ctx, pts);
      const rw = radiusWidget(app, live);
      if (rw) {
        ctx.beginPath();
        ctx.arc(rw.sx, rw.sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = edit?.type === "radius" ? "#3d8bfd" : "#fff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#3d8bfd";
        ctx.stroke();
      }
    },
  };
}

// ---------- Pen tool ----------

export function createPenTool(icon) {
  const settings = { mode: "shape", type: "path", fillOn: true, fill: "#000000", strokeOn: false, stroke: "#000000", strokeWidth: 3, dash: "solid" };
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
      if (!draft && settings.mode === "shape" && STYLE_KEYS.includes(key)) restyler.apply(app, key);
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
        edit.layer.shape = { ...s, points: pts, live: undefined }; // reshaped by hand: no longer a live shape
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
