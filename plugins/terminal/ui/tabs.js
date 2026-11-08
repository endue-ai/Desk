// The terminal's tab strip: one tab per session with its title, an unread badge and an ended mark.
// Arrows, Home and End move between tabs, Enter goes into the terminal, Shift+Arrow moves a tab and
// F2 or a double click renames it (an empty name gives the program's back). A tab drags through the
// desk (ADR 0119), past the SDK's threshold so a click stays a click: dropped on the strip it moves
// there, dropped elsewhere it hands over the folder its shell is in (drops.js).

import { TAB_KIND, tabDrag } from "./drops.js";

/**
 * @typedef {{
 *   select(id: string): unknown,
 *   activate(id: string): unknown,
 *   close(id: string): unknown,
 *   rename(id: string, title: string): unknown,
 *   move(id: string, index: number): unknown,
 *   session?(id: string): import("./types.js").Session | undefined,
 * }} TabActions
 * @typedef {{ tab: HTMLElement, label: HTMLButtonElement, text: HTMLElement, badge: HTMLElement, close: HTMLButtonElement, title: string, unread: number }} Tab
 */

/** The plugin a tab's drag must start in for the strip to move it. */
const SELF = "endue.terminal";

/**
 * @param {Document} doc
 * @param {HTMLElement} strip
 * @param {TabActions} actions
 * @param {import("@endue-ai/plugin-sdk").PluginDnd} [dnd]
 */
export function createTabs(doc, strip, actions, dnd) {
  /** @type {Map<string, Tab>} */
  const tabs = new Map();
  const ids = () =>
    [...strip.querySelectorAll(".tab")].map(
      (el) => /** @type {HTMLElement} */ (el).dataset.id ?? "",
    );

  const describe = (/** @type {Tab} */ t) => {
    t.label.title = t.title;
    t.label.setAttribute("aria-label", t.unread > 0 ? `${t.title}, ${t.unread} unread` : t.title);
    t.close.setAttribute("aria-label", `Close ${t.title}`);
  };

  /** Rename in place: an input over the label, Enter or leaving it keeps the name, Escape does not. */
  const rename = (/** @type {string} */ id) => {
    const t = tabs.get(id);
    if (!t || t.tab.querySelector(".tab-rename")) return;
    const input = doc.createElement("input");
    input.className = "desk-field tab-rename";
    input.value = t.title;
    input.setAttribute("aria-label", "Tab name");
    let done = false;
    const finish = (/** @type {boolean} */ keep) => {
      if (done) return;
      done = true;
      input.remove();
      t.label.hidden = false;
      if (keep && input.value.trim() !== t.title) actions.rename(id, input.value);
      t.label.focus();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    t.label.hidden = true;
    t.tab.insertBefore(input, t.label);
    input.focus();
    input.select();
  };

  strip.addEventListener("keydown", (event) => {
    const order = ids();
    const at = order.findIndex((id) => tabs.get(id)?.label === event.target);
    const id = order[at];
    if (at < 0 || id === undefined || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      actions.activate(id);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      rename(id);
      return;
    }
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      actions.move(id, at + (event.key === "ArrowLeft" ? -1 : 1));
      tabs.get(id)?.label.focus();
      return;
    }
    const to = /** @type {Record<string, number>} */ ({
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      Home: 0,
      End: order.length - 1,
    })[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = order[(to + order.length) % order.length];
    if (next === undefined) return;
    actions.select(next);
    tabs.get(next)?.label.focus();
  });

  const tabOf = (/** @type {unknown} */ target) =>
    target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(".tab")) : null;
  // A press on a tab (not in its rename field) drags it once the pointer has moved far enough.
  dnd?.draggable(strip, {
    item: (target) => {
      const id = tabOf(target)?.dataset.id;
      if (!id || (target instanceof Element && target.closest("input"))) return undefined;
      const session = actions.session?.(id);
      return session ? tabDrag(session) : undefined;
    },
  });
  // A tab dropped on the strip goes before the tab it lands on, or last.
  dnd?.onDrop(
    strip,
    (drop) => {
      const id = /** @type {{ session?: string } | undefined} */ (drop.json(TAB_KIND)[0])?.session;
      if (!id || !tabs.has(id)) return "none";
      const over = tabOf(drop.element);
      const order = ids().filter((other) => other !== id);
      const index = over?.dataset.id ? order.indexOf(over.dataset.id) : order.length;
      actions.move(id, index < 0 ? order.length : index);
      return undefined;
    },
    {
      accept: [`desk/json:${TAB_KIND}`],
      at: (element) => tabOf(element) ?? strip,
      effect: (over) =>
        over.from === SELF && over.effectAllowed.includes("link") ? "link" : "none",
    },
  );

  return {
    /** A tab for `id`, the panel it controls being `panel`. */
    add(/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ panel) {
      const tab = doc.createElement("div");
      tab.className = "tab";
      tab.dataset.id = id;
      tab.setAttribute("role", "presentation");
      const label = doc.createElement("button");
      label.type = "button";
      label.className = "desk-tab";
      label.id = `tab-${id}`;
      label.setAttribute("role", "tab");
      label.setAttribute("aria-controls", panel);
      label.setAttribute("aria-selected", "false");
      const text = doc.createElement("span");
      text.className = "tab-title";
      text.textContent = title;
      const badge = doc.createElement("span");
      badge.className = "desk-badge unread";
      badge.setAttribute("aria-hidden", "true");
      badge.hidden = true;
      label.append(text, badge);
      label.addEventListener("click", () => actions.activate(id));
      label.addEventListener("dblclick", () => rename(id));
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "desk-icon-btn close";
      close.textContent = "×";
      close.addEventListener("click", () => actions.close(id));
      tab.append(label, close);
      strip.append(tab);
      /** @type {Tab} */
      const t = { tab, label, text, badge, close, title, unread: 0 };
      tabs.set(id, t);
      describe(t);
      strip.hidden = tabs.size < 2;
      return t;
    },
    remove(/** @type {string} */ id) {
      tabs.get(id)?.tab.remove();
      tabs.delete(id);
      strip.hidden = tabs.size < 2;
    },
    retitle(/** @type {string} */ id, /** @type {string} */ title) {
      const t = tabs.get(id);
      if (!t) return;
      t.title = title;
      t.text.textContent = title;
      describe(t);
    },
    select(/** @type {string} */ id) {
      for (const [other, t] of tabs) {
        const on = other === id;
        t.label.setAttribute("aria-selected", String(on));
        t.label.tabIndex = on ? 0 : -1;
      }
    },
    badge(/** @type {string} */ id, /** @type {number} */ count) {
      const t = tabs.get(id);
      if (!t) return;
      t.unread = count;
      t.badge.textContent = count > 99 ? "99+" : String(count);
      t.badge.hidden = count === 0;
      describe(t);
    },
    ended(/** @type {string} */ id, /** @type {boolean} */ on) {
      const t = tabs.get(id);
      if (t) t.tab.classList.toggle("is-ended", on);
    },
    move(/** @type {string} */ id, /** @type {number} */ index) {
      const t = tabs.get(id);
      if (!t) return;
      const others = ids().filter((other) => other !== id);
      const before = others[index];
      strip.insertBefore(t.tab, before === undefined ? null : (tabs.get(before)?.tab ?? null));
    },
    rename,
    ids,
  };
}
