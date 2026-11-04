// The DOM for the chat plugin: the bar (layouts, search), the navigation (nav.js), the main area
// and the thread (panes.js) with their composers (composer.js), and a status live region. One
// click listener answers every button by its `data-act`; single letters outside a text field are
// the plugin's own keys; chords are never prevented, so they reach the desk's keymap.
import { createComposers } from "./dom/composer.js";
import { createNav } from "./dom/nav.js";
import { createPanes } from "./dom/panes.js";
import { LAYOUTS } from "./query.js";

/**
 * @typedef {import("./present.js").Chrome} Chrome
 * @typedef {import("./present.js").Main} Main
 * @typedef {import("./present.js").ThreadModel} ThreadModel
 * @typedef {ReturnType<typeof import("./present.js").sidebarOf>} Sidebar
 * @typedef {{
 *   command(id: string, args?: Record<string, unknown>): unknown,
 *   open(conversation: string): unknown, activate(key: string): unknown,
 *   select(key: string | null): unknown, key(name: string, where: string): Promise<boolean> | boolean,
 *   more(where: string): unknown, type(target: string, text: string): unknown,
 *   cancelEdit(): boolean, closeThread(): boolean, retry(key: string): unknown,
 *   discard(key: string): unknown, link(url: string): unknown,
 * }} Actions
 */

/** Letters pressed on a message or anywhere outside a field, and the command each runs. */
export const LETTERS =
  /** @type {Record<string, [string, "message" | "conversation" | "none"]>} */ ({
    r: ["endue.chat.reply", "message"],
    e: ["endue.chat.edit", "message"],
    "+": ["endue.chat.react", "message"],
    s: ["endue.chat.save", "message"],
    Delete: ["endue.chat.delete", "message"],
    m: ["endue.chat.mark-read", "conversation"],
    p: ["endue.chat.pin", "conversation"],
    n: ["endue.chat.next-unread", "none"],
  });
const MOVES = ["ArrowUp", "ArrowDown", "Home", "End", "j", "k"];

