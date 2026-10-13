// Shape layers: a layer with a `shape` keeps its vector path and styling and
// is re-rendered from them, so it stays editable (like type layers). Every
// shape is stored as a path, so any transform can be applied to it exactly.
//
//   shape = { kind, points, closed, fill, stroke, strokeWidth }
//   point = { x, y, ix, iy, ox, oy }   anchor plus in/out bezier handles
//
// fill/stroke are colors or null. Coordinates are in document space. The
// object is immutable: edits assign a new one, so history can keep the old.

import { unionRect } from "./util.js";

const KAPPA = 0.5522847498; // bezier handle length for a quarter circle

export const corner = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });

export function rectPoints(x, y, w, h, radius = 0) {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  const x0 = Math.min(x, x + w), y0 = Math.min(y, y + h), x1 = Math.max(x, x + w), y1 = Math.max(y, y + h);
  if (!r) return [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)];
  const k = r * KAPPA;
  return [
    { x: x0 + r, y: y0, ix: x0 + r - k, iy: y0, ox: x0 + r, oy: y0 },
    { x: x1 - r, y: y0, ix: x1 - r, iy: y0, ox: x1 - r + k, oy: y0 },
    { x: x1, y: y0 + r, ix: x1, iy: y0 + r - k, ox: x1, oy: y0 + r },
    { x: x1, y: y1 - r, ix: x1, iy: y1 - r, ox: x1, oy: y1 - r + k },
    { x: x1 - r, y: y1, ix: x1 - r + k, iy: y1, ox: x1 - r, oy: y1 },
    { x: x0 + r, y: y1, ix: x0 + r, iy: y1, ox: x0 + r - k, oy: y1 },
    { x: x0, y: y1 - r, ix: x0, iy: y1 - r + k, ox: x0, oy: y1 - r },
    { x: x0, y: y0 + r, ix: x0, iy: y0 + r, ox: x0, oy: y0 + r - k },
  ];
}

export function ellipsePoints(cx, cy, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { x: cx, y: cy - ry, ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry },
    { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky },
    { x: cx, y: cy + ry, ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry },
    { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky },
  ];
}

// A regular polygon or star inside the ellipse (cx, cy, rx, ry), point up.
export function polygonPoints(cx, cy, rx, ry, sides, star = false, inner = 0.5) {
  const n = Math.max(3, Math.round(sides));
  const pts = [];
  const count = star ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const k = star && i % 2 ? inner : 1;
    pts.push(corner(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
  }
  return pts;
}

function segment(path, a, b) {
  const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
  if (straight) path.lineTo(b.x, b.y);
  else path.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
}

export function shapePath(shape) {
  const path = new Path2D();
  const pts = shape.points;
  if (!pts.length) return path;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) segment(path, pts[i - 1], pts[i]);
  if (shape.closed && pts.length > 2) {
    segment(path, pts.at(-1), pts[0]);
    path.closePath();
  }
  return path;
}

// Bounds of the shape including its stroke (control points bound the curve).
export function shapeBounds(shape) {
  let b = null;
  for (const p of shape.points) {
    for (const [x, y] of [[p.x, p.y], [p.ix, p.iy], [p.ox, p.oy]]) b = unionRect(b, { x, y, w: 0, h: 0 });
  }
  if (!b) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = shape.stroke ? shape.strokeWidth * 2 + 2 : 2; // room for miter joins
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

// Apply a DOMMatrix to every anchor and handle (exact for any affine transform).
export function transformShape(shape, m) {
  const tp = (x, y) => m.transformPoint({ x, y });
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return {
    ...shape,
    strokeWidth: shape.strokeWidth * scale,
    points: shape.points.map((p) => {
      const a = tp(p.x, p.y), i = tp(p.ix, p.iy), o = tp(p.ox, p.oy);
      return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    }),
  };
}

export const translateShape = (shape, dx, dy) => transformShape(shape, new DOMMatrix().translate(dx, dy));

// Redraw a shape layer's pixels from its path, growing the canvas if the
// shape extends off the document.
export function renderShape(layer, doc) {
  const s = layer.shape;
  const b = shapeBounds(s);
  const x0 = Math.min(0, Math.floor(b.x)), y0 = Math.min(0, Math.floor(b.y));
  const x1 = Math.max(doc.width, Math.ceil(b.x + b.w)), y1 = Math.max(doc.height, Math.ceil(b.y + b.h));
  layer.setGeometry(x0, y0, x1 - x0, y1 - y0);
  const c = layer.ctx;
  const path = shapePath(s);
  if (s.fill) {
    c.fillStyle = s.fill;
    c.fill(path);
  }
  if (s.stroke && s.strokeWidth > 0) {
    c.strokeStyle = s.stroke;
    c.lineWidth = s.strokeWidth;
    c.lineJoin = "miter";
    c.miterLimit = 4;
    c.lineCap = s.closed ? "butt" : "round";
    c.stroke(path);
  }
}

// Draw a path's outline, anchors and handles in screen space (for the Pen
// tool). toScreen maps document points to screen points.
export function drawPathEditor(ctx, shape, toScreen, { closed = shape.closed, active = -1 } = {}) {
  const pts = shape.points.map((p) => ({
    a: toScreen(p.x, p.y), i: toScreen(p.ix, p.iy), o: toScreen(p.ox, p.oy),
  }));
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].a.sx, pts[0].a.sy);
  const seg = (A, B) => ctx.bezierCurveTo(A.o.sx, A.o.sy, B.i.sx, B.i.sy, B.a.sx, B.a.sy);
  for (let k = 1; k < pts.length; k++) seg(pts[k - 1], pts[k]);
  if (closed && pts.length > 2) seg(pts.at(-1), pts[0]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "#3d8bfd";
  ctx.stroke();

  pts.forEach((p, k) => {
    for (const hnd of [p.i, p.o]) {
      if (Math.hypot(hnd.sx - p.a.sx, hnd.sy - p.a.sy) < 1) continue;
      ctx.beginPath();
      ctx.moveTo(p.a.sx, p.a.sy);
      ctx.lineTo(hnd.sx, hnd.sy);
      ctx.strokeStyle = "rgba(61,139,253,.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hnd.sx, hnd.sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(Math.round(p.a.sx) - 4, Math.round(p.a.sy) - 4, 8, 8);
    ctx.fillStyle = k === active ? "#3d8bfd" : "#fff";
    ctx.fill();
    ctx.strokeStyle = "#3d8bfd";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}
