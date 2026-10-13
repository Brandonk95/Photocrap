// Pixel operations. Each takes an ImageData, modifies it in place and returns it.
// Uint8ClampedArray takes care of rounding and clamping on write.

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function lut(fn) {
  const table = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) table[i] = Math.round(fn(i));
  return table;
}

export function applyLUT(img, r, g = r, b = r) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
  return img;
}

// ---------- Adjustments ----------

export function brightnessContrast(img, { brightness = 0, contrast = 0 }) {
  const c = contrast * 2.55;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  return applyLUT(img, lut((i) => f * (i + brightness - 128) + 128));
}

export function levels(img, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 }) {
  const span = Math.max(1, inWhite - inBlack);
  return applyLUT(img, lut((i) => {
    const t = Math.min(1, Math.max(0, (i - inBlack) / span));
    return outBlack + (outWhite - outBlack) * Math.pow(t, 1 / gamma);
  }));
}

// Monotone cubic (Fritsch–Carlson) through [x, y] points in 0–255, so the
// curve never overshoots between control points.
export function curveLUT(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  const out = new Uint8ClampedArray(256);
  if (n === 1) return out.fill(p[0][1]);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { out[x] = ys[0]; continue; }
    if (x >= xs[n - 1]) { out[x] = ys[n - 1]; continue; }
    while (x > xs[seg + 1]) seg++;
    const hgt = xs[seg + 1] - xs[seg];
    const t = (x - xs[seg]) / hgt, t2 = t * t, t3 = t2 * t;
    out[x] = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * hgt * m[seg] +
      (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * hgt * m[seg + 1];
  }
  return out;
}

export function curves(img, { curves: c }) {
  const master = curveLUT(c.rgb);
  const channel = (k) => {
    const l = curveLUT(c[k]);
    return lut((i) => l[master[i]]);
  };
  return applyLUT(img, channel("r"), channel("g"), channel("b"));
}

const rgbOut = [0, 0, 0];
function hue2(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  if (!s) { rgbOut[0] = rgbOut[1] = rgbOut[2] = l; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  rgbOut[0] = hue2(p, q, h + 1 / 3);
  rgbOut[1] = hue2(p, q, h);
  rgbOut[2] = hue2(p, q, h - 1 / 3);
}

export function hueSaturation(img, { hue = 0, saturation = 0, lightness = 0 }) {
  const d = img.data;
  const shift = hue / 360, sat = 1 + saturation / 100, light = lightness / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const delta = max - min;
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      h = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      h /= 6;
    }
    hslToRgb((h + shift + 1) % 1, Math.min(1, s * sat), l);
    for (let c = 0; c < 3; c++) {
      let v = rgbOut[c];
      if (light > 0) v += (1 - v) * light;
      else if (light < 0) v *= 1 + light;
      d[i + c] = v * 255;
    }
  }
  return img;
}

// Shift colors separately in shadows, midtones and highlights.
// Each slider is −100…100: cyan↔red, magenta↔green, yellow↔blue.
export function colorBalance(img, v) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = luma(r, g, b) / 255;
    const ws = (1 - L) * (1 - L), wh = L * L, wm = 2 * L * (1 - L) * 1.5;
    let nr = r + ws * v.sCR + wm * v.mCR + wh * v.hCR;
    let ng = g + ws * v.sMG + wm * v.mMG + wh * v.hMG;
    let nb = b + ws * v.sYB + wm * v.mYB + wh * v.hYB;
    if (v.preserve) {
      const dl = luma(r, g, b) - luma(nr, ng, nb);
      nr += dl; ng += dl; nb += dl;
    }
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  return img;
}

export function grayscale(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
  return img;
}

export function sepia(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
    d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
  }
  return img;
}

export function invert(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return img;
}

// ---------- Filters ----------

// Gaussian approximated by three box blurs, on premultiplied alpha so
// transparent pixels don't bleed black into their neighbours.
export function gaussianBlur(img, sigma) {
  if (sigma < 0.3) return img;
  const { width: w, height: h, data } = img;
  const n = w * h;
  let a = new Float32Array(n * 4);
  let b = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    const al = data[i + 3] / 255;
    a[i] = data[i] * al;
    a[i + 1] = data[i + 1] * al;
    a[i + 2] = data[i + 2] * al;
    a[i + 3] = data[i + 3];
  }
  for (const box of boxSizes(sigma, 3)) {
    const r = (box - 1) / 2;
    if (r < 1) continue;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  for (let i = 0; i < n * 4; i += 4) {
    const al = a[i + 3];
    data[i + 3] = al;
    if (al > 0) {
      const k = 255 / al;
      data[i] = a[i] * k;
      data[i + 1] = a[i + 1] * k;
      data[i + 2] = a[i + 2] * k;
    }
  }
  return img;
}

