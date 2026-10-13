import { h, clamp } from "./util.js";
import { BLEND_MODES } from "./doc.js";
import { MENUS, createCommands, comboFromEvent, formatKeys, ADJUSTMENT_KINDS, adjustmentLabel } from "./commands.js";
import { hasStyles } from "./styles.js";
import { PROJECT_EXTENSION } from "./project.js";
import { openColorPicker } from "./colorpicker.js";
import { buildPropertiesPanel } from "./properties.js";

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const UI_ICONS = {
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="m3 3 18 18M10.6 5.1Q11.3 5 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  merge: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  mask: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  adjust: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  fx: svg('<path d="M10 4H8.5A2.5 2.5 0 0 0 6 6.5V20M3 10h6M14 9l6 8M20 9l-6 8"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  shape: svg('<path d="M12 3 21 20H3z" fill="currentColor" stroke="none"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  lockAlpha: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z" fill="currentColor" stroke="none"/>'),
  lockPixels: svg('<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M8 13.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2.5 3 3 1.5 8 1 8.5-3.5z"/>'),
  lockPosition: svg('<path d="M12 2v20M2 12h20M12 2 9 5M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>'),
  clip: svg('<path d="M5 5h6a3 3 0 0 1 3 3v12"/><path d="m10 16 4 4 4-4"/>'),
};

const isTyping = (el) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && ["text", "number", "search", "email"].includes(el.type)) ||
  el?.isContentEditable;

export function installUI(app, tools, autosave) {
  const commands = createCommands(app, tools);
  const closeMenus = buildMenubar(app, commands);
  buildToolbar(app, tools);
  buildOptionsBar(app);
  buildPropertiesPanel(app, commands);
  buildLayersPanel(app, commands);
  buildHistoryPanel(app);
  buildPanelResizers(app);
  buildStatusBar(app);
  bindKeyboard(app, commands, tools, closeMenus);
  bindDropAndPaste(app);
  bindToasts(app);

  app.on("doc", () => {
    document.getElementById("doc-name").textContent = app.doc.name;
    document.title = `${app.doc.name} — Photocrap`;
  });
  document.getElementById("toggle-panels").addEventListener("click", () => document.body.classList.toggle("panels-open"));
  // Work is autosaved, so only warn if the latest change hasn't been written yet.
  window.addEventListener("beforeunload", (e) => {
    if (autosave.hasUnsavedChanges()) e.preventDefault();
  });
  return commands;
}

// ---------- Menubar ----------

function buildMenubar(app, commands) {
  const nav = document.getElementById("menus");
  let openMenu = null;

  const close = () => {
    openMenu?.classList.remove("open");
    openMenu = null;
  };

  const renderItem = (id) => {
    if (id === "-") return h("div", { class: "menu-sep" });
    if (id.startsWith("#")) return h("div", { class: "menu-heading" }, id.slice(1));
    const cmd = commands[id];
    const disabled = app.busy || (cmd.enabled && !cmd.enabled());
    return h("button", {
      class: "menu-item",
      type: "button",
      disabled,
      onclick: () => {
        close();
        cmd.run();
      },
    }, h("span", {}, cmd.dynamicLabel?.() ?? cmd.label), h("span", { class: "shortcut" }, formatKeys(cmd.keys)));
  };

  for (const [name, items] of MENUS) {
    const dropdown = h("div", { class: "menu-dropdown", role: "menu" });
    const title = h("button", { class: "menu-title", type: "button" }, name);
    const menu = h("div", { class: "menu" }, title, dropdown);
    const open = () => {
      close();
      openMenu = menu;
      dropdown.replaceChildren(...items.map(renderItem));
      menu.classList.add("open");
      const r = title.getBoundingClientRect();
      dropdown.style.top = `${r.bottom + 4}px`;
      dropdown.style.left = `${Math.max(8, Math.min(r.left, innerWidth - dropdown.offsetWidth - 8))}px`;
    };
    title.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (openMenu === menu) close();
      else open();
    });
    title.addEventListener("pointerenter", () => {
      if (openMenu && openMenu !== menu) open();
    });
    nav.append(menu);
  }

  document.addEventListener("pointerdown", (e) => {
    if (openMenu && !openMenu.contains(e.target)) close();
  });
  window.addEventListener("resize", close);
  return close;
}

// ---------- Toolbar ----------

