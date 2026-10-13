// Shared plumbing for the healing tools and Edit › Heal Selection.

import { filterClient } from "./filter-client.js";
import { createCanvas, clampRect } from "./util.js";

// The image healing samples from, as document-sized ImageData: the target
// surface, or every visible layer merged.
export function sampleImage(app, surface, sampleAll) {
  const { width: w, height: h } = app.doc;
  if (sampleAll) {
    const data = app.doc.compose().getContext("2d").getImageData(0, 0, w, h);
    app.requestRender(); // compose() reused the on-screen composite
    return data;
  }
  return surface.getDocImageData({ x: 0, y: 0, w, h });
}

// Alpha channel of a document-space canvas inside rect R, as a Uint8Array.
export function maskFromCanvas(canvas, R) {
  const d = canvas.getContext("2d").getImageData(R.x, R.y, R.w, R.h).data;
  const m = new Uint8Array(R.w * R.h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
  return m;
}

// Copy rect R (shifted by ox, oy) out of a document-sized ImageData.
// The shifted rect must lie inside the image.
export function cropImage(full, R, ox = 0, oy = 0) {
  const out = new ImageData(R.w, R.h);
  for (let y = 0; y < R.h; y++) {
    const from = ((R.y + oy + y) * full.width + R.x + ox) * 4;
    out.data.set(full.data.subarray(from, from + R.w * 4), y * R.w * 4);
  }
  return out;
}

// Pad the bounds of a painted area so the healing has a ring of untouched
// pixels around it, clipped to the document.
export function healRegion(bounds, doc, pad) {
  return clampRect({ x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 }, doc.width, doc.height);
}

// Find where to copy texture from for an area marked by `mask` (inside
// rect R): try offsets on rings around it and keep the one whose
// surroundings best match the pixels just outside the area. Returns
// { x, y } or null if no clean candidate fits on the canvas.
export function findSourceOffset(full, mask, R) {
  const { width: W, height: H, data } = full;
  const at = (x, y) => mask[(y - R.y) * R.w + (x - R.x)];

  // Tight bounds of the marked area, and a band of pixels just outside it.
  let tx0 = Infinity, ty0 = Infinity, tx1 = -1, ty1 = -1;
  const band = [];
  for (let y = R.y; y < R.y + R.h; y++) {
    for (let x = R.x; x < R.x + R.w; x++) {
      if (at(x, y)) {
        if (x < tx0) tx0 = x;
        if (x > tx1) tx1 = x;
        if (y < ty0) ty0 = y;
        if (y > ty1) ty1 = y;
        continue;
      }
      // Within 3px of the area?
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) {
        for (let dx = -3; dx <= 3 && !near; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= R.x && ny >= R.y && nx < R.x + R.w && ny < R.y + R.h && at(nx, ny)) near = true;
        }
      }
      if (near) band.push(y * W + x);
    }
  }
  if (tx1 < 0) return null;
  const step = Math.max(1, Math.floor(band.length / 1500));
  const probe = band.filter((_, i) => i % step === 0);

  const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
  const size = Math.max(tw, th);
  let best = null, bestScore = Infinity;
  for (const k of [1.15, 1.5, 2, 2.75, 3.75]) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const ox = Math.round(Math.cos(ang) * size * k), oy = Math.round(Math.sin(ang) * size * k);
      // The whole source region must be on the canvas…
      if (R.x + ox < 0 || R.y + oy < 0 || R.x + R.w + ox > W || R.y + R.h + oy > H) continue;
      // …and must not overlap the area being repaired.
      if (Math.abs(ox) < tw + 4 && Math.abs(oy) < th + 4) continue;
      let score = 0;
      for (const p of probe) {
        const i = p * 4, j = (p + oy * W + ox) * 4;
        const dr = data[i] - data[j], dg = data[i + 1] - data[j + 1], db = data[i + 2] - data[j + 2];
        score += dr * dr + dg * dg + db * db;
        if (score >= bestScore) break;
      }
      // Gentle preference for nearby patches (similar lighting and texture).
      score *= 1 + k * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = { x: ox, y: oy };
      }
    }
  }
  return best;
}

// Run the Poisson blend in the worker and stamp the result onto `surface`
// inside R. base/src are R-sized ImageData; mask is the R-sized alpha.
export async function healInto(surface, R, base, src, mask, opacity = 1) {
  const out = await filterClient.run("heal", { src, mask }, base);
  const c = createCanvas(R.w, R.h);
  c.getContext("2d").putImageData(out, 0, 0);
  surface.ctx.globalAlpha = opacity;
  surface.ctx.drawImage(c, R.x, R.y);
  surface.ctx.globalAlpha = 1;
}

// Edit › Heal Selection: fill the selection from a matching nearby area.
export async function healSelection(app) {
  const doc = app.doc, sel = doc.selection;
  const { layer, surface, isMask } = app.target();
  if (!sel || isMask || !app.ensureVisible(layer)) return;
  const R = healRegion(sel.bounds, doc, 6);
  const mask = maskFromCanvas(sel.mask, R);
  const full = sampleImage(app, surface, false);
  const offset = findSourceOffset(full, mask, R);
  if (!offset) {
    app.toast("Couldn't find a clean area to copy from — try a smaller selection.");
    return;
  }
  app.history.begin("Heal Selection", [surface]);
  app.setWorking(true);
  try {
    await healInto(surface, R, cropImage(full, R), cropImage(full, R, offset.x, offset.y), mask);
    app.history.commit(R);
  } catch (err) {
    console.error(err);
    app.history.cancel();
    app.toast("Healing failed.");
  } finally {
    app.setWorking(false);
  }
}
