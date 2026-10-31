// The details view for a file the page view cannot show (damaged, encrypted, a variant Docs does
// not read), the Pages preview image, and the Google Drive shortcut card: name, size, format, why.

/** @param {number} bytes */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @param {Document} doc
 * @param {{ facts: HTMLElement, reason: HTMLElement, preview: HTMLImageElement, url: HTMLElement }} els
 * @param {import("../docs.js").Shown & { doc: import("../model.js").Details }} shown
 */
export function renderDetails(doc, els, shown) {
  const { facts, reason, preview, url } = els;
  const rows = [
    ["Size", formatSize(shown.size)],
    ["Format", shown.doc.formatName],
    ["Where", shown.path],
  ];
  facts.replaceChildren(
    ...rows.flatMap(([term, value]) => {
      const dt = doc.createElement("dt");
      dt.textContent = term ?? "";
      const dd = doc.createElement("dd");
      dd.textContent = value ?? "";
      return [dt, dd];
    }),
  );
  reason.textContent = shown.doc.reason;
  const src = shown.doc.preview?.src;
  preview.hidden = !src?.startsWith("data:image/");
  if (src && !preview.hidden) {
    preview.src = src;
    preview.alt = shown.doc.preview?.alt ?? "";
  } else preview.removeAttribute("src");
  url.hidden = !shown.doc.url;
  url.replaceChildren();
  if (shown.doc.url) {
    const label = doc.createElement("span");
    label.textContent = "Address: ";
    const code = doc.createElement("code");
    code.className = "selectable";
    code.textContent = shown.doc.url;
    url.append(label, code);
  }
}
