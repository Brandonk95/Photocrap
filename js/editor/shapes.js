// Shape layers: a layer with a `shape` keeps its vector path and styling and
// is re-rendered from them, so it stays editable (like type layers). Every
// shape is stored as a path, so any transform can be applied to it exactly.
//
//   shape = { kind, points, closed, fill, stroke, strokeWidth, dash?, arrowStart?, arrowEnd?, live? }
//   point = { x, y, ix, iy, ox, oy }   anchor plus in/out bezier handles
//
// "Live" shapes (drawn with the Shape tool) also keep what they were made
// from, so their corner radius, sides etc. can still be changed later:
//
//   live = { type, cx, cy, w, h, angle, flip, radius, sides, inner }
//
// (cx, cy) is the center, w × h the size before rotating by `angle` degrees,
// and flip mirrors it top-to-bottom. Moving, scaling, rotating and flipping
// keep a shape live; skewing turns it into a plain path.
//
// fill/stroke are colors or null; dash is "solid" | "dashed" | "dotted".
// Coordinates are in document space. The object is immutable: edits assign
// a new one, so history can keep the old.

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

// ---------- Live shapes ----------

// Shape types the Shape tool draws from a box. (Lines are drawn separately.)
export const LIVE_TYPES = ["rect", "ellipse", "triangle", "polygon", "star", "arrow", "heart", "bubble"];

// Scale a point list given in a unit box (−0.5…0.5) to w × h.
const scaled = (pts, w, h) => pts.map((p) => ({
  x: p.x * w, y: p.y * h, ix: (p.ix ?? p.x) * w, iy: (p.iy ?? p.y) * h, ox: (p.ox ?? p.x) * w, oy: (p.oy ?? p.y) * h,
}));

const HEART = [
  { x: 0, y: 0.5, ix: 0.1, iy: 0.4, ox: -0.1, oy: 0.4 },
  { x: -0.5, y: -0.15, ix: -0.5, iy: 0.15, ox: -0.5, oy: -0.47 },
  { x: 0, y: -0.3, ix: -0.08, iy: -0.56, ox: 0.08, oy: -0.56 },
  { x: 0.5, y: -0.15, ix: 0.5, iy: -0.47, ox: 0.5, oy: 0.15 },
];

