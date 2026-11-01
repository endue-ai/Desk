// The side panel: three tabs (contents, bookmarks, notes) over one list each, and the form that
// adds a note to the place on screen. Every entry is a button that goes where it says; bookmarks
// and notes have a Remove button named after them. Arrow keys move between the tabs.

/**
 * @typedef {import("./formats/toc.js").Toc} Toc
 * @typedef {import("./open.js").Target} Target
 * @typedef {import("./marks.js").Bookmark} Bookmark
 * @typedef {import("./marks.js").Note} Note
 * @typedef {{ go(target: Target & { offset?: number }): void, forget(kind: "bookmarks" | "notes", index: number): void,
 *   note(text: string): void, placeName(unit: number, offset: number): string }} SideHooks
 */

const TABS = /** @type {const} */ (["contents", "bookmarks", "notes"]);

/** @param {Document} doc @param {SideHooks} hooks */
export function createSide(doc, hooks) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const side = byId("side");
  const toggle = byId("contents-toggle");
  const contents = byId("contents");
  const bookmarks = byId("bookmarks");
  const notesList = byId("note-list");
  const form = /** @type {HTMLFormElement} */ (byId("note-form"));
  const text = /** @type {HTMLTextAreaElement} */ (byId("note-text"));
  const label = byId("note-label");

  const el = (
    /** @type {string} */ tag,
    /** @type {string} */ content = "",
    /** @type {string} */ cls = "",
  ) => {
    const node = doc.createElement(tag);
    if (content) node.textContent = content;
    if (cls) node.className = cls;
    return node;
  };
  const button = (
    /** @type {string} */ words,
    /** @type {() => void} */ action,
    /** @type {string} */ name = "",
  ) => {
    const b = /** @type {HTMLButtonElement} */ (el("button", words));
    b.type = "button";
    if (name) b.setAttribute("aria-label", name);
    b.addEventListener("click", action);
    return b;
  };

  const select = (/** @type {typeof TABS[number]} */ name, focus = false) => {
    for (const tab of TABS) {
      const on = tab === name;
      const t = byId(`tab-${tab}`);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      byId(tab).hidden = !on;
      if (on && focus) t.focus();
    }
  };
  for (const [i, tab] of TABS.entries()) {
    const t = byId(`tab-${tab}`);
    t.addEventListener("click", () => select(tab));
    t.addEventListener("keydown", (event) => {
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (move === undefined) return;
      event.preventDefault();
      select(TABS[(i + move + TABS.length) % TABS.length] ?? "contents", true);
    });
  }

  const open = (/** @type {boolean} */ on) => {
    side.hidden = !on;
    toggle.setAttribute("aria-expanded", String(on));
  };
  toggle.addEventListener("click", () => open(side.hidden));

  /** @type {{ unit: number, offset: number }} */
  let place = { unit: 0, offset: 0 };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const words = text.value.trim();
    if (!words) return;
    hooks.note(words);
    text.value = "";
    form.hidden = true;
  });
  byId("note-cancel").addEventListener("click", () => {
    text.value = "";
    form.hidden = true;
  });

  /** @param {Toc[]} entries @returns {HTMLElement} */
  const tree = (entries) => {
    const list = el("ul");
    for (const entry of entries) {
      const item = el("li");
      item.append(button(entry.title, () => hooks.go(entry)));
      if (entry.children.length) item.append(tree(entry.children));
      list.append(item);
    }
    return list;
  };

  return {
    /** @param {{ toc: Toc[] } | null} book */
    contents(book) {
      contents.replaceChildren(
        book?.toc.length
          ? tree(book.toc)
          : el("p", book ? "This document has no table of contents." : "", "quiet"),
      );
    },
    /** @param {{ bookmarks: Bookmark[], notes: Note[] } | null} marks */
    marks(marks) {
      const list = el("ul");
      for (const [i, mark] of (marks?.bookmarks ?? []).entries()) {
        const item = el("li");
        item.append(
          button(mark.label, () => hooks.go(mark)),
          button("Remove", () => hooks.forget("bookmarks", i), `Remove bookmark ${mark.label}`),
        );
        list.append(item);
      }
      bookmarks.replaceChildren(
        marks?.bookmarks.length
          ? list
          : el("p", marks ? "No bookmarks yet: Bookmark keeps the place on screen." : "", "quiet"),
      );
      notesList.replaceChildren();
      for (const [i, note] of (marks?.notes ?? []).entries()) {
        const item = el("li");
        const where = hooks.placeName(note.unit, note.offset);
        item.append(
          el("p", note.text, "note"),
          button(where, () => hooks.go(note), `Go to ${where}`),
          button("Remove", () => hooks.forget("notes", i), `Remove note at ${where}`),
        );
        notesList.append(item);
      }
      if (marks && !marks.notes.length)
        notesList.append(
          el("li", "No notes yet: Add note writes one for the place on screen.", "quiet"),
        );
    },
    /** Open the notes tab with the form, for a note on `at`. */
    addNote(/** @type {{ unit: number, offset: number }} */ at) {
      place = at;
      open(true);
      select("notes");
      label.textContent = `Note on ${hooks.placeName(place.unit, place.offset)}`;
      form.hidden = false;
      text.focus();
    },
    noteAt: () => place,
    open,
    isOpen: () => !side.hidden,
  };
}
