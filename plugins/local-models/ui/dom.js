// A few lines of DOM building: h() makes an element from a tag, attributes and children, icon() an
// inline SVG from icons.js. Every view is drawn with these; nothing a model or server wrote is ever
// put in as HTML.
import { ICONS } from "./icons.js";

/**
 * @typedef {string | number | Node | null | undefined | false} Child
 * @typedef {keyof typeof ICONS} IconName
 */

/**
 * @param {string} tag `div`, `button.desk-btn.lm-x`, `span#id`
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const [name = "div", ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name);
  for (const part of rest) {
    if (part.startsWith(".")) el.classList.add(part.slice(1));
    else if (part.startsWith("#")) el.id = part.slice(1);
  }
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function")
      el.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    else if (key === "class") {
      for (const cls of String(value).split(/\s+/)) if (cls) el.classList.add(cls);
    } else if (key === "dataset" && typeof value === "object") {
      for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value)))
        if (v !== undefined && v !== null && v !== false) el.dataset[k] = String(v);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(/** @type {Record<string, string>} */ (value)))
        el.style.setProperty(prop, v);
    } else if (key === "value" && "value" in el)
      /** @type {HTMLInputElement} */ (el).value = String(value);
    else if (key === "checked" && "checked" in el)
      /** @type {HTMLInputElement} */ (el).checked = value === true;
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/** @param {Element} el @param {(Child | Child[])[]} children */
export function append(el, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** Replace an element's children. @param {Element} el @param {...(Child | Child[])} children */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from icons.js, sized by CSS (1em by default). @param {IconName} name @param {string} [cls] */
export function icon(name, cls = "") {
  const el = document.createElementNS(SVG, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", `lm-icon ${cls}`.trim());
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    el.append(p);
  }
  return el;
}

/**
 * A quiet icon button with a tooltip and an accessible name.
 * @param {IconName} name @param {string} label @param {(e: MouseEvent) => void} onClick @param {Record<string, unknown>} [attrs]
 */
export function iconButton(name, label, onClick, attrs = {}) {
  return h(
    "button.desk-icon-btn.lm-icon-btn",
    { type: "button", title: label, "aria-label": label, onClick, ...attrs },
    icon(name),
  );
}

/** Copy text to the clipboard; false when the page may not. @param {string} text */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { "aria-hidden": "true", class: "lm-offscreen" }); // ds: own
    /** @type {HTMLTextAreaElement} */ (area).value = text;
    document.body.append(area);
    /** @type {HTMLTextAreaElement} */ (area).select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return ok;
  }
}

/** "3 minutes ago", "Yesterday", a date. @param {number} at @param {number} [now] */
export function ago(at, now = Date.now()) {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
