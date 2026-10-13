import { createCanvas, cloneCanvas, hexToRgb, rgbToHex, rgba, normRect, unionRect, clamp, h } from "./util.js";
import { sampleImage, maskFromCanvas, cropImage, healRegion, findSourceOffset, healInto } from "./heal.js";
import { textFont, renderText, nameFor, textLayerAt, LINE_HEIGHT } from "./text.js";
import { translateShape } from "./shapes.js";
import { createShapeTool, createPenTool } from "./shapetools.js";
import { Selection, floodFill } from "./selection.js";
import { QuickSelect } from "./quickselect.js";
import { HANDLE_FRACTIONS, hitHandle, drawHandles, resizeCursor } from "./handles.js";
import { createTransformTool } from "./transform.js";
import { snapPoint, snapBox } from "./guides.js";

const icon = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  move: icon('<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
  marquee: icon('<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.5"/>'),
  ellipse: icon('<ellipse cx="12" cy="12" rx="8.5" ry="7" stroke-dasharray="3 2.5"/>'),
  lasso: icon('<path d="M7.5 16.5C4.5 15.5 3 13.4 3.4 11 4.2 6.8 9.5 4.6 14.5 5.2s7.2 3.8 5.6 6.6c-1.6 2.9-6.6 4.3-11.3 4.2"/><circle cx="7.5" cy="17.5" r="1.6"/><path d="M7.5 19.1c0 1.4.9 2.4 2.4 2.4"/>'),
  wand: icon('<path d="m4 20 11-11M15 9l2-2M17 3v2M21 7h-2M19.8 4.2l-1.4 1.4M13 4.5l.6 1.4M19.5 11l-1.4-.6"/>'),
  quickSelect: icon('<path d="M14.5 3.5a2 2 0 0 1 2.8 2.8L9 14.6l-2.8-2.8z"/><path d="M6 12.4c-1.8.3-3 1.8-3 3.6v4h4c1.8 0 3.3-1.2 3.6-3"/><circle cx="17" cy="17" r="4.5" stroke-dasharray="2.2 2"/>'),
  crop: icon('<path d="M6 2v16h16M2 6h16v16"/>'),
  eyedropper: icon('<path d="m14 7 3 3M5 19l-1 1M15.5 5.5a2.1 2.1 0 0 1 3 3L9 18H6v-3z"/>'),
  brush: icon('<path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L12.5 15.3l-2.8-2.8z"/><path d="M8.6 13.6c-2 0-3.6 1.6-3.6 3.6 0 1.4-.9 2.4-2.3 2.8 1 .7 2.5 1 4 1 2.6 0 4.5-2 4.5-4.6"/>'),
  eraser: icon('<path d="M8 20h12M5.4 14.6 13.9 6a2 2 0 0 1 2.8 0l3.3 3.3a2 2 0 0 1 0 2.8L12 20H8.8l-3.4-3.4a1.4 1.4 0 0 1 0-2z"/><path d="m10 10 6 6"/>'),
  clone: icon('<path d="M9.5 3h5l-.8 6h-3.4zM5 12.5A2.5 2.5 0 0 1 7.5 10h9a2.5 2.5 0 0 1 2.5 2.5V15H5zM4 18h16v3H4z"/>'),
  spotHeal: icon('<rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)"/><path d="M10.6 10.6h.01M13.4 13.4h.01M10.6 13.4h.01M13.4 10.6h.01" stroke-width="2.4"/>'),
  healBrush: icon('<rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>'),
  bucket: icon('<path d="m5 11 7-7 8 8-7 7a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8zM5 12h15"/><path d="M20.5 16s1.8 2.1 1.8 3.3a1.8 1.8 0 0 1-3.6 0c0-1.2 1.8-3.3 1.8-3.3z"/>'),
  gradient: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14" stroke-width="4" opacity=".9"/><path d="M12 5v14" stroke-width="4" opacity=".45"/><path d="M17 5v14" stroke-width="4" opacity=".15"/>'),
  text: icon('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  shape: icon('<rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5" fill="currentColor" fill-opacity=".35"/>'),
  pen: icon('<path d="M12 19l7-7 2 2-7 7zM18 13l-1.5-7.5L3 2l3.5 13.5L14 17zM3 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>'),
  hand: icon('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0v8M14 11.5V5a1.5 1.5 0 0 1 3 0v7M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7l-2.7-3.8a1.5 1.5 0 0 1 2.5-1.6L8 14.5"/>'),
  zoom: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5M8 10.5h5M10.5 8v5"/>'),
};

// Reusable doc-sized scratch canvases. pooled() hands back whatever was
// there before; scratch() also clears it.
const pool = new Map();
function pooled(name, w, h) {
  let c = pool.get(name);
  if (!c) pool.set(name, (c = createCanvas(w, h)));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}
function scratch(name, w, h) {
  const c = pooled(name, w, h);
  c.getContext("2d").clearRect(0, 0, w, h);
  return c;
}

function clipTo(ctx, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
}

function maskInto(ctx, sel) {
  if (!sel) return;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(sel.mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

// Stroke the path built by draw() as a black/white dashed line, 1 screen px wide.
function dashed(ctx, zoom, draw) {
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  draw();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(0,0,0,.8)";
  ctx.stroke();
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.setLineDash([]);
}

function inDoc(app, x, y) {
  return x >= 0 && y >= 0 && x < app.doc.width && y < app.doc.height;
}

// ---------- Selection tools ----------

const SELECT_MODE = {
  key: "mode",
  type: "segmented",
  options: [["new", "New"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]],
};
const SELECT_HINT = "Shift adds to the selection · Alt subtracts";
const modeFor = (e, s) => (e.shift && e.alt ? "intersect" : e.shift ? "add" : e.alt ? "subtract" : s.mode);

function marqueeTool({ id, name, ellipse }) {
  const settings = { mode: "new" };
  let start = null, end = null, mode, constrain = false, shiftAtStart = false;

  const rect = () => {
    let w = end.x - start.x, hh = end.y - start.y;
    if (constrain) {
      const s = Math.max(Math.abs(w), Math.abs(hh));
      w = Math.sign(w || 1) * s;
      hh = Math.sign(hh || 1) * s;
    }
    const r = normRect(start.x, start.y, start.x + w, start.y + hh);
    if (ellipse) return r;
    const x0 = Math.round(r.x), y0 = Math.round(r.y);
    return { x: x0, y: y0, w: Math.round(r.x + r.w) - x0, h: Math.round(r.y + r.h) - y0 };
  };

  return {
    id, name, key: "M", group: 1, icon: ellipse ? ICONS.ellipse : ICONS.marquee,
    settings, options: [SELECT_MODE, { type: "hint", text: `${SELECT_HINT} · Shift while dragging constrains` }],
    cursor: "crosshair",
    down(app, e) {
      start = end = snapPoint(app, { x: e.x, y: e.y });
      mode = modeFor(e, settings);
      shiftAtStart = e.shift;
      constrain = false;
    },
    move(app, e) {
      if (!start) return;
      end = snapPoint(app, { x: e.x, y: e.y });
      constrain = e.shift && !shiftAtStart;
      app.requestRender(false);
    },
    up(app) {
      if (!start) return;
      const r = rect();
      start = null;
      if (r.w < 1 || r.h < 1) {
        if (mode === "new") app.deselect();
        app.requestRender(false);
        return;
      }
      const path = new Path2D();
      if (ellipse) path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      else path.rect(r.x, r.y, r.w, r.h);
      app.combineSelection(Selection.fromPath(app.doc.width, app.doc.height, path), mode, name);
    },
    cancel() {
      start = null;
    },
    drawOverlay(ctx, app) {
      if (!start) return;
      const r = rect();
      dashed(ctx, app.view.zoom, () => {
        if (ellipse) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(r.x, r.y, r.w, r.h);
      });
    },
  };
}

function lassoTool() {
  const settings = { mode: "new" };
  let points = null, mode;
  return {
    id: "lasso", name: "Lasso", key: "L", group: 1, icon: ICONS.lasso,
    settings, options: [SELECT_MODE, { type: "hint", text: SELECT_HINT }],
    cursor: "crosshair",
    down(app, e) {
      points = [[e.x, e.y]];
      mode = modeFor(e, settings);
    },
    move(app, e) {
      if (!points) return;
      const [lx, ly] = points.at(-1);
      if (Math.hypot(e.x - lx, e.y - ly) * app.view.zoom < 2) return;
      points.push([e.x, e.y]);
      app.requestRender(false);
    },
    up(app) {
      if (!points) return;
      const pts = points;
      points = null;
      if (pts.length < 3) {
        if (mode === "new") app.deselect();
        app.requestRender(false);
        return;
      }
      const path = new Path2D();
      path.moveTo(...pts[0]);
      for (const p of pts.slice(1)) path.lineTo(...p);
      path.closePath();
      app.combineSelection(Selection.fromPath(app.doc.width, app.doc.height, path), mode, "Lasso");
    },
    cancel() {
      points = null;
    },
    drawOverlay(ctx, app) {
      if (!points) return;
      dashed(ctx, app.view.zoom, () => {
        ctx.moveTo(...points[0]);
        for (const p of points.slice(1)) ctx.lineTo(...p);
      });
    },
  };
}

function quickSelectTool() {
  const settings = { mode: "new", size: 30, allLayers: false, enhance: true };
  let qs = null, mode = "add", last = null, overlay = null, changed = null;

  // Dabs every quarter brush along the drag, so fast strokes don't skip.
  function dabTo(app, x, y) {
    const r = settings.size / 2;
    const step = Math.max(1, r / 2);
    const from = last ?? { x, y };
    const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / step));
    for (let i = last ? 1 : 0; i <= n; i++) {
      const rect = qs.dab(from.x + ((x - from.x) * i) / n, from.y + ((y - from.y) * i) / n, r);
      if (!rect) continue;
      changed = unionRect(changed, rect);
      paintOverlay(app, rect);
    }
    last = { x, y };
    app.requestRender(false);
  }

  // Tint what the stroke has picked so far.
  function paintOverlay(app, r) {
    const img = new ImageData(r.w, r.h);
    const [cr, cg, cb] = mode === "subtract" ? [235, 70, 70] : [61, 139, 253];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (!qs.mask[(r.y + y) * app.doc.width + r.x + x]) continue;
        const k = (y * r.w + x) * 4;
        img.data[k] = cr;
        img.data[k + 1] = cg;
        img.data[k + 2] = cb;
        img.data[k + 3] = 255;
      }
    }
    overlay.getContext("2d").putImageData(img, r.x, r.y);
  }

  return {
    id: "quickselect", name: "Quick Selection", key: "W", group: 1, icon: ICONS.quickSelect,
    settings,
    options: [
      { ...SELECT_MODE, options: SELECT_MODE.options.filter(([v]) => v !== "intersect") },
      { key: "size", label: "Size", type: "range", min: 2, max: 300, unit: "px" },
      { key: "allLayers", label: "Sample all layers", type: "checkbox" },
      { key: "enhance", label: "Auto-enhance", type: "checkbox" },
      { type: "hint", text: "Paint over what you want · Alt subtracts" },
    ],
    cursor: "none",
    down(app, e) {
      const doc = app.doc;
      mode = modeFor(e, settings);
      if (mode === "intersect") mode = "add";
      if (mode === "new" && doc.selection) mode = "add"; // after the first stroke, strokes add (as in Photoshop)
      const node = doc.activeLayer;
      const full = { x: 0, y: 0, w: doc.width, h: doc.height };
      const data = settings.allLayers || node.isGroup || node.adjustment || doc.quickMask
        ? doc.compose().getContext("2d").getImageData(0, 0, doc.width, doc.height)
        : node.getDocImageData(full);
      qs = new QuickSelect(data);
      overlay = scratch("quick-select", doc.width, doc.height);
      last = null;
      changed = null;
      dabTo(app, e.x, e.y);
    },
    move(app, e) {
      if (qs) dabTo(app, e.x, e.y);
    },
    up(app) {
      if (!qs) return;
      const doc = app.doc;
      const maxHole = (settings.size * settings.size) * 3;
      let sel = Selection.fromArray(doc.width, doc.height, qs.result(maxHole));
      qs = null;
      if (settings.enhance) sel = sel.feathered(1.5);
      app.combineSelection(sel, mode, "Quick Selection");
      if (settings.mode === "new") {
        settings.mode = "add";
        app.emit("options");
      }
    },
    cancel(app) {
      qs = null;
      app.requestRender(false);
    },
    drawOverlay(ctx, app) {
      if (!qs || !overlay) return;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(overlay, 0, 0);
      ctx.restore();
    },
    drawCursor(ctx, app) {
      drawBrushCursor(ctx, app, settings.size);
      // A + or − in the middle says whether the stroke adds or subtracts.
      const p = app.pointer;
      const sub = qs ? mode === "subtract" : !!p.alt || settings.mode === "subtract";
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.shadowColor = "rgba(0,0,0,.8)";
      ctx.shadowBlur = 2;
      ctx.beginPath();
      ctx.moveTo(p.sx - 4, p.sy);
      ctx.lineTo(p.sx + 4, p.sy);
      if (!sub) {
        ctx.moveTo(p.sx, p.sy - 4);
        ctx.lineTo(p.sx, p.sy + 4);
      }
      ctx.stroke();
      ctx.restore();
    },
  };
}

