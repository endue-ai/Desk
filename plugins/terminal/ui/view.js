// The DOM for the terminal plugin: a tab strip (tabs.js), a search bar (searchbar.js), one xterm.js
// terminal per session in a pane of its own, a right-click menu (menu.js) and a status live region.
// Each terminal hands what programs say in OSC sequences to the actions, keeps IME composition whole
// (ime.js), asks before a risky paste (paste.js), opens links through shell.open (links.js) and
// refits when its box or its cells change (fit.js). Keys go to the shell unless keys.js hands them to
// the desk, the clipboard or search. The emulator is vendored in ./vendor (ADR 0037).
import { createDrops } from "./drops.js";
import { watchFit } from "./fit.js";
import { createImeGuard } from "./ime.js";
import { createLinks } from "./links.js";
import { createMenu } from "./menu.js";
import { CODES } from "./osc.js";
import { createPasteGuard } from "./paste.js";
import { createSearch } from "./search.js";
import { createSearchBar } from "./searchbar.js";
import { createTabs } from "./tabs.js";
import { FitAddon } from "./vendor/addon-fit.mjs";
import { SearchAddon } from "./vendor/addon-search.mjs";
import { Unicode11Addon } from "./vendor/addon-unicode11.mjs";
import { WebLinksAddon } from "./vendor/addon-web-links.mjs";
import { Terminal } from "./vendor/xterm.mjs";

/**
 * @typedef {import("./keys.js").KeyPress} KeyPress
 * @typedef {import("./keys.js").Decision} Decision
 * @typedef {ReturnType<typeof import("./theme.js").terminalOptions>} Options
 * @typedef {{
 *   input(id: string, data: string): unknown, resize(id: string, cols: number, rows: number): unknown,
 *   select(id: string): unknown, activate(id: string): unknown, close(id: string): unknown,
 *   retitle(id: string, title: string): unknown, bell(id: string): unknown,
 *   key(press: KeyPress, hasSelection: boolean): Decision,
 *   osc(id: string, code: number, data: string): unknown, rename(id: string, title: string): unknown,
 *   move(id: string, index: number): unknown, restart(id: string): unknown, attend(): unknown,
 *   session?(id: string): import("./types.js").Session | undefined,
 * }} Actions
 * @typedef {{
 *   bridge: Parameters<typeof createLinks>[0]["bridge"], platform: import("./shell.js").Platform,
 *   pasteWarning(): import("./paste.js").Warn, dnd?: import("@endue-ai/plugin-sdk").PluginDnd,
 * }} Deps
 * @typedef {{ term: Terminal, fit: FitAddon, search: ReturnType<typeof createSearch>, pane: HTMLElement, note: HTMLElement | null, guard: ReturnType<typeof createPasteGuard> | null }} Item
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

const HEX = /^#[0-9a-f]{6}$/iu;

/** Search highlights from the theme: xterm's decorations take #rrggbb only. */
const decorationsOf = (/** @type {Options} */ options) => {
  const theme = /** @type {Record<string, string | undefined>} */ (options.theme ?? {});
  const match = theme.yellow;
  const active = theme.cursor;
  if (!match || !active || !HEX.test(match) || !HEX.test(active)) return undefined;
  return {
    matchBorder: match,
    matchOverviewRuler: match,
    activeMatchBorder: active,
    activeMatchColorOverviewRuler: active,
  };
};

/**
 * @param {Document} doc
 * @param {Actions} actions
 * @param {Options & { copyOnSelect?: boolean }} options
 * @param {Deps} deps
 */
