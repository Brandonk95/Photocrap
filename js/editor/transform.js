import { createCanvas } from "./util.js";
import { renderText } from "./text.js";
import { transformShape, renderShape } from "./shapes.js";
import { HANDLE_FRACTIONS, hitHandle, drawBox, drawHandles, resizeCursor, ROTATE_CURSOR } from "./handles.js";
import { snapBox } from "./guides.js";

// Free Transform: lifts the selected pixels (or the layer's content) onto a
// floating canvas, lets you scale/rotate/move it with on-canvas handles, and
// stamps it back on commit. It is a modal tool that holds one history entry
// open for its whole session, entered through app.beginTransform().
export function createTransformTool() {
  const settings = { scaleX: 100, scaleY: 100, angle: 0, keep: true };
  let s = null; // the active session

  // Maps float-canvas pixels to document pixels.
  const matrix = () =>
    new DOMMatrix().translate(s.cx, s.cy).rotate(s.angle).scale(s.sx, s.sy).translate(-s.b.w / 2, -s.b.h / 2);

  const toScreen = (app, p) => ({ sx: app.view.x + p.x * app.view.zoom, sy: app.view.y + p.y * app.view.zoom });

  const handles = (app) => {
    const m = matrix();
    return HANDLE_FRACTIONS.map(([fx, fy]) => ({ fx, fy, ...toScreen(app, m.transformPoint({ x: fx * s.b.w, y: fy * s.b.h })) }));
  };

  const inside = (e) => {
    const p = matrix().inverse().transformPoint({ x: e.x, y: e.y });
    return p.x >= 0 && p.y >= 0 && p.x <= s.b.w && p.y <= s.b.h;
  };

  function syncSettings(app) {
    settings.scaleX = Math.round(s.sx * 1000) / 10;
    settings.scaleY = Math.round(s.sy * 1000) / 10;
    settings.angle = Math.round(s.angle * 10) / 10;
    app.emit("options");
  }

  function renderLive(app, piece, rect) {
    const { width: w, height: h } = app.doc;
    if (piece.out.width !== w || piece.out.height !== h) {
      piece.out.width = w;
      piece.out.height = h;
    }
    const c = piece.out.getContext("2d");
    const r = rect ?? { x: 0, y: 0, w, h };
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.clearRect(r.x, r.y, r.w, r.h);
    c.drawImage(piece.surface.canvas, piece.surface.x, piece.surface.y);
    c.setTransform(matrix());
    c.imageSmoothingQuality = "high";
    c.drawImage(piece.float.canvas, 0, 0);
    c.restore();
    return piece.out;
  }

  function end(app) {
    const prev = s.prevTool;
    s = null;
    app.live = null;
    app.hideSelection = false;
    app.setTool(prev.id);
  }

  function commit(app) {
    if (!s) return;
    const { sel, b } = s;
    // matrix() maps float-local pixels; the float sits at (b.x, b.y) in the document.
    const m = matrix().translate(-b.x, -b.y);
    for (const piece of s.pieces) piece.surface.stamp(piece.float, m, app.doc.width, app.doc.height);
    if (sel) app.doc.selection = sel.transformed(m);
    // Moving or uniformly scaling a whole type layer keeps it editable:
    // update its text and re-render it crisply instead of keeping scaled pixels.
    // Transforming whole layers: shapes stay vector under any transform (their
    // points are transformed and re-rendered crisply); type stays editable
    // when it's only moved or uniformly scaled, and becomes pixels otherwise.
    if (!sel) {
      const uniform = s.angle === 0 && s.sx > 0 && Math.abs(s.sx - s.sy) < 0.0005;
      for (const piece of s.pieces) {
        const owner = piece.owner;
        if (piece.isMask) continue;
        if (owner.shape) {
          owner.shape = transformShape(owner.shape, m);
          renderShape(owner, app.doc);
        }
        if (owner.text && uniform) {
          const t = owner.text;
          const p = m.transformPoint({ x: t.x, y: t.y });
          owner.text = { ...t, x: p.x, y: p.y, size: Math.max(1, t.size * s.sx) };
          renderText(owner, app.doc);
        } else if (owner.text) {
          owner.text = null;
          app.toast(`“${owner.name}” is now pixels — rotated or stretched text can't stay editable.`);
        }
      }
      app.history.pending.keepText = true;
    }
    end(app);
    app.history.commit();
  }

  function cancel(app) {
    if (!s) return;
    end(app);
    app.history.cancel();
  }

  const tool = {
    id: "transform", name: "Free Transform", modal: true, hidden: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" stroke-dasharray="3 2"/><rect x="3" y="3" width="4" height="4" fill="currentColor"/><rect x="17" y="3" width="4" height="4" fill="currentColor"/><rect x="3" y="17" width="4" height="4" fill="currentColor"/><rect x="17" y="17" width="4" height="4" fill="currentColor"/></svg>',
    settings,
    options: [
      { key: "scaleX", label: "W", type: "number", step: 0.1, unit: "%" },
      { key: "scaleY", label: "H", type: "number", step: 0.1, unit: "%" },
      { key: "keep", label: "Keep proportions", type: "checkbox" },
      { key: "angle", label: "Angle", type: "number", step: 0.5, unit: "°" },
      { type: "action", label: "Commit", primary: true, run: commit },
      { type: "action", label: "Cancel", run: cancel },
      { type: "hint", text: "Drag a handle to scale · drag outside to rotate · Shift toggles proportions · Enter commits · Esc cancels" },
    ],

    // Lift the content of the edit target (plus its linked mask). Returns
    // false if there is nothing to transform.
    // whole: transform the whole layer even if there is a selection.
    start(app, prevTool, { whole = false, label = "Free Transform" } = {}) {
      const doc = app.doc, sel = whole ? null : doc.selection;
      const { layer, surface: target, isMask } = app.target();
      // Bounds include any content that is already off-canvas.
      const b = sel ? sel.bounds : isMask ? target.bounds : app.contentBoundsOf(layer);
      if (!b) {
        app.toast("Nothing to transform — the layer is empty.");
        return false;
      }
      const linked = app.linkedSurfaces();
      app.history.begin(label, linked.map((p) => p.surface));
      const pieces = linked.map((p) => ({
        ...p,
        float: p.surface.lift(sel, sel ? null : b),
        out: createCanvas(doc.width, doc.height),
      }));
      s = {
        pieces, sel, b, prevTool,
        cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, angle: 0,
        drag: null,
      };
      // One preview entry per transformed layer (a group has several).
      const map = new Map();
      for (const piece of pieces) {
        const entry = map.get(piece.owner) ?? {};
        entry[piece.isMask ? "mask" : "pixels"] = (rect) => renderLive(app, piece, rect);
        map.set(piece.owner, entry);
      }
      app.live = { map };
      app.hideSelection = true;
      syncSettings(app);
      app.requestRender();
      return true;
    },

    // Give the layer's content new bounds directly (the Properties panel's
    // X / Y / W / H), with the same rules as a dragged transform.
    setBounds(app, { x, y, w, h }) {
      if (!this.start(app, app.tool, { whole: true, label: "Transform Layer" })) return;
      s.sx = w / s.b.w;
      s.sy = h / s.b.h;
      s.cx = x + w / 2;
      s.cy = y + h / 2;
      commit(app);
    },

    // Flip the whole layer ("h" or "v"). Going through the transform keeps
    // shape layers as editable vectors.
    flip(app, axis) {
      if (!this.start(app, app.tool, { whole: true, label: axis === "h" ? "Flip Layer Horizontal" : "Flip Layer Vertical" })) return;
      if (axis === "h") s.sx = -1;
      else s.sy = -1;
      commit(app);
    },

    cursor(app, p) {
      if (!s || !p) return "default";
      const pts = handles(app);
      const hit = hitHandle(pts, p.sx, p.sy);
      if (hit) {
        const c = toScreen(app, { x: s.cx, y: s.cy });
        return resizeCursor(c, hit);
      }
      return inside(p) ? "move" : ROTATE_CURSOR;
    },

    down(app, e) {
      if (!s) return;
      const hit = hitHandle(handles(app), e.sx, e.sy);
      const d = { start: e, cx: s.cx, cy: s.cy, sx: s.sx, sy: s.sy, angle: s.angle };
      if (hit) {
        d.type = "scale";
        d.handle = hit;
        d.anchor = matrix().transformPoint({ x: (1 - hit.fx) * s.b.w, y: (1 - hit.fy) * s.b.h });
      } else {
        d.type = inside(e) ? "move" : "rotate";
      }
      s.drag = d;
    },

    move(app, e) {
      const d = s?.drag;
      if (!d) return;
      if (d.type === "move") {
        let dx = e.x - d.start.x, dy = e.y - d.start.y;
        if (e.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        s.cx = d.cx + dx;
        s.cy = d.cy + dy;
        // Snap the (unrotated) box to guides and the canvas.
        if (s.angle === 0) {
          const w = Math.abs(s.sx) * s.b.w, h = Math.abs(s.sy) * s.b.h;
          const snap = snapBox(app, { x: s.cx - w / 2, y: s.cy - h / 2, w, h }, app.doc.activeLayer);
          s.cx += snap.dx;
          s.cy += snap.dy;
        }
      } else if (d.type === "rotate") {
        const a0 = Math.atan2(d.start.y - d.cy, d.start.x - d.cx);
        const a1 = Math.atan2(e.y - d.cy, e.x - d.cx);
        let angle = d.angle + ((a1 - a0) * 180) / Math.PI;
        if (e.shift) angle = Math.round(angle / 15) * 15;
        s.angle = ((((angle + 180) % 360) + 360) % 360) - 180;
      } else {
        // Scale with the opposite handle pinned. Work in the box's own
        // (unrotated) axes: ex/ey are the base distances from anchor to handle.
        const { fx, fy } = d.handle;
        const ax = 1 - fx, ay = 1 - fy;
        const ex = (fx - ax) * s.b.w, ey = (fy - ay) * s.b.h;
        const rad = (d.angle * Math.PI) / 180;
        const px = e.x - d.anchor.x, py = e.y - d.anchor.y;
        const lx = px * Math.cos(rad) + py * Math.sin(rad);
        const ly = -px * Math.sin(rad) + py * Math.cos(rad);
        let sx = ex ? lx / ex : d.sx;
        let sy = ey ? ly / ey : d.sy;
        if (settings.keep !== e.shift) {
          if (ex && ey) {
            const a = d.sx * ex, b = d.sy * ey;
            const k = (lx * a + ly * b) / (a * a + b * b);
            sx = d.sx * k;
            sy = d.sy * k;
          } else if (ex) {
            sy = d.sy * (sx / d.sx);
          } else {
            sx = d.sx * (sy / d.sy);
          }
        }
        const tiny = (v) => (Math.abs(v) < 0.005 ? (v < 0 ? -0.005 : 0.005) : v);
        s.sx = tiny(sx);
        s.sy = tiny(sy);
        const vx = (ax - 0.5) * s.b.w * s.sx, vy = (ay - 0.5) * s.b.h * s.sy;
        s.cx = d.anchor.x - (vx * Math.cos(rad) - vy * Math.sin(rad));
        s.cy = d.anchor.y - (vx * Math.sin(rad) + vy * Math.cos(rad));
      }
      syncSettings(app);
      app.requestRender();
    },

    up() {
      if (s) s.drag = null;
    },

    cancel() {
      if (s) s.drag = null;
    },

    optionsChanged(app, key) {
      if (!s) return;
      if (settings.keep && key === "scaleX") settings.scaleY = settings.scaleX;
      if (settings.keep && key === "scaleY") settings.scaleX = settings.scaleY;
      s.sx = settings.scaleX / 100 || 0.005;
      s.sy = settings.scaleY / 100 || 0.005;
      s.angle = settings.angle;
      app.emit("options");
      app.requestRender();
    },

    keydown(app, ev) {
      if (!s) return false;
      if (ev.key === "Enter") commit(app);
      else if (ev.key === "Escape") cancel(app);
      else if (ev.key.startsWith("Arrow")) {
        const d = ev.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[ev.key];
        s.cx += dx;
        s.cy += dy;
        app.requestRender();
      } else return false;
      return true;
    },

    // Switching tools mid-transform commits it, like Photoshop.
    deactivate(app) {
      commit(app);
    },

    drawScreenOverlay(ctx, app) {
      if (!s) return;
      const pts = handles(app);
      drawBox(ctx, pts.slice(0, 4));
      drawHandles(ctx, pts);
    },
  };
  return tool;
}
