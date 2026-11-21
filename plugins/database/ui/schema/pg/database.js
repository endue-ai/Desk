// The database's own objects (PG-50): extensions and what each owns, foreign data wrappers,
// foreign servers and user mappings, publications with their tables, subscriptions, event
// triggers, casts and procedural languages. One statement with the database level of a pass, asking
// only for what the server's version has. Never read: a user mapping's options, a subscription's
// connection string, and options whose name may hold a secret (sql.js). Built-in casts and
// languages (oid below 16384) and an extension's members are left out of their folders. Pure.

import {
  cls,
  countOf,
  described,
  digestOf,
  hiddenOptions,
  json,
  notMember,
  safeOptions,
} from "./sql.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {(string | null)[]} Row
 */

const USER = 16384;
const row = (/** @type {string[]} */ parts) => `SELECT '' AS nspname, ${parts.join(", ")}`;
const regproc = (/** @type {string} */ column) =>
  `CASE WHEN ${column} <> 0 THEN ${column}::pg_catalog.regproc::text END`;
const owner = (/** @type {string} */ column) => `pg_catalog.pg_get_userbyid(${column})`;

const EXTENSIONS =
  row([
    "'extension'",
    "e.extname",
    "e.extversion",
    "pg_catalog.json_build_object('schema', en.nspname, 'version', e.extversion)::text",
    owner("e.extowner"),
    "e.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace " +
  described("pg_extension", "e.oid");

const MEMBERS =
  row([
    "'member'",
    "e.extname",
    "pg_catalog.pg_describe_object(x.classid, x.objid, x.objsubid)",
    "NULL",
    "NULL",
    "x.objid::text",
    "NULL",
  ]) +
  " FROM pg_catalog.pg_depend x JOIN pg_catalog.pg_extension e ON e.oid = x.refobjid WHERE " +
  `x.refclassid = ${cls("pg_extension")} AND x.deptype = 'e'`;

const WRAPPERS =
  row([
    "'foreign data wrapper'",
    "w.fdwname",
    `coalesce(${regproc("w.fdwhandler")}, '')`,
    `pg_catalog.json_build_object('handler', ${regproc("w.fdwhandler")}, 'validator', ` +
      `${regproc("w.fdwvalidator")}, 'options', ${safeOptions("w.fdwoptions")}, 'hidden', ` +
      `${hiddenOptions("w.fdwoptions")})::text`,
    owner("w.fdwowner"),
    "w.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_foreign_data_wrapper w " +
  described("pg_foreign_data_wrapper", "w.oid") +
  ` WHERE ${notMember("pg_foreign_data_wrapper", "w.oid")}`;

const SERVERS =
  row([
    "'foreign server'",
    "s.srvname",
    "w.fdwname",
    "pg_catalog.json_build_object('wrapper', w.fdwname, 'type', s.srvtype, 'version', s.srvversion, " +
      `'options', ${safeOptions("s.srvoptions")}, 'hidden', ${hiddenOptions("s.srvoptions")})::text`,
    owner("s.srvowner"),
    "s.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_foreign_server s JOIN pg_catalog.pg_foreign_data_wrapper w ON w.oid = " +
  `s.srvfdw ${described("pg_foreign_server", "s.oid")} WHERE ${notMember("pg_foreign_server", "s.oid")}`;

// pg_user_mappings without umoptions: who maps to which server, never the options.
const MAPPINGS = `${row([
  "'user mapping'",
  "CASE WHEN u.umuser = 0 THEN 'PUBLIC' ELSE u.usename END || ' @ ' || u.srvname",
  "u.srvname",
  "pg_catalog.json_build_object('server', u.srvname, 'user', CASE WHEN u.umuser = 0 THEN NULL ELSE " +
    "u.usename END)::text",
  "NULL",
  "u.umid::text",
  "NULL",
])} FROM pg_catalog.pg_user_mappings u`;

const publications = (/** @type {number} */ version) =>
  row([
    "'publication'",
    "p.pubname",
    "CASE WHEN p.puballtables THEN 'all tables' ELSE '' END",
    "pg_catalog.json_build_object('all', p.puballtables, 'insert', p.pubinsert, 'update', p.pubupdate, " +
      "'delete', p.pubdelete, 'truncate', p.pubtruncate, 'viaRoot', p.pubviaroot, 'schemas', " +
      (version >= 150000
        ? "(SELECT pg_catalog.json_agg(sn.nspname ORDER BY sn.nspname) FROM " +
          "pg_catalog.pg_publication_namespace ps JOIN pg_catalog.pg_namespace sn ON sn.oid = " +
          "ps.pnnspid WHERE ps.pnpubid = p.oid)"
        : "NULL") +
      ")::text",
    owner("p.pubowner"),
    "p.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_publication p " +
  described("pg_publication", "p.oid");

const publicationTables = (/** @type {number} */ version) =>
  row([
    "'publication table'",
    "p.pubname",
    "pg_catalog.concat_ws('.', tn.nspname, t.relname)",
    "pg_catalog.json_build_object('schema', tn.nspname, 'table', t.relname" +
      (version >= 150000
        ? ", 'columns', (SELECT pg_catalog.json_agg(a.attname ORDER BY k.o) FROM pg_catalog.unnest(" +
          "r.prattrs) WITH ORDINALITY k(n, o) JOIN pg_catalog.pg_attribute a ON a.attrelid = r.prrelid " +
          "AND a.attnum = k.n), 'where', pg_catalog.pg_get_expr(r.prqual, r.prrelid)"
        : "") +
      ")::text",
    "NULL",
    "r.oid::text",
    "NULL",
  ]) +
  " FROM pg_catalog.pg_publication_rel r JOIN pg_catalog.pg_publication p ON p.oid = r.prpubid JOIN " +
  "pg_catalog.pg_class t ON t.oid = r.prrelid JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace";

/** A subscription's options as this version names them; never subconninfo. */
const SUBSCRIPTION_OPTIONS = /** @type {[number, string][]} */ ([
  [140000, "'binary', s.subbinary, 'streaming', s.substream::text"],
  [150000, "'twoPhase', s.subtwophasestate, 'disableOnError', s.subdisableonerr"],
  [
    160000,
    "'origin', s.suborigin, 'pwRequired', s.subpasswordrequired, 'runAsOwner', s.subrunasowner",
  ],
  [170000, "'failover', s.subfailover"],
]);

const subscriptions = (/** @type {number} */ version) =>
  row([
    "'subscription'",
    "s.subname",
    "CASE WHEN s.subenabled THEN 'enabled' ELSE 'disabled' END",
    "pg_catalog.json_build_object('enabled', s.subenabled, 'slot', s.subslotname, 'syncCommit', " +
      "s.subsynccommit, 'publications', s.subpublications" +
      SUBSCRIPTION_OPTIONS.filter(([since]) => version >= since)
        .map(([, columns]) => `, ${columns}`)
        .join("") +
      ")::text",
    owner("s.subowner"),
    "s.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_subscription s " +
  described("pg_subscription", "s.oid", "d", "pg_shdescription") +
  " WHERE s.subdbid = (SELECT b.oid FROM pg_catalog.pg_database b WHERE b.datname = " +
  "pg_catalog.current_database())";

const EVENT_TRIGGERS =
  row([
    "'event trigger'",
    "t.evtname",
    "t.evtevent",
    "pg_catalog.json_build_object('event', t.evtevent, 'function', t.evtfoid::pg_catalog.regproc::text, " +
      "'enabled', t.evtenabled, 'tags', t.evttags)::text",
    owner("t.evtowner"),
    "t.oid::text",
    "d.description",
  ]) +
  " FROM pg_catalog.pg_event_trigger t " +
  described("pg_event_trigger", "t.oid") +
  ` WHERE ${notMember("pg_event_trigger", "t.oid")}`;

const CASTS =
  row([
    "'cast'",
    "pg_catalog.format_type(k.castsource, NULL) || ' AS ' || pg_catalog.format_type(k.casttarget, NULL)",
    "CASE k.castmethod WHEN 'f' THEN 'function' WHEN 'i' THEN 'inout' ELSE 'binary' END",
    "pg_catalog.json_build_object('source', pg_catalog.format_type(k.castsource, NULL), 'target', " +
      "pg_catalog.format_type(k.casttarget, NULL), 'method', k.castmethod, 'context', k.castcontext, " +
      "'function', CASE WHEN k.castfunc <> 0 THEN k.castfunc::pg_catalog.regprocedure::text END)::text",
    "NULL",
    "k.oid::text",
    "d.description",
  ]) +
  ` FROM pg_catalog.pg_cast k ${described("pg_cast", "k.oid")} WHERE k.oid >= ${USER} AND ` +
  notMember("pg_cast", "k.oid");

const LANGUAGES =
  row([
    "'language'",
    "l.lanname",
    "CASE WHEN l.lanpltrusted THEN 'trusted' ELSE '' END",
    "pg_catalog.json_build_object('trusted', l.lanpltrusted, 'handler', " +
      `${regproc("l.lanplcallfoid")}, 'inline', ${regproc("l.laninline")}, 'validator', ` +
      `${regproc("l.lanvalidator")})::text`,
    owner("l.lanowner"),
    "l.oid::text",
    "d.description",
  ]) +
  ` FROM pg_catalog.pg_language l ${described("pg_language", "l.oid")} WHERE l.lanispl AND ` +
  `l.oid >= ${USER} AND ${notMember("pg_language", "l.oid")}`;

const DATABASE_COMMENTS = [
  "pg_extension",
  "pg_foreign_data_wrapper",
  "pg_foreign_server",
  "pg_publication",
  "pg_event_trigger",
  "pg_cast",
  "pg_language",
];

/** @type {import("../../schema-cache/kinds.js").Kind} */
export const reader = {
  id: "database",
  label: "extensions, foreign data, publications and more",
  level: "database",
  marks: [
    countOf("pg_catalog.pg_extension x", "x"),
    countOf(
      `pg_catalog.pg_depend x WHERE x.refclassid IN (${cls("pg_extension")}, ${cls("pg_publication")})`,
      "x",
    ),
    countOf("pg_catalog.pg_foreign_data_wrapper x", "x"),
    countOf("pg_catalog.pg_foreign_server x", "x"),
    digestOf(
      "pg_catalog.pg_user_mappings x",
      "x.umid::text || ':' || x.srvid::text || ':' || x.umuser::text",
    ),
    countOf("pg_catalog.pg_publication x", "x"),
    digestOf(
      "pg_catalog.pg_subscription x",
      "pg_catalog.concat_ws(':', x.oid, x.subname, x.subowner, x.subenabled, x.subslotname, " +
        "x.subsynccommit, x.subpublications)",
    ),
    countOf("pg_catalog.pg_event_trigger x", "x"),
    countOf(`pg_catalog.pg_cast x WHERE x.oid >= ${USER}`, "x"),
    countOf("pg_catalog.pg_language x", "x"),
    countOf(
      `pg_catalog.pg_description x WHERE x.classoid IN (${DATABASE_COMMENTS.map(cls).join(", ")})`,
      "x",
    ),
  ],
  sql: (_schemas, version = 170000) =>
    `${[
      EXTENSIONS,
      MEMBERS,
      WRAPPERS,
      SERVERS,
      MAPPINGS,
      publications(version),
      publicationTables(version),
      subscriptions(version),
      EVENT_TRIGGERS,
      CASTS,
      LANGUAGES,
    ].join(" UNION ALL ")} ORDER BY 1, 2, 3, 4`,
};

/**
 * The database's objects from the reader's rows (kind, name, detail, JSON, owner, oid, comment): an
 * extension with what it owns, a publication with its tables.
 * @param {Row[]} rows
 */
export function objectsOf(rows) {
  /** @type {SchemaObject[]} */
  const objects = [];
  /** @type {Map<string, string[]>} */
  const members = new Map();
  /** @type {Map<string, Record<string, any>[]>} */
  const tables = new Map();
  for (const [kind, name, detail, extra, who, oid, comment] of rows) {
    const key = name ?? "";
    if (kind === "member") members.set(key, [...(members.get(key) ?? []), detail ?? ""]);
    else if (kind === "publication table")
      tables.set(key, [...(tables.get(key) ?? []), json(extra)]);
    else
      objects.push(
        /** @type {SchemaObject} */ ({
          schema: "",
          name: key,
          kind: /** @type {import("../common.js").ObjectKind} */ (kind ?? "extension"),
          detail: detail ?? "",
          rows: null,
          ident: oid ?? "",
          owner: who ?? "",
          comment: comment ?? "",
          def: json(extra),
        }),
      );
  }
  const many = (/** @type {number} */ n, /** @type {string} */ what) =>
    `${n.toLocaleString()} ${what}${n === 1 ? "" : "s"}`;
  for (const object of objects) {
    const def = /** @type {Record<string, any>} */ (object.def);
    if (object.kind === "extension") {
      def.members = members.get(object.name) ?? [];
      object.detail = [object.detail, many(def.members.length, "object")].join(" · ");
    }
    if (object.kind === "publication") {
      def.tables = tables.get(object.name) ?? [];
      const schemas = def.schemas?.length ? many(def.schemas.length, "schema") : "";
      if (!def.all)
        object.detail = [many(def.tables.length, "table"), schemas].filter(Boolean).join(" · ");
    }
  }
  return objects;
}