export function createView(doc, actions, options, deps) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const panes = byId("panes");
  const status = byId("status");
  /** @type {Map<string, Item>} */
  const items = new Map();
  /** @type {string | null} */
  let shown = null;
  let current = options;
  const mac = deps.platform === "mac";
  const chord = (/** @type {string} */ key) => (mac ? `⌘${key}` : `Ctrl+Shift+${key}`);

  const say = (/** @type {string} */ text) => {
    status.textContent = text;
  };
  const shownItem = () => (shown === null ? undefined : items.get(shown));
  const tabs = createTabs(doc, byId("tabs"), actions, deps.dnd);
  const menu = createMenu(doc);
  const links = createLinks({ bridge: deps.bridge, say, platform: deps.platform });
  const bar = createSearchBar(doc, byId("search"), {
    search: () => shownItem()?.search,
    back: () => shownItem()?.term.focus(),
  });
  const fitShown = () => {
    const item = shownItem();
    if (item && !item.pane.hidden && item.pane.clientWidth > 0) item.fit.fit();
  };
  const win = doc.defaultView;
  if (win) {
    watchFit({ win, doc, target: panes, fit: fitShown });
    win.addEventListener("focus", () => actions.attend());
  }

  const copy = () => doc.execCommand("copy");
  const find = () => bar.show(shownItem()?.term.getSelection() ?? "");

  /** xterm asks before it handles a key: false leaves the key to the browser, and so to the desk. */
  const onKey = (/** @type {Terminal} */ term, /** @type {KeyboardEvent} */ event) => {
    if (event.type !== "keydown") return true;
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
    switch (actions.key({ key, metaKey, ctrlKey, altKey, shiftKey }, term.hasSelection())) {
      case "desk":
      case "paste":
        // Not prevented: the SDK hands a chord on to the desk's keymap, and the browser pastes into
        // the terminal's text area itself (the paste guard below catches it).
        return false;
      case "copy":
        copy();
        event.preventDefault();
        return false;
      case "find":
        event.preventDefault();
        find();
        return false;
      default:
        return true;
    }
  };

  /** A line of question or state over the bottom of a pane, with its buttons. */
  const note = (
    /** @type {Item} */ item,
    /** @type {string} */ text,
    /** @type {Array<[string, boolean, () => void]>} */ buttons,
  ) => {
    item.note?.remove();
    const bar = doc.createElement("div");
    bar.className = "pane-note";
    bar.setAttribute("role", "status");
    const words = doc.createElement("span");
    words.textContent = text;
    bar.append(words);
    for (const [label, primary, run] of buttons) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "desk-btn";
      if (primary) button.classList.add("desk-btn-primary");
      button.textContent = label;
      button.addEventListener("click", run);
      bar.append(button);
    }
    item.pane.append(bar);
    item.note = bar;
    return bar;
  };
  const unnote = (/** @type {Item} */ item) => {
    item.note?.remove();
    item.note = null;
  };

  /** Several lines into a program that does not bracket pastes: paste them, or not. */
  const ask = (/** @type {Item} */ item, /** @type {number} */ lines) =>
    new Promise((resolve) => {
      const answer = (/** @type {boolean} */ yes) => {
        unnote(item);
        item.term.focus();
        resolve(yes);
      };
      const bar = note(item, `Paste ${lines} lines? Each one runs as it arrives.`, [
        ["Paste", true, () => answer(true)],
        ["Cancel", false, () => answer(false)],
      ]);
      bar.addEventListener("keydown", (event) => {
        if (event.key === "Escape") answer(false);
      });
      bar.querySelector("button")?.focus();
    });

  const contextMenu = (
    /** @type {string} */ id,
    /** @type {Item} */ item,
    /** @type {MouseEvent} */ event,
  ) => {
    const { term } = item;
    menu.show(
      event.clientX,
      event.clientY,
      [
        {
          label: "Copy",
          keys: chord("C"),
          disabled: !term.hasSelection(),
          run: () => {
            term.focus();
            copy();
          },
        },
        {
          label: "Paste",
          keys: chord("V"),
          run: () => {
            term.focus();
            if (!doc.execCommand("paste")) say(`Press ${chord("V")} to paste.`);
          },
        },
        { label: "Select all", run: () => term.selectAll() },
        { label: "Clear", run: () => term.clear() },
        { label: "Find", keys: chord("F"), run: find },
        { label: "Rename tab", run: () => tabs.rename(id) },
      ],
      () => term.focus(),
    );
  };

  return {
    /** @param {string} id @param {string} title */
    open(id, title) {
      const pane = doc.createElement("div");
      pane.className = "pane";
      pane.id = `pane-${id}`;
      pane.setAttribute("role", "tabpanel");
      pane.hidden = true;
      const tab = tabs.add(id, title, pane.id);
      pane.setAttribute("aria-labelledby", tab.label.id);
      panes.append(pane);

      const term = new Terminal({ ...xtermOptions(current), linkHandler: links.handler });
      const fit = new FitAddon();
      const searching = new SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.loadAddon(searching);
      term.loadAddon(new WebLinksAddon(links.open, links.handler));
      term.open(pane);
      const search = createSearch(searching, {
        decorations: () => decorationsOf(current),
        render: (state) => shown === id && bar.render(state.label),
      });
      /** @type {Item} */
      const item = { term, fit, search, pane, note: null, guard: null };
      const ime = createImeGuard({ send: (data) => actions.input(id, data) });
      term.onData((data) => ime.data(data));
      const area = term.textarea;
      area?.addEventListener("compositionstart", () => ime.start());
      area?.addEventListener("compositionupdate", (e) => ime.update(e.data ?? ""));
      area?.addEventListener("compositionend", (e) => ime.end(e.data ?? ""));
      for (const code of CODES) {
        term.parser.registerOscHandler(code, (data) => {
          actions.osc(id, code, data);
          return true;
        });
      }
      term.onResize(({ cols, rows }) => actions.resize(id, cols, rows));
      term.onTitleChange((next) => actions.retitle(id, next));
      term.onBell(() => actions.bell(id));
      term.onSelectionChange(() => {
        if (current.copyOnSelect && term.hasSelection()) copy();
      });
      term.attachCustomKeyEventHandler((event) => onKey(term, event));
      const guard = createPasteGuard({
        paste: (text) => term.paste(text),
        ask: (_text, lines) => ask(item, lines),
        bracketed: () => term.modes.bracketedPasteMode,
        warn: deps.pasteWarning,
      });
      item.guard = guard;
      // Before xterm's own paste handlers, which sit on its text area and element.
      pane.addEventListener(
        "paste",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          void guard.paste(event.clipboardData?.getData("text/plain") ?? "");
        },
        true,
      );
      pane.addEventListener(
        "contextmenu",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          contextMenu(id, item, event);
        },
        true,
      );
      items.set(id, item);
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
      const before = shownItem()?.search;
      shown = id;
      for (const [other, item] of items) item.pane.hidden = other !== id;
      tabs.select(id);
      bar.switched(before === shownItem()?.search ? undefined : before);
      win?.requestAnimationFrame(fitShown);
    },

    close(/** @type {string} */ id) {
      const item = items.get(id);
      if (!item) return;
      items.delete(id);
      item.term.dispose();
      item.pane.remove();
      tabs.remove(id);
      if (shown === id) shown = null;
    },

    clear(/** @type {string} */ id) {
      items.get(id)?.term.clear();
    },

    retitle: (/** @type {string} */ id, /** @type {string} */ title) => tabs.retitle(id, title),

    focus(/** @type {string} */ id) {
      items.get(id)?.term.focus();
    },

    /** Drops (drops.js): on the panes, landing on the one shown, pasted through its guard. */
    dropTarget: panes,
    landing: () => shownItem()?.pane ?? panes,
    pasteGuard: (/** @type {string} */ id) => items.get(id)?.guard ?? undefined,
    /** Take drops on the terminals (drops.js). @param {import("./drops.js").Terminals} terminals */
    drops(/** @type {import("@endue-ai/plugin-sdk").PluginDnd | undefined} */ dnd, terminals) {
      createDrops(dnd, terminals, this);
    },

    status: say,

    /** The visual bell: the pane's edge lights for a moment. */
    flash(/** @type {string} */ id) {
      const pane = items.get(id)?.pane;
      if (!pane) return;
      pane.classList.add("is-bell");
      setTimeout(() => pane.classList.remove("is-bell"), 150);
    },

    badge: (/** @type {string} */ id, /** @type {number} */ count) => tabs.badge(id, count),

    /** The program ended (`text` says how) or started again (null): a banner with Restart. */
    end(/** @type {string} */ id, /** @type {string | null} */ text) {
      const item = items.get(id);
      if (!item) return;
      tabs.ended(id, text !== null);
      if (text === null) {
        unnote(item);
        return;
      }
      note(item, text, [
        ["Restart", true, () => actions.restart(id)],
        ["Close", false, () => actions.close(id)],
      ]);
    },

    move: (/** @type {string} */ id, /** @type {number} */ index) => tabs.move(id, index),

    find,

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
      win?.requestAnimationFrame(fitShown);
    },
  };
}
