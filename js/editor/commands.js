import { openDialog, histogramField, curvesField, anchorField } from "./dialogs.js";
import * as F from "./filters.js";
import { filterClient, PreviewQueue } from "./filter-client.js";
import { serializeDoc, PROJECT_EXTENSION } from "./project.js";
import { healSelection } from "./heal.js";
import { DEFAULT_STYLES, STYLE_LABELS, hasStyles } from "./styles.js";
import { CHANGELOG, VERSION, showChangelog } from "./changelog.js";
import { h, isMac, clamp, copyImageData, downloadBlob, createCanvas } from "./util.js";
import { Selection } from "./selection.js";

// Menu layout. "-" is a separator, "#Text" a section heading.
export const MENUS = [
  ["File", ["file.new", "file.open", "file.place", "-", "file.save", "file.export", "-", "file.home"]],
  ["Edit", ["edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "edit.clear", "-", "edit.fillFg", "edit.fillBg", "edit.healSelection", "-", "edit.transform"]],
  ["Image", [
    "#Adjustments", "image.brightness", "image.levels", "image.curves", "image.hue", "image.balance",
    "image.desaturate", "image.invert", "image.sepia", "-",
    "image.size", "image.canvas", "image.crop", "-",
    "image.rotCW", "image.rotCCW", "image.rot180", "image.flipH", "image.flipV",
  ]],
  ["Layer", [
    "layer.new", "layer.duplicate", "layer.delete", "-",
    "#Groups", "layer.newGroup", "layer.group", "layer.ungroup", "-",
    "#Clipping & Locks", "layer.clip", "layer.lockAll", "-",
    "#New Adjustment Layer", "adj.brightness", "adj.levels", "adj.curves", "adj.hue", "adj.balance", "adj.bw", "adj.invert", "layer.editAdjustment", "-",
    "#Layer Style", "layer.style", "layer.clearStyle", "-",
    "#Type & Shapes", "layer.editText", "layer.rasterize", "-",
    "#Layer Mask", "mask.add", "mask.hideAll", "mask.toggle", "mask.edit", "mask.view", "mask.apply", "mask.delete", "mask.select", "-",
    "layer.up", "layer.down", "-", "layer.mergeDown", "layer.flatten", "-", "layer.flipH", "layer.flipV",
  ]],
  ["Select", ["select.all", "select.none", "select.inverse", "-", "select.refine", "select.quickMask", "-", "#Modify", "select.feather", "select.expand", "select.contract"]],
  ["Filter", ["filter.blur", "filter.sharpen", "filter.noise", "filter.pixelate"]],
  ["View", ["view.zoomIn", "view.zoomOut", "view.fit", "view.actual", "-", "view.rulers", "view.guides", "view.lockGuides", "view.newGuide", "view.clearGuides", "-", "view.snap", "view.smartGuides", "-", "view.toolbar", "view.options", "view.properties", "view.panels", "-", "view.resetLayout"]],
  ["Help", ["help.shortcuts", "help.whatsNew"]],
];

// Normalize a keydown into the same form commands use, e.g. "Mod+Shift+Z".
// Letters and digits come from ev.code so Alt/Shift don't change them; for
// symbols Shift is already part of the character ("+" vs "="), so it's omitted.
export function comboFromEvent(ev) {
  let key, named;
  if (ev.code.startsWith("Key")) { key = ev.code.slice(3); named = true; }
  else if (ev.code.startsWith("Digit")) { key = ev.code.slice(5); named = true; }
  else { key = ev.key; named = ev.key.length > 1; }
  const mods = [];
  if (isMac ? ev.metaKey : ev.ctrlKey) mods.push("Mod");
  if (ev.altKey) mods.push("Alt");
  if (ev.shiftKey && named) mods.push("Shift");
  return [...mods, key].join("+");
}

export function formatKeys(keys) {
  if (!keys) return "";
  if (!isMac) return keys.replace("Mod", "Ctrl");
  return keys.replace("Mod+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧");
}

// ---------- Field helpers ----------

const range = (key, label, min, max, value, extra = {}) => ({ key, label, type: "range", min, max, value, ...extra });
const num = (key, label, min, max, value, unit = "px") => ({ key, label, type: "number", min, max, value, unit });
const check = (key, label, value) => ({ key, label, type: "checkbox", value });
const select = (key, label, options, value) => ({ key, label, type: "select", options, value });
const heading = (label) => ({ type: "heading", label });

// Run an adjustment dialog with a live preview on the active layer. The
// filter `op` (a filters.js export) runs in a worker; `spec` may be a
// function of the source pixels (for histograms).
async function adjust(app, label, spec, op, pad = 0) {
  const { layer: owner, surface: layer } = app.target(); // pixels or mask
  if (!app.ensureVisible(owner)) return;
  const r = app.region(pad);
  if (!r.w || !r.h) return;
  const src = layer.getDocImageData(r);
  const mask = app.doc.selection?.region(r);
  const run = (v) => filterClient.run(op, v, copyImageData(src), mask);
  const opts = typeof spec === "function" ? spec(src) : spec;

  app.history.begin(label, [layer]);
  const queue = new PreviewQueue((img) => {
    layer.putDocImageData(img, r.x, r.y);
    layer.refresh(r);
    app.requestRender(r);
  });
  const values = await openDialog({
    title: label,
    preview: true,
    ...opts,
    onChange: (v, on) => queue.request(() => (on ? run(v) : Promise.resolve(src))),
  });
  queue.stop();
  if (!values) {
    app.history.cancel();
    return;
  }
  app.setWorking(true);
  try {
    layer.putDocImageData(await run(values), r.x, r.y);
    app.history.commit(r);
  } catch (err) {
    console.error(err);
    app.history.cancel();
    app.toast(`${label} failed.`);
  } finally {
    app.setWorking(false);
  }
}


// Select › Refine Edge: improve the selection's edge against the image
// (hair, fur, soft or jagged edges) with a live preview of the result.
const REFINE_VIEWS = [["overlay", "Overlay"], ["black", "On Black"], ["white", "On White"], ["mask", "Black & White"]];

async function refineEdgeDialog(app) {
  const doc = app.doc;
  if (!doc.selection || app.busy) return;
  const { width: w, height: h } = doc;
  const image = doc.compose().getContext("2d").getImageData(0, 0, w, h);
  const original = doc.selection;
  const sel = copyImageData(original.data);
  const matte = createCanvas(w, h); // the refined selection (white, alpha = selected)
  matte.getContext("2d").drawImage(original.mask, 0, 0);
  const view = createCanvas(w, h);
  let viewMode = "overlay";

  // Show the matte the chosen way: tinted, cut out on black/white, or as a mask.
  const show = () => {
    const c = view.getContext("2d");
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, w, h);
    if (viewMode === "overlay") {
      c.fillStyle = "#ff0000";
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = "destination-out";
      c.drawImage(matte, 0, 0);
      app.viewOverlay = { canvas: view, alpha: 0.5 };
    } else if (viewMode === "mask") {
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      c.drawImage(matte, 0, 0);
      app.viewOverlay = { canvas: view };
    } else {
      c.drawImage(doc.composite, 0, 0);
      c.globalCompositeOperation = "destination-in";
      c.drawImage(matte, 0, 0);
      c.globalCompositeOperation = "destination-over";
      c.fillStyle = viewMode === "black" ? "#000" : "#fff";
      c.fillRect(0, 0, w, h);
      app.viewOverlay = { canvas: view };
    }
    app.requestRender(false);
  };
  const setMatte = (img) => {
    matte.getContext("2d").putImageData(img, 0, 0);
    show();
  };

  app.hideSelection = true;
  show();
  let lastKey = null;
  const queue = new PreviewQueue(setMatte);
  const params = (v) => ({ shift: v.shift, radius: v.radius, smooth: v.smooth, feather: v.feather, contrast: v.contrast });
  const run = (v) => filterClient.run("refineEdge", { sel: copyImageData(sel), ...params(v) }, copyImageData(image));
  const values = await openDialog({
    title: "Refine Edge",
    preview: true,
    okLabel: "OK",
    fields: [
      select("view", "View", REFINE_VIEWS, viewMode),
      heading("Edge detection"),
      range("radius", "Radius", 0, 100, 0, { unit: "px" }),
      heading("Adjust edge"),
      range("smooth", "Smooth", 0, 100, 0, { unit: "%" }),
      range("feather", "Feather", 0, 100, 0, { unit: "px", step: 0.5 }),
      range("contrast", "Contrast", 0, 100, 0, { unit: "%" }),
      range("shift", "Shift Edge", -50, 50, 0, { unit: "px" }),
      heading("Output"),
      select("output", "Output to", [["selection", "Selection"], ["mask", "Layer Mask"], ["layer", "New Layer with Layer Mask"]], "selection"),
    ],
    onChange: (v, on) => {
      const key = on ? JSON.stringify(params(v)) : "original";
      if (v.view !== viewMode) {
        viewMode = v.view;
        if (key === lastKey) show();
      }
      if (key === lastKey) return;
      lastKey = key;
      queue.request(() => (on ? run(v) : Promise.resolve(copyImageData(sel))));
    },
  });
  queue.stop();
  app.viewOverlay = null;
  app.hideSelection = false;
  app.requestRender(false);
  if (!values) return;

  app.setWorking(true);
  let refined;
  try {
    refined = new Selection(imageCanvas(await run(values)));
  } catch (err) {
    console.error(err);
    app.toast("Refine Edge failed.");
    return;
  } finally {
    app.setWorking(false);
  }
  if (refined.isEmpty) {
    app.toast("Nothing would be selected — the selection was left as it was.");
    return;
  }
  app.setSelection(refined, "Refine Edge");
  if (values.output === "selection") return;
  if (values.output === "layer") app.duplicateLayer();
  if (doc.activeLayer.mask) app.deleteMask();
  app.addMask("selection");
}


async function newGuideDialog(app) {
  const doc = app.doc;
  const v = await openDialog({
    title: "New Guide",
    okLabel: "Add",
    fields: [
      select("axis", "Orientation", [["y", "Horizontal"], ["x", "Vertical"]], "y"),
      num("pos", "Position", -100000, 100000, Math.round(doc.height / 2)),
    ],
    onInput: (key, values, api) => {
      if (key === "axis") api.set("pos", Math.round((values.axis === "x" ? doc.width : doc.height) / 2));
    },
  });
  if (v) app.addGuide(v.axis, Math.round(v.pos));
}
function imageCanvas(img) {
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

function pickFile(accept = `image/*,${PROJECT_EXTENSION}`) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept });
    input.addEventListener("change", () => resolve(input.files[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function confirmDiscard(app) {
  return app.history.entries.length <= 1 || confirm("Discard your changes to the current image?");
}

// ---------- Dialogs ----------

const PRESETS = {
  hd: [1920, 1080], hd720: [1280, 720], uhd: [3840, 2160], square: [1080, 1080],
  story: [1080, 1920], a4: [2480, 3508], web: [800, 600],
};

async function newDocument(app) {
  const v = await openDialog({
    title: "New Document",
    okLabel: "Create",
    fields: [
      select("preset", "Preset", [
        ["custom", "Custom"], ["hd", "Full HD — 1920 × 1080"], ["hd720", "HD — 1280 × 720"], ["uhd", "4K — 3840 × 2160"],
        ["square", "Square post — 1080 × 1080"], ["story", "Story — 1080 × 1920"], ["a4", "A4 @ 300 dpi"], ["web", "Web — 800 × 600"],
      ], "custom"),
      num("width", "Width", 1, 16384, app.doc?.width ?? 1280),
      num("height", "Height", 1, 16384, app.doc?.height ?? 720),
      select("background", "Background", [["white", "White"], ["black", "Black"], ["bg", "Background color"], ["transparent", "Transparent"]], "white"),
    ],
    onInput(key, values, api) {
      if (key === "preset" && PRESETS[values.preset]) {
        api.set("width", PRESETS[values.preset][0]);
        api.set("height", PRESETS[values.preset][1]);
      } else if (key === "width" || key === "height") {
        api.set("preset", "custom");
      }
    },
  });
  if (!v || !confirmDiscard(app)) return;
  const fill = { white: "#ffffff", black: "#000000", bg: app.bg, transparent: null }[v.background];
  app.newDoc(Math.round(clamp(v.width, 1, 16384)), Math.round(clamp(v.height, 1, 16384)), fill);
}

async function exportDialog(app) {
  const v = await openDialog({
    title: "Export Image",
    okLabel: "Export",
    fields: [
      { key: "name", label: "File name", type: "text", value: app.doc.name },
      select("format", "Format", [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]], "png"),
      range("quality", "Quality", 1, 100, 92, { unit: "%" }),
    ],
    init: (api) => api.show("quality", false),
    onInput(key, values, api) {
      if (key === "format") api.show("quality", values.format !== "png");
    },
  });
  if (!v) return;
  const ext = v.format === "jpeg" ? "jpg" : v.format;
  try {
    await app.exportImage(`image/${v.format}`, v.quality / 100, `${v.name.trim() || "image"}.${ext}`);
  } catch {
    app.toast("Export failed — this browser may not support that format.");
  }
}

async function imageSizeDialog(app) {
  const { width: w, height: hgt } = app.doc;
  const ratio = w / hgt;
  const v = await openDialog({
    title: "Image Size",
    fields: [num("width", "Width", 1, 16384, w), num("height", "Height", 1, 16384, hgt), check("constrain", "Constrain proportions", true)],
    onInput(key, values, api) {
      if (!values.constrain) return;
      if (key === "width") api.set("height", Math.max(1, Math.round(values.width / ratio)));
      if (key === "height") api.set("width", Math.max(1, Math.round(values.height * ratio)));
    },
  });
  if (!v) return;
  const nw = Math.round(clamp(v.width, 1, 16384)), nh = Math.round(clamp(v.height, 1, 16384));
  if (nw !== w || nh !== hgt) app.resizeImage(nw, nh);
}

async function canvasSizeDialog(app) {
  const { width: w, height: hgt } = app.doc;
  const v = await openDialog({
    title: "Canvas Size",
    fields: [
      num("width", "Width", 1, 16384, w),
      num("height", "Height", 1, 16384, hgt),
      anchorField(),
      select("fill", "New area", [["transparent", "Transparent"], ["bg", "Background color"], ["white", "White"]], "transparent"),
    ],
  });
  if (!v) return;
  const nw = Math.round(clamp(v.width, 1, 16384)), nh = Math.round(clamp(v.height, 1, 16384));
  if (nw === w && nh === hgt) return;
  const fill = { transparent: null, bg: app.bg, white: "#ffffff" }[v.fill];
  app.resizeCanvas(nw, nh, v.anchor[0], v.anchor[1], fill);
}

async function saveProject(app) {
  app.setWorking(true);
  try {
    const blob = await serializeDoc(app.doc);
    downloadBlob(blob, `${app.doc.name || "Untitled"}${PROJECT_EXTENSION}`);
    app.toast(`Saved ${app.doc.name}${PROJECT_EXTENSION} — open it again with File › Open.`);
  } catch (err) {
    console.error(err);
    app.toast("Couldn't save the project.");
  } finally {
    app.setWorking(false);
  }
}

async function modifySelection(app, label, fieldLabel, initial, fn) {
  const v = await openDialog({ title: label, fields: [num("amount", fieldLabel, 1, 500, initial)] });
  if (!v || !app.doc.selection) return;
  app.setWorking(true);
  // Let the "working" state paint before the (synchronous) mask work starts.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  try {
    const next = fn(app.doc.selection, clamp(v.amount, 1, 500));
    if (next.isEmpty) app.toast("That would leave nothing selected.");
    else app.setSelection(next, label);
  } finally {
    app.setWorking(false);
  }
}

function shortcutsDialog(commands, tools) {
  const rows = [
    ...tools.map((t) => [t.name, t.key]),
    ["Swap colors", "X"], ["Default colors", "D"],
    ["Brush size", "[  ]"], ["Brush hardness", "Shift + [  ]"], ["Tool opacity", "1 … 0"],
    ["Pan", "Space + drag"], ["Zoom", `${isMac ? "⌘" : "Ctrl"} + scroll`],
    ...Object.values(commands).filter((c) => c.keys).map((c) => [c.label.replace("…", ""), formatKeys(c.keys)]),
  ];
  openDialog({
    title: "Keyboard Shortcuts",
    okLabel: "Close",
    cancelLabel: null,
    width: 560,
    fields: [{
      type: "custom",
      create: () => h("div", { class: "shortcut-grid" },
        rows.map(([label, keys]) => h("div", { class: "shortcut-row" }, h("span", {}, label), h("kbd", {}, keys)))),
    }],
  });
}

// ---------- Adjustments ----------

// Available both as one-off edits (Image menu) and as adjustment layers.
// fields(src) builds the dialog (src: pixels for histograms); adjustments
// without settings have fixed `params` instead.
const ADJUSTMENTS = {
  brightness: {
    label: "Brightness/Contrast", op: "brightnessContrast",
    fields: () => [range("brightness", "Brightness", -150, 150, 0), range("contrast", "Contrast", -100, 100, 0)],
  },
  levels: {
    label: "Levels", op: "levels", width: 400,
    fields: (src) => [
      histogramField(src),
      heading("Input levels"),
      range("inBlack", "Shadows", 0, 253, 0),
      range("gamma", "Midtones", 0.1, 9.99, 1, { step: 0.01 }),
      range("inWhite", "Highlights", 2, 255, 255),
      heading("Output levels"),
      range("outBlack", "Black", 0, 255, 0),
      range("outWhite", "White", 0, 255, 255),
    ],
  },
  curves: { label: "Curves", op: "curves", width: 400, fields: (src) => [curvesField(src)] },
  hue: {
    label: "Hue/Saturation", op: "hueSaturation",
    fields: () => [
      range("hue", "Hue", -180, 180, 0, { unit: "°" }),
      range("saturation", "Saturation", -100, 100, 0),
      range("lightness", "Lightness", -100, 100, 0),
    ],
  },
  balance: {
    label: "Color Balance", op: "colorBalance", width: 400,
    fields: () => [
      ...[["s", "Shadows"], ["m", "Midtones"], ["h", "Highlights"]].flatMap(([p, name]) => [
        heading(name),
        range(`${p}CR`, "Cyan ↔ Red", -100, 100, 0),
        range(`${p}MG`, "Magenta ↔ Green", -100, 100, 0),
        range(`${p}YB`, "Yellow ↔ Blue", -100, 100, 0),
      ]),
      check("preserve", "Preserve luminosity", true),
    ],
  },
  bw: { label: "Black & White", op: "grayscale", params: {} },
  invert: { label: "Invert", op: "invert", params: {} },
};
export const ADJUSTMENT_KINDS = Object.keys(ADJUSTMENTS);
export const adjustmentLabel = (kind) => ADJUSTMENTS[kind]?.label ?? "Adjustment";
// Fields for editing an adjustment (null if it has no settings), seeded with params.
export function adjustmentFields(kind, src, params) {
  const def = ADJUSTMENTS[kind];
  return def?.fields ? seedFields(def.fields(src), params) : null;
}

// Pixels for an adjustment layer's histograms: the image under it, scaled
// down. A histogram doesn't need every pixel, and reading a full-size image
// back from the GPU is slow.
export function histogramSource(app, layer) {
  const doc = app.doc, visible = layer.visible;
  layer.visible = false;
  const flat = doc.compose();
  layer.visible = visible;
  app.requestRender(); // compose() reused the on-screen composite
  const s = Math.min(1, 1024 / Math.max(doc.width, doc.height));
  const c = createCanvas(Math.max(1, Math.round(doc.width * s)), Math.max(1, Math.round(doc.height * s)));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false; // sample real pixel values, not blends of them
  ctx.drawImage(flat, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

// Start dialog fields from previously chosen values.
function seedFields(fields, params) {
  if (!params) return fields;
  return fields.map((f) => (f.key && f.key in params ? { ...f, value: params[f.key] } : f));
}

function destructiveAdjust(app, kind) {
  const def = ADJUSTMENTS[kind];
  return adjust(app, def.label, (src) => ({ width: def.width, fields: def.fields(src) }), def.op);
}

// Create an adjustment layer (above the active layer, masked to the
// selection if there is one), or re-edit `existing`.
async function adjustmentLayer(app, kind, existing = null) {
  const def = ADJUSTMENTS[kind];
  const doc = app.doc;
  if (app.busy) return;
  const label = existing ? `Edit ${def.label}` : `New ${def.label} Layer`;
  app.history.begin(label);
  let layer = existing;
  if (!layer) {
    const n = doc.leaves().filter((l) => l.adjustment?.kind === kind).length + 1;
    layer = app.makeAdjustmentLayer({ kind, op: def.op, params: def.params ?? null }, `${def.label} ${n}`);
    doc.insertAbove(doc.activeLayer, layer);
    doc.activeLayer = layer;
    doc.selection = null;
    app.contentChanged();
  }
  if (!def.fields) {
    app.history.commit();
    return;
  }
  const before = layer.adjustment;
  const src = histogramSource(app, layer);
  const values = await openDialog({
    title: label,
    width: def.width,
    preview: true,
    fields: seedFields(def.fields(src), before?.params),
    onChange: (v, on) => {
      layer.adjustment = { kind, op: def.op, params: on ? v : before?.params ?? null };
      app.requestRender();
    },
  });
  if (!values) {
    app.history.cancel();
    return;
  }
  layer.adjustment = { kind, op: def.op, params: values };
  app.history.commit();
}

// ---------- Layer styles ----------

const STYLE_FIELDS = {
  dropShadow: ["color", "opacity", "angle", "distance", "size"],
  innerShadow: ["color", "opacity", "angle", "distance", "size"],
  outerGlow: ["color", "opacity", "size"],
  stroke: ["color", "opacity", "size"],
  colorOverlay: ["color", "opacity"],
};

function styleField(effect, prop, value) {
  const key = `${effect}.${prop}`;
  if (prop === "color") return { key, label: "Color", type: "color", value };
  if (prop === "opacity") return range(key, "Opacity", 0, 100, Math.round(value * 100), { unit: "%" });
  if (prop === "angle") return range(key, "Angle", -180, 180, value, { unit: "°" });
  if (prop === "distance") return range(key, "Distance", 0, 200, value, { unit: "px" });
  return range(key, "Size", effect === "stroke" ? 1 : 0, effect === "stroke" ? 50 : 200, value, { unit: "px" });
}

// Dialog values ("dropShadow.size" → …) back to a styles object.
function stylesFromValues(v) {
  const out = {};
  for (const [effect, props] of Object.entries(STYLE_FIELDS)) {
    out[effect] = { enabled: !!v[`${effect}.enabled`] };
    for (const p of props) out[effect][p] = p === "opacity" ? v[`${effect}.${p}`] / 100 : v[`${effect}.${p}`];
  }
  return out;
}

async function layerStyleDialog(app) {
  const layer = app.doc.activeLayer;
  if (app.busy) return;
  if (layer.isGroup || layer.adjustment) {
    app.toast("Layer styles work on pixel and type layers.");
    return;
  }
  const before = layer.styles;
  const start = Object.fromEntries(Object.entries(DEFAULT_STYLES).map(([k, d]) => [k, { ...d, ...(before?.[k] ?? {}) }]));
  if (!hasStyles(before)) start.dropShadow.enabled = true; // show something right away
  const fields = Object.entries(STYLE_FIELDS).flatMap(([effect, props]) => [
    { key: `${effect}.enabled`, label: STYLE_LABELS[effect], type: "checkbox", value: start[effect].enabled, section: true },
    ...props.map((p) => styleField(effect, p, start[effect][p])),
  ]);
  // Only show the settings of effects that are switched on, so the panel
  // stays short enough to need no scrolling.
  const showEffect = (api, effect, on) => {
    for (const p of STYLE_FIELDS[effect]) api.show(`${effect}.${p}`, on);
  };
  app.history.begin("Layer Style");
  const values = await openDialog({
    title: `Layer Style — ${layer.name}`,
    width: 420,
    preview: true,
    fields,
    init: (api) => {
      for (const effect of Object.keys(STYLE_FIELDS)) showEffect(api, effect, start[effect].enabled);
    },
    onInput: (key, v, api) => {
      const [effect, prop] = key.split(".");
      if (prop === "enabled") showEffect(api, effect, v[key]);
    },
    onChange: (v, on) => {
      layer.styles = on ? stylesFromValues(v) : before;
      app.requestRender();
    },
  });
  if (!values) {
    app.history.cancel();
    return;
  }
  const styles = stylesFromValues(values);
  layer.styles = hasStyles(styles) ? styles : null;
  app.history.commit();
}

// ---------- Commands ----------

export function createCommands(app, tools) {
  const hasSel = () => !!app.doc?.selection;
  const active = () => app.doc.activeLayer;
  const siblings = () => app.doc.siblingsOf(active());
  const allLocked = (node) => !!(node?.locks?.transparency && node.locks.pixels && node.locks.position);
  const layerIndex = () => app.doc.activeIndex;
  const hasMask = () => !!app.doc?.activeLayer?.mask;

  const commands = {
    "file.new": { label: "New…", keys: "Mod+Alt+N", run: () => newDocument(app) },
    "file.open": {
      label: "Open…", keys: "Mod+O",
      run: async () => {
        const file = await pickFile();
        if (file && confirmDiscard(app)) app.openFile(file, file.name).catch(() => app.toast("Couldn't open that file."));
      },
    },
    "file.place": {
      label: "Place Image as Layer…",
      run: async () => {
        const file = await pickFile("image/*");
        if (!file) return;
        try {
          if (await app.placeFile(file, file.name)) app.beginTransform();
        } catch {
          app.toast("Couldn't open that file.");
        }
      },
    },
    "file.save": { label: "Save Project", keys: "Mod+S", run: () => saveProject(app) },
    "file.export": { label: "Export As…", keys: "Mod+Shift+S", alt: ["Mod+Alt+S"], run: () => exportDialog(app) },
    "file.home": { label: "Back to Home", run: () => { location.href = "index.html"; } },

    "edit.undo": { label: "Undo", keys: "Mod+Z", enabled: () => app.history.canUndo, run: () => app.history.undo() },
    "edit.redo": { label: "Redo", keys: "Mod+Shift+Z", alt: ["Mod+Y"], enabled: () => app.history.canRedo, run: () => app.history.redo() },
    "edit.cut": { label: "Cut", keys: "Mod+X", run: () => app.copy(true) },
    "edit.copy": { label: "Copy", keys: "Mod+C", run: () => app.copy(false) },
    "edit.paste": { label: "Paste", keys: "Mod+V", noBind: true, run: () => app.pasteFromMenu() }, // the paste event handles the shortcut
    "edit.clear": { label: "Clear", keys: "Delete", alt: ["Backspace"], enabled: hasSel, run: () => app.clearArea() },
    "edit.fillFg": { label: "Fill with Foreground", keys: "Alt+Backspace", run: () => app.fill(app.fg, "Fill") },
    "edit.fillBg": { label: "Fill with Background", keys: "Mod+Backspace", run: () => app.fill(app.bg, "Fill") },
    "edit.transform": { label: "Free Transform", keys: "Alt+T", run: () => app.beginTransform() },
    "edit.healSelection": {
      label: "Heal Selection", keys: "Shift+Backspace", enabled: hasSel,
      run: () => healSelection(app),
    },

    "image.brightness": { label: "Brightness/Contrast…", run: () => destructiveAdjust(app, "brightness") },
    "image.levels": { label: "Levels…", keys: "Mod+L", run: () => destructiveAdjust(app, "levels") },
    "image.curves": { label: "Curves…", keys: "Mod+M", run: () => destructiveAdjust(app, "curves") },
    "image.hue": { label: "Hue/Saturation…", keys: "Mod+U", run: () => destructiveAdjust(app, "hue") },
    "image.balance": { label: "Color Balance…", keys: "Mod+B", run: () => destructiveAdjust(app, "balance") },
    "image.desaturate": { label: "Desaturate", keys: "Mod+Shift+U", run: () => app.applyFilter("Desaturate", F.grayscale) },
    "image.invert": { label: "Invert", keys: "Mod+I", run: () => app.applyFilter("Invert", F.invert) },
    "image.sepia": { label: "Sepia", run: () => app.applyFilter("Sepia", F.sepia) },
    "image.size": { label: "Image Size…", keys: "Mod+Alt+I", run: () => imageSizeDialog(app) },
    "image.canvas": { label: "Canvas Size…", keys: "Mod+Alt+C", run: () => canvasSizeDialog(app) },
    "image.crop": { label: "Crop to Selection", enabled: hasSel, run: () => app.crop(app.doc.selection.bounds) },
    "image.rotCW": { label: "Rotate 90° Clockwise", run: () => app.rotateImage(90) },
    "image.rotCCW": { label: "Rotate 90° Counter-Clockwise", run: () => app.rotateImage(-90) },
    "image.rot180": { label: "Rotate 180°", run: () => app.rotateImage(180) },
    "image.flipH": { label: "Flip Canvas Horizontal", run: () => app.flipImage("h") },
    "image.flipV": { label: "Flip Canvas Vertical", run: () => app.flipImage("v") },

    "layer.new": { label: "New Layer", keys: "Shift+N", run: () => app.addLayer() },
    "layer.newGroup": { label: "New Group", run: () => app.newGroup() },
    "layer.group": { label: "Group Layer", keys: "Mod+G", run: () => app.groupLayer() },
    "layer.ungroup": { label: "Ungroup", keys: "Mod+Shift+G", enabled: () => active().isGroup, run: () => app.ungroup() },
    "layer.duplicate": {
      label: "Duplicate Layer", keys: "Mod+J", run: () => app.duplicateLayer(),
      dynamicLabel: () => (active()?.isGroup ? "Duplicate Group" : "Duplicate Layer"),
    },
    "layer.delete": {
      label: "Delete Layer", enabled: () => !(app.doc.layers.length === 1 && app.doc.layers[0] === active()),
      run: () => app.deleteLayer(),
      dynamicLabel: () => (active()?.isGroup ? "Delete Group" : "Delete Layer"),
    },
    "layer.up": {
      label: "Bring Forward", keys: "Mod+]", enabled: () => layerIndex() < siblings().length - 1,
      run: () => app.moveNode(active(), app.doc.parentOf(active()), layerIndex() + 2),
    },
    "layer.down": {
      label: "Send Backward", keys: "Mod+[", enabled: () => layerIndex() > 0,
      run: () => app.moveNode(active(), app.doc.parentOf(active()), layerIndex() - 1),
    },
    "layer.mergeDown": {
      label: "Merge Down", keys: "Mod+E", run: () => app.mergeDown(),
      enabled: () => {
        if (active().isGroup) return true;
        const below = siblings()[layerIndex() - 1];
        return !!below && !below.isGroup && !below.adjustment;
      },
      dynamicLabel: () => (active()?.isGroup ? "Merge Group" : "Merge Down"),
    },
    "layer.clip": {
      label: "Create Clipping Mask", keys: "Mod+Alt+G",
      enabled: () => active().clipped || app.canClip(active()),
      run: () => app.toggleClipping(),
      dynamicLabel: () => (active()?.clipped ? "Release Clipping Mask" : "Create Clipping Mask"),
    },
    "layer.lockAll": {
      label: "Lock All", keys: "Mod+/",
      run: () => app.toggleLock(active(), "all"),
      dynamicLabel: () => (allLocked(active()) ? "Unlock All" : "Lock All"),
    },
    "layer.flatten": { label: "Flatten Image", keys: "Mod+Shift+E", enabled: () => app.doc.allNodes().length > 1, run: () => app.flatten() },
    "layer.style": {
      label: "Layer Style…", enabled: () => !active().isGroup && !active().adjustment, run: () => layerStyleDialog(app),
    },
    "layer.clearStyle": {
      label: "Clear Layer Style", enabled: () => hasStyles(active().styles),
      run: () => app.setStyles(active(), null, "Clear Layer Style"),
    },
    "layer.editAdjustment": {
      label: "Edit Adjustment…", enabled: () => !!active().adjustment,
      run: () => adjustmentLayer(app, active().adjustment.kind, active()),
    },
    ...Object.fromEntries(ADJUSTMENT_KINDS.map((kind) => [`adj.${kind}`, {
      label: `${ADJUSTMENTS[kind].label}${ADJUSTMENTS[kind].fields ? "…" : ""}`,
      run: () => adjustmentLayer(app, kind),
    }])),
    "layer.rasterize": {
      label: "Rasterize Layer", enabled: () => !!(active()?.text || active()?.shape), run: () => app.rasterizeLayer(),
      dynamicLabel: () => (active()?.shape ? "Rasterize Shape" : "Rasterize Type"),
    },
    "layer.editText": {
      label: "Edit Text", enabled: () => !!app.doc?.activeLayer?.text, run: () => app.editText(app.doc.activeLayer),
    },
    "mask.add": {
      label: "Add Layer Mask", enabled: () => !hasMask(),
      run: () => app.addMask(app.doc.selection ? "selection" : "reveal"),
    },
    "mask.hideAll": { label: "Add Mask — Hide All", enabled: () => !hasMask(), run: () => app.addMask("hide") },
    "mask.toggle": {
      label: "Disable Layer Mask", enabled: hasMask, run: () => app.toggleMaskEnabled(),
      dynamicLabel: () => (app.doc.activeLayer.mask && !app.doc.activeLayer.mask.enabled ? "Enable Layer Mask" : "Disable Layer Mask"),
    },
    "mask.edit": {
      label: "Edit Mask", keys: "Mod+\\", enabled: hasMask,
      run: () => app.setEditTarget(app.doc.activeLayer, !app.doc.activeLayer.editMask),
      dynamicLabel: () => (app.doc.activeLayer.editMask && hasMask() ? "Edit Layer Pixels" : "Edit Mask"),
    },
    "mask.view": { label: "Show Mask Only", keys: "\\", enabled: hasMask, run: () => app.toggleMaskView() },
    "mask.apply": {
      label: "Apply Layer Mask", enabled: () => hasMask() && !active().isGroup && !active().adjustment, run: () => app.applyMask(),
    },
    "mask.delete": { label: "Delete Layer Mask", enabled: hasMask, run: () => app.deleteMask() },
    "mask.select": { label: "Load Mask as Selection", enabled: hasMask, run: () => app.selectionFromMask() },

    "layer.flipH": { label: "Flip Layer Horizontal", run: () => app.flipLayer("h") },
    "layer.flipV": { label: "Flip Layer Vertical", run: () => app.flipLayer("v") },

    "select.all": { label: "Select All", keys: "Mod+A", run: () => app.selectAll() },
    "select.none": { label: "Deselect", keys: "Mod+D", enabled: hasSel, run: () => app.deselect() },
    "select.inverse": { label: "Inverse", keys: "Shift+F7", enabled: hasSel, run: () => app.invertSelection() },
    "select.refine": {
      label: "Refine Edge…", keys: "Mod+Alt+R", enabled: hasSel, run: () => refineEdgeDialog(app),
    },
    "select.quickMask": {
      label: "Edit in Quick Mask Mode", keys: "Q", run: () => app.toggleQuickMask(),
      dynamicLabel: () => (app.doc?.quickMask ? "Exit Quick Mask Mode" : "Edit in Quick Mask Mode"),
    },
    "select.feather": {
      label: "Feather…", keys: "Shift+F6", enabled: hasSel,
      run: () => modifySelection(app, "Feather Selection", "Feather radius", 8, (sel, v) => sel.feathered(v)),
    },
    "select.expand": {
      label: "Expand…", enabled: hasSel,
      run: () => modifySelection(app, "Expand Selection", "Expand by", 8, (sel, v) => sel.grown(v)),
    },
    "select.contract": {
      label: "Contract…", enabled: hasSel,
      run: () => modifySelection(app, "Contract Selection", "Contract by", 8, (sel, v) => sel.grown(-v)),
    },

    "filter.blur": {
      label: "Gaussian Blur…",
      run: () => adjust(app, "Gaussian Blur", {
        fields: [range("radius", "Radius", 0.1, 100, 4, { step: 0.1, unit: "px" })],
      }, "blur", 300),
    },
    "filter.sharpen": {
      label: "Unsharp Mask…",
      run: () => adjust(app, "Unsharp Mask", {
        fields: [range("amount", "Amount", 1, 500, 100, { unit: "%" }), range("radius", "Radius", 0.1, 50, 1.5, { step: 0.1, unit: "px" })],
      }, "unsharpMask", 150),
    },
    "filter.noise": {
      label: "Add Noise…",
      run: () => adjust(app, "Add Noise", {
        fields: [range("amount", "Amount", 1, 100, 12, { unit: "%" }), check("mono", "Monochromatic", true)],
      }, "addNoise"),
    },
    "filter.pixelate": {
      label: "Pixelate…",
      run: () => adjust(app, "Pixelate", {
        fields: [range("size", "Cell size", 2, 200, 12, { unit: "px" })],
      }, "pixelate"),
    },

    "view.zoomIn": { label: "Zoom In", keys: "Mod+=", alt: ["Mod++"], run: () => app.zoomStep(1) },
    "view.zoomOut": { label: "Zoom Out", keys: "Mod+-", run: () => app.zoomStep(-1) },
    "view.fit": { label: "Fit on Screen", keys: "Mod+0", run: () => app.fit() },
    "view.actual": { label: "Actual Pixels", keys: "Mod+1", run: () => app.actualSize() },
    "view.rulers": {
      label: "Show Rulers", keys: "Mod+R", run: () => app.setPref("rulers", !app.prefs.rulers),
      dynamicLabel: () => (app.prefs.rulers ? "Hide Rulers" : "Show Rulers"),
    },
    "view.guides": {
      label: "Show Guides", keys: "Mod+;", run: () => app.setPref("guides", !app.prefs.guides),
      dynamicLabel: () => (app.prefs.guides ? "Hide Guides" : "Show Guides"),
    },
    "view.snap": {
      label: "Snap", run: () => app.setPref("snap", !app.prefs.snap),
      dynamicLabel: () => (app.prefs.snap ? "Turn Snapping Off" : "Turn Snapping On"),
    },
    "view.lockGuides": {
      label: "Lock Guides", keys: "Mod+Alt+;", run: () => app.setPref("lockGuides", !app.prefs.lockGuides),
      dynamicLabel: () => (app.prefs.lockGuides ? "Unlock Guides" : "Lock Guides"),
    },
    "view.smartGuides": {
      label: "Smart Guides", run: () => app.setPref("smartGuides", !app.prefs.smartGuides),
      dynamicLabel: () => (app.prefs.smartGuides ? "Turn Smart Guides Off" : "Turn Smart Guides On"),
    },
    "view.newGuide": { label: "New Guide…", run: () => newGuideDialog(app) },
    "view.clearGuides": { label: "Clear Guides", enabled: () => !!app.doc?.guides.length, run: () => app.clearGuides() },
    "view.properties": { label: "Show/Hide Properties", run: () => app.emit("toggle-properties") },
    "view.resetLayout": { label: "Reset Layout to Default", run: () => app.resetLayout() },
    // Tab and Shift+Tab are handled by the panels themselves, only when nothing has focus.
    "view.toolbar": { label: "Show/Hide Toolbar", keys: "Shift+Tab", noBind: true, run: () => app.emit("toggle-toolbar") },
    "view.options": { label: "Show/Hide Options Bar", run: () => app.emit("toggle-options") },
    "view.panels": { label: "Show/Hide Panels", keys: "Tab", noBind: true, run: () => app.emit("toggle-panels") },

    "help.shortcuts": { label: "Keyboard Shortcuts", keys: "?", run: () => shortcutsDialog(commands, tools) },
    "help.whatsNew": { label: `What's New (v${VERSION})`, run: () => showChangelog(CHANGELOG, "Photocrap release notes") },
  };
  return commands;
}