function wandTool() {
  const settings = { mode: "new", tolerance: 32, contiguous: true, allLayers: false };
  return {
    id: "wand", name: "Magic Wand", key: "W", group: 1, icon: ICONS.wand,
    settings,
    options: [
      SELECT_MODE,
      { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 255 },
      { key: "contiguous", label: "Contiguous", type: "checkbox" },
      { key: "allLayers", label: "Sample all layers", type: "checkbox" },
    ],
    cursor: "crosshair",
    down(app, e) {
      const doc = app.doc;
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (!inDoc(app, x, y)) return;
      const full = { x: 0, y: 0, w: doc.width, h: doc.height };
      const node = doc.activeLayer;
      // Groups and adjustment layers have no pixels of their own: sample the image.
      const data = settings.allLayers || node.isGroup || node.adjustment
        ? doc.compose().getContext("2d").getImageData(0, 0, doc.width, doc.height)
        : node.getDocImageData(full);
      const mask = floodFill(data, x, y, settings.tolerance, settings.contiguous);
      app.combineSelection(Selection.fromArray(doc.width, doc.height, mask), modeFor(e, settings), "Magic Wand");
    },
  };
}

const screenPoint = (app, x, y) => ({ sx: app.view.x + x * app.view.zoom, sy: app.view.y + y * app.view.zoom });

