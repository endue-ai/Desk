// The DOM around the note: the shelf (a filter, New and the notes in ~/Notes as a hairline list), the
// note's toolbar (Rename, Delete, Preview) and the Markdown preview, a <desk-markdown> that builds
// nodes from text only. The text area itself stays view.js's.

/**
 * @typedef {import("./shelf.js").Shelved} Shelved
 * @typedef {{ open(path: string): unknown, create(): unknown, rename(name: string): unknown, remove(): unknown, filter(text: string): unknown }} ShelfActions
 */

/** "Today 09:30", "Mon 14:02" this week, else the date. */
const whenOf = (/** @type {string | undefined} */ at, /** @type {Date} */ now) => {
  const time = Date.parse(at ?? "");
  if (!Number.isFinite(time)) return "";
  const day = new Date(time);
  const clock = day.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (day.toDateString() === now.toDateString()) return clock;
  if (now.getTime() - time < 6 * 864e5)
    return `${day.toLocaleDateString([], { weekday: "short" })} ${clock}`;
  return day.toLocaleDateString();
};

/**
 * @param {Document} doc
 * @param {ShelfActions} actions
 * @param {{ text: () => string, editor: HTMLElement }} note what the preview shows, and the text area it stands in for
 */
export function createShelfView(doc, actions, note) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const list = byId("shelf-list");
  const empty = byId("shelf-empty");
  const filter = /** @type {HTMLInputElement} */ (byId("shelf-filter"));
  const tools = byId("note-tools");
  const rename = /** @type {HTMLButtonElement} */ (byId("note-rename"));
  const remove = /** @type {HTMLButtonElement} */ (byId("note-delete"));
  const preview = /** @type {HTMLButtonElement} */ (byId("note-preview"));
  const shown = /** @type {HTMLElement & { source?: string }} */ (byId("note-rendered"));
  const naming = /** @type {HTMLFormElement} */ (byId("note-naming"));
  const newName = /** @type {HTMLInputElement} */ (byId("note-new-name"));

  byId("shelf-new").addEventListener("click", () => actions.create());
  filter.addEventListener("input", () => actions.filter(filter.value));
  list.addEventListener("click", (event) => {
    const row = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[data-path]")
    );
    if (row?.dataset.path) actions.open(row.dataset.path);
  });

  let previewing = false;
  const showPreview = (/** @type {boolean} */ on) => {
    previewing = on;
    preview.setAttribute("aria-pressed", String(on));
    shown.hidden = !on || tools.hidden;
    note.editor.hidden = on || tools.hidden;
    if (on) shown.source = note.text();
  };
  preview.addEventListener("click", () => showPreview(!previewing));

  rename.addEventListener("click", () => {
    naming.hidden = false;
    newName.value = doc.getElementById("note-name")?.textContent ?? "";
    newName.focus();
    newName.select();
  });
  naming.addEventListener("submit", (event) => {
    event.preventDefault();
    naming.hidden = true;
    actions.rename(newName.value);
  });
  newName.addEventListener("keydown", (event) => {
    if (event.key === "Escape") naming.hidden = true;
  });
  remove.addEventListener("click", () => actions.remove());

  return {
    /**
     * @param {Shelved[]} items
     * @param {string | undefined} current
     * @param {string} filtering
     */
    list(items, current, filtering) {
      const now = new Date();
      list.replaceChildren(
        ...items.map((item) => {
          const li = doc.createElement("li");
          const row = doc.createElement("button");
          row.type = "button";
          row.className = "desk-row shelf-row";
          row.dataset.path = item.path;
          if (item.path === current) {
            row.setAttribute("aria-current", "true");
            row.dataset.active = "";
          }
          const text = doc.createElement("span");
          text.className = "desk-list-text";
          const title = doc.createElement("span");
          title.className = "desk-list-title";
          title.textContent = item.title || item.name;
          const desc = doc.createElement("span");
          desc.className = "desk-list-desc";
          desc.textContent = item.title ? item.name : "Empty";
          text.append(title, desc);
          const meta = doc.createElement("span");
          meta.className = "desk-list-meta";
          meta.textContent = whenOf(item.modifiedAt, now);
          row.append(text, meta);
          li.append(row);
          return li;
        }),
      );
      empty.hidden = items.length > 0;
      empty.textContent = filtering ? "No note matches." : "No notes in ~/Notes yet.";
    },

    /** The note on screen came or went: its tools, and the preview of its text. */
    note(/** @type {boolean} */ open) {
      tools.hidden = !open;
      if (!open) naming.hidden = true;
      showPreview(previewing && open);
    },

    confirming(/** @type {boolean} */ on) {
      remove.textContent = on ? "Confirm delete" : "Delete";
      remove.classList.toggle("desk-btn-danger", on);
    },
  };
}