// Toolbar tooltip: name and shortcut, plus the tool's description while Alt
// is held (with a hint saying so when it isn't).
function createToolTip() {
  const el = h("div", { class: "tool-tip", role: "tooltip", hidden: true });
  document.body.append(el);
  let tool = null, anchor = null, alt = false, timer = 0, more = null;

  function render() {
    el.replaceChildren(...[
      h("div", { class: "tool-tip-head" }, h("span", {}, tool.name), h("kbd", {}, tool.key)),
      alt && tool.description
        ? h("p", { class: "tool-tip-desc" }, tool.description)
        : h("p", { class: "tool-tip-hint" }, "Hold Alt for details"),
      more ? h("p", { class: "tool-tip-more" }, h("span", { class: "tool-tip-more-label" }, "Right-click or hold for"), ` ${more}`) : null,
    ].filter(Boolean));
    el.classList.toggle("expanded", alt);
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.right + 10}px`;
    const top = r.top + r.height / 2 - el.offsetHeight / 2;
    el.style.top = `${Math.max(8, Math.min(top, innerHeight - el.offsetHeight - 8))}px`;
  }

  const api = {
    // others: names of the tools sharing this button, if any.
    show(t, button, altKey, others = null) {
      more = others;
      tool = t;
      anchor = button;
      alt = altKey;
      clearTimeout(timer);
      // Appear immediately when moving between tools, after a beat otherwise.
      if (!el.hidden) render();
      else timer = setTimeout(() => { el.hidden = false; render(); }, 350);
    },
    hide() {
      clearTimeout(timer);
      el.hidden = true;
      tool = anchor = null;
    },
  };

  const setAlt = (on) => {
    alt = on;
    if (tool && !el.hidden) render();
  };
  window.addEventListener("keydown", (e) => { if (e.key === "Alt") setAlt(true); });
  window.addEventListener("keyup", (e) => { if (e.key === "Alt") setAlt(false); });
  window.addEventListener("blur", () => { setAlt(false); api.hide(); });
  return api;
}

// Related tools share one toolbar button, like Photoshop: the button shows
// the one used last, and a long press or right-click lists the others.
// Their shortcut key cycles through them.
const SHARED_SLOT = { ellipse: "marquee", wand: "quickselect", heal: "spotheal", gradient: "bucket" };

function buildToolbar(app, tools) {
  const bar = document.getElementById("toolbar");
  const tip = createToolTip();
  const slots = []; // { button, tools, current }
  let group = tools[0].group;
  for (const t of tools) {
    if (t.hidden) continue;
    if (t.group !== group) {
      bar.append(h("div", { class: "tool-sep" }));
      group = t.group;
    }
    const existing = SHARED_SLOT[t.id] && slots.find((s) => s.tools[0].id === SHARED_SLOT[t.id]);
    if (existing) {
      existing.tools.push(t);
      existing.button.classList.add("has-more");
      continue;
    }
    const slot = { tools: [t], current: t };
    let longPress = 0, suppressClick = false;
    const b = h("button", {
      class: "tool-btn",
      type: "button",
      onclick: () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        app.setTool(slot.current.id);
        b.blur();
      },
    });
    slot.button = b;
    const others = () => slot.tools.filter((t) => t !== slot.current).map((t) => t.name).join(", ") || null;
    b.addEventListener("pointerenter", (e) => tip.show(slot.current, b, e.altKey, others()));
    b.addEventListener("pointerleave", () => {
      tip.hide();
      clearTimeout(longPress);
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (slot.tools.length > 1) openFlyout(slot);
    });
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || slot.tools.length < 2) return;
      // The corner triangle itself opens the list right away.
      const r = b.getBoundingClientRect();
      if (e.clientX > r.right - 12 && e.clientY > r.bottom - 12) {
        suppressClick = true;
        openFlyout(slot);
        return;
      }
      longPress = setTimeout(() => {
        suppressClick = true;
        openFlyout(slot);
      }, 450);
    });
    b.addEventListener("pointerup", () => clearTimeout(longPress));
    slots.push(slot);
    bar.append(b);
  }

  const showSlot = (slot) => {
    const t = slot.current;
    slot.button.innerHTML = t.icon;
    slot.button.setAttribute("aria-label", `${t.name} (${t.key})${slot.tools.length > 1 ? " — right-click for more tools" : ""}`);
    slot.button.setAttribute("aria-description", t.description);
  };
  slots.forEach(showSlot);

  // The other tools of a shared button, in a little menu beside it.
  let flyout = null;
  function closeFlyout() {
    flyout?.remove();
    flyout = null;
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
  }
  const onOutside = (e) => { if (!flyout?.contains(e.target)) closeFlyout(); };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeFlyout();
  };
  function openFlyout(slot) {
    closeFlyout();
    tip.hide();
    flyout = h("div", { class: "menu-dropdown popup tool-flyout", role: "menu" },
      slot.tools.map((t) => h("button", {
        class: `menu-item${t === app.tool ? " current" : ""}`, type: "button", role: "menuitem",
        onclick: () => {
          closeFlyout();
          app.setTool(t.id);
        },
      }, h("span", { class: "flyout-icon", html: t.icon }), h("span", {}, t.name), h("span", { class: "shortcut" }, t.key))));
    document.body.append(flyout);
    const r = slot.button.getBoundingClientRect();
    flyout.style.left = `${r.right + 6}px`;
    flyout.style.top = `${Math.max(8, Math.min(r.top, innerHeight - flyout.offsetHeight - 8))}px`;
    setTimeout(() => {
      document.addEventListener("pointerdown", onOutside, true);
      window.addEventListener("keydown", onKey, true);
    });
  }

  app.on("reset-layout", () => {
    for (const slot of slots) slot.current = slot.tools.includes(app.tool) ? app.tool : slot.tools[0];
    slots.forEach(showSlot);
  });

  const pick = (which, button, title) => openColorPicker({
    anchor: button,
    color: app[which],
    title,
    onChange: (hex) => app.setColor(which, hex),
  });
  const fg = h("button", { class: "swatch fg", type: "button", title: "Foreground color", onclick: () => pick("fg", fg, "Foreground color") });
  const bg = h("button", { class: "swatch bg", type: "button", title: "Background color", onclick: () => pick("bg", bg, "Background color") });
  const swap = h("button", { class: "swatch-mini swap", type: "button", title: "Swap colors (X)", html: "⇄", onclick: () => app.swapColors() });
  const reset = h("button", { class: "swatch-mini reset", type: "button", title: "Default colors (D)", onclick: () => app.resetColors() });
  bar.append(h("div", { class: "swatches" }, bg, fg, swap, reset));
  // Quick Mask mode (Q), under the colors like Photoshop.
  const quick = h("button", {
    class: "tool-btn quick-mask-btn", type: "button", "aria-label": "Quick Mask mode (Q)", title: "Edit in Quick Mask mode (Q)",
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="4" stroke-dasharray="2 1.8"/></svg>',
    onclick: () => {
      app.toggleQuickMask();
      quick.blur();
    },
  });
  bar.append(quick);
  const syncQuick = () => {
    const on = !!app.doc?.quickMask;
    quick.classList.toggle("active", on);
    quick.title = on ? "Exit Quick Mask mode (Q)" : "Edit in Quick Mask mode (Q)";
  };
  app.on("history", syncQuick);
  app.on("doc", syncQuick);


  const syncColors = () => {
    fg.style.background = app.fg;
    bg.style.background = app.bg;
  };
  app.on("colors", syncColors);
  syncColors();
  app.on("tool", () => {
    for (const slot of slots) {
      const has = slot.tools.includes(app.tool);
      if (has && slot.current !== app.tool) {
        slot.current = app.tool;
        showSlot(slot);
      }
      slot.button.classList.toggle("active", has);
    }
  });
}

// ---------- Options bar ----------

function buildOptionsBar(app) {
  const bar = document.getElementById("optionsbar");
  let badge = null; // "quick" | "mask" | null
  const badgeFor = () => (!app.doc ? null : app.doc.quickMask ? "quick" : app.target().isMask ? "mask" : null);
  const render = () => {
    const t = app.tool;
    badge = badgeFor();
    bar.replaceChildren(
      h("div", { class: "opt-tool", html: t.icon }, h("span", {}, t.name),
        badge === "mask" ? h("span", { class: "mask-badge", title: "Painting affects the layer mask: black hides, white reveals" }, "Editing mask") : null,
        badge === "quick" ? h("span", { class: "mask-badge quick", title: "Paint white to select, black to deselect. Press Q to turn it back into a selection." }, "Quick Mask") : null),
      // Options can depend on other settings (e.g. corner radius only for rectangles).
      ...(t.options ?? []).filter((o) => !o.when || o.when(t.settings)).map((o) => renderOption(app, t, o, render)),
    );
  };
  app.on("tool", render);
  app.on("options", render);
  // Undo/redo can add or remove a mask or Quick Mask; only rebuild when the badge changes.
  const sync = () => {
    if (badgeFor() !== badge) render();
  };
  app.on("layers", sync);
  app.on("history", sync);
}

function renderOption(app, tool, o, rerender) {
  const s = tool.settings;
  const changed = () => {
    tool.optionsChanged?.(app, o.key);
    app.requestRender(false);
  };
  switch (o.type) {
    case "number": {
      const input = h("input", { type: "number", class: "num", step: o.step ?? 1, value: s[o.key] });
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (Number.isNaN(v)) { input.value = s[o.key]; return; }
        s[o.key] = v;
        changed();
      });
      return h("label", { class: "opt" }, h("span", {}, o.label), h("span", { class: "num-wrap" }, input, o.unit ? h("span", { class: "unit" }, o.unit) : null));
    }
    case "range": {
      const scale = o.scale ?? 1;
      const shown = Math.round(s[o.key] * scale);
      const range = h("input", { type: "range", min: o.min, max: o.max, step: o.step ?? 1, value: shown });
      const num = h("input", { type: "number", class: "num", min: o.min, max: o.max, step: o.step ?? 1, value: shown });
      const set = (v, from) => {
        v = clamp(v, o.min, o.max);
        s[o.key] = v / scale;
        if (from !== range) range.value = v;
        if (from !== num) num.value = v;
        changed();
      };
      range.addEventListener("input", () => set(+range.value, range));
      num.addEventListener("change", () => set(+num.value || o.min));
      return h("label", { class: "opt" }, h("span", {}, o.label), range, h("span", { class: "num-wrap" }, num, o.unit ? h("span", { class: "unit" }, o.unit) : null));
    }
    case "checkbox":
      return h("label", { class: "opt opt-check" },
        h("input", { type: "checkbox", checked: !!s[o.key], onchange: (e) => { s[o.key] = e.target.checked; changed(); rerender(); } }),
        o.label);
    case "select":
      return h("label", { class: "opt" }, h("span", {}, o.label),
        h("select", { onchange: (e) => { s[o.key] = e.target.value; changed(); } },
          o.options.map(([v, l]) => h("option", { value: v, selected: s[o.key] === v }, l))));
    case "segmented":
      // Options are [value, label] or [value, label, icon]; icons show the label as a tooltip.
      return h("div", { class: `segmented${o.options.some((x) => x[2]) ? " icons" : ""}`, role: "group" },
        o.options.map(([v, l, icon]) => h("button", {
          type: "button",
          class: s[o.key] === v ? "on" : "",
          title: icon ? l : null,
          "aria-label": icon ? l : null,
          html: icon ?? null,
          onclick: () => { s[o.key] = v; changed(); rerender(); },
        }, icon ? null : l)));
    case "color": {
      const swatch = h("button", {
        type: "button", class: "opt-swatch", title: `${o.label} color`, style: `background:${s[o.key]}`,
        onclick: () => openColorPicker({
          anchor: swatch,
          color: s[o.key],
          title: `${o.label} color`,
          onChange: (hex) => {
            s[o.key] = hex;
            swatch.style.background = hex;
            changed();
          },
        }),
      });
      return o.label ? h("label", { class: "opt" }, h("span", {}, o.label), swatch) : swatch;
    }
    case "action":
      return h("button", { type: "button", class: o.primary ? "btn-s primary" : "btn-s", onclick: () => o.run(app) }, o.label);
    case "hint":
      return h("span", { class: "opt-hint" }, o.text);
  }
  return null;
}

// ---------- Layers panel ----------

// Thumbnail of the part of a surface that lies on the canvas. `background`
// fills that area first (masks treat transparent pixels as their background).
function drawThumb(canvas, surface, doc, background = null) {
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  const s = Math.min(canvas.width / doc.width, canvas.height / doc.height);
  const w = doc.width * s, hh = doc.height * s;
  const ox = (canvas.width - w) / 2, oy = (canvas.height - hh) / 2;
  c.save();
  c.beginPath();
  c.rect(ox, oy, w, hh);
  c.clip();
  if (background) {
    c.fillStyle = background;
    c.fillRect(ox, oy, w, hh);
  }
  c.imageSmoothingQuality = "high";
  c.drawImage(surface.canvas, ox + surface.x * s, oy + surface.y * s, surface.canvas.width * s, surface.canvas.height * s);
  c.restore();
}

function buildLayersPanel(app, commands) {
  const panel = document.getElementById("layers-panel");
  const blend = h("select", { title: "Blend mode", "aria-label": "Blend mode" });
  const opacity = h("input", { type: "range", min: 0, max: 100, value: 100, "aria-label": "Layer opacity" });
  const opacityLabel = h("span", { class: "op-val" }, "100%");
  const list = h("ul", { class: "layer-list" });

  const action = (iconHtml, title, id, onclick) => {
    const b = h("button", {
      class: "icon-btn", type: "button", title, "aria-label": title, html: iconHtml,
      onclick: onclick ?? (() => !app.busy && commands[id].run()),
    });
    if (id) b.dataset.cmd = id;
    return b;
  };

  // Adjustment-layer picker: a small menu above the button.
  const adjustButton = action(UI_ICONS.adjust, "New adjustment layer", null, () => {
    if (app.busy) return;
    const menu = h("div", { class: "menu-dropdown popup", role: "menu" },
      h("div", { class: "menu-heading" }, "New adjustment layer"),
      ADJUSTMENT_KINDS.map((kind) => h("button", {
        class: "menu-item", type: "button",
        onclick: () => { close(); commands[`adj.${kind}`].run(); },
      }, h("span", {}, commands[`adj.${kind}`].label))));
    document.body.append(menu);
    const r = adjustButton.getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${r.top - menu.offsetHeight - 6}px`;
    const onDown = (e) => { if (!menu.contains(e.target)) close(); };
    function close() {
      menu.remove();
      document.removeEventListener("pointerdown", onDown, true);
    }
    setTimeout(() => document.addEventListener("pointerdown", onDown, true));
  });

  const actions = h("div", { class: "panel-actions" },
    action(UI_ICONS.up, "Bring forward", "layer.up"),
    action(UI_ICONS.down, "Send backward", "layer.down"),
    action(UI_ICONS.merge, "Merge down", "layer.mergeDown"),
    h("span", { class: "spacer" }),
    action(UI_ICONS.fx, "Layer style", "layer.style"),
    adjustButton,
    action(UI_ICONS.mask, "Add layer mask (reveals the selection if there is one)", "mask.add"),
    action(UI_ICONS.folder, "New group", "layer.newGroup"),
    action(UI_ICONS.plus, "New layer", "layer.new"),
    action(UI_ICONS.duplicate, "Duplicate", "layer.duplicate"),
    action(UI_ICONS.trash, "Delete", "layer.delete"));

  // Lock buttons: transparent pixels, image pixels, position, everything.
  const lockButton = (kind, icon, title) => h("button", {
    class: "icon-btn lock-btn", type: "button", title, "aria-label": title, "aria-pressed": "false",
    "data-lock": kind, html: icon,
    onclick: () => app.toggleLock(app.doc.activeLayer, kind),
  });
  const locks = h("div", { class: "layer-locks" },
    h("span", { class: "locks-label" }, "Lock"),
    lockButton("transparency", UI_ICONS.lockAlpha, "Lock transparent pixels — paint only where the layer already has pixels"),
    lockButton("pixels", UI_ICONS.lockPixels, "Lock image pixels — no painting or editing"),
    lockButton("position", UI_ICONS.lockPosition, "Lock position — can't be moved"),
    lockButton("all", UI_ICONS.lock, "Lock all (Ctrl+/)"));

  panel.append(
    h("div", { class: "panel-head" }, "Layers"),
    h("div", { class: "layer-props" }, blend, h("label", { class: "opacity" }, opacity, opacityLabel)),
    locks,
    list,
    actions);

  blend.addEventListener("change", () => app.setLayerProps(app.doc.activeLayer, { blend: blend.value }, "Blend Mode"));

  // The slider previews live and becomes one history entry when released.
  let editingOpacity = false;
  opacity.addEventListener("input", () => {
    if (!editingOpacity) {
      if (app.busy) return;
      app.history.begin("Layer Opacity");
      editingOpacity = true;
    }
    app.doc.activeLayer.opacity = opacity.value / 100;
    opacityLabel.textContent = `${opacity.value}%`;
    app.requestRender();
  });
  opacity.addEventListener("change", () => {
    if (!editingOpacity) return;
    editingOpacity = false;
    app.history.commit();
  });

  let dragNode = null;

  function maskThumbFor(layer, active) {
    if (!layer.mask) return null;
    const canvas = h("canvas", { class: "layer-thumb mask-thumb", width: 88, height: 64 });
    drawThumb(canvas, layer.mask, app.doc, layer.mask.background ? "#ffffff" : "#000000");
    return h("span", {
      class: [
        "mask-wrap",
        active && (layer.editMask || layer.adjustment) ? "targeted" : "",
        layer.mask.enabled ? "" : "disabled",
        app.viewMask === layer ? "viewing" : "",
      ].filter(Boolean).join(" "),
      title: "Mask — click to edit · Shift+click to disable · Alt+click to view alone · Ctrl+click to load as selection",
      onclick: (e) => {
        e.stopPropagation();
        if (e.shiftKey) app.toggleMaskEnabled(layer);
        else if (e.altKey) app.toggleMaskView(layer);
        else if (e.ctrlKey || e.metaKey) app.selectionFromMask(layer);
        else app.setEditTarget(layer, true);
      },
    }, canvas);
  }

  // The main thumbnail: a folder for groups, an icon for adjustment layers,
  // otherwise the layer's pixels (with a "T" badge for type).
  function thumbFor(layer, active) {
    if (layer.isGroup) {
      return h("span", {
        class: `layer-icon${active && layer.mask && !layer.editMask ? " targeted" : ""}`, html: UI_ICONS.folder,
        onclick: (e) => {
          if (!layer.mask) return;
          e.stopPropagation();
          app.setEditTarget(layer, false);
        },
      });
    }
    if (layer.adjustment) {
      return h("span", {
        class: "layer-icon adjust", html: UI_ICONS.adjust,
        title: `${adjustmentLabel(layer.adjustment.kind)} — double-click to edit`,
        ondblclick: (e) => {
          e.stopPropagation();
          app.setActiveLayer(layer);
          commands["layer.editAdjustment"].run();
        },
      });
    }
    const thumb = h("canvas", {
      class: `layer-thumb${active && layer.mask && !layer.editMask ? " targeted" : ""}`,
      width: 88, height: 64,
      title: layer.mask ? "Layer pixels — click to edit" : null,
      onclick: (e) => {
        if (!layer.mask) return;
        e.stopPropagation();
        app.setEditTarget(layer, false);
      },
    });
    drawThumb(thumb, layer, app.doc);
    if (layer.shape) {
      // Shape layers get a badge; double-clicking selects the Pen tool to edit the path.
      return h("span", {
        class: "thumb-wrap", title: "Shape layer — double-click to edit its path with the Pen tool",
        ondblclick: (e) => {
          e.stopPropagation();
          app.setActiveLayer(layer);
          app.setTool("pen");
        },
      }, thumb, h("span", { class: "type-badge shape-badge", html: UI_ICONS.shape }));
    }
    if (!layer.text) return thumb;
    // Type layers get a "T" badge; double-clicking the thumbnail edits the text.
    return h("span", {
      class: "thumb-wrap", title: "Type layer — double-click to edit the text",
      ondblclick: (e) => {
        e.stopPropagation();
        app.editText(layer);
      },
    }, thumb, h("span", { class: "type-badge" }, "T"));
  }

  function startRename(layer, li, name) {
    const input = h("input", { type: "text", value: layer.name, "aria-label": "Layer name" });
    li.draggable = false;
    name.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value && value !== layer.name) app.setLayerProps(layer, { name: value }, "Rename Layer");
      else render();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (ev) => ev.stopPropagation());
  }

  // Where a drop lands relative to a row: above/below it, or into a group.
  function dropZone(li, node, e) {
    const r = li.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (node.isGroup && t > 0.3 && t < 0.7) return "into";
    return t < 0.5 ? "above" : "below";
  }

  function row(layer, active, depth) {
    const name = h("span", { class: "layer-name" }, layer.name);
    const metaText = [
      layer.adjustment ? adjustmentLabel(layer.adjustment.kind) : null,
      layer.blend !== "source-over" && layer.blend !== "pass-through" ? BLEND_MODES.find(([v]) => v === layer.blend)?.[1] : null,
      layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : null,
    ].filter(Boolean).join(" · ");
    const eye = h("button", {
      class: "icon-btn eye", type: "button",
      title: layer.visible ? "Hide" : "Show",
      html: layer.visible ? UI_ICONS.eye : UI_ICONS.eyeOff,
      onclick: (e) => {
        e.stopPropagation();
        app.toggleVisibility(layer);
      },
    });
    const twisty = layer.isGroup
      ? h("button", {
        class: `icon-btn twisty${layer.expanded ? " open" : ""}`, type: "button",
        title: layer.expanded ? "Collapse group" : "Expand group", html: UI_ICONS.chevron,
        onclick: (e) => {
          e.stopPropagation();
          app.toggleExpanded(layer);
        },
      })
      : h("span", { class: "twisty-space" });
    const fx = hasStyles(layer.styles)
      ? h("button", {
        class: "fx-badge", type: "button", title: "Layer style — click to edit",
        onclick: (e) => {
          e.stopPropagation();
          app.setActiveLayer(layer);
          commands["layer.style"].run();
        },
      }, "fx")
      : null;
    // Clipping: clipped layers get an arrow pointing down at their base,
    // whose name is underlined (as in Photoshop).
    const siblings = app.doc.siblingsOf(layer), index = siblings.indexOf(layer);
    const isClipped = layer.clipped && index > 0;
    const isBase = !isClipped && !!siblings[index + 1]?.clipped && !layer.adjustment;
    const clipMark = isClipped ? h("span", { class: "clip-mark", title: `Clipped to “${app.clipBase(layer)?.name}”`, html: UI_ICONS.clip }) : null;
    if (isBase) name.classList.add("clip-base");
    const lk = layer.locks;
    const lockMark = lk
      ? h("span", {
        class: `lock-mark${lk.transparency && lk.pixels && lk.position ? " full" : ""}`,
        title: `Locked: ${[lk.transparency && "transparency", lk.pixels && "pixels", lk.position && "position"].filter(Boolean).join(", ")}`,
        html: UI_ICONS.lock,
      })
      : null;
    const li = h("li", {
      class: `layer-row${active ? " active" : ""}${app.doc.isVisible(layer) ? "" : " is-hidden"}${layer.isGroup ? " group" : ""}${isClipped ? " clipped" : ""}`,
      style: `padding-left:${6 + depth * 16}px`,
      draggable: "true",
      title: index > 0 || layer.clipped ? "Alt+click to clip to the layer below (or release)" : null,
      onclick: (e) => {
        app.setActiveLayer(layer);
        if (e.altKey) app.toggleClipping(layer);
      },
    }, eye, twisty, clipMark, thumbFor(layer, active), maskThumbFor(layer, active),
    h("div", { class: "layer-text" }, name, metaText ? h("span", { class: "layer-meta" }, metaText) : null), fx, lockMark);

    li.addEventListener("dblclick", (e) => {
      if (e.target.closest(".eye, .twisty, .fx-badge") || app.busy) return;
      startRename(layer, li, name);
    });

    li.addEventListener("dragstart", (e) => {
      dragNode = layer;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", layer.name);
    });
    li.addEventListener("dragend", () => { dragNode = null; });
    li.addEventListener("dragover", (e) => {
      if (!dragNode || dragNode === layer) return;
      e.preventDefault();
      const zone = dropZone(li, layer, e);
      li.classList.toggle("drop-above", zone === "above");
      li.classList.toggle("drop-below", zone === "below");
      li.classList.toggle("drop-into", zone === "into");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-above", "drop-below", "drop-into"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drop-above", "drop-below", "drop-into");
      if (!dragNode || dragNode === layer || app.busy) return;
      const doc = app.doc, zone = dropZone(li, layer, e);
      const moving = dragNode;
      dragNode = null;
      // "Above" in the list means higher in the stack (a later index).
      if (zone === "into") app.moveNode(moving, layer, layer.layers.length);
      else {
        const siblings = doc.siblingsOf(layer);
        const i = siblings.indexOf(layer);
        app.moveNode(moving, doc.parentOf(layer), zone === "above" ? i + 1 : i);
      }
    });
    return li;
  }

  // Top of the stack first; children of expanded groups indented below them.
  function rows(nodes, active, depth, out = []) {
    for (const node of [...nodes].reverse()) {
      out.push(row(node, node === active, depth));
      if (node.isGroup && node.expanded) rows(node.layers, active, depth + 1, out);
    }
    return out;
  }

  function render() {
    const doc = app.doc;
    if (!doc) return;
    const active = doc.activeLayer;
    const modes = active.isGroup ? [["pass-through", "Pass Through"], ...BLEND_MODES] : BLEND_MODES;
    blend.replaceChildren(...modes.map(([v, l]) => h("option", { value: v }, l)));
    blend.value = active.blend;
    if (!editingOpacity) {
      opacity.value = Math.round(active.opacity * 100);
      opacityLabel.textContent = `${opacity.value}%`;
    }
    list.replaceChildren(...rows(doc.layers, active, 0));
    const l = active.locks ?? {};
    const on = { ...l, all: !!(l.transparency && l.pixels && l.position) };
    for (const b of locks.querySelectorAll("[data-lock]")) {
      b.classList.toggle("on", !!on[b.dataset.lock]);
      b.setAttribute("aria-pressed", String(!!on[b.dataset.lock]));
    }
    for (const b of actions.querySelectorAll("[data-cmd]")) {
      const cmd = commands[b.dataset.cmd];
      b.disabled = cmd.enabled ? !cmd.enabled() : false;
    }
  }

  app.on("layers", render);
  app.on("doc", render);
}

