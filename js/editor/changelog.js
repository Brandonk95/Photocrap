// Release notes, newest first. When shipping a user-visible change, add an
// entry at the top and bump the version (major.minor.patch); returning users
// see everything newer than the last version they opened, once.

import { openDialog } from "./dialogs.js";
import { h } from "./util.js";
import { kvGet } from "../storage.js";

export const CHANGELOG = [
  {
    version: "0.13.1",
    title: "Fast adjustment layers",
    notes: [
      "Adjustment layers (Curves, Levels, Hue/Saturation and the rest) now run on the graphics card. Images with adjustment layers no longer lag while you paint, move layers or drag a curve — even on large photos.",
      "Selecting an adjustment layer no longer stalls while its histogram is drawn, and the histogram now shows the image under the adjustment, as intended.",
    ],
  },
  {
    version: "0.13.0",
    title: "A much better Shape tool",
    notes: [
      "More shapes: triangle, star, arrow, heart and speech bubble join rectangle, ellipse, polygon and line, picked from icons in the options bar.",
      "Shapes stay live: change a rectangle's corners, a polygon's sides or a star's points and indent at any time, from the options bar or the Properties panel — even after moving, resizing, rotating or flipping it.",
      "Edit on the canvas: the selected shape shows handles to resize it, and rectangles get a corner widget to drag their roundness.",
      "Click without dragging to create a shape at an exact size.",
      "Dashed and dotted strokes, and arrowheads on lines.",
      "Flip Layer keeps shape layers as editable shapes instead of turning them into pixels.",
      "Toolbar buttons that hold more tools have a clearer corner triangle — click it, right-click the button or press and hold — and their tooltip lists the tools inside.",
    ],
  },
  {
    version: "0.12.0",
    title: "Smart guides and locked guides",
    notes: [
      "Smart guides: when you move a layer (or draw a marquee or shape), it snaps to the edges and centers of the other layers, and a pink line shows what it lined up with. View › Turn Smart Guides Off to disable.",
      "View › Lock Guides (Ctrl+Alt+;) keeps guides from being moved or deleted by accident. New guides can still be dragged out of the rulers.",
    ],
  },
  {
    version: "0.11.1",
    title: "Tidier toolbar, one-click layout reset",
    notes: [
      "Related tools now share a toolbar button, like Photoshop: the marquees, Quick Selection and Magic Wand, the healing brushes, and Paint Bucket and Gradient. Right-click or press and hold a button with a small triangle to pick another; its shortcut key still cycles through them.",
      "The toolbar no longer scrolls: if the window is too short for one column it switches to two by itself.",
      "View › Reset Layout to Default puts panels, the toolbar, the options bar, dialog positions and rulers/guides/snapping back the way they started.",
    ],
  },
  {
    version: "0.11.0",
    title: "Rulers, guides, snapping and a Properties panel",
    notes: [
      "Rulers along the top and left of the canvas (View › Show Rulers, Ctrl+R) show where your pointer is in pixels.",
      "Drag from a ruler to make a guide. Drag a guide with the Move tool (or Ctrl with any tool) to move it, or back onto the ruler to remove it. View › New Guide… places one exactly.",
      "Snapping: moving layers, marquees, crops, shapes and Free Transform snap to guides and to the canvas edges and center (View › Turn Snapping Off to disable).",
      "New Properties panel above Layers: position and size (X, Y, W, H), text and shape settings, adjustment sliders, mask actions and the canvas size — for whatever layer is selected.",
    ],
  },
  {
    version: "0.10.0",
    title: "Quick Selection, Quick Mask and Refine Edge",
    notes: [
      "Quick Selection tool (W): paint over something and the selection grows to its edges. Keep painting to add, hold Alt to take away.",
      "Quick Mask mode (Q, or the button under the colors): paint your selection with any brush — white selects, black deselects, red shows what's left out. Press Q again to get the selection back.",
      "Select › Refine Edge (Ctrl+Alt+R): clean up a selection's edge with Radius (for hair and fur), Smooth, Feather, Contrast and Shift Edge, previewed as an overlay, on black, on white or as a mask. Output a selection, a layer mask or a new masked layer.",
    ],
  },
  {
    version: "0.9.0",
    title: "Clipping masks and layer locks",
    notes: [
      "Clipping masks: Alt+click a layer (or Layer › Create Clipping Mask, Ctrl+Alt+G) to show it only where the layer below has pixels. Great for textures in text and adjustments that affect just one layer.",
      "Lock layers from the Layers panel: transparent pixels (paint only where there's already something), image pixels, position, or everything (Ctrl+/).",
    ],
  },
  {
    version: "0.8.8",
    title: "Hide the options bar",
    notes: [
      "Fold the options bar away with the arrow at its right end, or View › Show/Hide Options Bar. Click the thin strip to bring it back.",
    ],
  },
  {
    version: "0.8.7",
    title: "Hide the toolbar, close buttons on dialogs",
    notes: [
      "Fold the toolbar away with the small arrow at its top, View › Show/Hide Toolbar, or Shift+Tab. Tool shortcuts still work while it's hidden.",
      "Dialogs such as Keyboard Shortcuts and What's New now have an X in the corner to close them.",
    ],
  },
  {
    version: "0.8.6",
    title: "Continue or start fresh",
    notes: [
      "Opening the editor now asks whether to continue your last session or start a new image, instead of always reopening it.",
    ],
  },
  {
    version: "0.8.5",
    title: "Collapsible panels",
    notes: [
      "Click the Layers or History title to fold that panel away; the other one gets the room.",
      "Fold the whole side column into a slim strip with the arrow next to “Layers”, View › Show/Hide Panels, or the Tab key. Click a name in the strip to bring it back.",
    ],
  },
  {
    version: "0.8.4",
    title: "Resizable toolbar and options bar",
    notes: [
      "Drag the right edge of the toolbar to show the tools in two or three columns.",
      "Drag the bottom edge of the options bar to make it taller (its controls wrap onto more rows instead of scrolling) or slimmer.",
      "Double-click either edge to reset. Your layout is remembered.",
    ],
  },
  {
    version: "0.8.3",
    title: "Resizable side panels, tidier adjustment panels",
    notes: [
      "Drag the left edge of the Layers/History column to make it wider or narrower, and the line between Layers and History to share the space. Double-click either to reset.",
      "Adjustment panels are now compact (one row per slider) and open just big enough to show everything without scrolling.",
      "Panel sizes are remembered for each kind of adjustment; double-click a resize grip to go back to the default.",
    ],
  },
  {
    version: "0.8.2",
    title: "Resizable adjustment panels",
    notes: [
      "Drag the edges or bottom corners of adjustment, filter and layer style panels to resize them; sliders and the Curves graph grow with the panel.",
      "Panels remember their size and position, even after you close the editor.",
    ],
  },
  {
    version: "0.8.1",
    title: "See your image while you adjust it",
    notes: [
      "Adjustment, filter and layer style dialogs no longer cover or darken the image: they sit beside it, and you can drag them anywhere.",
      "Pan and zoom the image while a dialog is open (scroll, Ctrl+scroll, Space+drag, Ctrl+0 / Ctrl+1).",
      "New “Hold to compare” button: press and hold to see the original, release to see your changes.",
    ],
  },
  {
    version: "0.8.0",
    title: "Shapes and the Pen tool",
    notes: [
      "New Shape tool (U): rectangles with rounded corners, ellipses, polygons, stars and lines.",
      "New Pen tool (P): click for corners, drag for curves. Makes a shape layer or a precise selection.",
      "Shapes stay sharp, editable vectors through move, transform, rotate, flip, crop and resize.",
      "Select a shape layer to restyle its fill and stroke, or drag its points with the Pen tool to reshape it.",
    ],
  },
  {
    version: "0.7.0",
    title: "Groups, adjustment layers and layer styles",
    notes: [
      "Group layers into folders (Ctrl+G), collapse them, and give groups their own opacity, blend mode and mask.",
      "Adjustment layers: Levels, Curves, Hue/Saturation and more, applied without changing your pixels.",
      "Layer styles: drop shadow, inner shadow, outer glow, stroke and color overlay.",
    ],
  },
  {
    version: "0.6.0",
    title: "Tool tips",
    notes: ["Hover a tool to see its name and shortcut, and hold Alt to read what it does."],
  },
  {
    version: "0.5.0",
    title: "Color picker and editable text",
    notes: [
      "A new color picker with hex, RGB and HSB fields, recent colors, swatches and a screen eyedropper.",
      "Text stays editable: click it with the Type tool to change the words, font, size, style or color.",
    ],
  },
  {
    version: "0.4.0",
    title: "Retouching tools",
    notes: [
      "Clone Stamp (S): Alt+click a source, then paint to copy it.",
      "Spot Healing Brush (J): paint over a blemish and it disappears.",
      "Healing Brush and Edit › Heal Selection blend repairs seamlessly into their surroundings.",
    ],
  },
  {
    version: "0.3.0",
    title: "Layers can extend past the canvas",
    notes: [
      "Content moved or transformed off the canvas is kept, and comes back when you move it back.",
      "Crop no longer deletes pixels; enlarge the canvas to bring them back.",
    ],
  },
  {
    version: "0.2.0",
    title: "Layer masks",
    notes: ["Hide parts of a layer without erasing them: add a mask, then paint black to hide and white to reveal."],
  },
  {
    version: "0.1.0",
    title: "Faster, safer editing",
    notes: [
      "Your work is saved automatically and restored when you come back.",
      "Save and reopen projects with all their layers (.pcrap files).",
      "On-canvas Free Transform with handles, crop handles, and Select › Feather / Expand / Contract.",
      "Much faster blur and adjustment previews on large photos.",
    ],
  },
  {
    version: "0.0.0",
    title: "The first Photocrap editor",
    notes: ["Layers, brushes, selections, adjustments, filters and undo history, right in your browser."],
  },
];

