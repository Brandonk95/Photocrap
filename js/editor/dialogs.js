import { h, clamp } from "./util.js";
import { curveLUT, histogram } from "./filters.js";
import { openColorPicker, isColorPickerOpen } from "./colorpicker.js";

// Modal dialog built from a field list. Resolves with the values, or null if cancelled.
//   onInput(key, values, api)  — a field changed; api.set/api.show update other fields
//   onChange(values, preview)  — throttled to one call per frame, for live previews
export function openDialog({
  title, fields = [], okLabel = "OK", cancelLabel = "Cancel", width = 360,
  preview = false, onChange, onInput, init,
}) {
  return new Promise((resolve) => {
    const values = {}, rows = {}, setters = {};
    let previewOn = true, frame = 0;

    const api = {
      set(key, v) { values[key] = v; setters[key]?.(v); },
      show(key, on) { if (rows[key]) rows[key].hidden = !on; },
    };
    const notify = (key) => {
      if (key) onInput?.(key, values, api);
      if (!onChange) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onChange({ ...values }, previewOn));
    };

    const body = h("div", { class: "modal-body" });
    for (const f of fields) {
      const row = buildField(f, values, setters, notify);
      if (f.key) rows[f.key] = row;
      body.append(row);
    }

    const ok = h("button", { class: "btn-s primary", type: "button", onclick: () => close({ ...values }) }, okLabel);
    const foot = h("div", { class: "modal-foot" },
      preview && onChange
        ? h("label", { class: "field-check" },
          h("input", { type: "checkbox", checked: true, onchange: (e) => { previewOn = e.target.checked; notify(null); } }),
          "Preview")
        : null,
      h("span", { class: "spacer" }),
      cancelLabel ? h("button", { class: "btn-s", type: "button", onclick: () => close(null) }, cancelLabel) : null,
      ok);

    const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, style: `--w:${width}px` },
      h("div", { class: "modal-head" }, title), body, foot);
    const backdrop = h("div", { class: "modal-backdrop" }, modal);

    const onKey = (e) => {
      if (isColorPickerOpen()) return; // Esc/Enter belong to the picker
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        close({ ...values });
      }
    };
    function close(result) {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(result);
    }

    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    init?.(api);
    const first = body.querySelector("input:not([type=checkbox]):not([type=range]), select");
    (first ?? ok).focus();
    first?.select?.();
    if (onChange) notify(null);
  });
}

