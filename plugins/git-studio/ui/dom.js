// A few lines of DOM building: h() makes an element from a tag, attributes and children; icon()
// an inline SVG from icons.js. Every view in Git Studio is drawn with these, never innerHTML of data.

import { ICONS } from "./icons.js";

/**
 * @typedef {string | number | Node | null | undefined | false} Child
 * @param {string} tag `div`, `button.desk-btn.quiet`, `span#id`
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
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    } else if (key === "class") {
      for (const name of String(value).split(/\s+/)) if (name) el.classList.add(name);
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(el.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(/** @type {Record<string, string>} */ (value)))
        el.style.setProperty(prop, v);
    } else if (value === true) el.setAttribute(key, "");
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

const SVG = "http://www.w3.org/2000/svg";

/** An SVG element with attributes. @param {string} tag @param {Record<string, string | number>} [attrs] */
export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** One of the plugin's icons, 16 px by default, drawn in the text's colour. */
export function icon(/** @type {keyof typeof ICONS} */ name, size = 16) {
  const el = svg("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "icon",
  });
  for (const d of ICONS[name] ?? []) el.append(svg("path", { d }));
  return el;
}

/** Replace an element's children. @param {Element} el @param {...(Child | Child[])} children */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** A button of the design system's kit, with an icon and a label (the label is its name). */
export function button(
  /** @type {{ label: string, icon?: keyof typeof ICONS, kind?: string, title?: string, onClick?: (event: MouseEvent) => void, disabled?: boolean, hideLabel?: boolean }} */ spec,
) {
  const cls = spec.hideLabel ? "desk-icon-btn" : "desk-btn";
  return h(
    `button.${cls}${spec.kind ? `.${spec.kind}` : ""}`,
    {
      type: "button",
      title: spec.title ?? spec.label,
      "aria-label": spec.hideLabel ? spec.label : undefined,
      disabled: spec.disabled,
      onClick: spec.onClick,
    },
    spec.icon ? icon(spec.icon) : null,
    spec.hideLabel ? null : h("span.label", null, spec.label),
  );
}
