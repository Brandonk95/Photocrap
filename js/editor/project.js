// The .pcrap project format: everything needed to reopen a document with its
// layers intact.
//
//   bytes 0–5   "PCRAP1"
//   bytes 6–9   JSON header length (uint32, little-endian)
//   then        UTF-8 JSON header (the layer tree)
//   then        PNGs back to back, in tree order: each pixel layer's image,
//               then its mask's image if it has one; groups contribute only
//               their mask (sizes are in the header)

import { Doc, Layer, LayerMask, Group } from "./doc.js";
import { createCanvas } from "./util.js";

const MAGIC = "PCRAP1";
export const PROJECT_EXTENSION = ".pcrap";

const toPng = (canvas) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));

// toBlob snapshots each canvas immediately, so editing can continue while
// the PNGs encode.
export async function serializeDoc(doc) {
  const canvases = [];
  const describe = (node) => {
    const info = {
      type: node.isGroup ? "group" : "layer",
      name: node.name, visible: node.visible, opacity: node.opacity, blend: node.blend,
      active: node === doc.activeLayer || undefined,
      clipped: node.clipped || undefined,
      locks: node.locks ?? undefined,
      mask: node.mask
        ? { enabled: node.mask.enabled, editing: node.editMask, x: node.mask.x, y: node.mask.y, background: node.mask.background }
        : null,
    };
    if (node.isGroup) {
      // The group's own mask comes before its children in the PNG stream.
      if (node.mask) info.mask.size = canvases.push(node.mask.canvas) - 1;
      info.expanded = node.expanded;
      info.children = node.layers.map(describe);
    } else {
      // x/y place the canvas in the document; layers can extend past the edges.
      Object.assign(info, {
        x: node.x, y: node.y,
        text: node.text ?? null,             // editable type; the PNG holds its rendered pixels
        shape: node.shape ?? null,           // editable vector shape
        adjustment: node.adjustment ?? null, // adjustment layer settings
        styles: node.styles ?? null,         // layer effects
      });
      info.size = canvases.push(node.canvas) - 1;
      if (node.mask) info.mask.size = canvases.push(node.mask.canvas) - 1;
    }
    return info;
  };
  const meta = {
    format: "photocrap",
    version: 5,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map(describe),
    guides: doc.guides.length ? doc.guides : undefined,
  };
  // Replace the canvas indexes with byte sizes once the PNGs exist.
  const pngs = await Promise.all(canvases.map(toPng));
  const fix = (info) => {
    if (info.size !== undefined) info.size = pngs[info.size].size;
    if (info.mask) info.mask.size = pngs[info.mask.size].size;
    info.children?.forEach(fix);
  };
  meta.layers.forEach(fix);
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const header = new Uint8Array(10);
  header.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(header.buffer).setUint32(6, json.length, true);
  return new Blob([header, json, ...pngs], { type: "application/x-photocrap" });
}

export async function isProjectFile(blob) {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  return new TextDecoder().decode(head) === MAGIC;
}

export async function deserializeDoc(blob) {
  const buf = await blob.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 6)) !== MAGIC) throw new Error("Not a Photocrap project");
  const jsonLength = new DataView(buf).getUint32(6, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 10, jsonLength)));

  const doc = new Doc(meta.width, meta.height, meta.name);
  doc.guides = Array.isArray(meta.guides) ? meta.guides.filter((g) => (g.axis === "x" || g.axis === "y") && Number.isFinite(g.pos)) : [];
  let offset = 10 + jsonLength;
  const nextImage = async (size) => {
    const png = new Blob([buf.slice(offset, offset + size)], { type: "image/png" });
    offset += size;
    return createImageBitmap(png);
  };

  let active = null;
  // Older files: no type (all layers), no x/y (everything at the origin).
  const build = async (info) => {
    let node;
    if (info.type === "group") {
      node = new Group(info.name);
      node.expanded = info.expanded ?? true;
    } else {
      const img = await nextImage(info.size);
      node = new Layer(img.width, img.height, info.name, info.x ?? 0, info.y ?? 0);
      node.drawLocal(img);
      Object.assign(node, {
        text: info.text ?? null, shape: info.shape ?? null, adjustment: info.adjustment ?? null, styles: info.styles ?? null,
      });
    }
    Object.assign(node, {
      visible: info.visible, opacity: info.opacity, blend: info.blend,
      clipped: !!info.clipped, locks: info.locks ?? null,
    });
    if (info.mask) {
      const maskImg = await nextImage(info.mask.size);
      const fill = info.mask.background === 0 ? "#000000" : "#ffffff";
      const mask = new LayerMask(maskImg.width, maskImg.height, fill, info.mask.x ?? 0, info.mask.y ?? 0);
      mask.drawLocal(maskImg);
      mask.enabled = info.mask.enabled;
      mask.refresh();
      node.mask = mask;
      node.editMask = !!info.mask.editing;
    }
    if (info.active) active = node;
    // Children come after the group's own mask in the PNG stream.
    if (info.type === "group") for (const child of info.children) node.layers.push(await build(child));
    return node;
  };
  for (const info of meta.layers) doc.layers.push(await build(info));

  doc.layerCount = doc.leaves().length;
  doc.groupCount = doc.allNodes().length - doc.layerCount;
  doc.activeLayer = active ?? doc.layers[meta.active] ?? doc.layers.at(-1);
  return doc;
}

// Small JPEG preview for the homepage's "continue" card.
export function thumbnail(doc, max = 360) {
  const s = Math.min(1, max / Math.max(doc.width, doc.height));
  const c = createCanvas(doc.width * s, doc.height * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(doc.compose(), 0, 0, c.width, c.height); // always the real image, never a mask view
  return c.toDataURL("image/jpeg", 0.8);
}
