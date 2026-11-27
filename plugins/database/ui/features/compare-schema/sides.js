// What each side of a comparison is (PG-53): a schema of a PostgreSQL connection (also of another
// database of its server, `name/database`, ADR 0321), a folder of DDL files, or a saved snapshot;
// from a command's arguments (`{ connection, schema }`, `{ folder, schema }`, `{ snapshot }`) or
// asked in the palette. A folder's schema is the one its files name (folder.js), unless named.

import { baseOf, databaseOf, onDatabase } from "../../databases.js";
import { t } from "../../strings/index.js";
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
  if (side.kind !== "schema")
    throw new Error(
      t("features.compareSchema.sides.isNotAConnectionSSchema", { label: String(side.label) }),
    );
  const home = deps.manager.get(baseOf(side.connection));
  if (!home)
    throw new Error(
      t("features.compareSchema.sides.theConnectionOfWasRemoved", { label: String(side.label) }),
    );
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
  if (!home) throw deps.cancelled(t("features.compareSchema.sides.nothingPicked"));
  if (home.engine !== "postgresql")
    throw new Error(
      t("features.compareSchema.sides.isNotPostgresqlSchemasAreCompared", {
        name: String(home.name),
      }),
    );
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
    t("features.compareSchema.sides.databaseWhichSchemaOf", { name: String(conn.name) }),
    (await deps.catalog.schemas(conn)).map((s) => ({ id: s, label: s })),
  );
  if (!schema) throw deps.cancelled(t("features.compareSchema.sides.nothingPicked"));
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
      (await deps.pick(
        t("features.compareSchema.sides.databaseCompareWhatOnThe", { which: String(which) }),
        [
          { id: "schema", label: t("features.compareSchema.sides.aSchemaOfAConnection") },
          {
            id: "folder",
            label: t("features.compareSchema.sides.aFolderOfDdlFiles"),
            detail: t("features.compareSchema.sides.oneFilePerObjectAsA"),
          },
          {
            id: "snapshot",
            label: t("features.compareSchema.sides.aSavedSnapshot"),
            detail: t("features.compareSchema.sides.aSchemaJsonFile"),
          },
        ],
      )) ?? "";
  if (kind === "schema") {
    const conn = await connectionFor(
      deps,
      arg?.connection,
      t("features.compareSchema.sides.databaseCompareASchemaOfWhich", { which: String(which) }),
    );
    const schema = await schemaOf(deps, conn, arg?.schema);
    return { kind, connection: conn.id, schema, label: `${conn.name} · ${schema}` };
  }
  if (kind === "folder") {
    const path =
      typeof arg?.folder === "string"
        ? arg.folder
        : await pickFolder(
            deps,
            t("features.compareSchema.sides.compareWithWhichFolderOfDdl", { which: String(which) }),
          );
    const schema = typeof arg?.schema === "string" ? arg.schema : "";
    return {
      kind,
      path,
      schema,
      label: t("features.compareSchema.sides.folder", { value: String(tail(path)) }),
    };
  }
  if (kind === "snapshot") {
    const got = await openSnapshot(
      deps,
      typeof arg?.snapshot === "string" ? arg.snapshot : undefined,
    );
    const { model } = snapshotModel(got.text);
    return {
      kind,
      path: got.path,
      schema: model.schema,
      label: t("features.compareSchema.sides.snapshot", { value: String(tail(got.path)) }),
    };
  }
  throw deps.cancelled(t("features.compareSchema.sides.nothingPicked"));
}

/** A schema of a connection to dump or save, from a command's arguments or the palette. */
export async function schemaSide(
  /** @type {Deps} */ deps,
  /** @type {Record<string, any>} */ args,
) {
  const conn = await connectionFor(
    deps,
    args.connection,
    t("features.compareSchema.sides.databaseWhichConnectionSSchema"),
  );
  const schema = await schemaOf(deps, conn, args.schema);
  /** @type {Side} */
  const side = { kind: "schema", connection: conn.id, schema, label: `${conn.name} · ${schema}` };
  return { conn, schema, side };
}
