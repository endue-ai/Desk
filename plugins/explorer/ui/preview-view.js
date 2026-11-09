// DOM for the quick preview. File text is always textContent, including HTML and source files.
import { sizeOf } from "./size.js";

/** @param {Document} doc
 * @param {{ open(path: string): unknown, close(): unknown }} actions
 */
export function previewView(doc, actions) {
  const root = /** @type {HTMLElement} */ (doc.getElementById("preview"));
  const title = /** @type {HTMLElement} */ (doc.getElementById("preview-title"));
  const detail = /** @type {HTMLElement} */ (doc.getElementById("preview-detail"));
  const content = /** @type {HTMLElement} */ (doc.getElementById("preview-content"));
  let path = "";
  /** Counts renders, so an image decoded after the preview moved on is dropped. */
  let shown = 0;
  doc.getElementById("preview-open")?.addEventListener("click", () => actions.open(path));
  doc.getElementById("preview-close")?.addEventListener("click", () => actions.close());
  const render = (/** @type {import("./preview.js").Preview | null} */ model) => {
    const ticket = ++shown;
    root.hidden = model === null;
    doc.getElementById("toggle-preview")?.setAttribute("aria-expanded", String(model !== null));
    content.replaceChildren();
    if (!model) return;
    path = model.path;
    title.textContent = model.name;
    const format = model.name.includes(".") ? model.name.split(".").at(-1)?.toUpperCase() : "File";
    detail.textContent = `${format} · ${model.size === undefined ? "" : `${sizeOf(model.size)} · `}${model.path}`;
    root.setAttribute("aria-busy", String(model.kind === "loading"));
    if (model.kind === "image" && model.url) {
      const img = doc.createElement("img");
      img.decoding = "async";
      img.alt = model.name;
      img.src = model.url;
      // Decoded whole before it goes on the page, where the engine can decode off this thread, so
      // a large image is neither decoded part by part as it loads nor in the frame's next paint.
      const failed = () => {
        if (ticket === shown)
          content.textContent = "This image could not be previewed. Open it in the image viewer.";
      };
      const decoded = typeof img.decode === "function" ? img.decode() : Promise.resolve();
      content.textContent = "Loading preview…";
      decoded.then(() => {
        if (ticket === shown) content.replaceChildren(img);
      }, failed);
    } else if (model.kind === "text") {
      if (model.truncated) {
        const note = doc.createElement("p");
        note.textContent = "Showing the first 64 KiB. Open the file to read more.";
        content.append(note);
      }
      const pre = doc.createElement("pre");
      pre.textContent = model.text ?? "";
      content.append(pre);
    } else {
      content.textContent =
        model.kind === "loading"
          ? "Loading preview…"
          : (model.reason ?? "Open this file in its viewer.");
    }
  };
  return { render, active: () => !root.hidden };
}
