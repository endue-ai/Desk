// The DOM of the Git surface: the header (repository and head), one tree of rows for the view on
// screen (status, log or diff) with a cursor the arrow keys move, folding, single-letter keys, the
// commit editor, a hint line and a status live region. Chords with Mod are never prevented, so the
// desk's keymap gets them; only Mod+Enter in the editor is taken.

import { actionFor, pressOf } from "./keys.js";
import { renderDiff } from "./view-diff.js";
import { renderLog } from "./view-log.js";
import { renderStatus } from "./view-status.js";

/**
 * @typedef {import("./git.js").View} View
 * @typedef {import("./git.js").Header} Header
 * @typedef {import("./git.js").StatusView} StatusView
 * @typedef {import("./git.js").LogView} LogView
 * @typedef {import("./git.js").DiffView} DiffView
 * @typedef {import("./actions.js").CommitEditor} CommitEditor
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./dom.js").RowSpec} RowSpec
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const MOVES = new Set(["next", "previous", "first", "last"]);

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @returns {View}
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const repoEl = byId("repo");
  const branchEl = byId("branch");
  const upstreamEl = byId("upstream");
  const countsEl = byId("counts");
  const busyEl = byId("busy");
  const tree = byId("view");
  const form = /** @type {HTMLFormElement} */ (byId("commit"));
  const summary = byId("commit-summary");
  const message = /** @type {HTMLTextAreaElement} */ (byId("commit-message"));
  const amend = /** @type {HTMLInputElement} */ (byId("commit-amend"));
  const signOff = /** @type {HTMLInputElement} */ (byId("commit-signoff"));
  const hintsEl = byId("hints");
  const statusEl = byId("status");

  /** @type {ViewName} */
  let current = "status";
  /** @type {{ status: StatusView | null, log: LogView | null, diff: DiffView | null }} */
  const models = { status: null, log: null, diff: null };
  /** @type {RowSpec[]} */
  let rows = [];
  let cursor = 0;
  /** What the cursor was on, so a re-render keeps it there. */
  let cursorKey = "";
  const folded = new Set();

  const keyOf = (/** @type {RowSpec | undefined} */ spec) =>
    spec?.fold ?? (spec?.item ? JSON.stringify(spec.item) : "");

  const render = () => {
    const shown = current === "commit" ? "status" : current;
    const model = models[shown];
    if (shown === "status")
      rows = model ? renderStatus(doc, /** @type {StatusView} */ (model), folded) : [];
    else if (shown === "log") rows = model ? renderLog(doc, /** @type {LogView} */ (model)) : [];
    else rows = model ? renderDiff(doc, /** @type {DiffView} */ (model), folded) : [];
    const found = rows.findIndex((spec) => keyOf(spec) === cursorKey && cursorKey !== "");
    cursor = found >= 0 ? found : Math.min(cursor, Math.max(0, rows.length - 1));
    rows.forEach((spec, index) => {
      spec.el.setAttribute("role", "treeitem");
      spec.el.setAttribute("aria-level", String(spec.level));
      if (spec.fold) spec.el.setAttribute("aria-expanded", String(!folded.has(spec.fold)));
      spec.el.dataset.index = String(index);
      spec.el.tabIndex = index === cursor ? 0 : -1;
      spec.el.setAttribute("aria-selected", String(index === cursor));
    });
    tree.replaceChildren(...rows.map((spec) => spec.el));
    tree.setAttribute("aria-label", `Git ${shown}`);
  };

  const moveTo = (/** @type {number} */ index) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    rows[cursor]?.el.setAttribute("aria-selected", "false");
    if (rows[cursor]) rows[cursor].el.tabIndex = -1;
    cursor = next;
    const spec = rows[cursor];
    if (!spec) return;
    cursorKey = keyOf(spec);
    spec.el.tabIndex = 0;
    spec.el.setAttribute("aria-selected", "true");
    spec.el.focus();
    spec.el.scrollIntoView({ block: "nearest" });
  };

  const move = (/** @type {string} */ action) => {
    if (action === "next") moveTo(cursor + 1);
    else if (action === "previous") moveTo(cursor - 1);
    else if (action === "first") moveTo(0);
    else moveTo(rows.length - 1);
  };

  /** Fold the row under the cursor, or the section or file it belongs to. */
  const fold = () => {
    let at = cursor;
    while (at >= 0 && !rows[at]?.fold) at--;
    const key = rows[at]?.fold;
    if (!key) return;
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    cursorKey = key;
    render();
    moveTo(cursor);
  };

  tree.addEventListener("keydown", (event) => {
    if (current === "commit") return;
    const action = actionFor(current, pressOf(event));
    if (!action) return;
    event.preventDefault();
    if (MOVES.has(action)) move(action);
    else if (action === "fold") fold();
    else void act(action);
  });
  tree.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const rowEl = target?.closest("[role=treeitem]");
    const index = Number(/** @type {HTMLElement | null} */ (rowEl)?.dataset.index);
    if (Number.isNaN(index)) return;
    moveTo(index);
    if (rows[index]?.fold && target?.classList.contains("caret")) fold();
  });
  tree.addEventListener("dblclick", () => {
    const item = rows[cursor]?.item;
    if (item?.kind === "commit") void act("diff");
    else if (item?.kind === "file" || item?.kind === "line") void act("visit");
  });

  message.addEventListener("keydown", (event) => {
    const action = actionFor("commit", pressOf(event));
    if (!action) return;
    event.preventDefault();
    if (action === "submitCommit")
      void act("submitCommit", message.value, { amend: amend.checked, signOff: signOff.checked });
    else void act("cancelCommit");
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    header(header) {
      repoEl.textContent = header.repo ? header.repo.name : "No repository";
      repoEl.title = header.repo?.root ?? "";
      branchEl.textContent =
        header.branch ?? (header.oid ? `detached at ${header.oid.slice(0, 7)}` : "");
      upstreamEl.textContent = header.upstream ? `→ ${header.upstream}` : "";
      const counts = [
        header.ahead ? `↑${header.ahead}` : "",
        header.behind ? `↓${header.behind}` : "",
      ];
      countsEl.textContent = counts.filter(Boolean).join(" ");
    },
    show(name, hints) {
      current = name;
      hintsEl.textContent = hints;
      const editing = name === "commit";
      form.hidden = !editing;
      tree.hidden = editing;
      if (!editing) render();
    },
    status(model) {
      models.status = model;
      if (current === "status") render();
    },
    log(model) {
      models.log = model;
      if (current === "log") render();
    },
    diff(model) {
      models.diff = model;
      if (current === "diff") render();
    },
    commit(editor) {
      if (!editor) return;
      message.value = editor.message;
      amend.checked = editor.amend;
      signOff.checked = editor.signOff;
      summary.textContent = editor.amend
        ? "Amending the last commit"
        : `${editor.staged} staged file${editor.staged === 1 ? "" : "s"}`;
    },
    say(text) {
      statusEl.textContent = text;
    },
    busy(running) {
      busyEl.hidden = running === 0;
    },
    focus() {
      if (current === "commit") message.focus();
      else if (rows[cursor]) rows[cursor]?.el.focus();
      else tree.focus();
    },
    selection() {
      return rows[cursor]?.item;
    },
  };
}