function cropTool() {
  let rect = null, drag = null;
  const handlePoints = (app) =>
    HANDLE_FRACTIONS.map(([fx, fy]) => ({ fx, fy, ...screenPoint(app, rect.x + fx * rect.w, rect.y + fy * rect.h) }));
  const inside = (p) => rect && p && p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h;
  const apply = (app) => {
    if (!rect) return;
    const r = rect;
    rect = null;
    app.crop(r);
  };
  const cancel = (app) => {
    rect = null;
    app.requestRender(false);
  };
  return {
    id: "crop", name: "Crop", key: "C", group: 1, icon: ICONS.crop,
    settings: {},
    options: [
      { type: "action", label: "Apply crop", primary: true, run: apply },
      { type: "action", label: "Cancel", run: cancel },
      { type: "hint", text: "Drag to set the crop area · Drag inside to move it · Enter applies · Esc cancels" },
    ],
    cursor: (app, p) => {
      const hit = p && rect && hitHandle(handlePoints(app), p.sx, p.sy);
      if (hit) return resizeCursor(screenPoint(app, rect.x + rect.w / 2, rect.y + rect.h / 2), hit);
      return inside(p) ? "move" : "crosshair";
    },
    down(app, e) {
      const hit = rect && hitHandle(handlePoints(app), e.sx, e.sy);
      if (hit) drag = { type: "resize", fx: hit.fx, fy: hit.fy, edges: { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h } };
      else if (inside(e)) drag = { type: "move", start: e, orig: { ...rect } };
      else {
        drag = { type: "draw", start: e };
        const sp = snapPoint(app, e);
        drag.start = sp;
        rect = { x: Math.round(sp.x), y: Math.round(sp.y), w: 0, h: 0 };
      }
    },
    move(app, e) {
      if (!drag) return;
      const { width: w, height: hh } = app.doc;
      const sp = drag.type === "move" ? e : snapPoint(app, e);
      const px = clamp(Math.round(sp.x), 0, w), py = clamp(Math.round(sp.y), 0, hh);
      if (drag.type === "draw") {
        const x0 = clamp(Math.round(drag.start.x), 0, w), y0 = clamp(Math.round(drag.start.y), 0, hh);
        rect = normRect(x0, y0, px, py);
      } else if (drag.type === "resize") {
        let { x0, y0, x1, y1 } = drag.edges;
        if (drag.fx === 0) x0 = px;
        if (drag.fx === 1) x1 = px;
        if (drag.fy === 0) y0 = py;
        if (drag.fy === 1) y1 = py;
        rect = normRect(x0, y0, x1, y1);
      } else {
        const o = drag.orig;
        rect = {
          ...o,
          x: clamp(Math.round(o.x + e.x - drag.start.x), 0, w - o.w),
          y: clamp(Math.round(o.y + e.y - drag.start.y), 0, hh - o.h),
        };
      }
      app.requestRender(false);
    },
    up() {
      drag = null;
      if (rect && (rect.w < 1 || rect.h < 1)) rect = null;
    },
    cancel() {
      if (drag?.orig) rect = drag.orig;
      else if (drag?.edges) rect = normRect(drag.edges.x0, drag.edges.y0, drag.edges.x1, drag.edges.y1);
      else rect = null;
      drag = null;
    },
    drawScreenOverlay(ctx, app) {
      if (!rect || drag?.type === "draw") return;
      drawHandles(ctx, handlePoints(app));
    },
    keydown(app, ev) {
      if (!rect) return false;
      if (ev.key === "Enter") apply(app);
      else if (ev.key === "Escape") cancel(app);
      else return false;
      return true;
    },
    deactivate() {
      rect = drag = null;
    },
    drawOverlay(ctx, app) {
      if (!rect) return;
      const { width: w, height: hh } = app.doc;
      const z = app.view.zoom;
      ctx.fillStyle = "rgba(5,6,9,.6)";
      ctx.beginPath();
      ctx.rect(0, 0, w, hh);
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.fill("evenodd");
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        ctx.moveTo(rect.x + rect.w * t, rect.y);
        ctx.lineTo(rect.x + rect.w * t, rect.y + rect.h);
        ctx.moveTo(rect.x, rect.y + rect.h * t);
        ctx.lineTo(rect.x + rect.w, rect.y + rect.h * t);
      }
      ctx.stroke();
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    },
  };
}

// ---------- Painting tools ----------

function makeTip(size, hardness, color) {
  const d = Math.max(1, Math.ceil(size));
  const tip = createCanvas(d, d);
  const c = tip.getContext("2d");
  const r = d / 2;
  if (hardness >= 0.99) {
    c.fillStyle = color;
    c.beginPath();
    c.arc(r, r, r, 0, Math.PI * 2);
    c.fill();
  } else {
    const { r: R, g: G, b: B } = hexToRgb(color);
    const grad = c.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
    grad.addColorStop(hardness, `rgba(${R},${G},${B},1)`);
    grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, d, d);
  }
  return tip;
}

