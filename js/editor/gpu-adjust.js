// Adjustment layers on the GPU. Re-coloring the composite on the CPU means
// reading every pixel back from the GPU and uploading the result again on
// each render, which is what made images with adjustment layers lag. Here
// the pixels never leave the GPU: the area is uploaded as a WebGL texture,
// re-colored by a shader through a lookup table, and drawn back.
//
// The lookup tables are built by running the CPU filter (filters.js) itself,
// so results match it: exactly for per-channel ops (one 256-entry table per
// channel), to within a level or two for the rest (a 3D color cube).
//
// gpuAdjust() returns null whenever the GPU can't be used (no WebGL2, a lost
// context, an image bigger than the GPU allows); callers then use the CPU.

import * as Filters from "./filters.js";
import { createCanvas } from "./util.js";

// Ops whose result for a channel depends only on that channel's value.
const PER_CHANNEL = new Set(["brightnessContrast", "levels", "curves", "invert"]);
const CUBE = 33; // 3D lookup table size per axis (32 steps of 8 levels)

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Output pixel (x, row) reads source texel (x, row): rows are flipped because
// GL counts from the bottom. Colors arrive unpremultiplied (like
// getImageData), are re-colored, and leave premultiplied.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D img;
uniform sampler2D lut1;
uniform sampler3D lut3;
uniform bool cube;
uniform float top;
out vec4 o;
void main() {
  vec4 c = texelFetch(img, ivec2(int(gl_FragCoord.x), int(top - gl_FragCoord.y)), 0);
  vec3 r;
  if (cube) {
    float n = float(${CUBE});
    r = texture(lut3, (c.rgb * (n - 1.0) + 0.5) / n).rgb;
  } else {
    ivec3 i = ivec3(round(c.rgb * 255.0));
    r = vec3(texelFetch(lut1, ivec2(i.r, 0), 0).r, texelFetch(lut1, ivec2(i.g, 0), 0).g, texelFetch(lut1, ivec2(i.b, 0), 0).b);
  }
  o = vec4(r * c.a, c.a);
}`;

let state; // undefined: not tried yet, null: unavailable

function init() {
  try {
    const canvas = createCanvas(1, 1);
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const texture = (unit, target, filter) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, t);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
      for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(target, wrap, gl.CLAMP_TO_EDGE);
      return t;
    };
    texture(0, gl.TEXTURE_2D, gl.NEAREST);
    texture(1, gl.TEXTURE_2D, gl.NEAREST);
    texture(2, gl.TEXTURE_3D, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, "img"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "lut1"), 1);
    gl.uniform1i(gl.getUniformLocation(prog, "lut3"), 2);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    const s = {
      gl, canvas,
      cube: gl.getUniformLocation(prog, "cube"),
      top: gl.getUniformLocation(prog, "top"),
      max: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
      staging: createCanvas(1, 1), // the area to adjust, when it's not the whole source
      lutKey: "",
    };
    s.stagingCtx = s.staging.getContext("2d");
    canvas.addEventListener("webglcontextlost", () => { state = null; });
    return s;
  } catch (err) {
    console.warn("GPU adjustments unavailable, using the CPU", err);
    return null;
  }
}

// Upload the lookup table for op/params, unless it's the one already loaded.
function loadLUT(s, op, params) {
  const key = `${op}|${JSON.stringify(params)}`;
  if (key === s.lutKey) return;
  const gl = s.gl;
  const perChannel = PER_CHANNEL.has(op);
  if (perChannel) {
    const ramp = new ImageData(256, 1);
    for (let i = 0; i < 256; i++) ramp.data.set([i, i, i, 255], i * 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Filters[op](ramp, params).data);
  } else {
    // Every combination of CUBE levels per channel, red fastest, blue slowest.
    const n = CUBE, img = new ImageData(n, n * n), d = img.data;
    const level = (i) => Math.round((i * 255) / (n - 1));
    for (let b = 0, k = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, k += 4) {
      d[k] = level(r); d[k + 1] = level(g); d[k + 2] = level(b); d[k + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, Filters[op](img, params).data);
  }
  gl.uniform1i(s.cube, perChannel ? 0 : 1);
  s.lutKey = key;
}

// The `op` adjustment (a filters.js export) of `source` within rect r.
// Returns a canvas holding the result in its top-left r.w × r.h pixels
// (valid until the next call), or null to fall back to the CPU.
export function gpuAdjust(source, r, op, params) {
  if (state === undefined) state = init();
  const s = state;
  if (!s || s.gl.isContextLost() || !Filters[op] || r.w > s.max || r.h > s.max) return null;
  const { gl, canvas } = s;
  try {
    loadLUT(s, op, params);
    // Grow-only, so painting (a new small rect every frame) doesn't reallocate.
    if (canvas.width < r.w || canvas.height < r.h) {
      canvas.width = Math.max(canvas.width, r.w);
      canvas.height = Math.max(canvas.height, r.h);
    }
    let src = source;
    if (r.x || r.y || r.w !== source.width || r.h !== source.height) {
      if (s.staging.width < r.w || s.staging.height < r.h) {
        s.staging.width = Math.max(s.staging.width, r.w);
        s.staging.height = Math.max(s.staging.height, r.h);
      }
      s.stagingCtx.globalCompositeOperation = "copy";
      s.stagingCtx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      src = s.staging;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    // Render into the canvas's top-left r.w × r.h (GL's y axis points up).
    gl.viewport(0, canvas.height - r.h, r.w, r.h);
    gl.uniform1f(s.top, canvas.height - 0.5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  } catch (err) {
    console.warn("GPU adjustment failed, using the CPU", err);
    state = null;
    return null;
  }
}
