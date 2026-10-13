// Quick Selection: each brush dab selects what's under the brush, then grows
// outward into neighboring pixels that look like the colors brushed so far,
// stopping at strong edges. Dragging along an object therefore "finds" its
// outline, like Photoshop's Quick Selection tool.

import { gaussianBlur } from "./filters.js";

const MAX_SAMPLES = 1500;

export class QuickSelect {
  // img: the ImageData to select from (it is not modified).
  constructor(img) {
    const { width: w, height: h } = img;
    this.w = w;
    this.h = h;
    // Work on a slightly blurred copy so noise and texture don't read as edges.
    const soft = gaussianBlur(new ImageData(new Uint8ClampedArray(img.data), w, h), 1);
    this.d = soft.data;
    this.edges = edgeMap(soft);
    this.mask = new Uint8Array(w * h); // 1 = picked by this stroke
    this.seen = new Int32Array(w * h); // dab number that last visited each pixel
    this.dabs = 0;
    this.samples = [];
    this.edgeSamples = [];
    this.centers = [];
    this.tolerance = 30;
    this.edgeLimit = 60;
  }

  // Select around (cx, cy) with a brush of radius r. Returns the rectangle
  // of pixels that changed, or null.
  dab(cx, cy, r) {
    const { w, h, d, mask, seen, edges } = this;
    const stamp = ++this.dabs;
    cx = Math.round(cx);
    cy = Math.round(cy);
    r = Math.max(1, Math.round(r));
    const x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
    if (x0 > x1 || y0 > y1) return null;

    // Seeds: everything under the brush.
    const queue = [];
    const seedEdges = [];
    const step = Math.max(1, Math.floor(r / 4));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = y * w + x;
        seen[i] = stamp;
        mask[i] = 1;
        queue.push(i);
        if (x % step === 0 && y % step === 0) {
          const k = i * 4;
          this.samples.push([d[k], d[k + 1], d[k + 2], d[k + 3]]);
          seedEdges.push(edges[i]);
        }
      }
    }
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    this.fitColors(seedEdges);

    // Grow within a window around the dab.
    const reach = r * 3 + 40;
    const wx0 = Math.max(0, cx - reach), wx1 = Math.min(w - 1, cx + reach);
    const wy0 = Math.max(0, cy - reach), wy1 = Math.min(h - 1, cy + reach);
    let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
    const tol2 = this.tolerance * this.tolerance;
    const edgeLimit = this.edgeLimit;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % w, y = (i - x) / w;
      for (let n = 0; n < 4; n++) {
        const nx = n === 0 ? x - 1 : n === 1 ? x + 1 : x;
        const ny = n === 2 ? y - 1 : n === 3 ? y + 1 : y;
        if (nx < wx0 || nx > wx1 || ny < wy0 || ny > wy1) continue;
        const j = ny * w + nx;
        if (seen[j] === stamp) continue;
        seen[j] = stamp;
        if (edges[j] > edgeLimit || this.colorDistance2(j) > tol2) continue;
        if (!mask[j]) {
          mask[j] = 1;
          if (nx < bx0) bx0 = nx;
          if (nx > bx1) bx1 = nx;
          if (ny < by0) by0 = ny;
          if (ny > by1) by1 = ny;
        }
        queue.push(j);
      }
    }
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
  }

  // Summarize the brushed colors as a few cluster centers (k-means), and
  // derive how far colors may stray from them and how strong an edge stops
  // the growth.
  fitColors(seedEdges) {
    const s = this.samples;
    const k = Math.min(6, Math.max(1, Math.ceil(s.length / 25)));
    let centers = this.centers.length >= k ? this.centers.slice(0, k) : s.filter((_, i) => i % Math.ceil(s.length / k) === 0).slice(0, k);
    const assign = new Int32Array(s.length);
    for (let iter = 0; iter < 5; iter++) {
      const sums = centers.map(() => [0, 0, 0, 0, 0]);
      for (let i = 0; i < s.length; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const dd = dist2(s[i], centers[c]);
          if (dd < bd) { bd = dd; best = c; }
        }
        assign[i] = best;
        const t = sums[best];
        t[0] += s[i][0]; t[1] += s[i][1]; t[2] += s[i][2]; t[3] += s[i][3]; t[4]++;
      }
      centers = sums.map((t, c) => (t[4] ? [t[0] / t[4], t[1] / t[4], t[2] / t[4], t[3] / t[4]] : centers[c]));
    }
    this.centers = centers;
    // Typical spread of the brushed colors around their centers.
    let spread = 0;
    for (let i = 0; i < s.length; i++) spread += Math.sqrt(dist2(s[i], centers[assign[i]]));
    spread /= Math.max(1, s.length);
    this.tolerance = Math.max(18, Math.min(70, spread * 2.5 + 14));
    // Edges clearly stronger than the ones under the brush stop the growth.
    const e = this.edgeSamples;
    e.push(...seedEdges);
    if (e.length > MAX_SAMPLES) e.splice(0, e.length - MAX_SAMPLES);
    if (e.length) {
      const sorted = [...e].sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length * 0.75)];
      this.edgeLimit = Math.max(28, Math.min(110, typical * 1.6 + 18));
    }
  }

  colorDistance2(i) {
    const d = this.d, k = i * 4;
    let best = Infinity;
    for (const c of this.centers) {
      const dr = d[k] - c[0], dg = d[k + 1] - c[1], db = d[k + 2] - c[2], da = d[k + 3] - c[3];
      const dd = dr * dr + dg * dg + db * db + da * da;
      if (dd < best) best = dd;
    }
    return best;
  }

  // Clean up the stroke's result: smooth ragged edges and fill pinholes
  // (holes smaller than maxHole pixels). Returns per-pixel alpha (0/255).
  result(maxHole) {
    const { w, h } = this;
    let m = this.mask;
    m = majority(m, w, h);
    m = majority(m, w, h);
    fillHoles(m, w, h, maxHole);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = m[i] ? 255 : 0;
    return out;
  }
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2;

