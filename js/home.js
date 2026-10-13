// Homepage: open an image (picker or drag-and-drop) and hand it to the editor.

import { putPendingImage } from "./handoff.js";
import { kvGet } from "./storage.js";

const fileInput = document.getElementById("file-input");
const dropzone = document.getElementById("dropzone");
const overlay = document.getElementById("drop-overlay");

document.getElementById("year").textContent = new Date().getFullYear();

// Offer to reopen the editor's autosaved session.
async function showResume() {
  const meta = await kvGet("autosave-meta").catch(() => null);
  if (!meta) return;
  const ago = Math.round((Date.now() - meta.savedAt) / 60000);
  const when = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} h ago` : new Date(meta.savedAt).toLocaleDateString();
  document.getElementById("resume-thumb").src = meta.thumb;
  document.getElementById("resume-meta").textContent =
    `${meta.name} · ${meta.width} × ${meta.height} · ${meta.layers} layer${meta.layers === 1 ? "" : "s"} · ${when}`;
  document.getElementById("resume").hidden = false;
}
showResume();

const isProject = (file) => file.name.toLowerCase().endsWith(".pcrap");

async function openInEditor(file) {
  if (!file || !(file.type.startsWith("image/") || isProject(file))) {
    alert("That doesn't look like an image file.");
    return;
  }
  try {
    await putPendingImage(file);
  } catch {
    alert("Couldn't hand that image to the editor. Try opening it from inside the editor.");
    return;
  }
  location.href = "editor.html?open=1";
}

fileInput.addEventListener("change", () => openInEditor(fileInput.files[0]));

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

// Whole-page drag and drop. dragenter/dragleave fire for every child element,
// so track depth to know when the drag truly leaves the window.
let dragDepth = 0;

window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  overlay.hidden = false;
});

window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) overlay.hidden = true;
});

window.addEventListener("dragover", (e) => e.preventDefault());

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  openInEditor(e.dataTransfer.files[0]);
});