function boxSizes(sigma, n) {
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wl + 2));
}

// Running-sum box blurs with edge pixels repeated. Both walk memory in
// order: the vertical pass keeps one running sum per column instead of
// striding down columns, which matters a lot on large images.
function boxBlurH(src, dst, w, h, r) {
  const inv = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      const first = src[row + c], last = src[row + (w - 1) * 4 + c];
      let sum = (r + 1) * first;
      for (let j = 0; j < r; j++) sum += src[row + Math.min(j, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        sum += (x + r < w ? src[row + (x + r) * 4 + c] : last) - (x - r - 1 >= 0 ? src[row + (x - r - 1) * 4 + c] : first);
        dst[row + x * 4 + c] = sum * inv;
      }
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const inv = 1 / (r + r + 1);
  const stride = w * 4;
  const lastRow = (h - 1) * stride;
  const sum = new Float64Array(stride);
  for (let i = 0; i < stride; i++) {
    let s = (r + 1) * src[i];
    for (let j = 0; j < r; j++) s += src[Math.min(j, h - 1) * stride + i];
    sum[i] = s;
  }
  for (let y = 0; y < h; y++) {
    const add = y + r < h ? (y + r) * stride : lastRow;
    const sub = y - r - 1 >= 0 ? (y - r - 1) * stride : 0;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      sum[i] += src[add + i] - src[sub + i];
      dst[out + i] = sum[i] * inv;
    }
  }
}

export function blur(img, { radius }) {
  return gaussianBlur(img, radius);
}

export function unsharpMask(img, { amount = 100, radius = 1.5 }) {
  const blurred = gaussianBlur(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), radius).data;
  const d = img.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (d[i] - blurred[i]) * k;
    d[i + 1] += (d[i + 1] - blurred[i + 1]) * k;
    d[i + 2] += (d[i + 2] - blurred[i + 2]) * k;
  }
  return img;
}

export function addNoise(img, { amount = 10, mono = true }) {
  const d = img.data, s = amount * 2.55 * 2;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (mono) {
      const n = (Math.random() - 0.5) * s;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += (Math.random() - 0.5) * s;
      d[i + 1] += (Math.random() - 0.5) * s;
      d[i + 2] += (Math.random() - 0.5) * s;
    }
  }
  return img;
}

export function pixelate(img, { size = 10 }) {
  const { width: w, height: h, data: d } = img;
  const cell = Math.max(1, Math.round(size));
  for (let by = 0; by < h; by += cell) {
    for (let bx = 0; bx < w; bx += cell) {
      const ex = Math.min(bx + cell, w), ey = Math.min(by + cell, h);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4, al = d[i + 3];
          r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++;
        }
      }
      const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = A;
        }
      }
    }
  }
  return img;
}

// ---------- Healing ----------

