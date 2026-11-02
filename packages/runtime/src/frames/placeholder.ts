/**
 * What stands in a surface while its frame is unloaded (ADR 0070): its title and a line saying it
 * loads again when shown. Usually covered or off the page; pressing it loads the surface.
 */
export const PLACEHOLDER = "desk-surface-placeholder";

export function placeholder(doc: Document, title: string, wake: () => void): HTMLElement {
  const el = doc.createElement("div");
  el.className = PLACEHOLDER;
  const name = doc.createElement("p");
  name.className = `${PLACEHOLDER}-title`;
  name.textContent = title;
  const line = doc.createElement("p");
  line.textContent = "Unloaded while out of sight. It loads again when shown.";
  el.append(name, line);
  el.addEventListener("pointerdown", wake);
  return el;
}
