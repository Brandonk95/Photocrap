import { h, clamp, hexToRgb, rgbToHex } from "./util.js";

// ---------- Color math (h: 0–360, s/v: 0–1) ----------

export function hsvToRgb(hue, s, v) {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return { r: f(5), g: f(3), b: f(1) };
}

export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { h: hue, s: max ? d / max : 0, v: max };
}

const PALETTE = [
  "#000000", "#3d3d3d", "#7a7a7a", "#b8b8b8", "#e6e6e6", "#ffffff",
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0c7",
  "#007aff", "#5856d6", "#af52de", "#ff2d55", "#a2845e", "#6b4f3a",
  "#ffd6cc", "#ffe8b3", "#d9f2d0", "#cce5ff", "#e3d7ff", "#ffd1e0",
];

const RECENT_KEY = "photocrap:recent-colors";
function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(v) ? v.filter((c) => /^#[0-9a-f]{6}$/i.test(c)) : [];
  } catch {
    return [];
  }
}
function saveRecent(hex) {
  const list = [hex, ...loadRecent().filter((c) => c !== hex)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

let current = null; // only one picker open at a time

// Open the picker next to `anchor`. onChange(hex) fires live while editing.
// Escape reverts to the starting color; Enter or clicking elsewhere keeps it.
export function openColorPicker({ anchor, color, title = "Color", onChange }) {
  current?.close(true);
  const original = color.toLowerCase();
  let hsv = rgbToHsv(hexToRgb(original));

  const sv = h("canvas", { class: "cp-sv", width: 440, height: 320 });
  const hue = h("canvas", { class: "cp-hue", width: 32, height: 320 });
  const svDot = h("span", { class: "cp-sv-dot" });
  const hueDot = h("span", { class: "cp-hue-dot" });
  const oldSwatch = h("button", { class: "cp-old", type: "button", title: "Original color — click to restore", style: `background:${original}` });
  const newSwatch = h("span", { class: "cp-new" });
  const hexInput = h("input", { type: "text", class: "cp-hex", maxlength: "7", spellcheck: "false", "aria-label": "Hex" });
  const num = (label, max) => {
    const input = h("input", { type: "number", min: 0, max, step: 1, "aria-label": label });
    return { input, el: h("label", { class: "cp-num" }, h("span", {}, label), input) };
  };
  const R = num("R", 255), G = num("G", 255), B = num("B", 255);
  const H = num("H", 360), S = num("S", 100), V = num("B", 100);
  const recentRow = h("div", { class: "cp-swatches" });
  const paletteRow = h("div", { class: "cp-swatches" },
    PALETTE.map((c) => h("button", { type: "button", class: "cp-chip", title: c, style: `background:${c}`, onclick: () => setHex(c) })));

  const eyedrop = "EyeDropper" in window
    ? h("button", {
      type: "button", class: "btn-s", title: "Pick a color from anywhere on screen",
      onclick: async () => {
        try {
          const { sRGBHex } = await new window.EyeDropper().open();
          setHex(sRGBHex);
        } catch { /* cancelled */ }
      },
    }, "Pick from screen")
    : null;

  const pop = h("div", { class: "color-pop", role: "dialog", "aria-label": title },
    h("div", { class: "cp-head" }, h("span", {}, title), h("span", { class: "cp-compare" }, oldSwatch, newSwatch)),
    h("div", { class: "cp-main" },
      h("div", { class: "cp-sv-wrap" }, sv, svDot),
      h("div", { class: "cp-hue-wrap" }, hue, hueDot)),
    h("div", { class: "cp-row" }, h("label", { class: "cp-num cp-hex-wrap" }, h("span", {}, "#"), hexInput), eyedrop),
    h("div", { class: "cp-grid" }, R.el, G.el, B.el, H.el, S.el, V.el),
    h("div", { class: "cp-label" }, "Recent"),
    recentRow,
    h("div", { class: "cp-label" }, "Swatches"),
    paletteRow);
  document.body.append(pop);

  // ---------- Drawing ----------
  const hueCtx = hue.getContext("2d");
  const grad = hueCtx.createLinearGradient(0, 0, 0, hue.height);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  hueCtx.fillStyle = grad;
  hueCtx.fillRect(0, 0, hue.width, hue.height);

  const svCtx = sv.getContext("2d");
  function drawSV() {
    const { r, g, b } = hsvToRgb(hsv.h, 1, 1);
    svCtx.fillStyle = `rgb(${r},${g},${b})`;
    svCtx.fillRect(0, 0, sv.width, sv.height);
    const white = svCtx.createLinearGradient(0, 0, sv.width, 0);
    white.addColorStop(0, "#fff");
    white.addColorStop(1, "rgba(255,255,255,0)");
    svCtx.fillStyle = white;
    svCtx.fillRect(0, 0, sv.width, sv.height);
    const black = svCtx.createLinearGradient(0, 0, 0, sv.height);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "#000");
    svCtx.fillStyle = black;
    svCtx.fillRect(0, 0, sv.width, sv.height);
  }

  const hex = () => {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(r, g, b);
  };

  let lastHue = null;
  function sync(skip) {
    const value = hex();
    const { r, g, b } = hexToRgb(value);
    if (hsv.h !== lastHue) {
      drawSV();
      lastHue = hsv.h;
    }
    svDot.style.left = `${hsv.s * 100}%`;
    svDot.style.top = `${(1 - hsv.v) * 100}%`;
    svDot.style.background = value;
    hueDot.style.top = `${(hsv.h / 360) * 100}%`;
    newSwatch.style.background = value;
    if (skip !== hexInput) hexInput.value = value.slice(1);
    const set = (f, v) => { if (skip !== f.input) f.input.value = v; };
    set(R, r); set(G, g); set(B, b);
    set(H, Math.round(hsv.h)); set(S, Math.round(hsv.s * 100)); set(V, Math.round(hsv.v * 100));
    onChange(value);
  }

  function setHex(value) {
    hsv = rgbToHsv(hexToRgb(value.toLowerCase()));
    sync();
  }

  function renderRecent() {
    const list = loadRecent();
    recentRow.replaceChildren(...(list.length
      ? list.map((c) => h("button", { type: "button", class: "cp-chip", title: c, style: `background:${c}`, onclick: () => setHex(c) }))
      : [h("span", { class: "cp-empty" }, "Colors you use show up here")]));
  }

  // ---------- Input ----------
  function drag(el, onPoint) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        onPoint(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
      };
      move(e);
      el.onpointermove = move;
      el.onpointerup = () => { el.onpointermove = el.onpointerup = null; };
    });
  }
  drag(sv.parentElement, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; sync(); });
  drag(hue.parentElement, (_, y) => { hsv = { ...hsv, h: Math.min(y * 360, 359.9) }; sync(); });

  hexInput.addEventListener("input", () => {
    const v = hexInput.value.replace(/[^0-9a-f]/gi, "");
    const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    if (full.length === 6) {
      hsv = rgbToHsv(hexToRgb(`#${full}`));
      sync(hexInput);
    }
  });
  for (const f of [R, G, B]) {
    f.input.addEventListener("input", () => {
      const c = [R, G, B].map((x) => clamp(Math.round(+x.input.value || 0), 0, 255));
      hsv = rgbToHsv({ r: c[0], g: c[1], b: c[2] });
      sync(f.input);
    });
  }
  for (const f of [H, S, V]) {
    f.input.addEventListener("input", () => {
      hsv = {
        h: clamp(+H.input.value || 0, 0, 359.9),
        s: clamp((+S.input.value || 0) / 100, 0, 1),
        v: clamp((+V.input.value || 0) / 100, 0, 1),
      };
      sync(f.input);
    });
  }
  oldSwatch.addEventListener("click", () => setHex(original));

  // ---------- Placement & closing ----------
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.right + 10, top = r.top - 40;
  if (left + pw > innerWidth - 8) { left = r.left; top = r.bottom + 8; }
  pop.style.left = `${clamp(left, 8, innerWidth - pw - 8)}px`;
  pop.style.top = `${clamp(top, 8, innerHeight - ph - 8)}px`;

  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) close(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(false); }
  };
  function close(revert) {
    if (current !== handle) return;
    current = null;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    pop.remove();
    if (revert) onChange(original);
    else if (hex() !== original) saveRecent(hex());
  }
  const handle = { close };
  current = handle;
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });

  renderRecent();
  sync();
  hexInput.focus();
  hexInput.select();
  return handle;
}

export const isColorPickerOpen = () => !!current;
