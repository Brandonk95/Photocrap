// Hands an image (or project file) from the homepage to the editor.
// IndexedDB is used because photos routinely exceed sessionStorage's ~5 MB cap.

import { kvGet, kvSet, kvDelete } from "./storage.js";

const KEY = "pending-image";

export function putPendingImage(file) {
  return kvSet(KEY, { name: file.name, blob: file });
}

export async function takePendingImage() {
  const value = await kvGet(KEY);
  if (value) await kvDelete(KEY);
  return value ?? null;
}
