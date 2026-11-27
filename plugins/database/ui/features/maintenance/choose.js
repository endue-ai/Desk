// Where a maintenance form is for: a PostgreSQL connection (the one named, on screen, the only one
// or one picked) and a target (the table on screen, else the database, a schema or a table picked
// in the palette), and the operation a caller names, checked against the target. No DOM.

import { engineOf } from "../../engines/index.js";
import { t as messageText } from "../../strings/index.js";
import { WHOLE } from "./model.js";
import { operationsFor, TITLES } from "./options.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./options.js").Target} Target
 * @typedef {import("./options.js").Operation} Operation
 */

/** A connection the form runs on, or the sentence why not. */
export function postgres(/** @type {Connection} */ conn) {
  if (conn.engine !== "postgresql")
    throw new Error(
      messageText("features.maintenance.choose.isVacuumAnalyzeReindexAndCluster", {
        name: String(conn.name),
        title: String(engineOf(conn.engine).title),
      }),
    );
  return conn;
}

/** The operation a caller names, checked against the target; the target's first when none. */
export function operationOf(/** @type {unknown} */ value, /** @type {Target} */ target) {
  const ops = operationsFor(target.kind);
  if (value === undefined || value === null || value === "") return ops[0];
  const op = String(value).toLowerCase();
  if (!ops.includes(/** @type {Operation} */ (op)))
    throw new Error(
      messageText("features.maintenance.choose.onATheFormRuns", {
        kind: String(target.kind),
        value: String(ops.map((o) => TITLES[o]).join(", ")),
      }),
    );
  return /** @type {Operation} */ (op);
}

/** @param {Pick<Deps, "manager" | "consoles" | "catalog" | "pick">} deps */
export function createChooser(deps) {
  /** The connection named, else the one on screen, the only one or one picked. */
  const choose = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref !== "") {
      const conn = deps.manager.get(ref);
      if (!conn)
        throw new Error(
          messageText("features.maintenance.choose.noConnectionIsNamed", { ref: String(ref) }),
        );
      return postgres(conn);
    }
    const shown = deps.consoles.current();
    const here = shown ? deps.manager.get(shown.connection) : undefined;
    if (here?.engine === "postgresql") return here;
    const list = deps.manager.list().filter((c) => c.engine === "postgresql");
    if (list.length === 0)
      throw new Error(messageText("features.maintenance.choose.noPostgresqlConnectionYetAddOne"));
    if (list.length === 1) return list[0];
    const items = list.map((c) => ({
      id: c.id,
      label: c.name,
      ...(c.tag !== "none" ? { detail: c.tag } : {}),
    }));
    const picked = await deps.pick(
      messageText("features.maintenance.choose.databaseMaintenanceOnWhichConnection"),
      items,
    );
    return picked ? deps.manager.get(picked) : undefined;
  };

  /** The table on screen, else the database, a schema or a table the person picks. */
  const pickTarget = async (/** @type {Connection} */ conn) => {
    const shown = deps.consoles.current();
    if (shown?.kind === "table" && shown.connection === conn.id && shown.table)
      return /** @type {Target} */ ({
        kind: "table",
        schema: shown.table.schema,
        table: shown.table.name,
        index: "",
      });
    const schemas = await deps.catalog.schemas(conn);
    const first = await deps.pick(
      messageText("features.maintenance.choose.databaseMaintenanceOfWhat"),
      [
        {
          id: "\u0000",
          label: messageText("features.maintenance.choose.theWholeDatabase", {
            database: String(conn.database),
          }),
        },
        ...schemas.map((s) => ({
          id: s,
          label: messageText("features.maintenance.choose.schema", { s: String(s) }),
        })),
      ],
    );
    if (first === undefined || first === "") return undefined;
    if (first === "\u0000") return { ...WHOLE };
    const tables = (await deps.catalog.objects(conn, first)).filter(
      (o) => o.kind === "table" || o.kind === "materialized view",
    );
    const second = await deps.pick(
      messageText("features.maintenance.choose.databaseMaintenanceOfWhatIn", {
        first: String(first),
      }),
      [
        {
          id: "\u0000",
          label: messageText("features.maintenance.choose.theWholeSchema", {
            first: String(first),
          }),
        },
        ...tables.map((t) => ({ id: t.name, label: t.name, detail: t.kind })),
      ],
    );
    if (second === undefined || second === "") return undefined;
    return /** @type {Target} */ (
      second === "\u0000"
        ? { kind: "schema", schema: first, table: "", index: "" }
        : { kind: "table", schema: first, table: second, index: "" }
    );
  };

  return { choose, pickTarget };
}