// Brush and eraser. Dabs accumulate on a stroke canvas at full strength; the
// stroke is then applied to the layer once at the tool's opacity, so
// overlapping dabs within one stroke don't build up (like Photoshop).
function paintTool({ id, name, key, erase }) {
  const settings = { size: erase ? 40 : 20, hardness: erase ? 1 : 0.8, opacity: 1, pressure: true };
  let layer = null, onMask = false, stroke = null, last = null, lastEnd = null, bounds = null, frameDirty = null;
  let tip = null, tipKey = "", tipColor = "#000000";

  const sizeAt = (p) =>
    Math.max(1, settings.pressure && p.pointerType === "pen" ? settings.size * Math.max(0.05, p.pressure) : settings.size);

  function dab(x, y, size) {
    const c = stroke.getContext("2d");
    if (size <= 1.5) {
      c.fillStyle = tipColor;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    } else {
      c.drawImage(tip, x - size / 2, y - size / 2, size, size);
    }
    const r = { x: x - size / 2 - 1, y: y - size / 2 - 1, w: size + 2, h: size + 2 };
    bounds = unionRect(bounds, r);
    frameDirty = unionRect(frameDirty, r);
  }

  function lineTo(p) {
    const dx = p.x - last.x, dy = p.y - last.y, dist = Math.hypot(dx, dy);
    const s0 = sizeAt(last), s1 = sizeAt(p);
    const step = Math.max(0.5, Math.min(s0, s1) * 0.1);
    if (dist < step) return;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) {
      const t = (i * step) / dist;
      dab(last.x + dx * t, last.y + dy * t, s0 + (s1 - s0) * t);
    }
    const t = (n * step) / dist;
    last = { x: last.x + dx * t, y: last.y + dy * t, pressure: last.pressure + (p.pressure - last.pressure) * t, pointerType: p.pointerType };
  }

  function masked(app) {
    const { width: w, height: hh, selection } = app.doc;
    const s = scratch("paint-masked", w, hh);
    const c = s.getContext("2d");
    c.drawImage(stroke, 0, 0);
    maskInto(c, selection);
    return s;
  }

  // On a mask the eraser paints the background color instead of removing pixels.
  function applyTo(ctx, src) {
    ctx.globalAlpha = settings.opacity;
    ctx.globalCompositeOperation = erase && !onMask ? "destination-out" : "source-over";
    ctx.drawImage(src, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Only the area inside `rect` needs to be right; the composite is clipped to it.
  function renderLive(app, rect) {
    const { width: w, height: hh, selection } = app.doc;
    const r = rect ?? { x: 0, y: 0, w, h: hh };
    const s = pooled("paint-masked", w, hh), sc = s.getContext("2d");
    const out = pooled("paint-out", w, hh), oc = out.getContext("2d");
    clipTo(sc, r);
    sc.drawImage(stroke, 0, 0);
    maskInto(sc, selection);
    sc.restore();
    clipTo(oc, r);
    oc.drawImage(layer.canvas, layer.x, layer.y);
    applyTo(oc, s);
    oc.restore();
    return out;
  }

  function flush(app) {
    if (frameDirty) app.requestRender(frameDirty);
    frameDirty = null;
  }

  return {
    id, name, key, group: 2, icon: erase ? ICONS.eraser : ICONS.brush,
    settings,
    options: [
      { key: "size", label: "Size", type: "range", min: 1, max: 500, unit: "px" },
      { key: "hardness", label: "Hardness", type: "range", min: 0, max: 100, scale: 100, unit: "%" },
      { key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, scale: 100, unit: "%" },
      { key: "pressure", label: "Pen pressure", type: "checkbox" },
    ],
    cursor: "none",
    down(app, e) {
      const t = app.target();
      if (!app.ensureVisible(t.layer)) return;
      layer = t.surface; // the canvas being painted: the layer's pixels or its mask
      onMask = t.isMask;
      tipColor = erase ? (onMask ? app.paintColor(app.bg) : "#000000") : app.paintColor(app.fg);
      const k = `${settings.size}|${settings.hardness}|${tipColor}`;
      if (k !== tipKey) {
        tip = makeTip(settings.size, settings.hardness, tipColor);
        tipKey = k;
      }
      stroke = scratch(`${id}-stroke`, app.doc.width, app.doc.height);
      bounds = null;
      app.history.begin(name, [layer]);
      const p = { x: e.x, y: e.y, pressure: e.pressure, pointerType: e.pointerType };
      if (e.shift && lastEnd) {
        last = lastEnd;
        lineTo(p);
      } else {
        last = p;
        dab(p.x, p.y, sizeAt(p));
      }
      app.live = { layer: t.layer, [onMask ? "mask" : "pixels"]: (rect) => renderLive(app, rect) };
      flush(app);
    },
    move(app, e) {
      if (!stroke) return;
      lineTo({ x: e.x, y: e.y, pressure: e.pressure, pointerType: e.pointerType });
      flush(app);
    },
    up(app) {
      if (!stroke) return;
      applyTo(layer.ctx, masked(app));
      app.live = null;
      stroke = null;
      lastEnd = last;
      app.history.commit(bounds ?? { x: 0, y: 0, w: 0, h: 0 });
    },
    cancel() {
      stroke = null;
      frameDirty = null;
    },
    drawCursor(ctx, app) {
      const p = app.pointer;
      const r = (settings.size * app.view.zoom) / 2;
      ctx.lineWidth = 1;
      if (r > 3) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,.75)";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 1, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.stroke();
      }
      if (r < 8) {
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.beginPath();
        ctx.moveTo(p.sx - 6, p.sy); ctx.lineTo(p.sx - 2, p.sy);
        ctx.moveTo(p.sx + 2, p.sy); ctx.lineTo(p.sx + 6, p.sy);
        ctx.moveTo(p.sx, p.sy - 6); ctx.lineTo(p.sx, p.sy - 2);
        ctx.moveTo(p.sx, p.sy + 2); ctx.lineTo(p.sx, p.sy + 6);
        ctx.stroke();
      }
    },
  };
}

// ---------- Clone & healing ----------

// Records a brush stroke as a doc-sized alpha mask (soft edges included),
// for tools that paint with something other than a color.
class StrokeMask {
  constructor(name) {
    this.name = name;
    this.tip = null;
    this.tipKey = "";
  }

  begin(app, settings, p) {
    this.settings = settings;
    this.canvas = scratch(this.name, app.doc.width, app.doc.height);
    this.bounds = null;
    this.dirty = null;
    const k = `${settings.size}|${settings.hardness}`;
    if (k !== this.tipKey) {
      this.tip = makeTip(settings.size, settings.hardness, "#000000");
      this.tipKey = k;
    }
    this.last = p;
    this.dab(p.x, p.y);
  }

  dab(x, y) {
    const size = this.settings.size;
    this.canvas.getContext("2d").drawImage(this.tip, x - size / 2, y - size / 2, size, size);
    const r = { x: x - size / 2 - 1, y: y - size / 2 - 1, w: size + 2, h: size + 2 };
    this.bounds = unionRect(this.bounds, r);
    this.dirty = unionRect(this.dirty, r);
  }

  to(p) {
    const dx = p.x - this.last.x, dy = p.y - this.last.y, dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, this.settings.size * 0.1);
    if (dist < step) return;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) this.dab(this.last.x + (dx * i * step) / dist, this.last.y + (dy * i * step) / dist);
    this.last = { x: this.last.x + (dx * n * step) / dist, y: this.last.y + (dy * n * step) / dist };
  }

  // Request a redraw of just the area painted since the last frame.
  flush(app) {
    if (this.dirty) app.requestRender(this.dirty);
    this.dirty = null;
  }
}

function drawBrushCursor(ctx, app, size) {
  const p = app.pointer;
  const r = (size * app.view.zoom) / 2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, Math.max(r, 2), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, Math.max(r, 2) + 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.stroke();
}

const BRUSH_OPTIONS = [
  { key: "size", label: "Size", type: "range", min: 1, max: 500, unit: "px" },
  { key: "hardness", label: "Hardness", type: "range", min: 0, max: 100, scale: 100, unit: "%" },
];

