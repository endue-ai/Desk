// The DOM for the terminal plugin: a tab strip, one xterm.js terminal per session in a pane of its
// own, and a status live region. Keys go to the shell unless keys.js hands them to the desk or the
// clipboard. The emulator is vendored in ./vendor (ADR 0033).
import { FitAddon } from "./vendor/addon-fit.mjs";
import { Unicode11Addon } from "./vendor/addon-unicode11.mjs";
import { Terminal } from "./vendor/xterm.mjs";

/**
 * @typedef {import("./keys.js").KeyPress} KeyPress
 * @typedef {import("./keys.js").Decision} Decision
 * @typedef {ReturnType<typeof import("./theme.js").terminalOptions>} Options
 * @typedef {{
 *   input(id: string, data: string): unknown,
 *   resize(id: string, cols: number, rows: number): unknown,
 *   select(id: string): unknown,
 *   close(id: string): unknown,
 *   retitle(id: string, title: string): unknown,
 *   bell(id: string): unknown,
 *   key(press: KeyPress, hasSelection: boolean): Decision,
 * }} Actions
 * @typedef {{ term: Terminal, fit: FitAddon, pane: HTMLElement, tab: HTMLElement, label: HTMLButtonElement, close: HTMLButtonElement }} Item
 */

/** Options that take effect on a terminal that is already open. */
const LIVE = [
  "cursorBlink",
  "cursorStyle",
  "fontFamily",
  "fontSize",
  "scrollback",
  "minimumContrastRatio",
  "theme",
];

/** xterm's own options, without the plugin's (copyOnSelect): xterm refuses keys it does not know. */
const xtermOptions = (/** @type {Record<string, unknown>} */ options) =>
  Object.fromEntries(
    Object.entries(options).filter(([name]) => name === "allowProposedApi" || LIVE.includes(name)),
  );

/**
 * @param {Document} doc
 * @param {Actions} actions
 * @param {Options & { copyOnSelect?: boolean }} options
 */
export function createView(doc, actions, options) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const tabs = byId("tabs");
  const panes = byId("panes");
  const status = byId("status");
  /** @type {Map<string, Item>} */
  const items = new Map();
  /** @type {string | null} */
  let shown = null;
  let current = options;
  let fitting = 0;

  const shownItem = () => (shown === null ? undefined : items.get(shown));
  const fitShown = () => {
    fitting = 0;
    const item = shownItem();
    if (item && !item.pane.hidden && item.pane.clientWidth > 0) item.fit.fit();
  };
  const scheduleFit = () => {
    if (fitting === 0) fitting = requestAnimationFrame(fitShown);
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(scheduleFit).observe(panes);

  const copy = () => doc.execCommand("copy");

  /** xterm asks before it handles a key: false leaves the key to the browser, and so to the desk. */
  const onKey = (/** @type {Terminal} */ term, /** @type {KeyboardEvent} */ event) => {
    if (event.type !== "keydown") return true;
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
    switch (actions.key({ key, metaKey, ctrlKey, altKey, shiftKey }, term.hasSelection())) {
      case "desk":
      case "paste":
        // Not prevented: the SDK hands a chord on to the desk's keymap, and the browser pastes into
        // the terminal's text area itself.
        return false;
      case "copy":
        copy();
        event.preventDefault();
        return false;
      default:
        return true;
    }
  };

  const tabsVisible = () => {
    tabs.hidden = items.size < 2;
  };

  return {
    /** @param {string} id @param {string} title */
    open(id, title) {
      const pane = doc.createElement("div");
      pane.className = "pane";
      pane.id = `pane-${id}`;
      pane.setAttribute("role", "tabpanel");
      pane.hidden = true;
      const tab = doc.createElement("div");
      tab.className = "tab";
      tab.setAttribute("role", "presentation");
      const label = doc.createElement("button");
      label.type = "button";
      label.id = `tab-${id}`;
      label.setAttribute("role", "tab");
      label.setAttribute("aria-controls", pane.id);
      label.setAttribute("aria-selected", "false");
      label.textContent = title;
      label.addEventListener("click", () => actions.select(id));
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "close";
      close.setAttribute("aria-label", `Close ${title}`);
      close.textContent = "×";
      close.addEventListener("click", () => actions.close(id));
      tab.append(label, close);
      pane.setAttribute("aria-labelledby", label.id);
      tabs.append(tab);
      panes.append(pane);

      const term = new Terminal(xtermOptions(current));
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.open(pane);
      term.onData((data) => actions.input(id, data));
      term.onResize(({ cols, rows }) => actions.resize(id, cols, rows));
      term.onTitleChange((next) => actions.retitle(id, next));
      term.onBell(() => actions.bell(id));
      term.onSelectionChange(() => {
        if (current.copyOnSelect && term.hasSelection()) copy();
      });
      term.attachCustomKeyEventHandler((event) => onKey(term, event));
      items.set(id, { term, fit, pane, tab, label, close });
      tabsVisible();
      // Fit needs a visible pane: show this one for a moment, size it, and let the caller decide.
      pane.hidden = false;
      if (pane.clientWidth > 0) fit.fit();
      pane.hidden = shown !== id;
      return { cols: term.cols, rows: term.rows };
    },

    /** @param {string} id @param {string | Uint8Array} data */
    write(id, data) {
      items.get(id)?.term.write(data);
    },

    /** A line of the terminal's own, dim, on a line of its own. */
    line(/** @type {string} */ id, /** @type {string} */ text) {
      items.get(id)?.term.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
    },

    show(/** @type {string} */ id) {
      shown = id;
      for (const [other, item] of items) {
        const on = other === id;
        item.pane.hidden = !on;
        item.label.setAttribute("aria-selected", String(on));
        item.label.tabIndex = on ? 0 : -1;
      }
      scheduleFit();
    },

    close(/** @type {string} */ id) {
      const item = items.get(id);
      if (!item) return;
      items.delete(id);
      item.term.dispose();
      item.pane.remove();
      item.tab.remove();
      if (shown === id) shown = null;
      tabsVisible();
    },

    clear(/** @type {string} */ id) {
      items.get(id)?.term.clear();
    },

    retitle(/** @type {string} */ id, /** @type {string} */ title) {
      const item = items.get(id);
      if (!item) return;
      item.label.textContent = title;
      item.close.setAttribute("aria-label", `Close ${title}`);
    },

    focus(/** @type {string} */ id) {
      items.get(id)?.term.focus();
    },

    status(/** @type {string} */ text) {
      status.textContent = text;
    },

    /** The settings or the theme changed: every terminal takes the new options. */
    theme(/** @type {Options & { copyOnSelect?: boolean }} */ next) {
      current = next;
      for (const { term } of items.values()) {
        for (const name of LIVE) {
          const value = /** @type {Record<string, unknown>} */ (next)[name];
          if (value !== undefined)
            /** @type {Record<string, unknown>} */ (term.options)[name] = value;
        }
      }
      scheduleFit();
    },
  };
}
