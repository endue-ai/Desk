// Apply message keys from the static page, retaining labels a running view has since replaced.
import { t } from "./index.js";

const ATTRIBUTES = ["alt", "aria-description", "aria-label", "label", "placeholder", "title"];
const rendered = new WeakMap();

/** @param {Document} document */
export function renderStaticMessages(document) {
  for (const attr of ["", ...ATTRIBUTES]) {
    const marker = attr ? `data-message-${attr}` : "data-message";
    for (const node of document.querySelectorAll(`[${marker}]`)) {
      const key = node.getAttribute(marker);
      if (!key) continue;
      const last = rendered.get(node) ?? new Map();
      const current = attr ? node.getAttribute(attr) : node.textContent;
      if (last.has(attr) && last.get(attr) !== current) continue;
      const text = t(key);
      if (attr) node.setAttribute(attr, text);
      else node.textContent = text;
      last.set(attr, text);
      rendered.set(node, last);
    }
  }
}
