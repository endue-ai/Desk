// The DOM of one view: containers in plain DOM and CSS (grid, split, stack, tabs) and each component
// as a section whose data-state says what it shows, drawn with the @endue-ai/ui elements. Never a
// blank: every state has its words, and the ones a person can fix have a button.

import { present } from "./present.js";

/**
 * @typedef {import("./components.js").ComponentModel} ComponentModel
 * @typedef {import("./components.js").ContainerModel} ContainerModel
 * @typedef {import("./components.js").NodeModel} NodeModel
 * @typedef {import("./template.js").Env} Env
 * @typedef {{ reconnect(path: string): unknown, requestAccess(path: string): unknown,
 *   connect(path: string): unknown, link(href: string): unknown }} Buttons
 * @typedef {(element: HTMLElement, component: ComponentModel) => void} Wire
 */

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {string} [text]
 */
export function make(doc, tag, attributes = {}, text) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** What each state says above or instead of the items, and the button that fixes it. */
const BUTTONS = /** @type {const} */ ({
  error: ["Reconnect", "reconnect"],
  stale: ["Reconnect", "reconnect"],
  denied: ["Ask for access", "requestAccess"],
  unbound: ["Connect a source", "connect"],
});

/**
 * The element that shows a component's items.
 * @param {Document} doc
 * @param {ComponentModel} component
 * @param {Env} env
 * @param {Buttons} buttons
 */
function itemsOf(doc, component, env, buttons) {
  const data = present(component, env);
  switch (data.kind) {
    case "table": {
      const table = /** @type {HTMLElement & Record<string, unknown>} */ (
        make(doc, "desk-table", { label: data.label })
      );
      table.columns = data.columns;
      table.sort = data.sort;
      table.rows = data.rows;
      return table;
    }
    case "agenda": {
      const agenda = /** @type {HTMLElement & Record<string, unknown>} */ (
        make(doc, "desk-agenda", {
          label: data.label,
          "time-zone": data.zone,
          locale: data.locale,
          now: data.now,
        })
      );
      agenda.events = data.events;
      return agenda;
    }
    case "stat":
      return make(doc, "desk-stat", {
        label: data.label,
        value: data.value,
        ...(data.unit ? { unit: data.unit } : {}),
      });
    case "markdown": {
      const markdown = /** @type {HTMLElement & { source: string }} */ (make(doc, "desk-markdown"));
      markdown.source = data.source;
      markdown.addEventListener("desk-link", (event) => {
        void buttons.link(/** @type {CustomEvent<{ href: string }>} */ (event).detail.href);
      });
      return markdown;
    }
    case "card": {
      const card = make(doc, "desk-card", data.heading ? { heading: data.heading } : {});
      for (const line of data.lines) {
        const p = make(doc, "p", { class: "line" });
        if (line.label) p.append(make(doc, "span", { class: "label" }, line.label), " ");
        p.append(line.text);
        card.append(p);
      }
      return card;
    }
    default: {
      const list = make(doc, "desk-list", { label: data.label });
      for (const option of data.options) {
        const row = make(doc, "div", { "data-key": option.key });
        row.append(make(doc, "span", { class: "title" }, option.title));
        if (option.detail) row.append(make(doc, "span", { class: "detail" }, option.detail));
        list.append(row);
      }
      return list;
    }
  }
}

/**
 * One component as a section.
 * @param {Document} doc
 * @param {ComponentModel} component
 * @param {Env} env
 * @param {Buttons} buttons
 * @param {Wire} wire  keys, menus and selection for the elements that list items
 */
export function drawComponent(doc, component, env, buttons, wire) {
  const { state, type, path } = component;
  const section = make(doc, "section", {
    class: "component",
    "data-component": type,
    "data-state": state,
    "data-path": path,
  });
  // A card carries its title as its heading; the rest get one above them.
  if (component.title && type !== "card")
    section.append(make(doc, "h2", { class: "component-title" }, component.title));
  const status = (/** @type {string} */ role) =>
    make(doc, "p", { class: "status", ...(role ? { role } : {}) }, component.message);
  const button = () => {
    const fix = BUTTONS[/** @type {keyof typeof BUTTONS} */ (state)];
    if (!fix) return [];
    const [label, action] = fix;
    const el = make(doc, "desk-button", {}, label);
    el.addEventListener("click", () => void buttons[action](path));
    return [el];
  };
  const items = () => {
    if (component.items.length === 0 && state !== "ready") return [];
    const el = itemsOf(doc, component, env, buttons);
    wire(el, component);
    return [el];
  };
  switch (state) {
    case "ready":
      section.append(...items());
      break;
    case "empty":
      section.append(make(doc, "p", { class: "empty" }, component.message));
      break;
    case "stale":
      section.append(...items(), status(""), ...button());
      break;
    case "error":
      section.append(status("alert"), ...button(), ...items());
      break;
    case "loading":
      section.append(status("status"));
      break;
    default:
      section.append(status(""), ...button());
  }
  return section;
}

/**
 * A container and what it holds.
 * @param {Document} doc
 * @param {ContainerModel} container
 * @param {(node: NodeModel) => HTMLElement} child
 */
export function drawContainer(doc, container, child) {
  const box = make(doc, "div", {
    class: `container ${container.type}`,
    "data-direction":
      container.direction ?? (container.type === "stack" ? "vertical" : "horizontal"),
  });
  if (container.type === "grid") box.style.setProperty("--columns", String(container.columns ?? 2));
  const heading = container.title
    ? [make(doc, "h2", { class: "container-title" }, container.title)]
    : [];
  if (container.type !== "tabs") {
    box.append(
      ...heading,
      ...container.children.map((node) => {
        const pane = make(doc, "div", { class: "pane" });
        pane.append(child(node));
        return pane;
      }),
    );
    return box;
  }
  const list = make(doc, "div", { role: "tablist", "aria-label": container.title || "Tabs" });
  const tabs = container.children.map((node, i) =>
    make(
      doc,
      "button",
      { role: "tab", type: "button", "data-tab": String(i) },
      node.title || `Tab ${i + 1}`,
    ),
  );
  const panels = container.children.map((node) => {
    const panel = make(doc, "div", { role: "tabpanel", class: "pane" });
    panel.append(child(node));
    return panel;
  });
  const select = (/** @type {number} */ at, /** @type {boolean} */ focus) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === at));
      tab.tabIndex = i === at ? 0 : -1;
      const panel = /** @type {HTMLElement} */ (panels[i]);
      panel.hidden = i !== at;
    });
    if (focus) tabs[at]?.focus();
  };
  list.addEventListener("keydown", (event) => {
    const at = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    const move = moves[/** @type {keyof typeof moves} */ (event.key)];
    const next =
      move !== undefined
        ? (at + move + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    select(next, true);
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i, true));
  });
  list.append(...tabs);
  select(0, false);
  box.append(...heading, list, ...panels);
  return box;
}