// Clone Stamp, and the Healing Brush (a clone that is blended into its
// surroundings when the stroke ends). Alt+click sets the source point.
function cloneTool({ heal }) {
  const id = heal ? "heal" : "clone";
  const name = heal ? "Healing Brush" : "Clone Stamp";
  const settings = { size: 40, hardness: heal ? 0.5 : 0.7, opacity: 1, aligned: true, allLayers: false };
  const stroke = new StrokeMask(`${id}-stroke`);
  let source = null;   // the Alt+clicked point
  let offset = null;   // source minus destination for the current/aligned stroke
  let active = null;   // { owner, surface, snap } while painting
  let healing = false;

  // The source pixels, shifted so they line up under the brush, masked by
  // the stroke and the selection. Only valid inside rect.
  function cloned(app, rect) {
    const { width: w, height: h, selection } = app.doc;
    const c = pooled(`${id}-cloned`, w, h);
    const ctx = c.getContext("2d");
    clipTo(ctx, rect ?? { x: 0, y: 0, w, h });
    const snap = active.snap;
    ctx.drawImage(snap.canvas, snap.x - offset.x, snap.y - offset.y);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(stroke.canvas, 0, 0);
    if (selection) ctx.drawImage(selection.mask, 0, 0);
    ctx.restore();
    return c;
  }

  function renderLive(app, rect) {
    const { width: w, height: h } = app.doc;
    const out = pooled(`${id}-out`, w, h);
    const oc = out.getContext("2d");
    clipTo(oc, rect ?? { x: 0, y: 0, w, h });
    const s = active.surface;
    oc.drawImage(s.canvas, s.x, s.y);
    oc.globalAlpha = settings.opacity;
    oc.drawImage(cloned(app, rect), 0, 0);
    oc.restore();
    return out;
  }

  async function finishHeal(app) {
    const { surface } = active;
    const doc = app.doc;
    const R = healRegion(stroke.bounds, doc, 4);
    if (!R.w || !R.h) {
      app.history.cancel();
      return;
    }
    // Source pixels for the whole region (unmasked), from the shifted snapshot.
    const srcCanvas = createCanvas(R.w, R.h);
    srcCanvas.getContext("2d").drawImage(active.snap.canvas, active.snap.x - offset.x - R.x, active.snap.y - offset.y - R.y);
    const src = srcCanvas.getContext("2d").getImageData(0, 0, R.w, R.h);
    // stroke ∩ selection, committed firmly toward the soft edge (see spot healing)
    const mask = maskFromCanvas(cloned(app, R), R).map((v) => Math.min(255, v * 2));
    const base = settings.allLayers ? cropImage(sampleImage(app, surface, true), R) : surface.getDocImageData(R);
    await healInto(surface, R, base, src, mask);
    app.history.commit(R);
  }

  return {
    id, name, key: heal ? "J" : "S", group: 2, icon: heal ? ICONS.healBrush : ICONS.clone,
    settings,
    options: [
      ...BRUSH_OPTIONS,
      ...(heal ? [] : [{ key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, scale: 100, unit: "%" }]),
      { key: "aligned", label: "Aligned", type: "checkbox" },
      { key: "allLayers", label: "Sample all layers", type: "checkbox" },
      { type: "hint", text: "Alt+click to set the source, then paint" },
    ],
    cursor: "none",
    down(app, e) {
      if (healing) return;
      if (e.alt) {
        source = { x: e.x, y: e.y };
        offset = null;
        app.toast("Source set — now paint where you want to copy it.");
        return;
      }
      if (!source) {
        app.toast("Alt+click to set a source point first.");
        return;
      }
      const t = app.target();
      if (!app.ensureVisible(t.layer)) return;
      if (heal && t.isMask) {
        app.toast("Healing works on layer pixels, not masks.");
        return;
      }
      if (!settings.aligned || !offset) offset = { x: source.x - e.x, y: source.y - e.y };
      // Sample from a snapshot taken now, so the stroke never copies itself.
      const snap = settings.allLayers && !t.isMask
        ? { canvas: cloneCanvas(app.doc.compose()), x: 0, y: 0 }
        : { canvas: cloneCanvas(t.surface.canvas), x: t.surface.x, y: t.surface.y };
      active = { owner: t.layer, surface: t.surface, snap };
      app.history.begin(name, [t.surface]);
      stroke.begin(app, settings, { x: e.x, y: e.y });
      app.live = { layer: t.layer, [t.isMask ? "mask" : "pixels"]: (rect) => renderLive(app, rect) };
      stroke.flush(app);
    },
    move(app, e) {
      if (!active) return;
      stroke.to({ x: e.x, y: e.y });
      stroke.flush(app);
    },
    async up(app) {
      if (!active) return;
      if (heal) {
        healing = true;
        app.setWorking(true);
        try {
          await finishHeal(app);
        } catch (err) {
          console.error(err);
          app.history.cancel();
          app.toast("Healing failed.");
        } finally {
          healing = false;
          app.setWorking(false);
          app.live = null;
          active = null;
          app.requestRender();
        }
        return;
      }
      const s = active.surface;
      s.ctx.globalAlpha = settings.opacity;
      s.ctx.drawImage(cloned(app, null), 0, 0);
      s.ctx.globalAlpha = 1;
      app.live = null;
      active = null;
      app.history.commit(stroke.bounds);
    },
    cancel() {
      active = null;
    },
    drawCursor(ctx, app) {
      drawBrushCursor(ctx, app, settings.size);
    },
    // Show where the brush is sampling from.
    drawScreenOverlay(ctx, app) {
      if (!source) return;
      const p = app.pointer;
      const at = offset && p ? { x: p.x + offset.x, y: p.y + offset.y } : source;
      const sx = app.view.x + at.x * app.view.zoom, sy = app.view.y + at.y * app.view.zoom;
      ctx.lineWidth = 1;
      for (const [color, width] of [["rgba(0,0,0,.7)", 3], ["#fff", 1.25]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy);
        ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8);
        ctx.stroke();
      }
    },
  };
}

// Spot Healing Brush: paint over a blemish; on release it finds a clean
// nearby patch by itself and blends it in.
function spotHealTool() {
  const settings = { size: 30, hardness: 0.6, allLayers: false };
  const stroke = new StrokeMask("spot-stroke");
  let active = null, healing = false;

  function renderLive(app, rect) {
    const { width: w, height: h } = app.doc;
    const out = pooled("spot-out", w, h);
    const oc = out.getContext("2d");
    clipTo(oc, rect ?? { x: 0, y: 0, w, h });
    const s = active.surface;
    oc.drawImage(s.canvas, s.x, s.y);
    // Show the painted area as a translucent dark wash, like Photoshop.
    const tint = pooled("spot-tint", w, h), tc = tint.getContext("2d");
    clipTo(tc, rect ?? { x: 0, y: 0, w, h });
    tc.drawImage(stroke.canvas, 0, 0);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = "rgba(40,40,48,.55)";
    tc.fillRect(0, 0, w, h);
    tc.restore();
    oc.drawImage(tint, 0, 0);
    oc.restore();
    return out;
  }

  return {
    id: "spotheal", name: "Spot Healing Brush", key: "J", group: 2, icon: ICONS.spotHeal,
    settings,
    options: [
      ...BRUSH_OPTIONS,
      { key: "allLayers", label: "Sample all layers", type: "checkbox" },
      { type: "hint", text: "Paint over a spot or blemish to remove it" },
    ],
    cursor: "none",
    down(app, e) {
      if (healing) return;
      const t = app.target();
      if (!app.ensureVisible(t.layer)) return;
      if (t.isMask) {
        app.toast("Healing works on layer pixels, not masks.");
        return;
      }
      active = { surface: t.surface };
      app.history.begin("Spot Healing Brush", [t.surface]);
      stroke.begin(app, settings, { x: e.x, y: e.y });
      app.live = { layer: t.layer, pixels: (rect) => renderLive(app, rect) };
      stroke.flush(app);
    },
    move(app, e) {
      if (!active) return;
      stroke.to({ x: e.x, y: e.y });
      stroke.flush(app);
    },
    async up(app) {
      if (!active) return;
      const { surface } = active;
      const doc = app.doc;
      healing = true;
      app.setWorking(true);
      try {
        const R = healRegion(stroke.bounds, doc, Math.max(6, Math.round(settings.size / 2)));
        // Commit the repair more firmly toward the soft brush edge, so the
        // rim of a blemish doesn't show through.
        let mask = maskFromCanvas(stroke.canvas, R).map((v) => Math.min(255, v * 2));
        if (doc.selection) {
          const sel = maskFromCanvas(doc.selection.mask, R);
          mask = mask.map((v, i) => (v * sel[i]) / 255);
        }
        const full = sampleImage(app, surface, settings.allLayers);
        const offset = findSourceOffset(full, mask, R);
        if (!offset) {
          app.history.cancel();
          app.toast("Couldn't find a clean area nearby — try a smaller brush or the Healing Brush.");
        } else {
          await healInto(surface, R, cropImage(full, R), cropImage(full, R, offset.x, offset.y), mask);
          app.history.commit(R);
        }
      } catch (err) {
        console.error(err);
        app.history.cancel();
        app.toast("Healing failed.");
      } finally {
        healing = false;
        app.setWorking(false);
        app.live = null;
        active = null;
        app.requestRender();
      }
    },
    cancel() {
      active = null;
    },
    drawCursor(ctx, app) {
      drawBrushCursor(ctx, app, settings.size);
    },
  };
}

