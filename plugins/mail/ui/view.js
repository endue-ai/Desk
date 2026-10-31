// The DOM for the mail plugin: the mailbox navigation, one list with role=listbox whose rows are
// threads (roving tabindex), the reader and the composer in the third column (reader.js,
// composer.js), and a status live region. Single letters inside the list and the reader are the
// plugin's own keys (j k, Enter, r a f, e #, s u, c /, Escape); chords are never prevented, so
// they reach the desk's keymap.
import { createComposer } from "./composer.js";
import { listTime } from "./format.js";
import { createReader } from "./reader.js";

/**
 * @typedef {import("./present.js").Row} Row
 * @typedef {import("./present.js").Nav} Nav
 * @typedef {import("./present.js").ReaderModel} ReaderModel
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {{
 *   select(id: string): unknown, activate(id: string): unknown, key(name: string): unknown,
 *   more(): unknown, mailbox(id: string): unknown, account(key: string | null): unknown,
 *   search(text: string): unknown, command(id: string, args?: Record<string, unknown>): unknown,
 *   openMessage(key: string): unknown, edit(fields: Record<string, string>): unknown,
 *   send(): unknown, discard(): unknown, closeComposer(): unknown,
 * }} Actions
 */

/** Letters pressed on the list or the reader, and the command each runs on the open message. */
export const LETTER_COMMANDS = /** @type {Record<string, string>} */ ({
  c: "endue.mail.compose",
  r: "endue.mail.reply",
  f: "endue.mail.forward",
  e: "endue.mail.archive",
  "#": "endue.mail.trash",
  s: "endue.mail.flag",
  u: "endue.mail.toggle-unread",
  "/": "endue.mail.search",
});
/** Letters pressed on the reader that answer its invitation. */
export const ANSWER_KEYS = /** @type {Record<string, string>} */ ({
  y: "accepted",
  m: "tentative",
  n: "declined",
});
const LIST_KEYS = ["ArrowUp", "ArrowDown", "Home", "End", "Enter", "j", "k"];

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const navList = byId("mailboxes");
  const accounts = /** @type {HTMLSelectElement} */ (byId("account"));
  const searchBox = /** @type {HTMLInputElement} */ (byId("search"));
  const list = byId("list");
  const more = /** @type {HTMLButtonElement} */ (byId("more"));
  const empty = byId("empty");
  const status = byId("status");
  const pane = byId("pane");
  /** @type {Map<string, HTMLElement>} */
  const items = new Map();
  /** @type {string | null} */
  let selected = null;
  let composing = false;

  const reader = createReader(doc, byId("reader"), {
    command: (id, args) => actions.command(id, args),
    openMessage: (key) => actions.openMessage(key),
  });
  const composer = createComposer(doc, byId("composer"), {
    edit: (fields) => actions.edit(fields),
    send: () => actions.send(),
    discard: () => actions.discard(),
    close: () => actions.closeComposer(),
  });

  byId("compose").addEventListener("click", () => actions.command("endue.mail.compose"));
  byId("refresh").addEventListener("click", () => actions.command("endue.mail.refresh"));
  accounts.addEventListener("change", () => actions.account(accounts.value || null));
  searchBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void actions.search(searchBox.value);
    } else if (event.key === "Escape" && searchBox.value !== "") {
      event.preventDefault();
      searchBox.value = "";
      void actions.search("");
    }
  });
  navList.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-mailbox]");
    if (button instanceof HTMLElement && button.dataset.mailbox)
      void actions.mailbox(button.dataset.mailbox);
  });
  list.addEventListener("click", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=option]");
    const id = item instanceof HTMLElement ? item.dataset.id : undefined;
    if (id === undefined) return;
    actions.select(id);
    void actions.activate(id);
  });
  more.addEventListener("click", () => actions.more());

  /** The plugin's own letters, on the list and the reader; typing in a field is left alone. */
  const letters = (/** @type {KeyboardEvent} */ event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest("input, textarea, select, [contenteditable]")) return false;
    const command = LETTER_COMMANDS[event.key];
    if (command) {
      event.preventDefault();
      void actions.command(command, {});
      return true;
    }
    if (event.key === "a") {
      event.preventDefault();
      void actions.command("endue.mail.reply", { all: true });
      return true;
    }
    return false;
  };
  list.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (LIST_KEYS.includes(event.key)) {
      event.preventDefault();
      void actions.key(event.key);
    } else letters(event);
  });
  byId("reader").addEventListener("keydown", (event) => {
    if (letters(event)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const answer = ANSWER_KEYS[event.key];
    if (answer && reader.canAnswer()) {
      event.preventDefault();
      void actions.command("endue.mail.rsvp", { status: answer });
    } else if (event.key === "Escape") {
      event.preventDefault();
      focus("list");
    }
  });
  // The surface becomes visible after show() reaches the desk, which then focuses this frame.
  doc.defaultView?.addEventListener("focus", () => focus(composing ? "composer" : "list"));

  const focus = (/** @type {"list" | "reader" | "composer"} */ where) => {
    if (where === "composer") composer.focus();
    else if (where === "reader") reader.focus();
    else {
      const item = selected === null ? undefined : items.get(selected);
      if (item) {
        item.focus({ preventScroll: true });
        item.scrollIntoView?.({ block: "nearest" });
      } else list.focus();
    }
  };

  const row = (/** @type {Row} */ model, /** @type {number} */ index, /** @type {number} */ of) => {
    const item = doc.createElement("li");
    item.setAttribute("role", "option");
    item.id = `row-${index}`;
    item.dataset.id = model.id;
    item.className = `row${model.unread ? " is-unread" : ""}${model.draft ? " is-draft" : ""}`;
    item.setAttribute("aria-selected", String(model.id === selected));
    item.setAttribute("aria-posinset", String(index + 1));
    item.setAttribute("aria-setsize", String(of));
    item.tabIndex = model.id === selected ? 0 : -1;
    const top = doc.createElement("div");
    top.className = "row-top";
    const people = doc.createElement("span");
    people.className = "people";
    people.textContent = model.draft ? `Draft to ${model.people}` : model.people;
    const time = doc.createElement("time");
    time.dateTime = model.time;
    time.textContent = listTime(model.time);
    top.append(people, time);
    const title = doc.createElement("div");
    title.className = "title";
    title.textContent = model.title;
    if (model.count > 1) {
      const count = doc.createElement("span");
      count.className = "count";
      count.textContent = String(model.count);
      title.append(" ", count);
    }
    const marks = doc.createElement("span");
    marks.className = "marks";
    marks.setAttribute("aria-hidden", "true");
    marks.textContent = `${model.flagged ? "★" : ""}${model.attachments ? "📎" : ""}${model.invitation ? "📅" : ""}`;
    title.append(marks);
    const snippet = doc.createElement("div");
    snippet.className = "snippet";
    snippet.textContent = model.snippet;
    item.append(top, title, snippet);
    const words = [
      model.unread ? `${model.unread} unread` : "",
      model.flagged ? "flagged" : "",
      model.attachments ? "with attachments" : "",
      model.invitation ? "with an invitation" : "",
    ].filter(Boolean);
    item.setAttribute(
      "aria-label",
      `${model.title}, ${model.people}${words.length ? `, ${words.join(", ")}` : ""}`,
    );
    return item;
  };

  return {
    /** @param {Nav} nav */
    nav(nav) {
      navList.replaceChildren(
        ...nav.mailboxes.map((box) => {
          const li = doc.createElement("li");
          const button = doc.createElement("button");
          button.type = "button";
          button.dataset.mailbox = box.id;
          button.textContent = box.title;
          button.setAttribute("aria-current", String(box.id === nav.current));
          if (box.count) {
            const badge = doc.createElement("span");
            badge.className = "badge";
            badge.textContent = box.count;
            badge.setAttribute("aria-label", `${box.count} unread`);
            button.append(badge);
          }
          li.append(button);
          return li;
        }),
      );
      const options = ["", ...nav.accounts].map((key) => {
        const option = doc.createElement("option");
        option.value = key;
        option.textContent = key === "" ? "All accounts" : key;
        return option;
      });
      accounts.replaceChildren(...options);
      accounts.value = nav.account ?? "";
      accounts.hidden = nav.accounts.length < 2;
      if (searchBox.value !== nav.search) searchBox.value = nav.search;
    },

    /** @param {Row[]} rows @param {string | null} picked */
    list(rows, picked, state) {
      selected = picked;
      items.clear();
      const nodes = rows.map((model, index) => {
        const item = row(model, index, rows.length);
        items.set(model.id, item);
        return item;
      });
      list.replaceChildren(...nodes);
      list.tabIndex = picked === null || !items.has(picked) ? 0 : -1;
      list.setAttribute("aria-busy", String(state.loading));
      more.hidden = !state.more;
      empty.hidden = rows.length > 0 || state.loading;
      empty.textContent = state.empty;
    },

    /** @param {ReaderModel | null} model */
    reader(model) {
      reader.show(model);
      pane.dataset.showing = composing ? "composer" : model ? "reader" : "none";
    },

    /** @param {Draft | null} draft @param {string[]} problems */
    composer(draft, problems) {
      composing = draft !== null;
      composer.show(draft, problems);
      pane.dataset.showing = composing ? "composer" : reader.showing() ? "reader" : "none";
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus,
  };
}
