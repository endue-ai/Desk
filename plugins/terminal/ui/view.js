// The DOM for the terminal plugin: a tab strip (tabs.js), a search bar (searchbar.js), one xterm.js
// terminal per session in a pane of its own, a tab's panes split in its panel (split-view.js, issue 315),
// a right-click menu (menu.js) and a status live region.
// Each terminal hands what programs say in OSC sequences to the actions, keeps IME composition whole
// (ime.js), asks before a risky paste (paste.js), opens links through shell.open (links.js) and
// refits when its box or its cells change (fit.js). Keys go to the shell unless keys.js hands them to
// the desk, the clipboard or search. The emulator is vendored in ./vendor (ADR 0037).
import { createDrops } from "./drops.js";
import { watchFit } from "./fit.js";
import { createImeGuard } from "./ime.js";
import { createLinks } from "./links.js";
import { createMenu, paneItems } from "./menu.js";
import { createNotes } from "./notes.js";
import { CODES } from "./osc.js";
import { createPasteGuard } from "./paste.js";
import { createSearch } from "./search.js";
import { createSearchBar } from "./searchbar.js";
import { createSplits } from "./split-view.js";
import { createStrip } from "./strip.js";
import { LIVE, searchDecorations, xtermOptions } from "./theme.js";
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
 *   split?(id: string, direction: import("./layout.js").Split): unknown,
 *   ratio?(tab: string, path: string, ratio: number, min: import("./layout.js").Min): unknown,
 * }} Actions
 * @typedef {{
 *   bridge: Parameters<typeof createLinks>[0]["bridge"], platform: import("./shell.js").Platform,
 *   pasteWarning(): import("./paste.js").Warn, dnd?: import("@endue-ai/plugin-sdk").PluginDnd,
 * }} Deps
 * @typedef {{ term: Terminal, fit: FitAddon, search: ReturnType<typeof createSearch>, pane: HTMLElement, note: HTMLElement | null, guard: ReturnType<typeof createPasteGuard> | null, tab: string, title: string, unread: number, ended: boolean }} Item
 */

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
  const { tabs, paneIds, inUse, using, tabState } = createStrip(
    doc,
    byId("tabs"),
    actions,
    items,
    deps.dnd,
  );
  const fitTab = (/** @type {string} */ tab) => {
    for (const id of paneIds(tab)) {
      const item = items.get(id);
      if (item && !item.pane.hidden && item.pane.clientWidth > 0) item.fit.fit();
    }
  };
  const splits = createSplits(doc, panes, {
    ratio: (tab, path, ratio, min) => actions.ratio?.(tab, path, ratio, min),
    // No pane under 8 columns or 3 rows: a cell's size from a terminal of the tab.
    min: (tab) => {
      const item = items.get(inUse(tab));
      const box = panes.getBoundingClientRect();
      if (!item || item.term.cols < 1 || item.term.rows < 1 || !box.width || !box.height)
        return { width: 0.05, height: 0.05 };
      const cell = item.pane.clientWidth / item.term.cols;
      const line = item.pane.clientHeight / item.term.rows;
      return { width: (8 * cell) / box.width, height: (3 * line) / box.height };
    },
  });
  const menu = createMenu(doc);
  const links = createLinks({ bridge: deps.bridge, say, platform: deps.platform });
  const bar = createSearchBar(doc, byId("search"), {
    search: () => shownItem()?.search,
    back: () => shownItem()?.term.focus(),
  });
  const fitShown = () => {
    const item = shownItem();
    if (item) fitTab(item.tab);
  };
  /**
   * The desk gave this window the keys with nothing in it focused (a start, not a click): the
   * terminal on screen takes them, as a click into it would; also when it shows after they came.
   */
  const claim = () => {
    const free = !doc.activeElement || doc.activeElement === doc.body;
    if (free && doc.hasFocus()) shownItem()?.term.focus();
  };
  const win = doc.defaultView;
  if (win) {
    watchFit({ win, doc, target: panes, fit: fitShown });
    win.addEventListener("focus", () => {
      actions.attend();
      claim();
    });
  }

  const copy = () => doc.execCommand("copy");
  const find = () => bar.show(shownItem()?.term.getSelection() ?? "");

  /** xterm asks before it handles a key: false leaves the key to the browser, and so to the desk. */
  const onKey = (
    /** @type {string} */ id,
    /** @type {Terminal} */ term,
    /** @type {KeyboardEvent} */ event,
  ) => {
    if (event.type !== "keydown") return true;
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
    const decision = actions.key({ key, metaKey, ctrlKey, altKey, shiftKey }, term.hasSelection());
    if (typeof decision === "object") {
      // The shell's key as text of the terminal's own (keys.js): ⌥← and ⌥→ on macOS.
      event.preventDefault();
      actions.input(id, decision.type);
      return false;
    }
    switch (decision) {
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

  const { note, unnote, ask } = createNotes(doc);

  const contextMenu = (/** @type {string} */ id, /** @type {MouseEvent} */ event) => {
    const item = items.get(id);
    if (!item) return;
    const { term } = item;
    const items_ = paneItems({
      term,
      chord,
      copy,
      paste: () => {
        if (!doc.execCommand("paste")) say(`Press ${chord("V")} to paste.`);
      },
      find,
      rename: () => tabs.rename(item.tab),
      split: (direction) => actions.split?.(id, direction),
      close: () => actions.close(id),
    });
    menu.show(event.clientX, event.clientY, items_, () => term.focus());
  };

  return {
    /** A pane for `id` in the tab `tab` (a new tab when it has none yet). */
    open(/** @type {string} */ id, /** @type {string} */ title, tab = id) {
      const pane = doc.createElement("div");
      pane.className = "pane";
      pane.id = `pane-${id}`;
      const fresh = paneIds(tab).length === 0;
      const panel = splits.panel(tab);
      if (fresh) {
        const t = tabs.add(tab, title, panel.id);
        // The tab's own menu: the pane in use's, from a right-click on its label.
        t.label.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          contextMenu(inUse(tab), event);
        });
      }
      panel.append(pane);
      // A press in a pane makes it the one in use; xterm takes the focus itself.
      pane.addEventListener("pointerdown", () => {
        if (shown !== id) actions.activate(id);
      });

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
        decorations: () => searchDecorations(current),
        render: (state) => shown === id && bar.render(state.label),
      });
      /** @type {Item} */
      const item = {
        ...{ term, fit, search, pane, note: null, guard: null, tab, title },
        ...{ unread: 0, ended: false },
      };
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
      term.attachCustomKeyEventHandler((event) => onKey(id, term, event));
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
          contextMenu(id, event);
        },
        true,
      );
      items.set(id, item);
      if (fresh) using.set(tab, id);
      // Fit needs a visible panel: show the tab's for a moment, size the pane, let the caller decide.
      const hidden = panel.hidden;
      panel.hidden = false;
      if (pane.clientWidth > 0) fit.fit();
      panel.hidden = hidden;
      return { cols: term.cols, rows: term.rows };
    },

    /** The tab's panes placed as `layout` says, and refitted when the tab is on screen. */
    layout(/** @type {string} */ tab, /** @type {import("./layout.js").Layout} */ layout) {
      splits.arrange(tab, layout, (id) => items.get(id)?.pane);
      if (splits.visible(tab)) fitTab(tab);
    },

    /** @param {string} id @param {string | Uint8Array} data */
    write(id, data) {
      items.get(id)?.term.write(data);
    },

    /** A line of the terminal's own, dim, on a line of its own. */
    line(/** @type {string} */ id, /** @type {string} */ text) {
      items.get(id)?.term.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
    },

    /** Show the tab `id` is in, `id` its pane in use, marked when the tab is split. */
    show(/** @type {string} */ id) {
      const item = items.get(id);
      if (!item) return;
      const before = shownItem()?.search;
      shown = id;
      using.set(item.tab, id);
      splits.show(item.tab);
      for (const [other, it] of items) {
        if (it.tab === item.tab) it.pane.classList.toggle("is-active", other === id);
      }
      tabs.select(item.tab);
      tabState(item.tab);
      bar.switched(before === shownItem()?.search ? undefined : before);
      win?.requestAnimationFrame(fitShown);
      claim();
    },

    close(/** @type {string} */ id) {
      const item = items.get(id);
      if (!item) return;
      items.delete(id);
      item.term.dispose();
      item.pane.remove();
      if (using.get(item.tab) === id) using.delete(item.tab);
      if (paneIds(item.tab).length === 0) {
        tabs.remove(item.tab);
        splits.remove(item.tab);
        using.delete(item.tab);
      } else tabState(item.tab);
      if (shown === id) shown = null;
    },

    clear(/** @type {string} */ id) {
      items.get(id)?.term.clear();
    },

    retitle(/** @type {string} */ id, /** @type {string} */ title) {
      const item = items.get(id);
      if (!item) return;
      item.title = title;
      tabState(item.tab);
    },

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

    badge(/** @type {string} */ id, /** @type {number} */ count) {
      const item = items.get(id);
      if (!item) return;
      item.unread = count;
      tabState(item.tab);
    },

    /** The program ended (`text` says how) or started again (null): a banner with Restart. */
    end(/** @type {string} */ id, /** @type {string | null} */ text) {
      const item = items.get(id);
      if (!item) return;
      item.ended = text !== null;
      tabState(item.tab);
      if (text === null) {
        unnote(item);
        return;
      }
      note(item, `${text} Press Enter to start it again.`, [
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