// Seamless (Poisson) blend: inside the masked area, keep the *texture* of
// `src` (its gradients) while matching the colors of `img` at the area's
// edge, so a patch copied from elsewhere picks up the local lighting.
// Returns an image whose RGB is the healed result and whose alpha is the
// mask, ready to draw over the original with source-over.
//
// Solved per channel with SOR iterations, starting from a smooth guess
// (the source shifted by an inverse-distance blend of the edge
// differences) so it converges in a few hundred passes even on big areas.
export function heal(img, { src, mask }) {
  const { width: w, height: h } = img;
  const B = img.data, S = src.data, n = w * h;
  const inside = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (mask[i]) { inside[i] = 1; count++; }
  const out = new ImageData(w, h);
  const O = out.data;
  if (!count) return out;

  // Unknowns, their neighbours (pixels at the region edge just have fewer),
  // the size of the area, and the ring of fixed pixels around it.
  const idx = new Int32Array(count), nb = new Int32Array(count * 4), deg = new Uint8Array(count);
  let x0 = w, x1 = 0, y0 = h, y1 = 0, k = 0;
  const ring = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      idx[k] = i;
      let d = 0;
      for (const [q, ok] of [[i - 1, x > 0], [i + 1, x < w - 1], [i - w, y > 0], [i + w, y < h - 1]]) {
        if (!ok) continue;
        nb[k * 4 + d++] = q;
        if (!inside[q]) ring.push(q);
      }
      deg[k++] = d;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const iterations = Math.min(500, Math.max(60, 2 * Math.max(x1 - x0 + 1, y1 - y0 + 1)));

  // A spread-out subset of the ring for the starting guess.
  const step = Math.max(1, Math.floor(ring.length / 96));
  const samples = ring.filter((_, j) => j % step === 0);

  const f = new Float32Array(n), rhs = new Float32Array(count);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) f[i] = B[i * 4 + c];
    // Starting guess: source + smoothly interpolated edge difference.
    const diffs = samples.map((q) => B[q * 4 + c] - S[q * 4 + c]);
    for (let k2 = 0; k2 < count; k2++) {
      const i = idx[k2], px = i % w, py = (i / w) | 0;
      let wsum = 0, dsum = 0;
      for (let j = 0; j < samples.length; j++) {
        const q = samples[j], dx = (q % w) - px, dy = ((q / w) | 0) - py;
        const wt = 1 / (dx * dx + dy * dy + 1);
        wsum += wt;
        dsum += wt * diffs[j];
      }
      f[i] = S[i * 4 + c] + (wsum ? dsum / wsum : 0);
    }
    // Guidance: the source's own Laplacian.
    for (let k2 = 0; k2 < count; k2++) {
      const i = idx[k2], b = k2 * 4;
      let g = 0;
      for (let j = 0; j < deg[k2]; j++) g += S[i * 4 + c] - S[nb[b + j] * 4 + c];
      rhs[k2] = g;
    }
    const omega = 1.9;
    for (let it = 0; it < iterations; it++) {
      for (let k2 = 0; k2 < count; k2++) {
        const i = idx[k2], b = k2 * 4, d = deg[k2];
        let s = rhs[k2];
        for (let j = 0; j < d; j++) s += f[nb[b + j]];
        f[i] += omega * (s / d - f[i]);
      }
    }
    for (let i = 0; i < n; i++) O[i * 4 + c] = inside[i] ? f[i] : B[i * 4 + c];
  }
  for (let i = 0; i < n; i++) O[i * 4 + 3] = mask[i];
  return out;
}

// Blend `out` back toward `orig` wherever the selection mask is partial or empty.
export function applyMask(orig, out, mask) {
  const o = orig.data, d = out.data, m = mask.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = m[i + 3] / 255;
    if (t === 1) continue;
    for (let c = 0; c < 4; c++) d[i + c] = o[i + c] + (d[i + c] - o[i + c]) * t;
  }
  return out;
}

export function histogram(img, channel = "rgb") {
  const hist = new Uint32Array(256);
  const d = img.data;
  const offset = { r: 0, g: 1, b: 2 }[channel];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    hist[offset === undefined ? Math.round(luma(d[i], d[i + 1], d[i + 2])) : d[i + offset]]++;
  }
  return hist;
}

