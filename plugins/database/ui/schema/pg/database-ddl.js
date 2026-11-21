// The DDL of the database's own objects (database.js) from their cached rows: an extension with
// what it owns listed after it, a wrapper and a server with the options that may be shown, a user
// mapping without its options, a publication with its tables, a subscription created without
// connecting (its connection string is never read), an event trigger, a cast and a language. Pure.

import { assemble, commentOn, dotted, hiddenLine, ident, literal, optionsClause } from "./ddl.js";

/** @typedef {import("../common.js").SchemaObject} SchemaObject */

/** @type {Record<string, (object: SchemaObject, def: Record<string, any>) => string>} */
const BUILDERS = {
  extension: (o, def) => {
    const owned = (def.members ?? []).map((/** @type {string} */ m) => `--   ${m}\n`);
    return assemble(
      o.owner,
      [
        `CREATE EXTENSION IF NOT EXISTS ${ident(o.name)} WITH SCHEMA ${ident(def.schema ?? "public")} ` +
          `VERSION ${literal(def.version ?? "")};\n`,
        ...(owned.length ? [`-- It owns:\n${owned.join("")}`] : []),
      ],
      commentOn("EXTENSION", ident(o.name), o.comment),
    );
  },
  "foreign data wrapper": (o, def) => {
    const handler = def.handler ? ` HANDLER ${def.handler}` : "";
    const validator = def.validator ? ` VALIDATOR ${def.validator}` : "";
    return assemble(
      o.owner,
      [
        hiddenLine(def.hidden),
        `CREATE FOREIGN DATA WRAPPER ${ident(o.name)}${handler}${validator}${optionsClause(def.options)};\n`,
      ],
      commentOn("FOREIGN DATA WRAPPER", ident(o.name), o.comment),
    );
  },
  "foreign server": (o, def) => {
    const type = def.type ? ` TYPE ${literal(def.type)}` : "";
    const version = def.version ? ` VERSION ${literal(def.version)}` : "";
    return assemble(
      o.owner,
      [
        hiddenLine(def.hidden),
        `CREATE SERVER ${ident(o.name)}${type}${version} FOREIGN DATA WRAPPER ` +
          `${ident(def.wrapper ?? "")}${optionsClause(def.options)};\n`,
      ],
      commentOn("SERVER", ident(o.name), o.comment),
    );
  },
  "user mapping": (_o, def) =>
    "-- Its options are never read: they may hold a password.\n" +
    `CREATE USER MAPPING FOR ${def.user ? ident(def.user) : "PUBLIC"} SERVER ${ident(def.server ?? "")};\n`,
  publication: (o, def) => {
    // Each table with ONLY, as the catalog lists it (an inheritance child has its own row); the
    // form PostgreSQL 13 reads too: `TABLE ONLY a, ONLY b`.
    const tables = (def.tables ?? []).map(
      (/** @type {Record<string, any>} */ t) =>
        `ONLY ${dotted(t.schema, t.table)}${
          Array.isArray(t.columns) ? ` (${t.columns.map(ident).join(", ")})` : ""
        }${t.where ? ` WHERE (${t.where})` : ""}`,
    );
    const targets = [
      ...(tables.length ? [`TABLE ${tables.join(",\n    ")}`] : []),
      ...(def.schemas ?? []).map((/** @type {string} */ s) => `TABLES IN SCHEMA ${ident(s)}`),
    ];
    const what = def.all
      ? " FOR ALL TABLES"
      : targets.length
        ? ` FOR ${targets.join(",\n    ")}`
        : "";
    const publish = ["insert", "update", "delete", "truncate"].filter((a) => def[a]).join(", ");
    const options = [`publish = ${literal(publish)}`];
    if (def.viaRoot) options.push("publish_via_partition_root = true");
    return assemble(
      o.owner,
      [`CREATE PUBLICATION ${ident(o.name)}${what}\n    WITH (${options.join(", ")});\n`],
      commentOn("PUBLICATION", ident(o.name), o.comment),
    );
  },
  subscription: (o, def) => {
    const options = [
      "connect = false",
      `slot_name = ${def.slot ? literal(def.slot) : "NONE"}`,
      ...subscriptionOptions(def),
    ];
    const publications = (def.publications ?? []).map(ident).join(", ");
    return assemble(
      o.owner,
      [
        "-- The connection string is never read: it may hold a password. Set it with ALTER\n" +
          `-- SUBSCRIPTION ... CONNECTION${def.enabled ? ", then ENABLE it" : ""}.\n`,
        `CREATE SUBSCRIPTION ${ident(o.name)} CONNECTION '' PUBLICATION ${publications}\n` +
          `    WITH (${options.join(", ")});\n`,
      ],
      commentOn("SUBSCRIPTION", ident(o.name), o.comment),
    );
  },
  "event trigger": (o, def) => {
    const tags = (def.tags ?? []).map(literal).join(", ");
    const state = { D: "DISABLE", R: "ENABLE REPLICA", A: "ENABLE ALWAYS" }[
      /** @type {"D"} */ (def.enabled)
    ];
    return assemble(
      o.owner,
      [
        `CREATE EVENT TRIGGER ${ident(o.name)} ON ${def.event}\n` +
          `${tags ? `    WHEN TAG IN (${tags})\n` : ""}    EXECUTE FUNCTION ${def.function}();\n`,
        ...(state ? [`ALTER EVENT TRIGGER ${ident(o.name)} ${state};\n`] : []),
      ],
      commentOn("EVENT TRIGGER", ident(o.name), o.comment),
    );
  },
  cast: (o, def) => {
    const target = `(${def.source} AS ${def.target})`;
    const how =
      def.method === "f"
        ? `WITH FUNCTION ${def.function}`
        : def.method === "i"
          ? "WITH INOUT"
          : "WITHOUT FUNCTION";
    const context =
      def.context === "a" ? " AS ASSIGNMENT" : def.context === "i" ? " AS IMPLICIT" : "";
    return assemble(
      "",
      [`CREATE CAST ${target} ${how}${context};\n`],
      commentOn("CAST", target, o.comment),
    );
  },
  language: (o, def) => {
    const parts = [
      ...(def.handler ? [`HANDLER ${def.handler}`] : []),
      ...(def.inline ? [`INLINE ${def.inline}`] : []),
      ...(def.validator ? [`VALIDATOR ${def.validator}`] : []),
    ];
    return assemble(
      o.owner,
      [
        `CREATE OR REPLACE ${def.trusted ? "TRUSTED " : ""}LANGUAGE ${ident(o.name)}` +
          `${parts.map((p) => `\n    ${p}`).join("")};\n`,
      ],
      commentOn("LANGUAGE", ident(o.name), o.comment),
    );
  },
};

/** What a subscription sets beyond its defaults, by the options this version has. */
function subscriptionOptions(/** @type {Record<string, any>} */ def) {
  /** @type {string[]} */
  const out = [];
  if (def.syncCommit && def.syncCommit !== "off")
    out.push(`synchronous_commit = ${literal(def.syncCommit)}`);
  if (def.binary) out.push("binary = true");
  const streaming = { t: "on", true: "on", p: "parallel" }[/** @type {"t"} */ (def.streaming)];
  if (streaming) out.push(`streaming = ${streaming}`);
  if (def.twoPhase && def.twoPhase !== "d") out.push("two_phase = true");
  if (def.disableOnError) out.push("disable_on_error = true");
  if (def.origin && def.origin !== "any") out.push(`origin = ${literal(def.origin)}`);
  if (def.pwRequired === false) out.push("password_required = false");
  if (def.runAsOwner) out.push("run_as_owner = true");
  if (def.failover) out.push("failover = true");
  return out;
}

/** The DDL of a database-level object, or undefined when it is not one. */
export function ddl(/** @type {SchemaObject} */ object) {
  const build = BUILDERS[object.kind];
  return build ? build(object, /** @type {Record<string, any>} */ (object.def ?? {})) : undefined;
}