export const VERSION = CHANGELOG[0].version;

const SEEN_KEY = "photocrap:seen-version";

// Compare "a.b.c" versions numerically.
function compare(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function readSeen() {
  try {
    return { ok: true, value: localStorage.getItem(SEEN_KEY) };
  } catch {
    return { ok: false, value: null };
  }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, VERSION); } catch { /* storage unavailable */ }
}

function releaseList(entries) {
  return h("div", { class: "changelog" }, entries.map((e) => h("section", { class: "release" },
    h("div", { class: "release-head" }, h("span", { class: "release-title" }, e.title), h("span", { class: "release-version" }, `v${e.version}`)),
    h("ul", {}, e.notes.map((n) => h("li", {}, n))))));
}

export function showChangelog(entries = CHANGELOG, title = "What's new in Photocrap") {
  return openDialog({
    title: `${title}${entries === CHANGELOG ? "" : ` ${VERSION}`}`,
    okLabel: "Got it",
    cancelLabel: null,
    width: 460,
    fields: [{ type: "custom", create: () => releaseList(entries) }],
  });
}

// Decide at startup (before autosave writes anything) which releases this
// browser hasn't seen, and record the current version so they're only ever
// shown once. Brand-new users get nothing; people who used the editor
// before versions were tracked (they have an autosaved session) get the
// latest release.
export async function unseenReleases() {
  const seen = readSeen();
  if (!seen.ok) return []; // can't remember that we showed it, so don't nag
  if (seen.value && compare(seen.value, VERSION) >= 0) return [];
  let entries;
  if (seen.value) {
    entries = CHANGELOG.filter((e) => compare(e.version, seen.value) > 0);
  } else {
    const returning = await kvGet("autosave-meta").catch(() => null);
    entries = returning ? [CHANGELOG[0]] : [];
  }
  markSeen(); // before showing, so a reload never shows it twice
  return entries;
}
