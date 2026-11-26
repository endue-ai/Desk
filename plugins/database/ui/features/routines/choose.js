// Which routine a form is for: a PostgreSQL connection (the one named, the one on screen, the only
// one or one picked), then a routine by its schema and name (named, or picked in the palette from
// the connection's routines), and its signature when the name is overloaded: picked, or, for an
// agent's call, named among the ones listed. No DOM.

import { engineOf } from "../../engines/index.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./read.js").Listed} Listed
 * @typedef {ReturnType<typeof import("./read.js").createReader>} Reader
 */

/** A connection a routine runs from here, or the sentence why not. */
export function postgres(/** @type {Connection} */ conn) {
  if (conn.engine !== "postgresql")
    throw new Error(
      t("features.routines.choose.isFunctionsAndProceduresRunFrom", {
        name: String(conn.name),
        title: String(engineOf(conn.engine).title),
      }),
    );
  return conn;
}

/** Arguments written the same however they are spaced or cased. */
const plain = (/** @type {string} */ text) => text.replace(/\s+/gu, " ").trim().toLowerCase();

/** @param {Pick<Deps, "manager" | "consoles" | "pick" | "settings"> & { reader: Reader }} deps */
export function createChooser(deps) {
  /** The connection named, else the one on screen, the only one or one picked. */
  const connection = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref !== "") {
      const conn = deps.manager.get(ref);
      if (!conn)
        throw new Error(t("features.routines.choose.noConnectionIsNamed", { ref: String(ref) }));
      return postgres(conn);
    }
    const shown = deps.consoles.current();
    const here = shown ? deps.manager.get(shown.connection) : undefined;
    if (here?.engine === "postgresql") return here;
    const list = deps.manager.list().filter((c) => c.engine === "postgresql");
    if (list.length === 0)
      throw new Error(t("features.routines.choose.noPostgresqlConnectionYetAddOne"));
    if (list.length === 1) return list[0];
    const picked = await deps.pick(
      t("features.routines.choose.databaseRunARoutineOfWhich"),
      list.map((c) => ({
        id: c.id,
        label: c.name,
        ...(c.tag !== "none" ? { detail: c.tag } : {}),
      })),
    );
    return picked ? deps.manager.get(picked) : undefined;
  };

  /** One signature among several: the one named, else picked (an agent's call names it). */
  const signature = async (
    /** @type {Listed[]} */ found,
    /** @type {{ signature?: unknown, run?: unknown }} */ args,
  ) => {
    const named = typeof args.signature === "string" ? plain(args.signature) : undefined;
    const matching = named === undefined ? found : found.filter((l) => plain(l.identity) === named);
    if (matching.length === 1) return matching[0];
    const first = found[0];
    const name = first ? `${first.schema}.${first.name}` : "";
    const list = found.map((l) => `${l.schema}.${l.name}(${l.identity})`).join("; ");
    if (named !== undefined && matching.length === 0)
      throw new Error(
        t("features.routines.choose.hasNoSignatureItHas", {
          name: String(name),
          signature: String(args.signature),
          list: String(list),
        }),
      );
    if (args.run === true)
      throw new Error(
        t("features.routines.choose.hasSignaturesNameOneWithSignature", {
          name: String(name),
          length: String(found.length),
          list: String(list),
        }),
      );
    const picked = await deps.pick(
      t("features.routines.choose.databaseWhichSignatureOf", { name: String(name) }),
      found.map((l) => ({
        id: l.oid,
        label: `${l.schema}.${l.name}(${l.identity})`,
        detail:
          l.kind === "procedure"
            ? t("features.routines.choose.procedure")
            : t("features.routines.choose.returns", { result: String(l.result) }),
      })),
    );
    return found.find((l) => l.oid === picked);
  };

  /** The routine a command names (schema, name, signature), else one picked from the palette. */
  const routine = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    const system = deps.settings().systemSchemas;
    if (typeof args.name === "string" && args.name) {
      const schema = typeof args.schema === "string" && args.schema ? args.schema : undefined;
      const found = await deps.reader.list(conn, {
        name: args.name,
        system,
        ...(schema ? { schema } : {}),
      });
      if (found.length === 0)
        throw new Error(
          t("features.routines.choose.hasNoFunctionOrProcedure", {
            name: String(conn.name),
            value: String(schema ? `${schema}.` : ""),
            name2: String(args.name),
          }),
        );
      return signature(found, args);
    }
    const all = await deps.reader.list(conn, { system });
    if (all.length === 0)
      throw new Error(
        t("features.routines.choose.hasNoFunctionsOrProcedures", { name: String(conn.name) }),
      );
    /** @type {Map<string, Listed[]>} */
    const names = new Map();
    for (const l of all) {
      const key = `${l.schema}\u0000${l.name}`;
      names.set(key, [...(names.get(key) ?? []), l]);
    }
    const picked = await deps.pick(
      t("features.routines.choose.databaseRunWhichFunctionOrProcedure"),
      [...names].map(([key, list]) => ({
        id: key,
        label: `${list[0]?.schema}.${list[0]?.name}`,
        detail:
          list.length > 1
            ? t("features.routines.choose.signatures", { length: String(list.length) })
            : `${list[0]?.kind} (${list[0]?.identity})`,
      })),
    );
    const chosen = picked ? names.get(picked) : undefined;
    return chosen ? signature(chosen, {}) : undefined;
  };

  return { connection, routine };
}