function buildField(f, values, setters, notify) {
  if (f.type === "heading") return h("div", { class: "field-heading" }, f.label);
  if (f.type === "custom") {
    if (f.key) values[f.key] = f.value;
    return f.create({ get: () => values[f.key], set: (v) => { values[f.key] = v; notify(f.key); }, values });
  }

  values[f.key] = f.value;
  const unit = f.unit ? h("span", { class: "unit" }, f.unit) : null;

  if (f.type === "range") {
    const step = f.step ?? 1;
    const range = h("input", { type: "range", min: f.min, max: f.max, step, value: f.value });
    const num = h("input", { type: "number", class: "num", min: f.min, max: f.max, step, value: f.value });
    const set = (v, from) => {
      values[f.key] = v;
      if (from !== range) range.value = v;
      if (from !== num) num.value = v;
    };
    range.addEventListener("input", () => { set(+range.value, range); notify(f.key); });
    num.addEventListener("input", () => {
      const v = parseFloat(num.value);
      if (Number.isNaN(v)) return;
      set(clamp(v, f.min, f.max), num);
      notify(f.key);
    });
    range.addEventListener("dblclick", () => { set(f.value); notify(f.key); }); // double-click resets
    setters[f.key] = (v) => set(v);
    return h("div", { class: "field field-range" },
      h("div", { class: "field-top" }, h("span", {}, f.label), h("span", { class: "num-wrap" }, num, unit)),
      range);
  }

  if (f.type === "checkbox") {
    const input = h("input", { type: "checkbox", checked: !!f.value });
    input.addEventListener("change", () => { values[f.key] = input.checked; notify(f.key); });
    setters[f.key] = (v) => { input.checked = v; };
    return h("label", { class: `field field-check${f.section ? " field-section" : ""}` }, input, f.label);
  }

  if (f.type === "color") {
    const swatch = h("button", { type: "button", class: "opt-swatch", style: `background:${f.value}`, "aria-label": f.label });
    const set = (hex) => {
      values[f.key] = hex;
      swatch.style.background = hex;
    };
    swatch.addEventListener("click", () => openColorPicker({
      anchor: swatch,
      color: values[f.key],
      title: f.label,
      onChange: (hex) => { set(hex); notify(f.key); },
    }));
    setters[f.key] = set;
    return h("div", { class: "field field-row" }, h("span", {}, f.label), swatch);
  }

  let input;
  if (f.type === "select") {
    input = h("select", {}, f.options.map(([v, l]) => h("option", { value: v, selected: v === f.value }, l)));
    input.addEventListener("change", () => { values[f.key] = input.value; notify(f.key); });
  } else {
    const isNum = f.type === "number";
    input = h("input", { type: isNum ? "number" : "text", min: f.min, max: f.max, step: f.step, value: f.value });
    input.addEventListener("input", () => {
      if (isNum) {
        const v = parseFloat(input.value);
        if (Number.isNaN(v)) return;
        values[f.key] = v;
      } else {
        values[f.key] = input.value;
      }
      notify(f.key);
    });
  }
  setters[f.key] = (v) => { input.value = v; };
  return h("label", { class: "field field-row" }, h("span", {}, f.label), h("span", { class: "num-wrap" }, input, unit));
}

// ---------- Custom fields ----------

const CHANNEL_COLORS = { rgb: "#e8eaf0", r: "#ff6b6b", g: "#4cd38a", b: "#4d9bff" };

function drawHistogram(ctx, hist, w, hgt, color) {
  let max = 0;
  for (let i = 0; i < 256; i++) if (hist[i] > max) max = hist[i];
  if (!max) return;
  ctx.fillStyle = color;
  const bw = w / 256;
  for (let i = 0; i < 256; i++) {
    const bh = (hist[i] / max) * hgt;
    ctx.fillRect(i * bw, hgt - bh, bw + 0.5, bh);
  }
}

export function histogramField(src) {
  return {
    type: "custom",
    create() {
      const canvas = h("canvas", { class: "hist-canvas", width: 512, height: 140 });
      drawHistogram(canvas.getContext("2d"), histogram(src), 512, 140, "rgba(232,234,240,.55)");
      return canvas;
    },
  };
}

