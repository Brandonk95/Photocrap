import { App } from "./app.js";
import { createTools } from "./tools.js";
import { installUI } from "./ui.js";
import { installAutosave, loadAutosave } from "./autosave.js";
import { takePendingImage } from "../handoff.js";

const app = new App({
  workspace: document.getElementById("workspace"),
  canvas: document.getElementById("view"),
});
const tools = createTools();
app.registerTools(tools);
const autosave = installAutosave(app);
const commands = installUI(app, tools, autosave);
app.setTool("brush");

// ?open=1: the homepage handed us a file. ?new=1: ask for document settings.
// Otherwise pick up where the last session left off.
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
        app.setDoc(doc, "Restored Session");
        app.toast("Picked up where you left off.");
        return;
      }
    } catch (err) {
      console.warn("Couldn't restore the last session", err);
    }
  }
  app.newDoc(1280, 720, "#ffffff");
  if (params.has("new")) commands["file.new"].run();
}

await start();

window.photocrap = app; // handy for debugging from the console