// The shape's points around (0, 0), before rotating and placing it.
function localPoints(live) {
  const { type, w, h } = live;
  switch (type) {
    case "ellipse": return ellipsePoints(0, 0, w / 2, h / 2);
    case "triangle": return [corner(0, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
    case "polygon": return polygonPoints(0, 0, w / 2, h / 2, live.sides ?? 6);
    case "star": return polygonPoints(0, 0, w / 2, h / 2, live.sides ?? 5, true, live.inner ?? 0.5);
    case "arrow": {
      // A block arrow pointing right.
      const head = Math.min(w * 0.45, h * 0.9), shaft = h * 0.4;
      const x0 = -w / 2, x1 = w / 2, xh = x1 - head;
      return [corner(x0, -shaft / 2), corner(xh, -shaft / 2), corner(xh, -h / 2), corner(x1, 0),
        corner(xh, h / 2), corner(xh, shaft / 2), corner(x0, shaft / 2)];
    }
    case "heart": return scaled(HEART, w, h);
    case "bubble": {
      // A rounded box with a tail at the bottom left.
      const bodyH = h * 0.78;
      const r = live.radius > 0 ? live.radius : Math.min(w, bodyH) * 0.18;
      const body = rectPoints(-w / 2, -h / 2, w, bodyH, r);
      const y1 = -h / 2 + bodyH;
      const tail = [corner(-w / 2 + w * 0.42, y1), corner(-w / 2 + w * 0.18, h / 2), corner(-w / 2 + w * 0.22, y1)];
      // Insert the tail on the bottom edge (after the bottom-right corner).
      const i = body.length === 8 ? 5 : 3;
      return [...body.slice(0, i), ...tail, ...body.slice(i)];
    }
    default: return rectPoints(-w / 2, -h / 2, w, h, live.radius ?? 0);
  }
}

// The live shape's points in document space.
export function livePoints(live) {
  const a = ((live.angle ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const f = live.flip ? -1 : 1;
  const tp = (x, y) => ({ x: live.cx + cos * x - sin * y * f, y: live.cy + sin * x + cos * y * f });
  return localPoints(live).map((p) => {
    const A = tp(p.x, p.y), I = tp(p.ix, p.iy), O = tp(p.ox, p.oy);
    return { x: A.x, y: A.y, ix: I.x, iy: I.y, ox: O.x, oy: O.y };
  });
}

// A live shape with some of its parameters changed.
export function withLive(shape, changes) {
  const live = { ...shape.live, ...changes };
  live.w = Math.max(1, live.w);
  live.h = Math.max(1, live.h);
  return { ...shape, kind: live.type, live, points: livePoints(live), closed: true };
}

// Where a live shape's box lands under an affine matrix, or null if the
// matrix skews it (then it stays a plain path).
function transformLive(live, m) {
  const c = m.transformPoint({ x: live.cx, y: live.cy });
  const a = ((live.angle ?? 0) * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -Math.sin(a), y: Math.cos(a) };
  const U = { x: m.a * u.x + m.c * u.y, y: m.b * u.x + m.d * u.y };
  const V = { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
  const lu = Math.hypot(U.x, U.y), lv = Math.hypot(V.x, V.y);
  if (!lu || !lv || Math.abs(U.x * V.x + U.y * V.y) > 1e-6 * lu * lv) return null;
  const mirrored = U.x * V.y - U.y * V.x < 0;
  return {
    ...live, cx: c.x, cy: c.y, w: live.w * lu, h: live.h * lv,
    angle: Math.round(((Math.atan2(U.y, U.x) * 180) / Math.PI) * 1000) / 1000,
    flip: mirrored ? !live.flip : !!live.flip,
    radius: (live.radius ?? 0) * Math.min(lu, lv),
  };
}

// ---------- Paths, bounds, transforms ----------

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

const arrowSize = (s) => Math.max(8, s.strokeWidth * 4);

// Bounds of the shape including its stroke (control points bound the curve).
export function shapeBounds(shape) {
  let b = null;
  for (const p of shape.points) {
    for (const [x, y] of [[p.x, p.y], [p.ix, p.iy], [p.ox, p.oy]]) b = unionRect(b, { x, y, w: 0, h: 0 });
  }
  if (!b) return { x: 0, y: 0, w: 0, h: 0 };
  let pad = shape.stroke ? shape.strokeWidth * 2 + 2 : 2; // room for miter joins
  if (shape.arrowStart || shape.arrowEnd) pad += arrowSize(shape) * 1.2;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

// Apply a DOMMatrix to every anchor and handle (exact for any affine transform).
export function transformShape(shape, m) {
  const tp = (x, y) => m.transformPoint({ x, y });
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const out = {
    ...shape,
    strokeWidth: shape.strokeWidth * scale,
    points: shape.points.map((p) => {
      const a = tp(p.x, p.y), i = tp(p.ix, p.iy), o = tp(p.ox, p.oy);
      return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    }),
  };
  if (shape.live) {
    const live = transformLive(shape.live, m);
    if (live) out.live = live;
    else delete out.live;
  }
  return out;
}

export const translateShape = (shape, dx, dy) => transformShape(shape, new DOMMatrix().translate(dx, dy));

// ---------- Drawing ----------

// An arrowhead at the end of an open path: base at the endpoint, pointing on.
function arrowhead(c, s, tip, from) {
  const len = arrowSize(s), half = len * 0.55;
  let dx = tip.x - from.x, dy = tip.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  dx /= d;
  dy /= d;
  c.beginPath();
  c.moveTo(tip.x + dx * len, tip.y + dy * len);
  c.lineTo(tip.x - dy * half, tip.y + dx * half);
  c.lineTo(tip.x + dy * half, tip.y - dx * half);
  c.closePath();
  c.fill();
}

// Which way a path leaves an endpoint: toward its handle, or the next point.
function approach(pts, end) {
  const n = pts.length;
  const p = end ? pts[n - 1] : pts[0];
  const h = end ? { x: p.ix, y: p.iy } : { x: p.ox, y: p.oy };
  if (Math.hypot(h.x - p.x, h.y - p.y) > 0.5) return h;
  return end ? pts[n - 2] : pts[1];
}

// Paint a shape onto a context (in its current transform).
export function paintShape(c, s) {
  const path = shapePath(s);
  if (s.fill && s.closed) {
    c.fillStyle = s.fill;
    c.fill(path);
  }
  if (s.stroke && s.strokeWidth > 0) {
    const w = s.strokeWidth;
    const arrows = !s.closed && s.points.length > 1;
    c.strokeStyle = s.stroke;
    c.lineWidth = w;
    c.lineJoin = s.dash === "dotted" ? "round" : "miter";
    c.miterLimit = 4;
    c.lineCap = s.dash === "dotted" ? "round" : s.closed ? "butt" : arrows && (s.arrowStart || s.arrowEnd) ? "butt" : "round";
    c.setLineDash(s.dash === "dashed" ? [w * 3, w * 2] : s.dash === "dotted" ? [0.001, w * 2] : []);
    c.stroke(path);
    c.setLineDash([]);
    if (arrows) {
      c.fillStyle = s.stroke;
      if (s.arrowEnd) arrowhead(c, s, s.points.at(-1), approach(s.points, true));
      if (s.arrowStart) arrowhead(c, s, s.points[0], approach(s.points, false));
    }
  }
}

// Redraw a shape layer's pixels from its path, growing the canvas if the
// shape extends off the document.
export function renderShape(layer, doc) {
  const s = layer.shape;
  const b = shapeBounds(s);
  const x0 = Math.min(0, Math.floor(b.x)), y0 = Math.min(0, Math.floor(b.y));
  const x1 = Math.max(doc.width, Math.ceil(b.x + b.w)), y1 = Math.max(doc.height, Math.ceil(b.y + b.h));
  layer.setGeometry(x0, y0, x1 - x0, y1 - y0);
  paintShape(layer.ctx, s);
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
