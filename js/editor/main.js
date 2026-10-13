import { App } from "./app.js";
import { createTools } from "./tools.js";
import { installUI } from "./ui.js";
import { installAutosave, loadAutosave } from "./autosave.js";
import { takePendingImage } from "../handoff.js";
import { unseenReleases, showChangelog } from "./changelog.js";
import { openDialog } from "./dialogs.js";
import { h } from "./util.js";
import { kvGet } from "../storage.js";

// Checked first: it looks for an existing autosave to tell returning users
// from new ones, and opening a document starts autosaving.
const releases = await unseenReleases();

const app = new App({
  workspace: document.getElementById("workspace"),
  canvas: document.getElementById("view"),
});
const tools = createTools();
app.registerTools(tools);
const autosave = installAutosave(app);
const commands = installUI(app, tools, autosave);
app.setTool("brush");
window.photocrap = app; // handy for debugging from the console

// ?open=1: the homepage handed us a file. ?new=1: ask for document settings.
// ?resume=1: the homepage's "continue" card, so don't ask again.
// Otherwise offer to pick up where the last session left off.
const params = new URLSearchParams(location.search);
history.replaceState(null, "", location.pathname);

async function start() {
  if (params.has("open")) {
    try {
      const pending = await takePendingImage();
      if (pending) {
        await app.openFile(pending.blob, pending.name);
        return;
      }
    } catch (err) {
      console.error(err);
      app.toast("Couldn't load that file.");
    }
  }
  if (!params.has("new")) {
    try {
      const doc = await loadAutosave();
      if (doc) {
        // Show the session behind the question so people can see what it is.
        app.setDoc(doc, "Restored Session");
        if (params.has("resume") || await askToContinue()) {
          app.toast("Picked up where you left off.");
          return;
        }
      }
    } catch (err) {
      console.warn("Couldn't restore the last session", err);
    }
  }
  app.newDoc(1280, 720, "#ffffff");
}

// Continue the autosaved session, or start over? Esc and Enter continue,
// since starting over replaces the autosaved session.
async function askToContinue() {
  const meta = await kvGet("autosave-meta").catch(() => null);
  const card = h("div", { class: "resume-prompt" },
    meta?.thumb ? h("img", { class: "resume-prompt-thumb", src: meta.thumb, alt: "" }) : null,
    h("div", {},
      h("div", { class: "resume-prompt-name" }, meta?.name ?? app.doc.name),
      meta ? h("div", { class: "resume-prompt-meta" }, `${meta.width} × ${meta.height} · ${meta.layers} layer${meta.layers === 1 ? "" : "s"} · ${timeAgo(meta.savedAt)}`) : null));
  const result = await openDialog({
    title: "Continue where you left off?",
    okLabel: "Continue",
    cancelLabel: "Start new",
    escapeOk: true,
    width: 400,
    fields: [
      { type: "custom", create: () => card },
      { type: "custom", create: () => h("p", { class: "resume-prompt-note" }, "Starting new replaces this session. To keep a copy, continue and use File › Save first.") },
    ],
  });
  return result !== null;
}

function timeAgo(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString();
}

await start();
if (releases.length) await showChangelog(releases);
if (params.has("new")) commands["file.new"].run();
