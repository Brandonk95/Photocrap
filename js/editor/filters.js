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