// ---------- Resizable panels ----------

// Drag the side column's left edge to change its width, the line between
// Layers and History to share the height, the toolbar's right edge to lay
// the tools out in 1–3 columns, and the options bar's bottom edge to give
// its controls more rows. Double-click any handle to reset. Remembered
// across visits.
const PANELS_KEY = "photocrap:panels";
const TOOL_W = 36, TOOL_GAP = 2, TOOLBAR_PAD = 12;
const toolbarWidth = (cols) => TOOLBAR_PAD + cols * TOOL_W + (cols - 1) * TOOL_GAP;
const OPTIONS_H = 44, OPTIONS_MIN = 34, OPTIONS_MAX = 160, OPTIONS_WRAP = 64;
const TOOLBAR_FOLDED = 18, OPTIONS_FOLDED = 14;

function buildPanelResizers(app) {
  const appEl = document.querySelector(".app");
  const main = document.querySelector(".main");
  const panels = document.getElementById("panels");
  const layers = document.getElementById("layers-panel");
  const history = document.getElementById("history-panel");
  const properties = document.getElementById("properties-panel");
  const toolbar = document.getElementById("toolbar");
  const optionsbar = document.getElementById("optionsbar");
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PANELS_KEY)) ?? {}; } catch { /* nothing saved */ }
  const save = () => {
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
  };
  const setVar = (name, px) => {
    if (px) root.style.setProperty(name, `${px}px`);
    else root.style.removeProperty(name);
  };

  const applyWidth = () => setVar("--panels-w", saved.width);
  // History keeps a fixed share; Layers takes the rest.
  const applySplit = () => {
    if (saved.layers && !saved.collapsed?.layers && !saved.collapsed?.history) {
      const max = Math.max(120, panels.clientHeight - 90);
      layers.style.flex = `0 0 ${Math.min(saved.layers, max)}px`;
      history.style.flex = "1 1 0";
    } else {
      layers.style.flex = history.style.flex = "";
    }
  };
  // autoCols: when one column of tools doesn't fit the window's height, the
  // toolbar adds columns on its own (not saved), so it doesn't need to scroll.
  let autoCols = 1;
  const applyToolCols = () => {
    const folded = !!saved.collapsed?.toolbar;
    const cols = saved.toolCols ?? autoCols;
    setVar("--toolbar-w", folded ? TOOLBAR_FOLDED : cols > 1 ? toolbarWidth(cols) : 0);
    toolbar.style.setProperty("--tool-cols", cols);
    toolbar.classList.toggle("multi", cols > 1 && !folded);
    toolbar.classList.toggle("folded", folded);
    toolHandle.hidden = folded;
    toolToggle.title = folded ? "Show the toolbar (Shift+Tab)" : "Hide the toolbar (Shift+Tab)";
    toolToggle.setAttribute("aria-expanded", String(!folded));
  };
  // The fewest columns (up to 3) that fit, found by laying the toolbar out
  // each way for a moment (nothing is painted in between).
  const fitToolbar = () => {
    if (saved.toolCols || saved.collapsed?.toolbar) return;
    const multi = toolbar.classList.contains("multi"), cols = toolbar.style.getPropertyValue("--tool-cols");
    let need = 3;
    for (let c = 1; c <= 3; c++) {
      toolbar.classList.toggle("multi", c > 1);
      toolbar.style.setProperty("--tool-cols", c);
      if (toolbar.scrollHeight <= toolbar.clientHeight + 1) {
        need = c;
        break;
      }
    }
    toolbar.classList.toggle("multi", multi);
    toolbar.style.setProperty("--tool-cols", cols);
    if (autoCols !== need) {
      autoCols = need;
      applyToolCols();
    }
  };
  // Tall enough for a second row: controls wrap instead of scrolling sideways.
  const applyOptionsHeight = () => {
    const folded = !!saved.collapsed?.options;
    setVar("--options-h", folded ? OPTIONS_FOLDED : saved.optionsH);
    optionsbar.classList.toggle("wrap", !folded && (saved.optionsH ?? OPTIONS_H) >= OPTIONS_WRAP);
    optionsbar.inert = folded;
    document.body.classList.toggle("options-folded", folded);
    optionsHandle.hidden = folded;
    optionsToggle.title = folded ? "Show the options bar" : "Hide the options bar";
    optionsToggle.setAttribute("aria-expanded", String(!folded));
  };

  function handle(cls, axis, title, onMove, onReset) {
    const el = h("div", { class: cls, title: `${title} · double-click to reset`, role: "separator", "aria-orientation": axis === "cols" ? "vertical" : "horizontal" });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      el.classList.add("dragging");
      document.body.classList.add("resizing-panels", axis);
      el.onpointermove = (ev) => onMove(ev);
      el.onpointerup = el.onpointercancel = () => {
        el.onpointermove = el.onpointerup = el.onpointercancel = null;
        el.classList.remove("dragging");
        document.body.classList.remove("resizing-panels", axis);
        save();
      };
    });
    el.addEventListener("dblclick", () => {
      onReset();
      save();
    });
    return el;
  }

  const widthHandle = handle("panels-resizer", "cols", "Drag to resize the panels", (ev) => {
    saved.width = Math.round(clamp(panels.getBoundingClientRect().right - ev.clientX, 220, Math.min(560, innerWidth * 0.5)));
    applyWidth();
  }, () => { delete saved.width; applyWidth(); });

  const divider = handle("panel-divider", "rows", "Drag to resize", (ev) => {
    saved.layers = Math.round(clamp(ev.clientY - layers.getBoundingClientRect().top, 120, panels.clientHeight - 90));
    applySplit();
  }, () => { delete saved.layers; applySplit(); });

  // Snaps to whole columns of tool buttons.
  const toolHandle = handle("toolbar-resizer", "cols", "Drag to show the tools in more columns", (ev) => {
    const w = ev.clientX - toolbar.getBoundingClientRect().left;
    const cols = clamp(Math.round((w - TOOLBAR_PAD + TOOL_GAP) / (TOOL_W + TOOL_GAP)), 1, 3);
    if (cols > 1) saved.toolCols = cols;
    else delete saved.toolCols;
    applyToolCols();
    fitToolbar();
  }, () => { delete saved.toolCols; applyToolCols(); fitToolbar(); });

  const optionsHandle = handle("optionsbar-resizer", "rows", "Drag to resize the options bar", (ev) => {
    const hgt = Math.round(clamp(ev.clientY - optionsbar.getBoundingClientRect().top, OPTIONS_MIN, OPTIONS_MAX));
    if (Math.abs(hgt - OPTIONS_H) < 4) delete saved.optionsH; // snap to the default
    else saved.optionsH = hgt;
    applyOptionsHeight();
  }, () => { delete saved.optionsH; applyOptionsHeight(); });

  // ---- Collapsing ----
  // Click a panel's title to fold it down to just the title; the other one
  // takes the space. The column's collapse button (or Tab) folds the whole
  // column into a slim strip; click a name there to bring it back.
  saved.collapsed ??= {};
  const col = saved.collapsed;
  const narrow = matchMedia("(max-width: 900px)"); // the column is a slide-over there
  const panelHeads = [];
  const applyCollapsed = () => {
    for (const [panel, key, head] of panelHeads) {
      panel.classList.toggle("collapsed", !!col[key]);
      head.setAttribute("aria-expanded", String(!col[key]));
    }
    divider.hidden = !!(col.layers || col.history);
    document.body.classList.toggle("panels-collapsed", !!col.column);
    applySplit();
  };
  const setColumn = (collapsed) => {
    if (narrow.matches) {
      document.body.classList.toggle("panels-open", !collapsed);
      return;
    }
    if (collapsed) col.column = true;
    else delete col.column;
    applyCollapsed();
    save();
  };
  const togglePanel = (key) => {
    if (col[key]) delete col[key];
    else col[key] = true;
    applyCollapsed();
    save();
  };

  for (const [panel, key] of [[properties, "properties"], [layers, "layers"], [history, "history"]]) {
    const head = panel.querySelector(".panel-head");
    head.classList.add("collapsible");
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.title = "Click to collapse or expand";
    head.prepend(h("span", { class: "panel-chev", html: UI_ICONS.chevron }));
    head.addEventListener("click", (e) => {
      if (!e.target.closest(".panel-head-btn")) togglePanel(key);
    });
    head.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      togglePanel(key);
    });
    panelHeads.push([panel, key, head]);
  }
  properties.querySelector(".panel-head").append(h("button", {
    class: "icon-btn panel-head-btn", type: "button", title: "Collapse panels (Tab)", "aria-label": "Collapse panels",
    html: UI_ICONS.chevron, onclick: () => setColumn(true),
  }));

  const stripItem = (key, label) => h("button", {
    class: "strip-item", type: "button", title: `Show ${label}`,
    onclick: () => {
      delete col[key];
      setColumn(false);
    },
  }, label);
  const strip = h("div", { class: "panels-strip" },
    h("button", { class: "icon-btn strip-expand", type: "button", title: "Expand panels (Tab)", "aria-label": "Expand panels", html: UI_ICONS.chevron, onclick: () => setColumn(false) }),
    stripItem("properties", "Properties"), stripItem("layers", "Layers"), stripItem("history", "History"));

  // The toolbar folds to a thin strip; tool shortcuts keep working.
  const setToolbar = (folded) => {
    if (folded) col.toolbar = true;
    else delete col.toolbar;
    applyToolCols();
    save();
  };
  const toolToggle = h("button", {
    class: "toolbar-toggle", type: "button", "aria-label": "Show or hide the toolbar",
    html: UI_ICONS.chevron, onclick: () => setToolbar(!col.toolbar),
  });
  toolbar.prepend(toolToggle);
  app.on("toggle-toolbar", () => setToolbar(!col.toolbar));
  app.on("toggle-properties", () => {
    if (col.column) setColumn(false);
    togglePanel("properties");
  });

  // The options bar folds to a thin strip; click the strip to bring it back.
  // The button lives outside the bar, which re-renders for every tool.
  const setOptions = (folded) => {
    if (folded) col.options = true;
    else delete col.options;
    applyOptionsHeight();
    save();
  };
  const optionsToggle = h("button", {
    class: "optionsbar-toggle", type: "button", "aria-label": "Show or hide the options bar",
    html: UI_ICONS.chevron, onclick: () => setOptions(!col.options),
  });
  appEl.append(optionsToggle);
  app.on("toggle-options", () => setOptions(!col.options));

  app.on("toggle-panels", () => setColumn(narrow.matches ? document.body.classList.contains("panels-open") : !col.column));
  // Tab (panels) and Shift+Tab (toolbar) like Photoshop, but only when
  // nothing has focus so keyboard navigation between controls still works.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    if (document.querySelector(".modal-backdrop") || app.busy) return;
    e.preventDefault();
    app.emit(e.shiftKey ? "toggle-toolbar" : "toggle-panels");
  });

  panels.append(strip);
  panels.prepend(widthHandle);
  panels.insertBefore(divider, history);
  applyCollapsed();
  // These live outside their bars, which scroll and would carry them along.
  main.append(toolHandle);
  appEl.append(optionsHandle);
  applyWidth();
  applySplit();
  applyToolCols();
  applyOptionsHeight();
  window.addEventListener("resize", applySplit);
  new ResizeObserver(() => fitToolbar()).observe(toolbar);
  fitToolbar();

  // View › Reset Layout: everything back to how it ships.
  app.on("reset-layout", () => {
    for (const k of Object.keys(saved)) if (k !== "collapsed") delete saved[k];
    for (const k of Object.keys(col)) delete col[k];
    autoCols = 1;
    document.body.classList.remove("panels-open");
    applyWidth();
    applyCollapsed();
    applyToolCols();
    applyOptionsHeight();
    save();
    fitToolbar();
  });
}

