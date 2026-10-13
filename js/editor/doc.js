import { createCanvas, cloneCanvas, clampRect, unionRect } from "./util.js";
import { alphaBounds } from "./selection.js";
import * as Filters from "./filters.js";
import { renderStyled, hasStyles } from "./styles.js";

let nextLayerId = 1;

// Canvas composite operations double as layer blend modes.
export const BLEND_MODES = [
  ["source-over", "Normal"],
  ["multiply", "Multiply"],
  ["screen", "Screen"],
  ["overlay", "Overlay"],
  ["darken", "Darken"],
  ["lighten", "Lighten"],
  ["color-dodge", "Color Dodge"],
  ["color-burn", "Color Burn"],
  ["hard-light", "Hard Light"],
  ["soft-light", "Soft Light"],
  ["difference", "Difference"],
  ["exclusion", "Exclusion"],
  ["hue", "Hue"],
  ["saturation", "Saturation"],
  ["color", "Color"],
  ["luminosity", "Luminosity"],
];

// Bounding box of a rect after a transform, rounded outward.
export function transformedBox(r, m) {
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => m.transformPoint({ x, y }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs)) - 1, y0 = Math.floor(Math.min(...ys)) - 1;
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs)) + 1 - x0, h: Math.ceil(Math.max(...ys)) + 1 - y0 };
}

// A drawable surface: a canvas placed at (x, y) in document coordinates.
// Layers and masks are both surfaces, so tools, filters and history treat
// them the same way.
//
// Invariant: a surface always covers at least the whole document, and may
// extend beyond it to keep content that has been moved off the canvas.
//
// The context carries a translate(-x, -y) transform, so drawing calls use
// document coordinates. getImageData/putImageData ignore transforms; use
// getDocImageData/putDocImageData, or drawLocal for canvas-local pixels.
export class Surface {
  constructor(width, height, x = 0, y = 0) {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext("2d");
    this.x = x;
    this.y = y;
    this.syncTransform();
  }

  get bounds() {
    return { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height };
  }

  syncTransform() {
    this.ctx.setTransform(1, 0, 0, 1, -this.x, -this.y);
  }

  // Resize/move the canvas, discarding its pixels.
  setGeometry(x, y, w, h) {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
    this.x = x;
    this.y = y;
    this.syncTransform();
    this.geometryChanged();
  }

  geometryChanged() {}

  refresh() {}

  getDocImageData(r) {
    return this.ctx.getImageData(r.x - this.x, r.y - this.y, r.w, r.h);
  }

  putDocImageData(img, x, y) {
    this.ctx.putImageData(img, x - this.x, y - this.y);
  }

  // Replace all pixels with a canvas of the same size, in canvas-local space.
  drawLocal(src) {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(src, 0, 0);
    this.ctx.restore();
  }