/** @param {Document} doc @param {Actions} actions */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const layouts = byId("layouts");
  const search = /** @type {HTMLInputElement} */ (byId("search"));
  const status = byId("status");
  const groups = byId("groups");
  /** @type {string[]} */
  let quick = [];
  /** @type {string | null} */
  let paneTarget = null;
  /** @type {string | null} */
  let threadTarget = null;
  /** @type {string | null} */
  let current = null;
  /** @type {string | null} */
  let selected = null;

  const composers = createComposers(doc, {
    type: (target, text) => actions.type(target, text),
    send: (target) => actions.command("endue.chat.send", { target }),
    editLast: (target) => actions.command("endue.chat.edit", { last: true, target }),
    cancelEdit: () => actions.cancelEdit(),
    leave: (target) => focus(target.startsWith("thread:") ? "thread-messages" : "messages"),
  });
  const nav = createNav(doc);
  const panes = createPanes(doc, composers, () => quick);

  layouts.replaceChildren(
    ...LAYOUTS.map((l) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.dataset.layout = l.id;
      b.setAttribute("role", "tab");
      b.title = `${l.title} (${l.key})`;
      b.textContent = l.title;
      return b;
    }),
  );
  layouts.addEventListener("click", (event) => {
    const b = /** @type {HTMLElement} */ (event.target).closest("[data-layout]");
    if (b instanceof HTMLElement && b.dataset.layout)
      actions.command("endue.chat.layout", { layout: b.dataset.layout });
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      actions.command("endue.chat.search", { text: search.value });
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (search.value !== "") {
        search.value = "";
        actions.command("endue.chat.search", { text: "" });
      } else focus("messages");
    }
  });
  byId("refresh").addEventListener("click", () => actions.command("endue.chat.refresh"));
  byId("read-all").addEventListener("click", () => actions.command("endue.chat.mark-all-read"));

  /** Every button of the page, by what it does. */
  doc.body.addEventListener("click", (event) => {
    const el = /** @type {HTMLElement} */ (event.target);
    const platform = el.closest("[data-platform]");
    if (platform instanceof HTMLElement)
      return void actions.command("endue.chat.platform", { platform: platform.dataset.platform });
    const filter = el.closest("[data-filter]");
    if (filter instanceof HTMLElement)
      return void actions.command("endue.chat.filter", { filter: filter.dataset.filter });
    const option = el.closest("[role=option][data-conv]");
    if (option instanceof HTMLElement && option.dataset.conv)
      return void actions.open(option.dataset.conv);
    const act = el.closest("[data-act]");
    if (act instanceof HTMLElement) {
      const { key, conv: conversation, href, emoji } = act.dataset;
      switch (act.dataset.act) {
        case "link":
        case "original":
          event.preventDefault();
          if (href) actions.link(href);
          return;
        case "react":
          return void actions.command("endue.chat.react", { key, emoji });
        case "react-pick":
          return void actions.command("endue.chat.react", { key });
        case "retry":
          return void (key && actions.retry(key));
        case "discard":
          return void (key && actions.discard(key));
        case "open-conversation":
          return void (key
            ? actions.command("endue.chat.show", { key })
            : conversation && actions.open(conversation));
        case "mark-read":
          return void actions.command("endue.chat.mark-read", { conversation });
        case "pin":
          return void actions.command("endue.chat.pin", { conversation });
        case "more":
          return void actions.more("conversation");
        case "more-timeline":
          return void actions.more("timeline");
        case "close-thread":
          actions.closeThread();
          return focus("messages");
        default:
          if (act.dataset.act)
            return void actions.command(`endue.chat.${act.dataset.act}`, { key });
      }
    }
    const article = el.closest("article.msg[data-key]");
    if (
      article instanceof HTMLElement &&
      article.dataset.key &&
      !article.classList.contains("pending")
    )
      actions.select(article.dataset.key);
  });

  groups.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (MOVES.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      nav.move(event.key);
    } else if (event.key === "Enter" || event.key === " ") {
      const option = /** @type {HTMLElement} */ (event.target).closest("[data-conv]");
      if (option instanceof HTMLElement && option.dataset.conv) {
        event.preventDefault();
        event.stopPropagation();
        actions.open(option.dataset.conv);
        focus("composer");
      }
    }
  });

  doc.body.addEventListener("keydown", async (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest?.("input, textarea, select, [contenteditable]")) return;
    const where = target.closest?.("#thread") ? "thread" : "messages";
    const layout = LAYOUTS.find((l) => l.key === event.key);
    const letter = LETTERS[event.key === "Backspace" ? "Delete" : event.key];
    if (layout) {
      event.preventDefault();
      actions.command("endue.chat.layout", { layout: layout.id });
    } else if (event.key === "/") {
      event.preventDefault();
      focus("search");
    } else if (event.key === "c") {
      event.preventDefault();
      focus("composer");
    } else if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      const order = nav.order();
      const at = current ? order.indexOf(current) : -1;
      const next =
        order[
          event.key === "]"
            ? Math.min(order.length - 1, at + 1)
            : Math.max(0, at < 0 ? order.length - 1 : at - 1)
        ];
      if (next) actions.open(next);
    } else if (MOVES.includes(event.key)) {
      event.preventDefault();
      if (await actions.key(event.key, where))
        focus(where === "thread" ? "thread-messages" : "messages");
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      actions.activate(selected);
    } else if (letter) {
      event.preventDefault();
      const [command, about] = letter;
      actions.command(
        command,
        about === "message"
          ? selected
            ? { key: selected }
            : {}
          : about === "conversation" && current
            ? { conversation: current }
            : {},
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!actions.cancelEdit() && !actions.closeThread()) focus("list");
    }
  });
  // The surface becomes visible after show() reaches the desk, which then focuses this frame.
  doc.defaultView?.addEventListener("focus", () => {
    if (doc.activeElement === doc.body) focus(paneTarget ? "composer" : "list");
  });

  /** @param {string} where */
  const focus = (where) => {
    if (where === "search") return search.focus();
    if (where === "list") return nav.focus();
    if (where === "composer") return void (paneTarget ? composers.focus(paneTarget) : nav.focus());
    if (where === "thread") return void (threadTarget && composers.focus(threadTarget));
    const scope = where === "thread-messages" ? byId("thread") : byId("main");
    const article = /** @type {HTMLElement | null} */ (
      scope.querySelector("article.msg.selected") ?? scope.querySelector(".log")
    );
    article?.focus({ preventScroll: false });
    article?.scrollIntoView?.({ block: "nearest" });
  };

  return {
    /** @param {Chrome} c */
    chrome(c) {
      quick = c.quick;
      for (const b of layouts.querySelectorAll("[data-layout]"))
        b.setAttribute("aria-selected", String(b.getAttribute("data-layout") === c.layout));
      if (doc.activeElement !== search && search.value !== c.search) search.value = c.search;
      doc.body.dataset.layout = c.layout;
      doc.body.dataset.density = c.density;
      doc.body.dataset.connected = String(c.connected);
      nav.chrome(c);
    },
    /** @param {Sidebar} s */
    sidebar(s) {
      current = s.current;
      nav.sidebar(s);
    },
    /** @param {Main} m */
    main(m) {
      const panesOf =
        m.layout === "conversation"
          ? m.pane
            ? [m.pane]
            : []
          : m.layout === "inbox"
            ? m.cards
            : m.layout === "columns"
              ? m.columns
              : [];
      paneTarget =
        m.layout === "conversation"
          ? (m.pane?.composer.target ?? null)
          : (panesOf[0]?.composer.target ?? null);
      const rows = m.layout === "timeline" ? m.rows : panesOf.flatMap((p) => p.rows);
      const picked = rows.find((r) => r.type === "message" && r.message.selected);
      selected =
        picked?.key ?? (selected && rows.some((r) => r.key === selected) ? selected : null);
      panes.main(m);
    },
    /** @param {ThreadModel | null} t */
    thread(t) {
      threadTarget = t?.composer.target ?? null;
      if (t?.rows.some((r) => r.type === "message" && r.message.selected))
        selected = t.rows.find((r) => r.type === "message" && r.message.selected)?.key ?? selected;
      if (t?.root.selected) selected = t.root.key;
      panes.thread(t);
    },
    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },
    focus,
  };
}