// ---------- History panel ----------

function buildHistoryPanel(app) {
  const panel = document.getElementById("history-panel");
  const list = h("ul", { class: "history-list" });
  panel.append(h("div", { class: "panel-head" }, "History"), list);
  app.on("history", () => {
    const { entries, index } = app.history;
    list.replaceChildren(...entries.map((entry, i) => h("li", {
      class: `history-item${i === index ? " current" : ""}${i > index ? " future" : ""}`,
      onclick: () => { if (!app.busy) app.history.jumpTo(i); },
    }, entry.label)));
    // Scroll only the list itself; scrollIntoView would also scroll the page
    // when the panel is slid off-screen on small displays.
    const cur = list.querySelector(".current");
    if (cur) {
      if (cur.offsetTop < list.scrollTop) list.scrollTop = cur.offsetTop;
      else if (cur.offsetTop + cur.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = cur.offsetTop + cur.offsetHeight - list.clientHeight;
      }
    }
  });
}

// ---------- Status bar ----------

function buildStatusBar(app) {
  const bar = document.getElementById("statusbar");
  const zoom = h("button", { class: "status-zoom", type: "button", title: "Fit on screen", onclick: () => app.fit() });
  const size = h("span");
  const pos = h("span", { class: "status-pos" });
  const working = h("span", { class: "status-working", hidden: true }, h("span", { class: "spinner" }), "Working…");
  const saved = h("span", { class: "status-saved" });
  const hint = h("span", { class: "status-hint" }, "Space to pan · Ctrl+scroll to zoom · ? for shortcuts");
  bar.append(zoom, size, pos, working, hint, saved);
  app.on("working", (on) => {
    working.hidden = !on;
    document.body.classList.toggle("is-working", on);
  });
  app.on("autosave", (state) => {
    saved.textContent = { saving: "Saving…", saved: "All changes saved", failed: "Autosave failed" }[state];
    saved.classList.toggle("failed", state === "failed");
  });
  const update = () => {
    zoom.textContent = `${+(app.view.zoom * 100).toFixed(1)}%`;
    if (app.doc) size.textContent = `${app.doc.width} × ${app.doc.height} px`;
  };
  app.on("view", update);
  app.on("history", update);
  app.on("doc", update);
  app.on("pointer", (p) => {
    pos.textContent = p ? `X ${Math.floor(p.x)}   Y ${Math.floor(p.y)}` : "";
  });
}

