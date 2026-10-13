// Properties panel: settings for whatever layer is selected, like
// Photoshop's. Transform (X / Y / W / H) for anything with pixels; text
// settings for type layers; fill and stroke for shapes; the adjustment's
// sliders for adjustment layers; mask actions; and the canvas size.

import { h } from "./util.js";
import { buildField } from "./dialogs.js";
import { adjustmentFields, adjustmentLabel } from "./commands.js";
import { renderText } from "./text.js";
import { renderShape, withLive } from "./shapes.js";

const FONTS = ["Inter", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Impact", "Comic Sans MS"];

export function buildPropertiesPanel(app, commands) {
  const panel = document.getElementById("properties-panel");
  const body = h("div", { class: "props" });
  panel.append(h("div", { class: "panel-head" }, "Properties"), body);

  // Rebuilding while someone drags a slider or types in a field would
  // interrupt them, so wait until they're done.
  let interacting = false, stale = false, signature = "";
  body.addEventListener("pointerdown", () => { interacting = true; });
  window.addEventListener("pointerup", () => {
    if (!interacting) return;
    interacting = false;
    if (stale) refresh();
  });
  body.addEventListener("focusout", () => setTimeout(() => { if (stale) refresh(); }));

  // Rapid changes (slider drags) become one history entry.
  let pending = null;
  function edit(label, surfaces, fn, { keepText = true } = {}) {
    if (!pending) {
      if (app.busy) return;
      app.history.begin(label, surfaces, { keepText });
      pending = { timer: 0 };
    }
    fn();
    app.requestRender();
    clearTimeout(pending.timer);
    pending.timer = setTimeout(flush, 400);
  }
  function flush() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    app.history.commit();
  }

  // A form section: fields built like a dialog's, onChange(values, key).
  function section(title, fields, onChange) {
    const values = {}, setters = {};
    const els = fields.map((f) => buildField(f, values, setters, (key) => onChange(values, key)));
    return h("div", { class: "props-section" }, title ? h("div", { class: "field-heading" }, title) : null, els);
  }

  function transformSection(layer) {
    const t = app.target();
    const b = t.isMask ? null : app.contentBoundsOf(layer);
    if (!b) return null;
    const r = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
    const values = { ...r }, setters = {};
    let keep = true;
    // Apply when a value is committed (Enter / leaving the field), not per keystroke.
    const apply = () => {
      const next = { x: values.x, y: values.y, w: Math.max(1, values.w), h: Math.max(1, values.h) };
      if (next.x === r.x && next.y === r.y && next.w === r.w && next.h === r.h) return;
      const resized = next.w !== r.w || next.h !== r.h;
      if (!app.ensureVisible(layer, { whole: true, locks: resized ? ["pixels", "position"] : ["position"] })) {
        refresh(true);
        return;
      }
      flush();
      app.tools.get("transform").setBounds(app, { x: next.x, y: next.y, w: next.w * (b.w / r.w), h: next.h * (b.h / r.h) });
    };
    const field = (key, label) => {
      const el = buildField({ key, label, type: "number", min: -100000, max: 100000, value: r[key], unit: "px" }, values, setters, (k) => {
        if (!keep || (k !== "w" && k !== "h")) return;
        // Keep proportions: the other side follows.
        if (k === "w") setters.h((values.h = Math.max(1, Math.round((values.w * r.h) / r.w))));
        else setters.w((values.w = Math.max(1, Math.round((values.h * r.w) / r.h))));
      });
      const input = el.querySelector("input");
      input.addEventListener("change", apply);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      return el;
    };
    const link = h("button", {
      type: "button", class: "icon-btn props-link on", title: "Keep proportions", "aria-pressed": "true",
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg>',
      onclick: () => {
        keep = !keep;
        link.classList.toggle("on", keep);
        link.setAttribute("aria-pressed", String(keep));
      },
    });
    const flip = (axis, label) => h("button", { type: "button", class: "btn-s", onclick: () => app.flipLayer(axis) }, label);
    return h("div", { class: "props-section" },
      h("div", { class: "field-heading" }, "Transform"),
      h("div", { class: "props-grid" }, field("x", "X"), field("y", "Y")),
      h("div", { class: "props-grid" }, field("w", "W"), field("h", "H"), link),
      h("div", { class: "props-buttons" }, flip("h", "Flip Horizontal"), flip("v", "Flip Vertical")));
  }

  function textSection(layer) {
    const t = layer.text;
    const update = (changes) => edit("Edit Type", [layer], () => {
      layer.text = { ...layer.text, ...changes };
      renderText(layer, app.doc);
    });
    const content = h("textarea", { class: "props-text", rows: 2, "aria-label": "Text" });
    content.value = t.content;
    content.addEventListener("change", () => {
      if (content.value.trim() && content.value !== layer.text.content) {
        update({ content: content.value });
        flush();
      }
    });
    const fields = section("Character", [
      { key: "font", label: "Font", type: "select", options: FONTS.map((f) => [f, f]), value: t.font },
      { key: "size", label: "Size", type: "range", min: 6, max: 400, value: t.size, unit: "px" },
      { key: "color", label: "Color", type: "color", value: t.color },
      { key: "bold", label: "Bold", type: "checkbox", value: !!t.bold },
      { key: "italic", label: "Italic", type: "checkbox", value: !!t.italic },
      { key: "align", label: "Align", type: "select", options: [["left", "Left"], ["center", "Center"], ["right", "Right"]], value: t.align },
    ], (v, key) => {
      if (app.refuseLocked(layer, "pixels")) return;
      update({ [key]: v[key] });
    });
    return h("div", {}, h("div", { class: "props-section" }, h("div", { class: "field-heading" }, "Text"), content), fields);
  }

  function shapeSection(layer) {
    const s = layer.shape, live = s.live, open = !s.closed;
    const restyle = (fn) => {
      if (app.refuseLocked(layer, "pixels")) return;
      edit("Edit Shape", [layer], () => {
        layer.shape = fn(layer.shape);
        renderShape(layer, app.doc);
      });
    };
    // A live shape's own settings (corner radius, sides, points…).
    const geometry = [];
    if (live?.type === "rect" || live?.type === "bubble") geometry.push({ key: "radius", label: "Corners", type: "range", min: 0, max: Math.round(Math.min(live.w, live.h) / 2), value: Math.round(live.radius ?? 0), unit: "px" });
    if (live?.type === "polygon") geometry.push({ key: "sides", label: "Sides", type: "range", min: 3, max: 24, value: live.sides });
    if (live?.type === "star") {
      geometry.push({ key: "sides", label: "Points", type: "range", min: 3, max: 24, value: live.sides });
      geometry.push({ key: "indent", label: "Indent", type: "range", min: 5, max: 95, value: Math.round((1 - live.inner) * 100), unit: "%" });
    }
    if (live) geometry.push({ key: "angle", label: "Angle", type: "range", min: -180, max: 180, value: Math.round(live.angle ?? 0), unit: "°" });
    const shapeFields = geometry.length
      ? section("Shape", geometry, (v, key) => restyle((sh) => withLive(sh, key === "indent" ? { inner: 1 - v.indent / 100 } : { [key]: v[key] })))
      : null;

    const appearance = section("Appearance", [
      ...(open ? [] : [
        { key: "fillOn", label: "Fill", type: "checkbox", value: !!s.fill },
        { key: "fill", label: "Fill color", type: "color", value: s.fill ?? s.lastFill ?? "#000000" },
        { key: "strokeOn", label: "Stroke", type: "checkbox", value: !!s.stroke },
      ]),
      { key: "stroke", label: open ? "Color" : "Stroke color", type: "color", value: s.stroke ?? s.lastStroke ?? "#000000" },
      { key: "strokeWidth", label: open ? "Width" : "Stroke width", type: "range", min: 0, max: 100, value: Math.round(s.strokeWidth ?? 0), unit: "px" },
      { key: "dash", label: "Style", type: "select", options: [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]], value: s.dash ?? "solid" },
      ...(open ? [
        { key: "arrowStart", label: "Start arrow", type: "checkbox", value: !!s.arrowStart },
        { key: "arrowEnd", label: "End arrow", type: "checkbox", value: !!s.arrowEnd },
      ] : []),
    ], (v) => restyle((sh) => ({
      ...sh,
      fill: open ? null : v.fillOn ? v.fill : null,
      stroke: open || v.strokeOn ? v.stroke : null,
      strokeWidth: v.strokeWidth, dash: v.dash,
      arrowStart: open ? v.arrowStart : sh.arrowStart, arrowEnd: open ? v.arrowEnd : sh.arrowEnd,
      lastFill: open ? sh.lastFill : v.fill, lastStroke: v.stroke,
    })));
    return h("div", { class: "props-section" }, shapeFields, appearance);
  }

  function adjustmentSection(layer) {
    const { kind, op } = layer.adjustment;
    // Histograms show the image under the adjustment.
    const src = app.doc.compose().getContext("2d").getImageData(0, 0, app.doc.width, app.doc.height);
    const fields = adjustmentFields(kind, src, layer.adjustment.params);
    if (!fields) return h("p", { class: "props-note" }, `${adjustmentLabel(kind)} has no settings.`);
    return section(null, fields, (v) => edit(`Edit ${adjustmentLabel(kind)}`, [], () => {
      layer.adjustment = { kind, op, params: { ...v } };
    }));
  }

  function maskSection(layer) {
    if (!layer.mask) return null;
    const button = (id, label) => {
      const cmd = commands[id];
      return h("button", { type: "button", class: "btn-s", onclick: () => !app.busy && cmd.run() }, cmd.dynamicLabel?.() ?? label ?? cmd.label);
    };
    return h("div", { class: "props-section" },
      h("div", { class: "field-heading" }, "Layer Mask"),
      h("div", { class: "props-buttons" },
        button("mask.toggle"), button("mask.view"), button("mask.select", "Load as Selection"),
        button("mask.apply"), button("mask.delete")));
  }

  function documentSection() {
    const doc = app.doc;
    return h("div", { class: "props-section" },
      h("div", { class: "field-heading" }, "Canvas"),
      h("div", { class: "props-meta" }, `${doc.width} × ${doc.height} px`),
      h("div", { class: "props-buttons" },
        h("button", { type: "button", class: "btn-s", onclick: () => commands["image.size"].run() }, "Image Size…"),
        h("button", { type: "button", class: "btn-s", onclick: () => commands["image.canvas"].run() }, "Canvas Size…")));
  }

  function kindOf(layer) {
    if (layer.isGroup) return "Group";
    if (layer.adjustment) return `${adjustmentLabel(layer.adjustment.kind)} Adjustment`;
    if (layer.text) return "Type Layer";
    if (layer.shape) return "Shape Layer";
    return "Pixel Layer";
  }

  function render() {
    const doc = app.doc;
    const layer = doc.activeLayer;
    body.replaceChildren(...[
      h("div", { class: "props-kind" }, h("span", { class: "props-kind-label" }, kindOf(layer)), h("span", { class: "props-kind-name" }, layer.name)),
      layer.adjustment ? adjustmentSection(layer) : transformSection(layer),
      layer.text ? textSection(layer) : null,
      layer.shape ? shapeSection(layer) : null,
      maskSection(layer),
      documentSection(),
    ].filter(Boolean));
  }

  // What the panel shows depends on these; rebuild only when they change.
  function currentSignature() {
    const doc = app.doc, l = doc?.activeLayer;
    if (!l) return "";
    const b = l.adjustment ? null : app.contentBoundsOf(l);
    return JSON.stringify([
      l.id, l.name, l.text, l.shape, l.adjustment?.kind, l.adjustment?.params, !!l.mask, l.mask?.enabled, l.editMask,
      app.viewMask === l, b && [b.x, b.y, b.w, b.h], doc.width, doc.height,
    ]);
  }

  function refresh(force = false) {
    if (!app.doc) return;
    if (panel.classList.contains("collapsed")) {
      stale = true;
      return;
    }
    const sig = currentSignature();
    if (!force && sig === signature) return;
    if (!force && (interacting || pending || body.contains(document.activeElement))) {
      stale = true;
      return;
    }
    stale = false;
    signature = sig;
    render();
  }

  app.on("layers", () => refresh());
  app.on("history", () => refresh());
  app.on("doc", () => refresh(true));
  // Expanding the panel shows anything that changed while it was folded.
  new MutationObserver(() => { if (!panel.classList.contains("collapsed") && stale) refresh(true); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
}