function bucketTool() {
  const settings = { tolerance: 32, contiguous: true, allLayers: false, opacity: 1 };
  return {
    id: "bucket", name: "Paint Bucket", key: "G", group: 2, icon: ICONS.bucket,
    settings,
    options: [
      { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 255 },
      { key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, scale: 100, unit: "%" },
      { key: "contiguous", label: "Contiguous", type: "checkbox" },
      { key: "allLayers", label: "Sample all layers", type: "checkbox" },
    ],
    cursor: "crosshair",
    down(app, e) {
      const doc = app.doc;
      const { layer: owner, surface: layer, isMask } = app.target();
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (!inDoc(app, x, y) || !app.ensureVisible(owner)) return;
      const full = { x: 0, y: 0, w: doc.width, h: doc.height };
      const data = settings.allLayers && !isMask
        ? doc.compose().getContext("2d").getImageData(0, 0, doc.width, doc.height)
        : layer.getDocImageData(full);
      const region = Selection.fromArray(doc.width, doc.height, floodFill(data, x, y, settings.tolerance, settings.contiguous));
      if (!region.bounds) return;
      const paint = scratch("bucket", doc.width, doc.height);
      const c = paint.getContext("2d");
      c.fillStyle = app.paintColor(app.fg);
      c.fillRect(0, 0, doc.width, doc.height);
      maskInto(c, region);
      maskInto(c, doc.selection);
      app.history.begin("Paint Bucket", [layer]);
      layer.ctx.globalAlpha = settings.opacity;
      layer.ctx.drawImage(paint, 0, 0);
      layer.ctx.globalAlpha = 1;
      app.history.commit(region.bounds);
    },
  };
}

function gradientTool() {
  const settings = { type: "linear", mode: "fg-bg", opacity: 1 };
  let layer = null, a = null, b = null;

  function masked(app) {
    const { width: w, height: hh, selection } = app.doc;
    const s = scratch("gradient", w, hh);
    const c = s.getContext("2d");
    const g = settings.type === "radial"
      ? c.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y))
      : c.createLinearGradient(a.x, a.y, b.x, b.y);
    const fg = app.paintColor(app.fg), bg = app.paintColor(app.bg);
    g.addColorStop(0, fg);
    g.addColorStop(1, settings.mode === "fg-bg" ? bg : rgba(fg, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, w, hh);
    maskInto(c, selection);
    return s;
  }

  function applyTo(ctx, src) {
    ctx.globalAlpha = settings.opacity;
    ctx.drawImage(src, 0, 0);
    ctx.globalAlpha = 1;
  }

  return {
    id: "gradient", name: "Gradient", key: "G", group: 2, icon: ICONS.gradient,
    settings,
    options: [
      { key: "type", label: "Type", type: "select", options: [["linear", "Linear"], ["radial", "Radial"]] },
      { key: "mode", label: "Colors", type: "select", options: [["fg-bg", "Foreground → Background"], ["fg-transparent", "Foreground → Transparent"]] },
      { key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, scale: 100, unit: "%" },
    ],
    cursor: "crosshair",
    down(app, e) {
      const t = app.target();
      if (!app.ensureVisible(t.layer)) return;
      layer = t.surface;
      a = b = { x: e.x, y: e.y };
      app.history.begin("Gradient", [layer]);
      app.live = {
        layer: t.layer,
        [t.isMask ? "mask" : "pixels"]: () => {
          const out = scratch("gradient-out", app.doc.width, app.doc.height);
          const c = out.getContext("2d");
          c.drawImage(layer.canvas, layer.x, layer.y);
          applyTo(c, masked(app));
          return out;
        },
      };
    },
    move(app, e) {
      if (!layer) return;
      b = { x: e.x, y: e.y };
      if (e.shift) {
        const step = Math.PI / 4;
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      }
      app.requestRender();
    },
    up(app) {
      if (!layer) return;
      app.live = null;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) app.history.cancel();
      else {
        applyTo(layer.ctx, masked(app));
        app.history.commit(app.region());
      }
      layer = null;
    },
    cancel() {
      layer = null;
    },
    drawOverlay(ctx, app) {
      if (!layer) return;
      const z = app.view.zoom;
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
    },
  };
}

function eyedropperTool() {
  let active = false;
  const sample = (app, e) => {
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (!inDoc(app, x, y)) return;
    const p = app.doc.composite.getContext("2d").getImageData(x, y, 1, 1).data;
    // While borrowed by holding Alt in a paint tool, Alt is not a modifier.
    const which = e.alt && !app.temporaryTool ? "bg" : "fg";
    if (p[3]) app.setColor(which, rgbToHex(p[0], p[1], p[2]));
  };
  return {
    id: "eyedropper", name: "Eyedropper", key: "I", group: 2, icon: ICONS.eyedropper,
    settings: {},
    options: [{ type: "hint", text: "Click to pick the foreground color · Alt+click picks the background color · Hold Alt in paint tools to pick quickly" }],
    cursor: "crosshair",
    down(app, e) { active = true; sample(app, e); },
    move(app, e) { if (active) sample(app, e); },
    up() { active = false; },
    cancel() { active = false; },
  };
}

