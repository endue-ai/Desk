// What each side of a comparison is (PG-53): a schema of a PostgreSQL connection (also of another
// database of its server, `name/database`, ADR 0321), a folder of DDL files, or a saved snapshot;
// from a command's arguments (`{ connection, schema }`, `{ folder, schema }`, `{ snapshot }`) or
// asked in the palette. A folder's schema is the one its files name (folder.js), unless named.

import { baseOf, databaseOf, onDatabase } from "../../databases.js";
import { openSnapshot, pickFolder } from "./files.js";
import { snapshotModel } from "./snapshot.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ kind: "schema", connection: string, schema: string, label: string }
 *   | { kind: "folder", path: string, schema: string, label: string }
 *   | { kind: "snapshot", path: string, schema: string, label: string }} Side
 *   `connection` is the connection's reference (its id, or `id/database`).
 */

const tail = (/** @type {string} */ p) => p.replace(/\/+$/u, "").split("/").at(-1) ?? p;

/** A side's connection, on its database. */
export function connectionOf(/** @type {Pick<Deps, "manager">} */ deps, /** @type {Side} */ side) {
  if (side.kind !== "schema") throw new Error(`${side.label} is not a connection's schema.`);
  const home = deps.manager.get(baseOf(side.connection));
  if (!home) throw new Error(`The connection of ${side.label} was removed.`);
  return onDatabase(home, databaseOf(side.connection));
}

/** A PostgreSQL connection a command names (`name` or `name/database`), or the person's pick. */
async function connectionFor(
  /** @type {Deps} */ deps,
  /** @type {unknown} */ ref,
  /** @type {string} */ title,
) {
  const name = typeof ref === "string" ? ref : undefined;
  const home = await deps.manager.choose(name === undefined ? undefined : baseOf(name), title);
  if (!home) throw deps.cancelled("Nothing picked.");
  if (home.engine !== "postgresql")
    throw new Error(`${home.name} is not PostgreSQL: schemas are compared on PostgreSQL.`);
  const database = name === undefined ? undefined : databaseOf(name);
  const conn = onDatabase(home, database);
  return conn;
}

/** A schema of a connection, picked in the palette when not named. */
async function schemaOf(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {unknown} */ named,
) {
  if (typeof named === "string" && named) return named;
  const schema = await deps.pick(
    `Database: which schema of ${conn.name}?`,
    (await deps.catalog.schemas(conn)).map((s) => ({ id: s, label: s })),
  );
  if (!schema) throw deps.cancelled("Nothing picked.");
  return schema;
}

/**
 * One side from a command's arguments, asked for what they leave out.
 * @param {Deps} deps
 * @param {Record<string, any> | undefined} arg
 * @param {string} which "left" or "right", as the palette says it.
 * @returns {Promise<Side>}
 */
export async function sideOf(deps, arg, which) {
  let kind = arg?.folder
    ? "folder"
    : arg?.snapshot
      ? "snapshot"
      : arg?.connection || arg?.schema
        ? "schema"
        : "";
  if (!kind)
    kind =
      (await deps.pick(`Database: compare what, on the ${which}?`, [
        { id: "schema", label: "A schema of a connection" },
        {
          id: "folder",
          label: "A folder of DDL files",
          detail: "One file per object, as a dump writes them",
        },
        { id: "snapshot", label: "A saved snapshot", detail: "A .schema.json file" },
      ])) ?? "";
  if (kind === "schema") {
    const conn = await connectionFor(
      deps,
      arg?.connection,
      `Database: compare a schema of which connection, on the ${which}?`,
    );
    const schema = await schemaOf(deps, conn, arg?.schema);
    return { kind, connection: conn.id, schema, label: `${conn.name} · ${schema}` };
  }
  if (kind === "folder") {
    const path =
      typeof arg?.folder === "string"
        ? arg.folder
        : await pickFolder(deps, `Compare with which folder of DDL files, on the ${which}?`);
    const schema = typeof arg?.schema === "string" ? arg.schema : "";
    return { kind, path, schema, label: `${tail(path)} (folder)` };
  }
  if (kind === "snapshot") {
    const got = await openSnapshot(
      deps,
      typeof arg?.snapshot === "string" ? arg.snapshot : undefined,
    );
    const { model } = snapshotModel(got.text);
    return { kind, path: got.path, schema: model.schema, label: `${tail(got.path)} (snapshot)` };
  }
  throw deps.cancelled("Nothing picked.");
}

/** A schema of a connection to dump or save, from a command's arguments or the palette. */
export async function schemaSide(
  /** @type {Deps} */ deps,
  /** @type {Record<string, any>} */ args,
) {
  const conn = await connectionFor(deps, args.connection, "Database: which connection's schema?");
  const schema = await schemaOf(deps, conn, args.schema);
  /** @type {Side} */
  const side = { kind: "schema", connection: conn.id, schema, label: `${conn.name} · ${schema}` };
  return { conn, schema, side };
}
