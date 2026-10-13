import * as F from "./filters.js";
import { copyImageData } from "./util.js";

// Thin promise wrapper around filter-worker.js. Falls back to running on the
// main thread if module workers aren't available.
class FilterClient {
  constructor() {
    this.seq = 0;
    this.waiting = new Map();
    try {
      this.worker = new Worker(new URL("./filter-worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }) => {
        const job = this.waiting.get(data.id);
        this.waiting.delete(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve(data.img);
      };
    } catch {
      this.worker = null;
    }
  }

  // `img` is consumed (its buffer is transferred); pass a copy if you need it.
  run(op, params, img, mask) {
    if (!this.worker) {
      const orig = mask ? copyImageData(img) : null;
      const out = F[op](img, params);
      if (mask) F.applyMask(orig, out, mask);
      return Promise.resolve(out);
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, params, img, mask }, [img.data.buffer]);
    });
  }
}

export const filterClient = new FilterClient();

// Keeps at most one preview in flight; while one runs, only the newest
// request is remembered, so a fast slider drag never queues up stale work.
// Results that arrive after stop() are dropped.
export class PreviewQueue {
  constructor(render) {
    this.render = render;
    this.running = false;
    this.next = null;
    this.stopped = false;
  }

  request(job) {
    this.next = job;
    if (!this.running) this.pump();
  }

  async pump() {
    this.running = true;
    while (this.next && !this.stopped) {
      const job = this.next;
      this.next = null;
      try {
        const out = await job();
        if (!this.stopped) this.render(out);
      } catch (err) {
        console.error(err);
      }
    }
    this.running = false;
  }

  stop() {
    this.stopped = true;
    this.next = null;
  }
}