// ---------- Keyboard ----------

function stepSize(size, dir) {
  const step = size < 10 ? 1 : size < 50 ? 5 : size < 100 ? 10 : 25;
  return clamp(size + dir * step, 1, 500);
}

function bindKeyboard(app, commands, tools, closeMenus) {
  const byCombo = new Map();
  for (const cmd of Object.values(commands)) {
    if (cmd.noBind) continue;
    for (const k of [cmd.keys, ...(cmd.alt ?? [])]) if (k) byCombo.set(k, cmd);
  }

  // Holding Alt in a paint tool borrows the eyedropper until Alt is released.
  const PICK_WITH_ALT = ["brush", "bucket", "gradient"];
  let borrowedFrom = null;
  const returnTool = () => {
    if (!borrowedFrom) return;
    if (app.gesture) return; // finish the current pick first; see "gestureend"
    const id = borrowedFrom;
    borrowedFrom = null;
    app.temporaryTool = false;
    if (app.tool.id === "eyedropper") app.setTool(id);
  };
  app.on("gestureend", () => {
    if (borrowedFrom && !altDown) returnTool();
  });
  let altDown = false;

  window.addEventListener("keydown", (ev) => {
    if (isTyping(ev.target)) return;
    const dialog = document.querySelector(".modal-backdrop");
    if (dialog) {
      // Floating (preview) dialogs still allow looking around the image.
      if (!dialog.classList.contains("floating")) return;
      if (ev.code === "Space") {
        ev.preventDefault();
        if (!ev.repeat) app.setSpace(true);
        return;
      }
      const viewCmd = byCombo.get(comboFromEvent(ev));
      if (viewCmd && Object.entries(commands).some(([id, c]) => c === viewCmd && id.startsWith("view."))) {
        ev.preventDefault();
        viewCmd.run();
      }
      return;
    }
    if (ev.key === "Escape") {
      closeMenus();
      if (app.gesture) {
        ev.preventDefault();
        app.cancelGesture();
        return;
      }
    }

    if (ev.key === "Alt") {
      ev.preventDefault(); // keep the browser menu bar from grabbing focus
      altDown = true;
      // Not while hovering the toolbar: there Alt reveals tool descriptions.
      const overToolbar = document.getElementById("toolbar").matches(":hover");
      if (!ev.repeat && !ev.ctrlKey && !app.gesture && !overToolbar && PICK_WITH_ALT.includes(app.tool.id)) {
        borrowedFrom = app.tool.id;
        app.temporaryTool = true;
        app.setTool("eyedropper");
      }
      return;
    }

    if (ev.code === "Space") {
      ev.preventDefault();
      if (!ev.repeat) app.setSpace(true);
      return;
    }
    if (app.tool.keydown?.(app, ev)) {
      ev.preventDefault();
      return;
    }

    const cmd = byCombo.get(comboFromEvent(ev));
    if (cmd) {
      ev.preventDefault();
      closeMenus();
      if (borrowedFrom) { // an Alt shortcut, not an eyedropper pick
        altDown = false;
        returnTool();
      }
      if (!app.busy && cmd.enabled?.() !== false) cmd.run();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || app.busy) return;

    const s = app.tool.settings;
    const k = ev.key;
    if (ev.code.startsWith("Key")) {
      const letter = ev.code.slice(3);
      if (letter === "X") return app.swapColors();
      if (letter === "D") return app.resetColors();
      const group = tools.filter((t) => t.key === letter && !t.hidden);
      if (group.length) {
        const i = group.indexOf(app.tool);
        app.setTool(group[(i + 1) % group.length].id); // repeat the key to cycle (M, G)
        ev.preventDefault();
      }
    } else if ((k === "[" || k === "]") && s.size != null) {
      s.size = stepSize(s.size, k === "]" ? 1 : -1);
    } else if ((k === "{" || k === "}") && s.hardness != null) {
      s.hardness = clamp(Math.round((s.hardness + (k === "}" ? 0.25 : -0.25)) * 100) / 100, 0, 1);
    } else if (/^[0-9]$/.test(k) && s.opacity != null) {
      s.opacity = k === "0" ? 1 : +k / 10;
    } else if (k.startsWith("Arrow") && app.tool.nudge) {
      ev.preventDefault();
      const d = ev.shiftKey ? 10 : 1;
      const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
      app.tool.nudge(app, dx, dy);
      return;
    } else {
      return;
    }
    app.emit("options");
    app.requestRender(false);
  });

  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") {
      if (!isTyping(ev.target)) ev.preventDefault();
      app.setSpace(false);
    }
    if (ev.key === "Alt") {
      ev.preventDefault();
      altDown = false;
      returnTool();
    }
  });
  window.addEventListener("blur", () => {
    app.setSpace(false);
    altDown = false;
    returnTool();
    app.clipboardFresh = false; // the system clipboard may change while we're away
  });
}

