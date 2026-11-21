// The view's built-in actions, by the name its buttons, keys and dialogs call them with (act(name,
// ...args) in view.js): the explorer's rows, the console's runs, the grid's pending changes, drops,
// the import, the connection form and the password dialog. A failure is said through the guard,
// never thrown at the DOM. The features' actions join these (feature-host.js). No DOM.

import { codeOf } from "./answer.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {{
 *   guard: ReturnType<typeof import("./answer.js").guarded>,
 *   view: import("./database.js").View,
 *   manager: ReturnType<typeof import("./manage.js").createManager>,
 *   consoles: ReturnType<typeof import("./consoles.js").createConsoles>,
 *   explorer: ReturnType<typeof import("./explorer.js").createExplorer>,
 *   tools: ReturnType<typeof import("./tools.js").createTools>,
 *   importer: ReturnType<typeof import("./importer.js").createImporter>,
 *   dropped: ReturnType<typeof import("./dropped.js").createDropped>,
 *   complete(text: string, caret: number): Promise<unknown>,
 *   cancel(): void,
 * }} Deps
 */

/** @param {Deps} deps */
export function builtinActions(deps) {
  const { guard, view, manager, consoles, explorer, tools, importer, dropped } = deps;
  const edits = consoles.edits;
  return {
    /** Activate a row of the explorer: a connection opens its console, a table its rows. */
    activate: guard(async (/** @type {Node} */ node) => {
      const conn = manager.get(node.connection);
      if (!conn) return explorer.toggle(node);
      if (node.kind === "connection") await consoles.open(conn);
      else if (node.kind === "table" && node.table)
        await consoles.open(conn, { schema: node.schema ?? "", name: node.table });
      else if (node.kind === "object" || node.kind === "part") await tools.ddl(node);
      else explorer.toggle(node);
    }),
    toggle: (/** @type {Node} */ node, /** @type {boolean | undefined} */ open) =>
      explorer.toggle(node, open),
    edited: (/** @type {string} */ text) => consoles.edited(text),
    tab: (/** @type {number} */ index) => consoles.tab(index),
    run: guard(() => consoles.run("statement")),
    runAll: guard(() => consoles.run("all")),
    runTransaction: guard(() => consoles.run("all", "transaction")),
    dryRun: guard(() => consoles.run("all", "dry-run")),
    explain: guard(() => consoles.explain(false)),
    explainAnalyze: guard(() => consoles.explain(true)),
    format: guard(async () => view.say(await consoles.format())),
    complete: (/** @type {string} */ text, /** @type {number} */ caret) =>
      deps.complete(text, caret).catch(() => undefined),
    more: guard(() => consoles.more()),
    cancel: deps.cancel,
    page: guard((/** @type {Parameters<typeof consoles.page>[0]} */ change) =>
      consoles.page(change),
    ),
    history: guard(() => tools.history(undefined)),
    star: guard(() => tools.star(undefined)),
    starred: guard(() => tools.starred()),
    copy: guard((/** @type {string | undefined} */ format) => tools.copy(format)),
    exportTo: guard((/** @type {string | undefined} */ format) => tools.exportTo(format)),
    ddl: guard((/** @type {Node} */ node) => tools.ddl(node)),
    openTable: guard(
      async (
        /** @type {string} */ connection,
        /** @type {string} */ schema,
        /** @type {string} */ name,
      ) => {
        const conn = manager.get(connection);
        if (conn) await consoles.open(conn, { schema, name });
        view.focus("grid");
      },
    ),
    count: guard((/** @type {Node} */ node) => tools.countRows(explorer.rows(), node)),
    filter: (/** @type {string} */ text) => explorer.filter(text),
    editCell: guard(
      (/** @type {number} */ row, /** @type {number} */ col, /** @type {string | null} */ value) =>
        edits.editCell(row, col, value),
    ),
    addRow: guard(() => edits.addRow()),
    deleteRows: guard((/** @type {number[]} */ rows) => edits.deleteRows(rows)),
    revertRows: guard((/** @type {number[] | undefined} */ rows) => edits.revert(rows)),
    previewChanges: guard(() => view.preview(edits.preview())),
    submitChanges: guard(async () => view.say(await edits.submit())),
    canEdit: guard(() => edits.ensure()),
    /** A drop on the surface (dnd.js): undefined when it was carried out, "none" when not. */
    drop: async (
      /** @type {import("./drops.js").Dropped} */ item,
      /** @type {import("./importer.js").Into | undefined} */ into,
    ) => {
      try {
        return await dropped(item, into);
      } catch (error) {
        if (codeOf(error) !== "cancelled")
          view.say(error instanceof Error ? error.message : String(error));
        return /** @type {const} */ ("none");
      }
    },
    dropped: guard((/** @type {import("./drops.js").Dropped} */ item) => dropped(item)),
    say: (/** @type {string} */ text) => view.say(text),
    importChange: guard((/** @type {import("./importer.js").Change} */ change) =>
      importer.change(change),
    ),
    importRun: guard(() => importer.run()),
    importCancel: () => importer.cancel(),
    create: () => manager.create(),
    importUri: guard(() => manager.importUri(undefined)),
    edit: guard((/** @type {string | undefined} */ id) => manager.edit(id)),
    remove: guard((/** @type {string | undefined} */ id) => manager.remove(id)),
    refresh: (/** @type {string | undefined} */ id, /** @type {Node | undefined} */ node) =>
      explorer.refresh(id, node),
    formSave: guard((/** @type {Partial<Connection>} */ fields) => manager.save(fields)),
    formTest: guard((/** @type {Partial<Connection>} */ fields) => manager.test(fields)),
    formCancel: guard((/** @type {Parameters<typeof manager.cancelForm>[0]} */ fields) =>
      manager.cancelForm(fields),
    ),
    password: (/** @type {string | undefined} */ value) => manager.answered(value),
  };
}
