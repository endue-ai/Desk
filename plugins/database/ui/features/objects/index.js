// Objects changed from the explorer (PG-52): rename, move to another schema, change the owner,
// comment, drop (what depends on it listed first, CASCADE only when chosen), truncate, refresh a
// materialized view, enable or disable a trigger, edit a view's, a materialized view's, a
// routine's or a trigger function's source in a console and apply it, and generate SQL into a
// console. Each from a row (o or a right click for its menu, F2 rename, s its source) or a command
// with arguments, which agents get too; every one shows its exact script first and runs it only on
// the person's answer (ADR 0312). kinds.js says what each engine's kinds take. No DOM here.

import { openRoutine } from "../routines/index.js";
import { openTableEntry, tableEntries } from "../table-design/index.js";
import { createObjects } from "./controller.js";
import { operationDialog } from "./dialog.js";
import { applySource, openSource } from "./source.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../explorer.js").Node} Node
 * @typedef {import("./kinds.js").Op} Op
 */

/** The commands of each operation, by its id. */
const OPERATIONS = /** @type {Record<string, Op>} */ ({
  "endue.database.rename-object": "rename",
  "endue.database.move-object": "move",
  "endue.database.change-owner": "owner",
  "endue.database.comment-object": "comment",
  "endue.database.drop-object": "drop",
  "endue.database.truncate-table": "truncate",
  "endue.database.refresh-materialized-view": "refresh",
  "endue.database.enable-trigger": "enable",
});

/** A PostgreSQL function's or procedure's form of its arguments (features/routines/), first. */
const RUN = { id: "run", label: "Run with its arguments…" };

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let made = controllers.get(deps);
  if (!made) {
    made = createObjects(deps);
    controllers.set(deps, made);
  }
  return /** @type {ReturnType<typeof createObjects>} */ (made);
};

/** The menu of a row or of a command's object, and what was picked from it, run. */
async function fromMenu(
  /** @type {Deps} */ deps,
  /** @type {Node | Record<string, unknown>} */ ref,
) {
  const objects = of(deps);
  const { conn, target } = await objects.resolve(ref, undefined);
  const runs =
    conn.engine === "postgresql" && (target.kind === "function" || target.kind === "procedure");
  const tables = tableEntries(conn, target);
  const picked = await objects.menu(conn, target, [...(runs ? [RUN] : []), ...tables]);
  if (picked === "run") return openRoutine(deps, conn, target);
  if (tables.some((t) => t.id === picked)) return openTableEntry(deps, conn, target, picked);
  if (picked.startsWith("generate:")) return objects.generate(conn, target, picked.slice(9));
  if (picked === "source") return openSource(deps, conn, target);
  return objects.operate(conn, /** @type {Op} */ (picked), target, {});
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "objects",
  commands: (deps) => {
    const objects = of(deps);
    /** @type {Record<string, (args: Record<string, unknown>, invocation?: import("@endue-ai/plugin-sdk").Invocation) => unknown>} */
    const operations = {};
    for (const [id, op] of Object.entries(OPERATIONS))
      operations[id] = async (args, invocation) => {
        const { conn, target } = await objects.resolve(args, op);
        return objects.operate(conn, op, target, args, invocation?.approved === true);
      };
    return {
      ...operations,
      "endue.database.object-actions": (args) => fromMenu(deps, args),
      "endue.database.edit-source": async (args) => {
        const { conn, target } = await objects.resolve(args, "source");
        return openSource(deps, conn, target);
      },
      "endue.database.apply-source": () => applySource(deps),
      "endue.database.generate-sql": async (args) => {
        const { conn, target } = await objects.resolve(args, "generate");
        return objects.generate(conn, target, args.statement);
      },
    };
  },
  actions: (deps) => ({
    objectMenu: (/** @type {Node} */ node) => fromMenu(deps, node),
    renameObject: async (/** @type {Node} */ node) => {
      const objects = of(deps);
      const { conn, target } = await objects.resolve(node, "rename");
      return objects.operate(conn, "rename", target, {});
    },
    editSource: async (/** @type {Node} */ node) => {
      const { conn, target } = await of(deps).resolve(node, "source");
      return openSource(deps, conn, target);
    },
    applySource: () => applySource(deps),
  }),
  dialogs: { "object-operation": { label: "Change an object", render: operationDialog } },
  styles: [new URL("./objects.css", import.meta.url).href],
};