// Curves editor: click to add a point, drag to move, drag off or double-click to remove.
export function curvesField(src) {
  const identity = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  return {
    type: "custom",
    key: "curves",
    value: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
    create({ get, set }) {
      // Start from the current value (re-editing an adjustment layer keeps its points).
      const init = get();
      const state = Object.fromEntries(["rgb", "r", "g", "b"].map((k) => [k, init?.[k]?.map(([x, y]) => ({ x, y })) ?? identity()]));
      const hists = {};
      let channel = "rgb", drag = null;

      const S = 512;
      const canvas = h("canvas", { class: "curve-canvas", width: S, height: S });
      const ctx = canvas.getContext("2d");
      const emit = () => set(Object.fromEntries(Object.entries(state).map(([k, pts]) => [k, pts.map((p) => [p.x, p.y])])));

      const draw = () => {
        ctx.clearRect(0, 0, S, S);
        drawHistogram(ctx, (hists[channel] ??= histogram(src, channel)), S, S, "rgba(255,255,255,.07)");
        ctx.strokeStyle = "rgba(255,255,255,.09)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
          ctx.moveTo((S * i) / 4, 0); ctx.lineTo((S * i) / 4, S);
          ctx.moveTo(0, (S * i) / 4); ctx.lineTo(S, (S * i) / 4);
        }
        ctx.moveTo(0, S); ctx.lineTo(S, 0);
        ctx.stroke();

        const lut = curveLUT(state[channel].map((p) => [p.x, p.y]));
        ctx.strokeStyle = CHANNEL_COLORS[channel];
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x < 256; x++) {
          const px = (x / 255) * S, py = S - (lut[x] / 255) * S;
          if (x) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
        for (const p of state[channel]) {
          ctx.beginPath();
          ctx.arc((p.x / 255) * S, S - (p.y / 255) * S, 9, 0, Math.PI * 2);
          ctx.fillStyle = p === drag ? CHANNEL_COLORS[channel] : "#161922";
          ctx.fill();
          ctx.stroke();
        }
      };

      const toCurve = (ev) => {
        const r = canvas.getBoundingClientRect();
        return { x: ((ev.clientX - r.left) / r.width) * 255, y: 255 - ((ev.clientY - r.top) / r.height) * 255 };
      };

      canvas.addEventListener("pointerdown", (ev) => {
        const pts = state[channel];
        const c = toCurve(ev);
        drag = pts.find((p) => Math.hypot(p.x - c.x, p.y - c.y) < 12);
        if (!drag) {
          const x = Math.round(clamp(c.x, 1, 254));
          if (pts.some((p) => p.x === x)) return;
          drag = { x, y: Math.round(clamp(c.y, 0, 255)) };
          pts.push(drag);
          pts.sort((a, b) => a.x - b.x);
          emit();
        }
        canvas.setPointerCapture(ev.pointerId);
        draw();
      });
      canvas.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        const pts = state[channel];
        const i = pts.indexOf(drag);
        const c = toCurve(ev);
        const endpoint = i === 0 || i === pts.length - 1;
        if (!endpoint && (c.y < -30 || c.y > 285)) {
          pts.splice(i, 1);
          drag = null;
        } else {
          const lo = i > 0 ? pts[i - 1].x + 1 : 0;
          const hi = i < pts.length - 1 ? pts[i + 1].x - 1 : 255;
          drag.x = Math.round(clamp(c.x, lo, hi));
          drag.y = Math.round(clamp(c.y, 0, 255));
        }
        emit();
        draw();
      });
      canvas.addEventListener("pointerup", () => { drag = null; draw(); });
      canvas.addEventListener("dblclick", (ev) => {
        const pts = state[channel];
        const c = toCurve(ev);
        const i = pts.findIndex((p) => Math.hypot(p.x - c.x, p.y - c.y) < 12);
        if (i > 0 && i < pts.length - 1) {
          pts.splice(i, 1);
          emit();
          draw();
        }
      });

      const select = h("select", {}, [["rgb", "RGB"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]].map(([v, l]) => h("option", { value: v }, l)));
      select.addEventListener("change", () => { channel = select.value; draw(); });
      const reset = h("button", {
        class: "btn-s", type: "button",
        onclick: () => { state[channel] = identity(); emit(); draw(); },
      }, "Reset channel");

      draw();
      return h("div", { class: "curves" },
        h("div", { class: "field-row" }, h("span", {}, "Channel"), h("span", { class: "num-wrap" }, select, reset)),
        canvas,
        h("p", { class: "field-note" }, "Click to add a point · drag to adjust · drag off the graph to remove"));
    },
  };
}

export function anchorField() {
  return {
    type: "custom",
    key: "anchor",
    value: [0.5, 0.5],
    create({ get, set }) {
      const grid = h("div", { class: "anchor-grid" });
      const render = () => {
        const [cx, cy] = get();
        grid.replaceChildren(...[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) =>
          h("button", {
            type: "button",
            class: cx === ax && cy === ay ? "on" : "",
            "aria-label": `Anchor ${ax},${ay}`,
            onclick: () => { set([ax, ay]); render(); },
          }))));
      };
      render();
      return h("div", { class: "field field-row" }, h("span", {}, "Anchor"), grid);
    },
  };
}
