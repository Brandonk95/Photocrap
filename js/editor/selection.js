import { createCanvas, cloneCanvas } from "./util.js";
import { gaussianBlur } from "./filters.js";

const COMBINE_OPS = { add: "source-over", subtract: "destination-out", intersect: "destination-in" };

// An immutable selection: a doc-sized alpha mask plus an outline for the
// marching ants. Shape selections keep their original vector path as the
// outline; anything else traces the mask's pixel edges on demand.
export class Selection {
  constructor(mask, outline = null) {
    this.mask = mask;
    this._outline = outline;
    this._data = null;
    this._bounds = undefined;
  }

  static fromPath(width, height, path) {
    const mask = createCanvas(width, height);
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fill(path);
    return new Selection(mask, path);
  }

  static all(width, height) {
    const path = new Path2D();
    path.rect(0, 0, width, height);
    return Selection.fromPath(width, height, path);
  }

  // `values` is a Uint8Array of per-pixel alpha (0–255).
  static fromArray(width, height, values) {
    const img = new ImageData(width, height);
    const d = img.data;
    for (let i = 0; i < values.length; i++) {
      const k = i * 4;
      d[k] = d[k + 1] = d[k + 2] = 255;
      d[k + 3] = values[i];
    }
    const mask = createCanvas(width, height);
    mask.getContext("2d").putImageData(img, 0, 0);
    const sel = new Selection(mask);
    sel._data = img;
    return sel;
  }

  get width() { return this.mask.width; }
  get height() { return this.mask.height; }

  get data() {
    return (this._data ??= this.mask.getContext("2d").getImageData(0, 0, this.width, this.height));
  }

  get bounds() {
    if (this._bounds === undefined) this._bounds = alphaBounds(this.data);
    return this._bounds;
  }

  get isEmpty() {
    return !this.bounds;
  }

  get outline() {
    return (this._outline ??= traceOutline(this.data, this.bounds));
  }

  region(r) {
    return this.mask.getContext("2d").getImageData(r.x, r.y, r.w, r.h);
  }

  combine(other, mode) {
    const mask = cloneCanvas(this.mask);
    const ctx = mask.getContext("2d");
    ctx.globalCompositeOperation = COMBINE_OPS[mode];
    ctx.drawImage(other.mask, 0, 0);
    return new Selection(mask);
  }

  inverted() {
    const mask = createCanvas(this.width, this.height);
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.mask, 0, 0);
    return new Selection(mask);
  }

  transformed(matrix) {
    const mask = createCanvas(this.width, this.height);
    const ctx = mask.getContext("2d");
    ctx.setTransform(matrix);
    ctx.drawImage(this.mask, 0, 0);
    let outline = null;
    if (this._outline) {
      outline = new Path2D();
      outline.addPath(this._outline, matrix);
    }
    return new Selection(mask, outline);
  }

  translated(dx, dy) {
    return this.transformed(new DOMMatrix().translate(dx, dy));
  }

  // Soften the edge by blurring the mask.
  feathered(radius) {
    const img = new ImageData(new Uint8ClampedArray(this.data.data), this.width, this.height);
    gaussianBlur(img, radius / 2);
    return Selection.fromImageData(img);
  }

  // Grow (r > 0) or shrink (r < 0) by r pixels with round corners and an
  // anti-aliased edge. Shrinking also pulls away from the canvas edge.
  grown(r) {
    const { width: w, height: h } = this;
    const a = this.data.data;
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < inside.length; i++) inside[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
    const out = new Uint8Array(w * h);
    if (r > 0) {
      const dist = distanceTransform(inside, w, h, 1); // distance to nearest selected pixel
      for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, r + 1 - dist[i])) * 255;
    } else {
      const k = -r;
      const dist = distanceTransform(inside, w, h, 0); // distance to nearest unselected pixel
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const d = Math.min(dist[i], x + 1, y + 1, w - x, h - y);
          out[i] = Math.max(0, Math.min(1, d - k)) * 255;
        }
      }
    }
    return Selection.fromArray(w, h, out);
  }

  static fromImageData(img) {
    const mask = createCanvas(img.width, img.height);
    mask.getContext("2d").putImageData(img, 0, 0);
    const sel = new Selection(mask);
    sel._data = img;
    return sel;
  }
}

// Exact Euclidean distance (in pixels) from every pixel to the nearest pixel
// whose value equals `target`, using Felzenszwalb & Huttenlocher's
// two-pass lower-envelope algorithm. O(w·h).
function distanceTransform(values, w, h, target) {
  const INF = 1e20;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = values[i] === target ? 0 : INF;

  const pass = (len) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    pass(w);
    for (let x = 0; x < w; x++) grid[row + x] = Math.sqrt(d[x]);
  }
  return grid;
}

export function alphaBounds({ data, width: w, height: h }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (!data[row]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Build a path along every boundary between selected and unselected pixels,
// merging straight runs so the path stays reasonably small.
function traceOutline({ data, width: w, height: h }, bounds) {
  const path = new Path2D();
  if (!bounds) return path;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128;
  const bx0 = bounds.x, by0 = bounds.y, bx1 = bounds.x + bounds.w, by1 = bounds.y + bounds.h;

  for (let y = by0; y <= by1; y++) {
    let start = -1;
    for (let x = bx0; x <= bx1; x++) {
      const edge = x < bx1 && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) {
        path.moveTo(start, y);
        path.lineTo(x, y);
        start = -1;
      }
    }
  }
  for (let x = bx0; x <= bx1; x++) {
    let start = -1;
    for (let y = by0; y <= by1; y++) {
      const edge = y < by1 && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) {
        path.moveTo(x, start);
        path.lineTo(x, y);
        start = -1;
      }
    }
  }
  return path;
}

// Scanline flood fill. Returns a per-pixel mask (255 = matched).
// Pixels match when every RGBA channel is within `tolerance` of the seed.
export function floodFill({ data, width: w, height: h }, sx, sy, tolerance, contiguous = true) {
  const out = new Uint8Array(w * h);
  const s = (sy * w + sx) * 4;
  const r0 = data[s], g0 = data[s + 1], b0 = data[s + 2], a0 = data[s + 3];
  const match = (p) => {
    const i = p * 4;
    return Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance &&
      Math.abs(data[i + 2] - b0) <= tolerance && Math.abs(data[i + 3] - a0) <= tolerance;
  };

  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) out[p] = 255;
    return out;
  }

  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const row = y * w;
    if (out[row + x] || !match(row + x)) continue;
    let lx = x, rx = x;
    while (lx > 0 && !out[row + lx - 1] && match(row + lx - 1)) lx--;
    while (rx < w - 1 && !out[row + rx + 1] && match(row + rx + 1)) rx++;
    out.fill(255, row + lx, row + rx + 1);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const ok = !out[nrow + i] && match(nrow + i);
        if (ok && !inRun) stack.push(i, ny);
        inRun = ok;
      }
    }
  }
  return out;
}