// Type tool. Creates type layers and edits existing ones in place: click
// on text to edit it; with a type layer selected (and not editing), the
// options bar restyles it directly.
function textTool() {
  const settings = { font: "Inter", size: 64, bold: false, italic: false, align: "left", color: "#000000" };
  let editor = null, session = null, hooked = false;
  let restyle = null; // { layer, timer } while options-bar edits are being coalesced
  const nothing = createCanvas(1, 1); // stands in for a layer's pixels while its text is being edited

  const styleOf = () => ({
    font: settings.font, size: settings.size, bold: settings.bold, italic: settings.italic, align: settings.align, color: settings.color,
  });

  function autosize() {
    editor.style.width = "0px";
    editor.style.height = "0px";
    editor.style.width = `${editor.scrollWidth + 4}px`;
    editor.style.height = `${editor.scrollHeight}px`;
  }

  function place(app) {
    if (!editor) return;
    const { zoom, x, y } = app.view;
    editor.style.font = textFont(settings, settings.size * zoom);
    editor.style.lineHeight = String(LINE_HEIGHT);
    editor.style.color = settings.color;
    editor.style.textAlign = settings.align;
    autosize();
    const w = editor.offsetWidth;
    const ax = x + session.x * zoom;
    editor.style.left = `${settings.align === "center" ? ax - w / 2 : settings.align === "right" ? ax - w : ax}px`;
    editor.style.top = `${y + session.y * zoom}px`;
  }

  function syncFromLayer(app, layer) {
    if (layer?.text) Object.assign(settings, { ...layer.text });
    else settings.color = app.fg;
    app.emit("options");
  }

  function hook(app) {
    if (hooked) return;
    hooked = true;
    app.on("view", () => place(app));
    app.on("colors", () => {
      if (!editor && app.tool?.id === "text" && !app.doc.activeLayer.text) {
        settings.color = app.fg;
        app.emit("options");
      }
    });
    // Selecting a type layer shows its styling in the options bar.
    app.on("layers", () => {
      if (!editor && !restyle && app.tool?.id === "text") syncFromLayer(app, app.doc.activeLayer);
    });
  }

  function open(app, x, y, layer = null) {
    hook(app);
    session = { layer, x, y };
    app.editingText = true;
    if (layer) {
      app.doc.activeLayer = layer;
      syncFromLayer(app, layer);
      app.live = { layer, pixels: () => nothing };
      app.emit("layers");
      app.requestRender();
    }
    editor = h("textarea", { class: "text-editor", spellcheck: "false", rows: 1, wrap: "off" });
    editor.value = layer?.text.content ?? "";
    editor.addEventListener("input", () => place(app));
    editor.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") close(app);
      else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) commit(app);
    });
    app.workspace.append(editor);
    place(app);
  }

  function close(app) {
    editor?.remove();
    editor = null;
    session = null;
    app.editingText = false;
    app.live = null;
    app.requestRender();
  }

  function commit(app) {
    if (!editor) return;
    const content = editor.value.replace(/\s+$/, "");
    const { layer, x, y } = session;
    close(app);
    const doc = app.doc;
    const next = { content, x, y, ...styleOf() };
    if (layer) {
      if (!doc.contains(layer)) return;
      const prev = layer.text;
      if (!content.trim()) {
        // Emptying a type layer removes it, like Photoshop.
        doc.activeLayer = layer;
        app.deleteLayer();
        return;
      }
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      app.history.begin("Edit Type", [layer], { keepText: true });
      if (layer.name === nameFor(prev.content)) layer.name = nameFor(content); // keep custom names
      layer.text = next;
      renderText(layer, doc);
      app.history.commit();
    } else if (content.trim()) {
      const L = doc.newLayer(nameFor(content));
      L.text = next;
      renderText(L, doc);
      app.addLayer(L, "Type");
    }
  }

  // Options-bar changes restyle the selected type layer. Rapid changes (a
  // slider drag) are coalesced into one history entry.
  function restyleActive(app) {
    const layer = app.doc.activeLayer;
    if (!layer.text || (app.busy && !restyle)) return;
    if (!restyle && app.refuseLocked(layer, "pixels")) return;
    if (!restyle) {
      app.history.begin("Edit Type", [layer], { keepText: true });
      restyle = { layer, timer: 0 };
    }
    layer.text = { ...layer.text, ...styleOf() };
    renderText(layer, app.doc);
    app.requestRender();
    clearTimeout(restyle.timer);
    restyle.timer = setTimeout(() => {
      restyle = null;
      app.history.commit();
    }, 500);
  }

  return {
    id: "text", name: "Type", key: "T", group: 2, icon: ICONS.text,
    settings,
    options: [
      {
        key: "font", label: "Font", type: "select",
        options: ["Inter", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Impact", "Comic Sans MS"].map((f) => [f, f]),
      },
      { key: "size", label: "Size", type: "range", min: 6, max: 400, unit: "px" },
      { key: "bold", label: "Bold", type: "checkbox" },
      { key: "italic", label: "Italic", type: "checkbox" },
      { key: "align", type: "segmented", options: [["left", "Left"], ["center", "Center"], ["right", "Right"]] },
      { key: "color", label: "Color", type: "color" },
      { type: "hint", text: "Click to type, or click text to edit it · Ctrl+Enter or click away to commit · Esc cancels" },
    ],
    cursor: "text",
    down(app, e) {
      if (editor) {
        commit(app);
        return;
      }
      const hit = textLayerAt(app.doc, e.x, e.y);
      if (hit && app.refuseLocked(hit, "pixels")) return;
      if (hit) open(app, hit.text.x, hit.text.y, hit);
      else open(app, e.x, e.y);
    },
    up() {
      editor?.focus(); // after pointerup, so the browser's own focus handling can't steal it back
    },
    // Start editing a type layer directly (e.g. double-clicking its thumbnail).
    edit(app, layer) {
      if (app.refuseLocked(layer, "pixels")) return;
      if (editor) commit(app);
      open(app, layer.text.x, layer.text.y, layer);
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    },
    optionsChanged(app) {
      if (editor) place(app);
      else restyleActive(app);
    },
    activate(app) {
      hook(app);
      syncFromLayer(app, app.doc?.activeLayer);
    },
    deactivate(app) {
      commit(app);
      if (restyle) {
        clearTimeout(restyle.timer);
        restyle = null;
        app.history.commit();
      }
    },
  };
}

// ---------- Move & navigation ----------

// Moving a selection's pixels edits them; moving the whole layer repositions it.
const movingLocks = (app) => (app.doc.selection ? ["pixels"] : ["position"]);