// Exact Euclidean distance (in pixels) from every pixel to the nearest pixel
// whose value equals `target`, using Felzenszwalb & Huttenlocher's
// two-pass lower-envelope algorithm. O(w·h).
export function distanceTransform(values, w, h, target) {
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


// ---------- Refine Edge ----------

// Blur interleaved 4-channel floats in place (Gaussian via box passes).
function blur4(a, w, h, sigma) {
  if (sigma < 0.3) return a;
  const b = new Float32Array(a.length);
  for (const box of boxSizes(sigma, 3)) {
    const r = (box - 1) / 2;
    if (r < 1) continue;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return a;
}

// Blur one float channel (0–1) by packing it into the 4-channel blur.
function blur1(v, w, h, sigma) {
  if (sigma < 0.3) return v;
  const a = new Float32Array(v.length * 4);
  for (let i = 0; i < v.length; i++) a[i * 4] = v[i];
  blur4(a, w, h, sigma);
  for (let i = 0; i < v.length; i++) v[i] = a[i * 4];
  return v;
}

// Refine a selection against the image it was made on, like Photoshop's
// Select and Mask. `img` is the image; params.sel is the selection as an
// ImageData whose alpha is the selection. Returns an ImageData (white,
// alpha = refined selection). Steps, in order:
//   shift    move the edge out (+) or in (−), in pixels
//   radius   width of the band around the edge where alpha is re-estimated
//            from the colors (hair, fur, soft edges): each band pixel is
//            placed between the nearby foreground and background colors
//   smooth   round off jagged edges (0–100)
//   feather  blur the edge, in pixels
//   contrast sharpen soft edges (0–100)
export function refineEdge(img, { sel, shift = 0, radius = 0, smooth = 0, feather = 0, contrast = 0 }) {
  const { width: w, height: h, data: C } = img;
  const n = w * h;
  const S = sel.data;
  let alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = S[i * 4 + 3] / 255;

  if (shift) alpha = shiftEdge(alpha, w, h, shift);

  if (radius > 0) {
    const inside = new Uint8Array(n);
    for (let i = 0; i < n; i++) inside[i] = alpha[i] >= 0.5 ? 1 : 0;
    const toOutside = distanceTransform(inside, w, h, 0); // for inside pixels: distance to the edge
    const toInside = distanceTransform(inside, w, h, 1);  // for outside pixels
    // Known foreground / background: beyond half the radius from the edge.
    const fg = new Float32Array(n * 4), bg = new Float32Array(n * 4);
    const known = radius / 2;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      const target = inside[i] ? (toOutside[i] > known ? fg : null) : (toInside[i] > known ? bg : null);
      if (!target) continue;
      target[k] = C[k];
      target[k + 1] = C[k + 1];
      target[k + 2] = C[k + 2];
      target[k + 3] = 1;
    }
    // Average nearby known colors (normalized convolution).
    blur4(fg, w, h, radius);
    blur4(bg, w, h, radius);
    for (let i = 0; i < n; i++) {
      const d = inside[i] ? toOutside[i] : toInside[i];
      if (d > radius) continue; // outside the band: keep as is
      const k = i * 4;
      const wf = fg[k + 3], wb = bg[k + 3];
      if (wf < 1e-3 || wb < 1e-3) continue;
      const fr = fg[k] / wf, fgg = fg[k + 1] / wf, fb = fg[k + 2] / wf;
      const br = bg[k] / wb, bgg = bg[k + 1] / wb, bb = bg[k + 2] / wb;
      const dr = fr - br, dg = fgg - bgg, db = fb - bb;
      const len2 = dr * dr + dg * dg + db * db;
      if (len2 < 400) continue; // foreground and background look alike: no information
      const a = ((C[k] - br) * dr + (C[k + 1] - bgg) * dg + (C[k + 2] - bb) * db) / len2;
      // Trust the color estimate more where the two colors differ a lot.
      const trust = Math.min(1, (len2 - 400) / 2000);
      alpha[i] = alpha[i] * (1 - trust) + Math.max(0, Math.min(1, a)) * trust;
    }
  }

  if (smooth > 0) {
    blur1(alpha, w, h, smooth / 25);
    // Re-harden what the blur softened, so smoothing rounds the edge off
    // rather than feathering it.
    const k = 1 + smooth / 50;
    for (let i = 0; i < n; i++) alpha[i] = (alpha[i] - 0.5) * k + 0.5;
  }
  if (feather > 0) blur1(alpha, w, h, feather / 2);
  if (contrast > 0) {
    const k = 1 / (1 - 0.95 * (contrast / 100));
    for (let i = 0; i < n; i++) alpha[i] = (alpha[i] - 0.5) * k + 0.5;
  }

  const out = new ImageData(w, h);
  const o = out.data;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    o[k] = o[k + 1] = o[k + 2] = 255;
    o[k + 3] = Math.max(0, Math.min(1, alpha[i])) * 255;
  }
  return out;
}

// Move a selection's edge by `px` pixels (anti-aliased).
function shiftEdge(alpha, w, h, px) {
  const n = w * h;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = alpha[i] >= 0.5 ? 1 : 0;
  // Signed distance to the edge: positive inside.
  const out = distanceTransform(inside, w, h, 0), inn = distanceTransform(inside, w, h, 1);
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = inside[i] ? out[i] - 0.5 : 0.5 - inn[i];
    res[i] = Math.max(0, Math.min(1, d + px + 0.5));
  }
  return res;
}
