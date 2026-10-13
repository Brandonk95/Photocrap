// Saves the open document to IndexedDB shortly after every change, so a
// reload, crash or closed tab never loses work. The homepage reads the small
// "autosave-meta" record to offer "Continue where you left off".

import { kvGet, kvSet } from "../storage.js";
import { serializeDoc, deserializeDoc, thumbnail } from "./project.js";

const DELAY_MS = 1200;

export function installAutosave(app) {
  let timer = 0;
  let saving = false;
  let dirty = false;

  async function save() {
    timer = 0;
    if (app.busy || saving) {
      timer = setTimeout(save, 500);
      return;
    }
    dirty = false;
    saving = true;
    app.emit("autosave", "saving");
    try {
      const doc = app.doc;
      const meta = { name: doc.name, width: doc.width, height: doc.height, layers: doc.leaves().length, savedAt: Date.now(), thumb: thumbnail(doc) };
      app.requestRender(); // thumbnail() reused the composite canvas
      const blob = await serializeDoc(doc);
      await kvSet("autosave", blob);
      await kvSet("autosave-meta", meta);
      app.emit("autosave", "saved");
    } catch (err) {
      console.warn("Autosave failed", err);
      app.emit("autosave", "failed");
    } finally {
      saving = false;
    }
    if (dirty && !timer) timer = setTimeout(save, DELAY_MS);
  }

  app.on("history", () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, DELAY_MS);
  });

  return { hasUnsavedChanges: () => dirty || saving };
}

export async function loadAutosave() {
  const blob = await kvGet("autosave");
  return blob ? deserializeDoc(blob) : null;
}
