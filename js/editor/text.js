// Type layers: a layer with a `text` property keeps its words and styling
// and is re-rendered from them, so it stays editable. The text object is
// treated as immutable (edits assign a new one), which lets history keep
// references to old versions.
//
//   { content, x, y, font, size, bold, italic, align, color, autoName }
//
// (x, y) is the top of the first line, at its left edge, center or right
// edge depending on `align`. Coordinates are in document space.

import { createCanvas } from "./util.js";

export const LINE_HEIGHT = 1.2;

export function textFont(t, size = t.size) {
  return `${t.italic ? "italic " : ""}${t.bold ? "700" : "400"} ${size}px "${t.font}", sans-serif`;
}

const measureCtx = createCanvas(1, 1).getContext("2d");

// Bounding box of the rendered text, in document space.
export function measureText(t) {
  measureCtx.font = textFont(t);
  const lines = t.content.split("\n");
  const w = Math.max(1, ...lines.map((l) => measureCtx.measureText(l).width));
  const h = lines.length * t.size * LINE_HEIGHT;
  const x = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
  return { x, y: t.y, w, h };
}

// Redraw a type layer's pixels from its text, growing the canvas if the
// text runs off the document (italics and descenders get some padding).
export function renderText(layer, doc) {
  const t = layer.text;
  const box = measureText(t);
  const pad = Math.ceil(t.size * 0.5);
  const x0 = Math.min(0, Math.floor(box.x - pad)), y0 = Math.min(0, Math.floor(box.y - pad));
  const x1 = Math.max(doc.width, Math.ceil(box.x + box.w + pad)), y1 = Math.max(doc.height, Math.ceil(box.y + box.h + pad));
  layer.setGeometry(x0, y0, x1 - x0, y1 - y0);
  const c = layer.ctx;
  c.font = textFont(t);
  c.fillStyle = t.color;
  c.textAlign = t.align;
  c.textBaseline = "middle";
  const lh = t.size * LINE_HEIGHT;
  t.content.split("\n").forEach((line, i) => c.fillText(line, t.x, t.y + lh * (i + 0.5)));
}

// A sensible layer name for some text.
export function nameFor(content) {
  return content.split("\n")[0].trim().slice(0, 32) || "Text";
}

// Topmost visible type layer under a document point.
export function textLayerAt(doc, x, y) {
  const leaves = doc.leaves();
  for (let i = leaves.length - 1; i >= 0; i--) {
    const layer = leaves[i];
    if (!layer.text || !doc.isVisible(layer)) continue;
    const b = measureText(layer.text);
    const pad = 6;
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return layer;
  }
  return null;
}
