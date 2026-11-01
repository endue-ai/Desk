// DOM for the quick preview. File text is always textContent, including HTML and source files.

/** @param {Document} doc
 * @param {{ open(path: string): unknown, close(): unknown }} actions
 */
export function previewView(doc, actions) {
  const root = /** @type {HTMLElement} */ (doc.getElementById("preview"));
  const title = /** @type {HTMLElement} */ (doc.getElementById("preview-title"));
  const detail = /** @type {HTMLElement} */ (doc.getElementById("preview-detail"));
  const content = /** @type {HTMLElement} */ (doc.getElementById("preview-content"));
  let path = "";
  doc.getElementById("preview-open")?.addEventListener("click", () => actions.open(path));
  doc.getElementById("preview-close")?.addEventListener("click", () => actions.close());
  const render = (/** @type {import("./preview.js").Preview | null} */ model) => {
    root.hidden = model === null;
    doc.getElementById("toggle-preview")?.setAttribute("aria-expanded", String(model !== null));
    content.replaceChildren();
    if (!model) return;
    path = model.path;
    title.textContent = model.name;
    const format = model.name.includes(".") ? model.name.split(".").at(-1)?.toUpperCase() : "File";
    detail.textContent = `${format} · ${model.size === undefined ? "" : `${model.size.toLocaleString()} bytes · `}${model.path}`;
    root.setAttribute("aria-busy", String(model.kind === "loading"));
    if (model.kind === "image" && model.url) {
      const img = doc.createElement("img");
      img.src = model.url;
      img.alt = model.name;
      img.addEventListener("error", () => {
        if (content.contains(img))
          content.textContent = "This image could not be previewed. Open it in the image viewer.";
      });
      content.append(img);
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