  clearAll() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  // Bounds of non-transparent pixels, in document coordinates.
  contentBounds() {
    const b = alphaBounds(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    return b && { x: b.x + this.x, y: b.y + this.y, w: b.w, h: b.h };
  }

  // Grow the canvas (keeping its pixels) so it also covers `rect`.
  ensure(rect) {
    const cur = this.bounds;
    const want = unionRect(cur, {
      x: Math.floor(rect.x), y: Math.floor(rect.y),
      w: Math.ceil(rect.x + rect.w) - Math.floor(rect.x), h: Math.ceil(rect.y + rect.h) - Math.floor(rect.y),
    });
    if (want.x === cur.x && want.y === cur.y && want.w === cur.w && want.h === cur.h) return false;
    const copy = cloneCanvas(this.canvas);
    this.setGeometry(want.x, want.y, want.w, want.h);
    this.ctx.drawImage(copy, cur.x, cur.y);
    this.geometryChanged();
    return true;
  }

  // Shrink the canvas to its content plus the document area.
  trim(docW, docH) {
    const doc = { x: 0, y: 0, w: docW, h: docH };
    const cur = this.bounds;
    if (cur.x === 0 && cur.y === 0 && cur.w === docW && cur.h === docH) return false;
    const keep = unionRect(doc, this.contentBounds());
    if (keep.x === cur.x && keep.y === cur.y && keep.w === cur.w && keep.h === cur.h) return false;
    const copy = cloneCanvas(this.canvas);
    this.setGeometry(keep.x, keep.y, keep.w, keep.h);
    this.ctx.drawImage(copy, cur.x, cur.y);
    this.geometryChanged();
    return true;
  }

  // Cut pixels out onto a floating canvas, positioned in document space:
  // the selection if there is one, else `rect`, else the whole surface.
  lift(sel, rect = null) {
    let float;
    if (sel) {
      const b = sel.bounds;
      float = { canvas: createCanvas(b.w, b.h), x: b.x, y: b.y };
      const f = float.canvas.getContext("2d");
      f.drawImage(this.canvas, this.x - b.x, this.y - b.y);
      f.globalCompositeOperation = "destination-in";
      f.drawImage(sel.mask, -b.x, -b.y);
      this.ctx.globalCompositeOperation = "destination-out";
      this.ctx.drawImage(sel.mask, 0, 0);
      this.ctx.globalCompositeOperation = "source-over";
    } else if (rect) {
      float = { canvas: createCanvas(rect.w, rect.h), x: rect.x, y: rect.y };
      float.canvas.getContext("2d").drawImage(this.canvas, this.x - rect.x, this.y - rect.y);
      this.ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    } else {
      float = { canvas: cloneCanvas(this.canvas), x: this.x, y: this.y };
      this.clearAll();
    }
    return float;
  }

  // Draw a floating canvas back, through document-space matrix `m`, growing
  // the surface to fit and then trimming empty space.
  stamp(float, m, docW, docH) {
    const box = transformedBox({ x: float.x, y: float.y, w: float.canvas.width, h: float.canvas.height }, m);
    this.ensure(box);
    const c = this.ctx;
    c.save();
    c.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    c.imageSmoothingQuality = "high";
    c.drawImage(float.canvas, float.x, float.y);
    c.restore();
    this.trim(docW, docH);
  }
}

export class Layer extends Surface {
  constructor(width, height, name, x = 0, y = 0) {
    super(width, height, x, y);
    this.id = nextLayerId++;
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.blend = "source-over";
    this.mask = null;       // LayerMask or null
    this.editMask = false;  // tools target the mask instead of the pixels
    this.text = null;       // editable type (see text.js) or null
    this.shape = null;      // editable vector shape (see shapes.js) or null
    this.adjustment = null; // { kind, op, params }: an adjustment layer (pixels unused)
    this.styles = null;     // layer effects (see styles.js) or null
    this.clipped = false;   // clipped to the nearest unclipped layer below (clipping mask)
    this.locks = null;      // { transparency, pixels, position } or null
  }

  get isGroup() {
    return false;
  }
}

// Convert grayscale mask pixels to an alpha mask in place. Transparent mask
// pixels take the mask's background value (white for "reveal all" masks,
// black for "hide all"), so moving a mask never exposes holes.
export function grayToAlpha(img, background = 255) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    const v = (background * (255 - a) + d[i] * a) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = v;
  }
  return img;
}

// A grayscale layer mask: white shows the layer, black hides it. The gray
// canvas is what tools paint on; `alpha` is a cached alpha-channel version
// (same size and position) used for compositing, kept in sync by refresh().
export class LayerMask extends Surface {
  constructor(width, height, fill = "#ffffff", x = 0, y = 0) {
    super(width, height, x, y);
    this.background = fill === "#000000" ? 0 : 255;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.restore();
    this.alpha = createCanvas(width, height);
    this.alphaCtx = this.alpha.getContext("2d");
    this.enabled = true;
    this.refresh();
  }

  geometryChanged() {
    if (this.alpha) this.refresh();
  }

  // Re-derive the alpha cache, for `rect` (document coordinates) or everything.
  refresh(rect) {
    const { width: w, height: h } = this.canvas;
    if (this.alpha.width !== w || this.alpha.height !== h) {
      this.alpha.width = w;
      this.alpha.height = h;
      rect = null;
    }
    const r = rect ? clampRect({ ...rect, x: rect.x - this.x, y: rect.y - this.y }, w, h) : { x: 0, y: 0, w, h };
    if (!r.w || !r.h) return;
    this.alphaCtx.putImageData(grayToAlpha(this.ctx.getImageData(r.x, r.y, r.w, r.h), this.background), r.x, r.y);
  }

  clone() {
    const { x, y, w, h } = this.bounds;
    const m = new LayerMask(w, h, this.background ? "#ffffff" : "#000000", x, y);
    m.drawLocal(this.canvas);
    m.enabled = this.enabled;
    m.refresh();
    return m;
  }

