// Layer styles (effects). Rendered live from a layer's (masked) pixels each
// time the document is composited, so they follow edits and never change
// the layer itself. A layer's `styles` object is immutable, like `text`.
//
//   { dropShadow, innerShadow, outerGlow, stroke, colorOverlay }
//   each: { enabled, color, opacity (0–1), size, distance?, angle? }

import { rgba } from "./util.js";

export const DEFAULT_STYLES = {
  dropShadow: { enabled: false, color: "#000000", opacity: 0.75, angle: 120, distance: 10, size: 14 },
  innerShadow: { enabled: false, color: "#000000", opacity: 0.6, angle: 120, distance: 6, size: 10 },
  outerGlow: { enabled: false, color: "#ffe08a", opacity: 0.8, size: 20 },
  stroke: { enabled: false, color: "#000000", opacity: 1, size: 3 },
  colorOverlay: { enabled: false, color: "#ff3b30", opacity: 1 },
};

export const STYLE_LABELS = {
  dropShadow: "Drop Shadow",
  innerShadow: "Inner Shadow",
  outerGlow: "Outer Glow",
  stroke: "Stroke",
  colorOverlay: "Color Overlay",
};

export const hasStyles = (styles) => !!styles && Object.values(styles).some((s) => s?.enabled);

// Light comes from `angle` (Photoshop convention), so shadows fall the other way.
function shadowOffset({ angle, distance }) {
  const a = (angle * Math.PI) / 180;
  return { dx: -Math.cos(a) * distance, dy: Math.sin(a) * distance };
}

// Draw only the blurred shadow of `src`: the image itself is drawn far off
// the canvas and the shadow offset brings just the shadow back into view.
function shadowOnly(ctx, src, color, alpha, dx, dy, blur, far) {
  ctx.save();
  ctx.shadowColor = rgba(color, alpha);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx + far;
  ctx.shadowOffsetY = dy;
  ctx.drawImage(src, -far, 0);
  ctx.restore();
}

function begin(ctx, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
}

// content: a document-space canvas (w×h) holding the layer's masked pixels.
// Returns a document-space canvas with effects + content, valid inside r.
// temp(name) hands out reusable document-sized canvases.
export function renderStyled(content, styles, r, w, h, temp) {
  const far = (w + h) * 2 + 1000;
  const out = temp("fx-out"), oc = out.getContext("2d");
  begin(oc, r);

  const { dropShadow: ds, outerGlow: og, stroke: st, colorOverlay: co, innerShadow: is } = styles;

  if (ds?.enabled) {
    const { dx, dy } = shadowOffset(ds);
    shadowOnly(oc, content, ds.color, ds.opacity, dx, dy, ds.size, far);
  }
  if (og?.enabled) shadowOnly(oc, content, og.color, og.opacity, 0, 0, og.size, far);

  if (st?.enabled && st.size > 0) {
    // Outside stroke: the silhouette, dilated by stamping it in rings, minus the shape.
    const sil = temp("fx-sil"), sc = sil.getContext("2d");
    begin(sc, { x: 0, y: 0, w, h });
    sc.drawImage(content, 0, 0);
    sc.globalCompositeOperation = "source-in";
    sc.fillStyle = st.color;
    sc.fillRect(0, 0, w, h);
    sc.restore();
    const ring = temp("fx-ring"), rc = ring.getContext("2d");
    begin(rc, r);
    for (const k of [1, 0.66, 0.33]) {
      const rad = st.size * k;
      const n = Math.max(8, Math.min(36, Math.round(rad * 2)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        rc.drawImage(sil, Math.cos(a) * rad, Math.sin(a) * rad);
      }
    }
    rc.globalCompositeOperation = "destination-out";
    rc.drawImage(content, 0, 0);
    rc.restore();
    oc.globalAlpha = st.opacity;
    oc.drawImage(ring, 0, 0);
    oc.globalAlpha = 1;
  }

  // The layer itself, with effects that sit on its surface.
  const face = temp("fx-face"), fc = face.getContext("2d");
  begin(fc, r);
  fc.drawImage(content, 0, 0);
  if (co?.enabled) {
    fc.globalCompositeOperation = "source-atop";
    fc.fillStyle = rgba(co.color, co.opacity);
    fc.fillRect(r.x, r.y, r.w, r.h);
    fc.globalCompositeOperation = "source-over";
  }
  if (is?.enabled) {
    // Shadow cast by everything *outside* the shape, kept only on the shape.
    const inv = temp("fx-inv"), ic = inv.getContext("2d");
    begin(ic, { x: 0, y: 0, w, h });
    ic.fillStyle = "#000";
    ic.fillRect(0, 0, w, h);
    ic.globalCompositeOperation = "destination-out";
    ic.drawImage(content, 0, 0);
    ic.restore();
    const { dx, dy } = shadowOffset(is);
    fc.globalCompositeOperation = "source-atop";
    shadowOnly(fc, inv, is.color, is.opacity, dx, dy, is.size, far);
    fc.globalCompositeOperation = "source-over";
  }
  fc.restore();
  oc.drawImage(face, 0, 0);
  oc.restore();
  return out;
}
