// Rulers, guides and snapping.
//
// Guides live on the document (doc.guides: [{ axis, pos }], immutable —
// changes assign a new array, so history can keep old ones). axis "x" is a
// vertical guide at x = pos, "y" a horizontal one. The view preferences
// (rulers / guides / snap on or off) are per browser.

export const RULER = 18;          // ruler thickness, screen px
const SNAP_PX = 6;                // snapping distance, screen px
const GUIDE_HIT_PX = 4;           // how close the pointer must be to grab a guide
const PREFS_KEY = "photocrap:view";
const GUIDE_COLOR = "#2ad4ff";
const SNAP_COLOR = "#ff3df2";

export function loadViewPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { /* defaults */ }
  return { ...DEFAULT_VIEW_PREFS, ...saved };
}

export const DEFAULT_VIEW_PREFS = { rulers: true, guides: true, snap: true };

export function saveViewPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ---------- Snapping ----------

// Positions on one axis that things snap to: the canvas edges and center,
// and the guides (when shown).
function targets(app, axis) {
  const doc = app.doc, size = axis === "x" ? doc.width : doc.height;
  const t = [0, size / 2, size];
  const dragging = app.gesture?.type === "guide" ? doc.guides[app.gesture.index] : null; // not onto itself
  if (app.prefs.guides) for (const g of doc.guides) if (g.axis === axis && g !== dragging) t.push(g.pos);
  return t;
}