// ---------- Drag & drop, paste ----------

function bindDropAndPaste(app) {
  const ws = app.workspace;
  const hint = h("div", { class: "drop-hint", hidden: true }, "Drop to add as a new layer");
  ws.append(hint);
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types.includes("Files");

  ws.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    hint.hidden = false;
  });
  ws.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) hint.hidden = true;
  });
  ws.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  ws.addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    hint.hidden = true;
    if (app.busy) return;
    const files = [...e.dataTransfer.files];
    const project = files.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXTENSION));
    if (project) {
      if (app.history.entries.length <= 1 || confirm("Discard your changes to the current image?")) {
        app.openFile(project, project.name).catch(() => app.toast(`Couldn't open ${project.name}.`));
      }
      return;
    }
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const file of images) {
      try {
        await app.placeFile(file, file.name);
      } catch {
        app.toast(`Couldn't open ${file.name}.`);
      }
    }
    if (images.length === 1) app.beginTransform(); // position it straight away
  });
  // Keep the browser from navigating to files dropped outside the workspace.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  document.addEventListener("paste", (e) => {
    if (isTyping(e.target) || document.querySelector(".modal-backdrop") || app.busy) return;
    e.preventDefault();
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file && !app.clipboardFresh) app.placeFile(file, "Pasted Layer", "Paste");
    else if (app.pasteInternal()) return;
    else if (file) app.placeFile(file, "Pasted Layer", "Paste");
    else app.toast("Nothing to paste.");
  });
}

function bindToasts(app) {
  const box = document.getElementById("toasts");
  app.on("toast", (message) => {
    const t = h("div", { class: "toast", role: "status" }, message);
    box.append(t);
    setTimeout(() => t.remove(), 2800);
  });
}