function moveTool() {
  // pieces: [{ surface, owner, isMask, float }] — everything that moves together.
  let sel = null, pieces = null, start = null, dx = 0, dy = 0, box = null;

  // Cut the selected area (or the whole surface, including anything already
  // off-canvas) of each linked surface out onto a floating canvas.
  function lift(app) {
    const doc = app.doc;
    sel = doc.selection;
    const linked = app.linkedSurfaces();
    app.history.begin("Move", linked.map((p) => p.surface));
    pieces = linked.map((p) => ({ ...p, float: p.surface.lift(sel) }));
    dx = dy = 0;
  }

  function preview(app, piece, i) {
    const out = scratch(`move-out-${i}`, app.doc.width, app.doc.height);
    const c = out.getContext("2d");
    const { surface: s, float: f } = piece;
    c.clearRect(0, 0, out.width, out.height);
    c.drawImage(s.canvas, s.x, s.y);
    c.drawImage(f.canvas, f.x + dx, f.y + dy);
    return out;
  }

  // Stamping grows a surface to keep content that left the canvas, then
  // trims it back to what is actually there.
  function drop(app) {
    app.live = null;
    app.selectionOffset = null;
    const ps = pieces;
    pieces = null;
    if (!dx && !dy) {
      app.history.cancel();
      return;
    }
    const { width: w, height: h } = app.doc;
    const shift = new DOMMatrix().translate(dx, dy);
    for (const p of ps) p.surface.stamp(p.float, shift, w, h);
    // Moving whole type and shape layers keeps them editable.
    if (!sel) {
      for (const p of ps) {
        if (p.isMask) continue;
        if (p.owner.text) p.owner.text = { ...p.owner.text, x: p.owner.text.x + dx, y: p.owner.text.y + dy };
        if (p.owner.shape) p.owner.shape = translateShape(p.owner.shape, dx, dy);
      }
      app.history.pending.keepText = true;
    }
    let dirty;
    if (sel) {
      const b = sel.bounds;
      dirty = unionRect(b, { ...b, x: b.x + dx, y: b.y + dy });
      app.doc.selection = sel.translated(dx, dy);
    }
    app.history.commit(dirty);
  }

  return {
    id: "move", name: "Move", key: "V", group: 0, icon: ICONS.move,
    settings: {},
    options: [{ type: "hint", text: "Drag to move the active layer, group or selection · Shift locks the axis · Arrow keys nudge (Shift ×10)" }],
    cursor: "move",
    down(app, e) {
      if (!app.ensureVisible(app.doc.activeLayer, { whole: true, locks: movingLocks(app) })) return;
      // What snaps: the selection, or the layer's content (measured before lifting it).
      const t = app.target(), cur = app.doc.selection;
      box = cur ? cur.bounds : t.isMask ? t.surface.bounds : app.contentBoundsOf(t.layer);
      lift(app);
      start = e;
      // One preview entry per moving layer (a group moves several).
      const map = new Map();
      pieces.forEach((p, i) => {
        const entry = map.get(p.owner) ?? {};
        entry[p.isMask ? "mask" : "pixels"] = () => preview(app, p, i);
        map.set(p.owner, entry);
      });
      app.live = { map };
      app.requestRender();
    },
    move(app, e) {
      if (!pieces) return;
      dx = Math.round(e.x - start.x);
      dy = Math.round(e.y - start.y);
      let axisLock = null;
      if (e.shift) axisLock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axisLock === "x") dy = 0;
      if (axisLock === "y") dx = 0;
      // Snap the moved box's edges or center to guides and the canvas.
      if (box) {
        const snap = snapBox(app, { ...box, x: box.x + dx, y: box.y + dy });
        if (axisLock !== "y") dx += Math.round(snap.dx);
        if (axisLock !== "x") dy += Math.round(snap.dy);
      }
      if (sel) app.selectionOffset = { x: dx, y: dy };
      app.requestRender();
    },
    up(app) {
      if (pieces) drop(app);
    },
    cancel() {
      pieces = null;
    },
    nudge(app, ndx, ndy) {
      if (app.busy || !app.ensureVisible(app.doc.activeLayer, { whole: true, locks: movingLocks(app) })) return;
      lift(app);
      dx = ndx;
      dy = ndy;
      drop(app);
    },
  };
}

function handTool() {
  return {
    id: "hand", name: "Hand", key: "H", group: 3, icon: ICONS.hand,
    settings: {},
    options: [{ type: "hint", text: "Drag to pan · Hold Space with any tool to pan" }],
    cursor: "grab",
  };
}

function zoomTool() {
  return {
    id: "zoom", name: "Zoom", key: "Z", group: 3, icon: ICONS.zoom,
    settings: {},
    options: [
      { type: "action", label: "Fit on screen", run: (app) => app.fit() },
      { type: "action", label: "100%", run: (app) => app.actualSize() },
      { type: "hint", text: "Click to zoom in · Alt+click to zoom out · Ctrl+scroll zooms with any tool" },
    ],
    cursor: (app) => "zoom-in",
    down(app, e) {
      app.zoomStep(e.alt ? -1 : 1, e.sx, e.sy);
    },
  };
}

// What each tool does, shown in its toolbar tooltip while Alt is held.
const DESCRIPTIONS = {
  move: "Drag to move the selected layer, or just the selected pixels if there's a selection. Content dragged off the canvas is kept. Arrow keys nudge 1px (Shift for 10).",
  marquee: "Drag to make a rectangular selection. Hold Shift while dragging for a square. Shift-click adds to the selection, Alt-click subtracts.",
  ellipse: "Drag to make an elliptical selection. Hold Shift while dragging for a circle. Shift-click adds to the selection, Alt-click subtracts.",
  lasso: "Draw a freehand selection. The shape closes itself when you let go.",
  quickselect: "Paint over the thing you want to select: the selection grows to its edges as you drag. Keep painting to add more; hold Alt to paint away parts you don't want. [ and ] change the brush size.",
  wand: "Click to select areas of similar color. Raise Tolerance to include more shades; turn off Contiguous to select that color everywhere.",
  crop: "Drag to choose the area to keep, fine-tune it with the handles, then press Enter. Cropped pixels aren't deleted, so enlarging the canvas brings them back.",
  eyedropper: "Click to pick a color from the image as the foreground color. Alt-click picks the background color.",
  brush: "Paint with the foreground color. [ and ] change the size, number keys set the opacity, and holding Alt picks a color.",
  eraser: "Erase pixels to transparency. On a layer mask it paints with the background color instead.",
  clone: "Alt-click to set a source point, then paint to copy pixels from there. With Aligned on, the source follows your strokes.",
  spotheal: "Paint over a spot or blemish. When you let go, it finds a clean patch nearby and blends it in automatically.",
  heal: "Like the Clone Stamp, but the copied pixels are blended to match the color and lighting where you paint. Alt-click to set the source.",
  bucket: "Click to fill an area of similar color with the foreground color. Tolerance controls how similar the colors must be.",
  gradient: "Drag to draw a gradient from the foreground to the background color. Hold Shift to snap the angle to 45°.",
  text: "Click to add text, or click existing text to edit it. Text layers stay editable until you paint on or filter them.",
  shape: "Drag to draw a rectangle, ellipse, polygon, star or line as a vector shape layer. Shift constrains, Alt draws from the center. Shapes stay sharp when transformed.",
  pen: "Click to place corner points, drag to make curves, and click the first point to close the path. Makes a shape layer or a selection. With a shape layer selected, drag its points to reshape it.",
  hand: "Drag to scroll around the image. Hold Space with any tool to pan temporarily.",
  zoom: "Click to zoom in, Alt-click to zoom out. Ctrl+scroll zooms with any tool.",
};

export function createTools() {
  const tools = [
    moveTool(),
    marqueeTool({ id: "marquee", name: "Rectangular Marquee" }),
    marqueeTool({ id: "ellipse", name: "Elliptical Marquee", ellipse: true }),
    lassoTool(),
    quickSelectTool(),
    wandTool(),
    cropTool(),
    eyedropperTool(),
    paintTool({ id: "brush", name: "Brush", key: "B" }),
    paintTool({ id: "eraser", name: "Eraser", key: "E", erase: true }),
    cloneTool({ heal: false }),
    spotHealTool(),
    cloneTool({ heal: true }),
    bucketTool(),
    gradientTool(),
    textTool(),
    createShapeTool(ICONS.shape),
    createPenTool(ICONS.pen),
    handTool(),
    zoomTool(),
    createTransformTool(),
  ];
  for (const t of tools) t.description = DESCRIPTIONS[t.id] ?? "";
  return tools;
}