// Strength of the strongest color edge at each pixel (0–255), from Sobel
// gradients of each channel (alpha included, so layer outlines are edges).
function edgeMap({ data: d, width: w, height: h }) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let best = 0;
      for (let c = 0; c < 4; c++) {
        const p = (o) => d[(i + o) * 4 + c];
        const gx = p(-w + 1) + 2 * p(1) + p(w + 1) - p(-w - 1) - 2 * p(-1) - p(w - 1);
        const gy = p(w - 1) + 2 * p(w) + p(w + 1) - p(-w - 1) - 2 * p(-w) - p(-w + 1);
        const g = (Math.abs(gx) + Math.abs(gy)) / 8;
        if (g > best) best = g;
      }
      out[i] = best > 255 ? 255 : best;
    }
  }
  return out;
}

// 3×3 majority vote: removes stray pixels and evens out jagged edges.
function majority(m, w, h) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += m[yy * w + xx];
          count++;
        }
      }
      out[y * w + x] = sum * 2 > count ? 1 : 0;
    }
  }
  return out;
}

// Fill enclosed unselected areas smaller than maxArea pixels.
function fillHoles(m, w, h, maxArea) {
  const label = new Int32Array(m.length);
  let next = 0;
  const stack = [];
  for (let s = 0; s < m.length; s++) {
    if (m[s] || label[s]) continue;
    // Collect one unselected region; it's a hole unless it touches the border.
    next++;
    const region = [];
    let border = false;
    stack.push(s);
    label[s] = next;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !m[i - 1] && !label[i - 1]) { label[i - 1] = next; stack.push(i - 1); }
      if (x < w - 1 && !m[i + 1] && !label[i + 1]) { label[i + 1] = next; stack.push(i + 1); }
      if (y > 0 && !m[i - w] && !label[i - w]) { label[i - w] = next; stack.push(i - w); }
      if (y < h - 1 && !m[i + w] && !label[i + w]) { label[i + w] = next; stack.push(i + w); }
    }
    if (!border && region.length <= maxArea) for (const i of region) m[i] = 1;
  }
}
