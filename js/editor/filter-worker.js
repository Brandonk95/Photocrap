// Runs pixel operations off the main thread so dialogs stay responsive.
// Message: { id, op, params, img, mask? } → reply { id, img } or { id, error }.

import * as F from "./filters.js";

self.onmessage = ({ data: { id, op, params, img, mask } }) => {
  try {
    const orig = mask ? new ImageData(new Uint8ClampedArray(img.data), img.width, img.height) : null;
    const out = F[op](img, params);
    if (mask) F.applyMask(orig, out, mask);
    self.postMessage({ id, img: out }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
