// The preview pane: the selected entry as text, an image, a hex dump, a folder's totals, an archive to
// open one level down, or one sentence; with a caption saying what is shown.

/** @typedef {import("./preview.js").PreviewModel} PreviewModel */

/** @param {Document} doc @param {HTMLElement} pane @param {{ open(): unknown }} actions */
export function createPreview(doc, pane, actions) {
  /** @param {PreviewModel | null} model */
  return (model) => {
    pane.replaceChildren();
    pane.hidden = !model;
    if (!model) return;
    const title = doc.createElement("h2");
    title.textContent = model.name;
    pane.append(title);
    const caption = doc.createElement("p");
    caption.className = "caption";
    if ("caption" in model) caption.textContent = model.caption;
    if (model.kind === "message") {
      caption.textContent = model.text;
      caption.className = "message";
    }
    pane.append(caption);
    if (model.kind === "text") {
      const pre = doc.createElement("pre");
      pre.className = "text";
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", `Text of ${model.name}`);
      pre.textContent = model.text;
      pane.append(pre);
    } else if (model.kind === "hex") {
      const pre = doc.createElement("pre");
      pre.className = "hex";
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", `Hex of ${model.name}`);
      pre.textContent = model.hex;
      pane.append(pre);
    } else if (model.kind === "image") {
      const img = doc.createElement("img");
      img.src = model.url;
      img.alt = model.name;
      pane.append(img);
    } else if (model.kind === "archive") {
      const open = doc.createElement("button");
      open.type = "button";
      open.textContent = `Open ${model.name}`;
      open.addEventListener("click", () => actions.open());
      pane.append(open);
    }
  };
}