// The offset that brings the closest of `values` onto a target, or 0.
// Remembers the target so the view can draw a snap line.
export function snapOffset(app, axis, values) {
  if (!app.prefs.snap || !app.doc) return 0;
  const tol = SNAP_PX / app.view.zoom;
  let best = null;
  for (const v of values) {
    for (const t of targets(app, axis)) {
      const d = t - v;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
  }
  if (best) app.snapLines[axis] = best.t;
  else delete app.snapLines[axis];
  return best ? best.d : 0;
}

// Snap a document point.
export function snapPoint(app, p) {
  return { ...p, x: p.x + snapOffset(app, "x", [p.x]), y: p.y + snapOffset(app, "y", [p.y]) };
}

// How far to shift a box so its edges or center land on a target.
export function snapBox(app, b) {
  return {
    dx: snapOffset(app, "x", [b.x, b.x + b.w / 2, b.x + b.w]),
    dy: snapOffset(app, "y", [b.y, b.y + b.h / 2, b.y + b.h]),
  };
}

// ---------- Guides ----------

// The guide under a screen point, as an index into doc.guides, or -1.
export function guideAt(app, sx, sy) {
  if (!app.prefs.guides || !app.doc) return -1;
  const { zoom, x, y } = app.view;
  let best = -1, bd = GUIDE_HIT_PX + 1;
  app.doc.guides.forEach((g, i) => {
    const d = g.axis === "x" ? Math.abs(x + g.pos * zoom - sx) : Math.abs(y + g.pos * zoom - sy);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// Over a ruler? Returns the axis of guide it would create ("y" from the top
// ruler, "x" from the left one), or null.
export function rulerAt(app, sx, sy) {
  if (!app.prefs.rulers) return null;
  if (sy < RULER && sx >= RULER) return "y";
  if (sx < RULER && sy >= RULER) return "x";
  return null;
}

// Guide position for a pointer, snapped to the canvas edges/center and
// whole pixels.
export function guidePos(app, axis, e) {
  const v = axis === "x" ? e.x : e.y;
  const snapped = v + snapOffset(app, axis, [v]);
  return Math.round(snapped);
}

// ---------- Drawing (screen space) ----------

export function drawGuides(app, ctx) {
  const doc = app.doc;
  const { zoom, x, y } = app.view;
  ctx.save();
  ctx.lineWidth = 1;
  const line = (axis, pos, color, dash) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    if (axis === "x") {
      const sx = Math.round(x + pos * zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, app.cssH);
    } else {
      const sy = Math.round(y + pos * zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(app.cssW, sy);
    }
    ctx.stroke();
  };
  if (app.prefs.guides) {
    doc.guides.forEach((g, i) => {
      if (app.gesture?.type === "guide" && app.gesture.index === i) return; // drawn below
      line(g.axis, g.pos, GUIDE_COLOR);
    });
  }
  const g = app.gesture;
  if (g?.type === "guide" && g.pos != null && !g.remove) line(g.axis, g.pos, GUIDE_COLOR);
  // While dragging, show what snapped.
  if (g && g.type !== "pan") {
    for (const axis of ["x", "y"]) if (app.snapLines[axis] != null) line(axis, app.snapLines[axis], SNAP_COLOR, [4, 3]);
  }
  ctx.restore();
}

// Tick spacing in document px: about every 60 screen px, on a 1-2-5 scale.
function tickStep(zoom) {
  const target = 60 / zoom;
  const p = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (p * m >= target) return p * m;
  return p * 10;
}

export function drawRulers(app, ctx, colors) {
  const { zoom, x, y } = app.view;
  const W = app.cssW, H = app.cssH;
  ctx.save();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, RULER);
  ctx.fillRect(0, 0, RULER, H);
  // The document's extent, slightly lighter.
  ctx.fillStyle = colors.doc;
  ctx.fillRect(Math.max(RULER, x), 0, Math.max(0, Math.min(W, x + app.doc.width * zoom) - Math.max(RULER, x)), RULER);
  ctx.fillRect(0, Math.max(RULER, y), RULER, Math.max(0, Math.min(H, y + app.doc.height * zoom) - Math.max(RULER, y)));

  const major = tickStep(zoom);
  const per = major * zoom / 10 >= 6 ? 10 : 5; // minor ticks per major
  const minor = major / per;
  const tick = (i) => (i % per === 0 ? RULER : per === 10 && i % 5 === 0 ? 7 : 4);
  const label = (v) => String(Math.round(v));
  ctx.strokeStyle = colors.tick;
  ctx.fillStyle = colors.text;
  ctx.font = "9px system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Top ruler.
  for (let i = Math.floor((RULER - x) / zoom / minor); x + i * minor * zoom < W; i++) {
    const v = i * minor, sx = Math.round(x + v * zoom) + 0.5;
    if (sx < RULER) continue;
    ctx.moveTo(sx, RULER - tick(i));
    ctx.lineTo(sx, RULER);
    if (i % per === 0) ctx.fillText(label(v), sx + 3, 9);
  }
  // Left ruler (labels rotated).
  for (let i = Math.floor((RULER - y) / zoom / minor); y + i * minor * zoom < H; i++) {
    const v = i * minor, sy = Math.round(y + v * zoom) + 0.5;
    if (sy < RULER) continue;
    ctx.moveTo(RULER - tick(i), sy);
    ctx.lineTo(RULER, sy);
    if (i % per === 0) {
      ctx.save();
      ctx.translate(9, sy - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label(v), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();

  // Pointer position.
  const p = app.pointer;
  if (p) {
    ctx.strokeStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(Math.round(p.sx) + 0.5, 0);
    ctx.lineTo(Math.round(p.sx) + 0.5, RULER);
    ctx.moveTo(0, Math.round(p.sy) + 0.5);
    ctx.lineTo(RULER, Math.round(p.sy) + 0.5);
    ctx.stroke();
  }
  // Edges and the corner square.
  ctx.strokeStyle = colors.border;
  ctx.beginPath();
  ctx.moveTo(0, RULER - 0.5);
  ctx.lineTo(W, RULER - 0.5);
  ctx.moveTo(RULER - 0.5, 0);
  ctx.lineTo(RULER - 0.5, H);
  ctx.stroke();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, RULER - 1, RULER - 1);
  ctx.restore();
}