  // An alpha canvas covering `rect` (document space), with the background
  // value wherever the mask canvas doesn't reach.
  alphaFor(rect) {
    const c = createCanvas(rect.w, rect.h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = `rgba(255,255,255,${this.background / 255})`;
    ctx.fillRect(0, 0, rect.w, rect.h);
    ctx.clearRect(this.x - rect.x, this.y - rect.y, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.alpha, this.x - rect.x, this.y - rect.y);
    return c;
  }
}


// A folder of layers. Groups have no pixels of their own but can have a
// mask, opacity and blend mode. "pass-through" (the default) composites
// the children as if they weren't grouped; anything else isolates them.
export class Group {
  constructor(name) {
    this.id = nextLayerId++;
    this.name = name;
    this.layers = []; // children, bottom first
    this.visible = true;
    this.opacity = 1;
    this.blend = "pass-through";
    this.mask = null;
    this.editMask = false;
    this.expanded = true;
    this.text = null;
    this.shape = null;
    this.adjustment = null;
    this.styles = null;
    this.clipped = false;
    this.locks = null;
  }

  get isGroup() {
    return true;
  }
}

// A tool's live preview for one node. live is either { layer, pixels?, mask? }
// for a single layer, or { map: Map<node, { pixels?, mask? }> } for several
// (dragging a whole group).
function liveFor(live, node) {
  if (!live) return null;
  if (live.map) return live.map.get(node) ?? null;
  return live.layer === node ? live : null;
}

// Reusable doc-sized canvases for compositing.
const temp = {};
function tempCanvas(name, w, h) {
  const c = (temp[name] ??= createCanvas(w, h));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

function clipped(ctx, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
}

// How far a layer's effects can reach beyond its pixels.
function styleReach(styles) {
  if (!styles) return 0;
  const { dropShadow: d, outerGlow: g, stroke: s, innerShadow: i } = styles;
  return Math.ceil(Math.max(
    d?.enabled ? d.distance + d.size * 1.5 : 0,
    g?.enabled ? g.size * 1.5 : 0,
    s?.enabled ? s.size + 2 : 0,
    i?.enabled ? i.distance + i.size * 1.5 : 0,
  ));
}

export class Doc {
  constructor(width, height, name = "Untitled") {
    this.width = width;
    this.height = height;
    this.name = name;
    this.layers = []; // top-level nodes (layers and groups), bottom first
    this.activeLayer = null; // a Layer or a Group
    this.selection = null;
    this.guides = [];        // [{ axis: "x" | "y", pos }] (see guides.js)
    this.quickMask = null;   // Quick Mask mode: { mask: LayerMask, … } (see App.toggleQuickMask)
    this.quickOverlay = null; // red tint over what the quick mask leaves unselected
    this.layerCount = 0;
    this.groupCount = 0;
    this.composite = createCanvas(width, height);
    this.compositeCtx = this.composite.getContext("2d");
  }

  newLayer(name) {
    return new Layer(this.width, this.height, name ?? `Layer ${++this.layerCount}`);
  }

  newGroup(name) {
    return new Group(name ?? `Group ${++this.groupCount}`);
  }

  // ---------- Tree helpers ----------

  // Every node (groups and layers), depth-first, bottom to top.
  allNodes(list = this.layers, out = []) {
    for (const node of list) {
      out.push(node);
      if (node.isGroup) this.allNodes(node.layers, out);
    }
    return out;
  }

  // Every pixel layer (not groups), bottom to top.
  leaves() {
    return this.allNodes().filter((n) => !n.isGroup);
  }

  contains(node) {
    return this.allNodes().includes(node);
  }

  parentOf(node, list = this.layers, parent = null) {
    for (const n of list) {
      if (n === node) return parent;
      if (n.isGroup) {
        const found = this.parentOf(node, n.layers, n);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  // The array that holds `node` (its parent's children, or the top level).
  siblingsOf(node) {
    const parent = this.parentOf(node);
    return parent ? parent.layers : this.layers;
  }

  get activeIndex() {
    return this.siblingsOf(this.activeLayer).indexOf(this.activeLayer);
  }

  // Visible only if it and every group containing it are visible.
  isVisible(node) {
    for (let n = node; n; n = this.parentOf(n)) if (!n.visible) return false;
    return true;
  }

  insertAbove(ref, node) {
    if (!ref || !this.contains(ref)) {
      this.layers.push(node);
      return;
    }
    const list = this.siblingsOf(ref);
    list.splice(list.indexOf(ref) + 1, 0, node);
  }

  remove(node) {
    const list = this.siblingsOf(node);
    const i = list.indexOf(node);
    if (i >= 0) list.splice(i, 1);
    return i;
  }

  syncSize() {
    if (this.composite.width !== this.width || this.composite.height !== this.height) {
      this.composite.width = this.width;
      this.composite.height = this.height;
    }
  }

  // ---------- Compositing ----------

  // Flatten visible layers into this.composite, optionally only within `rect`.
  //
  // `live` lets a tool preview a gesture without touching real pixels:
  //   { layer, pixels?(rect) → canvas, mask?(rect) → gray canvas }
  // Both return document-space, document-sized canvases that only need to
  // be correct inside rect.
  // `viewMask` shows that node's mask in grayscale instead of the image.
  compose(live = null, rect = null, viewMask = null) {
    this.syncSize();
    const ctx = this.compositeCtx;
    const { width: w, height: h } = this;
    const r = rect ?? { x: 0, y: 0, w, h };
    ctx.save();
    if (rect) {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }
    ctx.clearRect(r.x, r.y, r.w, r.h);

    const viewing = viewMask?.mask && this.contains(viewMask) ? viewMask : null;
    if (viewing) {
      const m = viewing.mask;
      ctx.fillStyle = m.background ? "#ffffff" : "#000000";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const lv = liveFor(live, viewing);
      if (lv?.mask) ctx.drawImage(lv.mask(rect), 0, 0);
      else ctx.drawImage(m.canvas, m.x, m.y);
      ctx.restore();
      return this.composite;
    }

    this.composeList(ctx, this.layers, r, rect, live, 0);
    ctx.restore();
    if (this.quickMask) this.composeQuickOverlay(r, live);
    return this.composite;
  }

  // Red where the quick mask is black (unselected); drawn over the image at
  // half opacity by the view.
  composeQuickOverlay(r, live) {
    const o = tempCanvas("quick-overlay", this.width, this.height), oc = o.getContext("2d");
    this.quickOverlay = o;
    clipped(oc, r);
    oc.fillStyle = "#ff0000";
    oc.fillRect(r.x, r.y, r.w, r.h);
    const alpha = this.maskAlpha(this.quickMask, r, live);
    oc.globalCompositeOperation = "destination-out";
    oc.drawImage(alpha.canvas, alpha.x, alpha.y);
    oc.restore();
  }

  // Alpha mask to apply for a node: a canvas and where to draw it, or null.
  maskAlpha(node, r, live) {
    const mask = node.mask?.enabled ? node.mask : null;
    if (!mask) return null;
    const lv = liveFor(live, node);
    if (lv?.mask) {
      // Convert just the dirty area of the previewed gray mask.
      const alpha = tempCanvas(`live-alpha-${node.id}`, this.width, this.height);
      const gray = lv.mask(r).getContext("2d").getImageData(r.x, r.y, r.w, r.h);
      alpha.getContext("2d").putImageData(grayToAlpha(gray, mask.background), r.x, r.y);
      return { canvas: alpha, x: 0, y: 0 };
    }
    return { canvas: mask.alpha, x: mask.x, y: mask.y };
  }

  composeList(ctx, list, r, rect, live, depth) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      // Layers clipped to this one follow it directly in the list.
      let end = i + 1;
      while (end < list.length && list[end].clipped) end++;
      const clips = list.slice(i + 1, end).filter((n) => n.visible && n.opacity > 0);
      i = end - 1;
      if (!node.visible || node.opacity <= 0) continue; // hiding the base hides its clipped layers too
      if (!clips.length) this.drawNode(ctx, node, r, rect, live, depth);
      else if (node.adjustment) {
        // An adjustment layer has no pixels to clip to: draw everything normally.
        for (const n of [node, ...clips]) this.drawNode(ctx, n, r, rect, live, depth);
      } else this.drawClippingGroup(ctx, node, clips, r, rect, live, depth);
    }
  }

  // A base layer and the layers clipped to it: the clipped layers only show
  // where the base has pixels, and the base's opacity and blend mode apply
  // to the whole group (as in Photoshop).
  drawClippingGroup(ctx, base, clips, r, rect, live, depth) {
    const { width: w, height: h } = this;
    const t = tempCanvas(`clip-${depth}`, w, h), tc = t.getContext("2d");
    const a = tempCanvas(`clip-alpha-${depth}`, w, h), ac = a.getContext("2d");
    clipped(tc, r);
    this.drawNode(tc, base, r, rect, live, depth + 1, 1, "source-over");
    clipped(ac, r);
    ac.drawImage(t, 0, 0); // remember the base's coverage
    ac.restore();
    // Make the base opaque (drawing it over itself keeps its colors), so the
    // clipped layers blend with its full color even on soft edges...
    for (let k = 0; k < 6; k++) tc.drawImage(t, 0, 0);
    for (const n of clips) this.drawNode(tc, n, r, rect, live, depth + 1);
    // ...then give the result the base's coverage back.
    tc.globalCompositeOperation = "destination-in";
    tc.drawImage(a, 0, 0);
    tc.restore();
    this.draw(ctx, t, 0, 0, base.opacity, base.blend === "pass-through" ? "source-over" : base.blend);
  }

  // Composite one node onto ctx. opacity/blend override the node's own.
  drawNode(ctx, node, r, rect, live, depth, opacity = node.opacity, blend = node.blend) {
    const { width: w, height: h } = this;
    if (node.isGroup) {
      const isolate = blend !== "pass-through" || opacity < 1 || node.mask?.enabled;
      if (!isolate) {
        this.composeList(ctx, node.layers, r, rect, live, depth);
        return;
      }
      const g = tempCanvas(`group-${depth}`, w, h), gc = g.getContext("2d");
      clipped(gc, r);
      this.composeList(gc, node.layers, r, rect, live, depth + 1);
      const alpha = this.maskAlpha(node, r, live);
      if (alpha) {
        gc.globalCompositeOperation = "destination-in";
        gc.drawImage(alpha.canvas, alpha.x, alpha.y);
      }
      gc.restore();
      this.draw(ctx, g, 0, 0, opacity, blend === "pass-through" ? "source-over" : blend);
      return;
    }

    if (node.adjustment) {
      this.applyAdjustment(ctx, node, r, live, depth);
      return;
    }

    // A pixel layer, optionally masked and styled.
    const lv = liveFor(live, node);
    const styled = hasStyles(node.styles);
    const reach = styleReach(node.styles);
    // Effects can reach into r from outside it, so prepare a wider area.
    const rr = reach ? clampRect({ x: r.x - reach, y: r.y - reach, w: r.w + reach * 2, h: r.h + reach * 2 }, w, h) : r;
    let src = node.canvas, sx = node.x, sy = node.y;
    // A tool's preview on a layer with locked transparency only shows where
    // the layer already has pixels (the commit makes it exact).
    const keepAlpha = !!(lv?.pixels && node.locks?.transparency);
    if (lv?.pixels) {
      src = lv.pixels(rr);
      sx = sy = 0;
    }
    const alpha = this.maskAlpha(node, rr, live);
    if (alpha || styled || keepAlpha) {
      const t = tempCanvas(`content-${depth}`, w, h), tc = t.getContext("2d");
      clipped(tc, rr);
      tc.drawImage(src, sx, sy);
      tc.globalCompositeOperation = "destination-in";
      if (keepAlpha) tc.drawImage(node.canvas, node.x, node.y);
      if (alpha) tc.drawImage(alpha.canvas, alpha.x, alpha.y);
      tc.restore();
      src = t;
      sx = sy = 0;
    }
    if (styled) src = renderStyled(src, node.styles, r, w, h, (name) => tempCanvas(`${name}-${depth}`, w, h));
    this.draw(ctx, src, sx, sy, opacity, blend);
  }

  draw(ctx, src, x, y, opacity, blend) {
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(src, x, y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Adjustment layer: re-color what has been composited so far (inside r),
  // then lay the result back over it through the layer's mask and opacity.
  applyAdjustment(ctx, node, r, live, depth) {
    const { op, params } = node.adjustment;
    if (!params || !Filters[op]) return;
    const { width: w, height: h } = this;
    const below = ctx.getImageData(r.x, r.y, r.w, r.h);
    const adjusted = Filters[op](below, params);
    const t = tempCanvas(`adjust-${depth}`, w, h), tc = t.getContext("2d");
    clipped(tc, r);
    tc.putImageData(adjusted, r.x, r.y);
    const alpha = this.maskAlpha(node, r, live);
    if (alpha) {
      tc.globalCompositeOperation = "destination-in";
      tc.drawImage(alpha.canvas, alpha.x, alpha.y);
    }
    tc.restore();
    this.draw(ctx, t, 0, 0, node.opacity, node.blend);
  }
}