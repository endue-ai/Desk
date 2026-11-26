// A schema's aggregates, operators, collations and text search configurations (PG-50), in one
// statement for every schema of a pass: each row its kind, name, arguments, the definition as JSON,
// owner, oid and comment. An extension's are left out. The DDL is built from the cached row. Pure.

import { t } from "../../strings/index.js";
import { assemble, commentOn, dotted, ident, literal } from "./ddl.js";
import { described, inSchemas, json, markOf, notMember } from "./sql.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {(string | null)[]} Row
 */

const fn = (/** @type {string} */ column) =>
  `CASE WHEN ${column} <> 0 THEN ${column}::pg_catalog.regproc::text END`;
const oper = (/** @type {string} */ column) =>
  `(SELECT pg_catalog.json_build_array(xn.nspname, xo.oprname) FROM pg_catalog.pg_operator xo JOIN ` +
  `pg_catalog.pg_namespace xn ON xn.oid = xo.oprnamespace WHERE xo.oid = ${column})`;
const type = (/** @type {string} */ column) =>
  `CASE WHEN ${column} <> 0 THEN pg_catalog.format_type(${column}, NULL) END`;
const tail = (/** @type {string} */ oid, /** @type {string} */ owner) =>
  `pg_catalog.pg_get_userbyid(${owner}), ${oid}::text, d.description`;

const AGGREGATES =
  "SELECT n.nspname, 'aggregate', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), " +
  "pg_catalog.json_build_object('kind', g.aggkind, 'direct', g.aggnumdirectargs, 'sfunc', " +
  `${fn("g.aggtransfn")}, 'stype', ${type("g.aggtranstype")}, 'sspace', g.aggtransspace, 'finalfunc', ` +
  `${fn("g.aggfinalfn")}, 'finalExtra', g.aggfinalextra, 'finalModify', g.aggfinalmodify, 'combine', ` +
  `${fn("g.aggcombinefn")}, 'serial', ${fn("g.aggserialfn")}, 'deserial', ${fn("g.aggdeserialfn")}, ` +
  `'initcond', g.agginitval, 'msfunc', ${fn("g.aggmtransfn")}, 'minvfunc', ${fn("g.aggminvtransfn")}, ` +
  `'mstype', ${type("g.aggmtranstype")}, 'msspace', g.aggmtransspace, 'mfinalfunc', ` +
  `${fn("g.aggmfinalfn")}, 'mfinalExtra', g.aggmfinalextra, 'mfinalModify', g.aggmfinalmodify, ` +
  `'minitcond', g.aggminitval, 'sortop', ${oper("g.aggsortop")}, 'parallel', p.proparallel)::text, ` +
  `${tail("p.oid", "p.proowner")} FROM pg_catalog.pg_aggregate g JOIN pg_catalog.pg_proc p ` +
  "ON p.oid = g.aggfnoid JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
  `${described("pg_proc", "p.oid")} WHERE %IN% AND ${notMember("pg_proc", "p.oid")}`;

const OPERATORS =
  "SELECT n.nspname, 'operator', o.oprname, pg_catalog.concat_ws(', ', coalesce(" +
  `${type("o.oprleft")}, 'NONE'), ${type("o.oprright")}), pg_catalog.json_build_object('function', ` +
  `${fn("o.oprcode")}, 'left', ${type("o.oprleft")}, 'right', ${type("o.oprright")}, 'result', ` +
  `${type("o.oprresult")}, 'commutator', ${oper("o.oprcom")}, 'negator', ${oper("o.oprnegate")}, ` +
  `'restrict', ${fn("o.oprrest")}, 'join', ${fn("o.oprjoin")}, 'hashes', o.oprcanhash, 'merges', ` +
  `o.oprcanmerge)::text, ${tail("o.oid", "o.oprowner")} FROM pg_catalog.pg_operator o ` +
  `JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace ${described("pg_operator", "o.oid")} ` +
  `WHERE %IN% AND ${notMember("pg_operator", "o.oid")}`;

// to_jsonb reads the locale columns of every version: colliculocale (15, 16), colllocale (17).
const COLLATIONS =
  "SELECT n.nspname, 'collation', co.collname, '', pg_catalog.json_build_object('provider', " +
  "co.collprovider, 'deterministic', co.collisdeterministic, 'collate', co.collcollate, 'ctype', " +
  "co.collctype, 'locale', coalesce(pg_catalog.to_jsonb(co) ->> 'colllocale', pg_catalog.to_jsonb(co) " +
  "->> 'colliculocale'), 'rules', pg_catalog.to_jsonb(co) ->> 'collicurules')::text, " +
  `${tail("co.oid", "co.collowner")} FROM pg_catalog.pg_collation co JOIN ` +
  `pg_catalog.pg_namespace n ON n.oid = co.collnamespace ${described("pg_collation", "co.oid")} ` +
  `WHERE %IN% AND ${notMember("pg_collation", "co.oid")}`;

const CONFIGURATIONS =
  "SELECT n.nspname, 'text search configuration', f.cfgname, '', pg_catalog.json_build_object(" +
  "'parser', (SELECT pg_catalog.json_build_array(pn.nspname, pr.prsname) FROM pg_catalog.pg_ts_parser " +
  "pr JOIN pg_catalog.pg_namespace pn ON pn.oid = pr.prsnamespace WHERE pr.oid = f.cfgparser), 'maps', " +
  "(SELECT pg_catalog.json_agg(pg_catalog.json_build_array(tt.alias, (SELECT pg_catalog.json_agg(" +
  "m.mapdict::pg_catalog.regdictionary::text ORDER BY m.mapseqno) FROM pg_catalog.pg_ts_config_map m " +
  "WHERE m.mapcfg = f.oid AND m.maptokentype = tt.tokid)) ORDER BY tt.tokid) FROM " +
  "pg_catalog.ts_token_type(f.cfgparser) tt WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config_map m " +
  "WHERE m.mapcfg = f.oid AND m.maptokentype = tt.tokid)))::text, " +
  `${tail("f.oid", "f.cfgowner")} FROM pg_catalog.pg_ts_config f JOIN ` +
  `pg_catalog.pg_namespace n ON n.oid = f.cfgnamespace ${described("pg_ts_config", "f.oid")} ` +
  `WHERE %IN% AND ${notMember("pg_ts_config", "f.oid")}`;

const descriptionsOf = (/** @type {string} */ catalog, /** @type {string} */ ns) =>
  markOf(
    `pg_catalog.pg_description d JOIN pg_catalog.${catalog} o ON o.oid = d.objoid AND d.classoid = ` +
      `'pg_catalog.${catalog}'::pg_catalog.regclass`,
    `o.${ns}`,
    "d",
  );

/** @type {import("../../schema-cache/kinds.js").Kind} */
export const reader = {
  id: "objects",
  label: t("schema.pg.objects.aggregatesOperatorsCollationsAndTextSearch"),
  marks: [
    markOf("pg_catalog.pg_operator o", "o.oprnamespace", "o"),
    markOf("pg_catalog.pg_collation o", "o.collnamespace", "o"),
    markOf("pg_catalog.pg_ts_config o", "o.cfgnamespace", "o"),
    markOf(
      "pg_catalog.pg_ts_config_map m JOIN pg_catalog.pg_ts_config o ON o.oid = m.mapcfg",
      "o.cfgnamespace",
      "m",
    ),
    descriptionsOf("pg_operator", "oprnamespace"),
    descriptionsOf("pg_collation", "collnamespace"),
    descriptionsOf("pg_ts_config", "cfgnamespace"),
  ],
  sql: (schemas) =>
    `${[AGGREGATES, OPERATORS, COLLATIONS, CONFIGURATIONS]
      .map((part) => part.replace("%IN%", inSchemas(schemas)))
      .join(" UNION ALL ")} ORDER BY 1, 2, 3, 4`,
};

/** The schema's objects from the reader's rows (kind, name, arguments, detail, owner, oid, comment). */
export function objectsOf(/** @type {Row[]} */ rows, /** @type {string} */ schema) {
  return rows.map(([kind, name, args, detail, owner, oid, comment]) => {
    const def = json(detail);
    const callable = kind === "aggregate" || kind === "operator";
    return /** @type {SchemaObject} */ ({
      schema,
      name: callable ? `${name ?? ""}(${args ?? ""})` : (name ?? ""),
      kind: /** @type {import("../common.js").ObjectKind} */ (kind ?? "aggregate"),
      detail: shownOf(kind ?? "", def),
      rows: null,
      ident: oid ?? "",
      owner: owner ?? "",
      comment: comment ?? "",
      def: { ...def, name: name ?? "", args: args ?? "" },
    });
  });
}

const PROVIDERS = /** @type {Record<string, string>} */ ({
  c: "libc",
  i: "icu",
  b: "builtin",
  d: "default",
});

/** What the explorer says beside each. */
function shownOf(/** @type {string} */ kind, /** @type {Record<string, any>} */ def) {
  if (kind === "aggregate") return def.stype ? `state ${def.stype}` : "";
  if (kind === "operator") return def.result ? `→ ${def.result}` : "";
  if (kind === "collation")
    return [PROVIDERS[def.provider] ?? "", def.locale ?? def.collate ?? ""]
      .filter(Boolean)
      .join(" ");
  return def.parser ? `parser ${def.parser[1]}` : "";
}

const lines = (/** @type {string[]} */ items) => `(\n    ${items.join(",\n    ")}\n)`;
/** An operator as CREATE OPERATOR and COMMUTATOR name it: `schema.op`, the symbol never quoted. */
const opName = (/** @type {string} */ schema, /** @type {string} */ op) =>
  schema ? `${ident(schema)}.${op}` : op;

/** The DDL of an aggregate, operator, collation or configuration from its cached row. */
export function ddl(/** @type {SchemaObject} */ object) {
  const def = /** @type {Record<string, any>} */ (object.def ?? {});
  const base = dotted(object.schema, def.name ?? object.name);
  if (object.kind === "aggregate") {
    const target = `${base}(${def.args || "*"})`;
    return assemble(
      object.owner,
      [aggregateDdl(target, def)],
      commentOn("AGGREGATE", target, object.comment),
    );
  }
  if (object.kind === "operator") {
    const name = opName(object.schema, def.name);
    const items = [`FUNCTION = ${def.function}`];
    if (def.left) items.push(`LEFTARG = ${def.left}`);
    if (def.right) items.push(`RIGHTARG = ${def.right}`);
    for (const [key, word] of /** @type {const} */ ([
      ["commutator", "COMMUTATOR"],
      ["negator", "NEGATOR"],
    ]))
      if (def[key]) items.push(`${word} = OPERATOR(${opName(def[key][0], def[key][1])})`);
    if (def.restrict) items.push(`RESTRICT = ${def.restrict}`);
    if (def.join) items.push(`JOIN = ${def.join}`);
    if (def.hashes) items.push("HASHES");
    if (def.merges) items.push("MERGES");
    const target = `${name} (${def.left ?? "NONE"}, ${def.right ?? "NONE"})`;
    return assemble(
      object.owner,
      [`CREATE OPERATOR ${name} ${lines(items)};\n`],
      commentOn("OPERATOR", target, object.comment),
    );
  }
  if (object.kind === "collation") {
    const items = [`provider = ${PROVIDERS[def.provider] ?? "libc"}`];
    if (def.provider === "c" && def.collate !== def.ctype)
      items.push(
        `lc_collate = ${literal(def.collate ?? "")}`,
        `lc_ctype = ${literal(def.ctype ?? "")}`,
      );
    else items.push(`locale = ${literal(def.locale ?? def.collate ?? "")}`);
    if (def.deterministic === false) items.push("deterministic = false");
    if (def.rules) items.push(`rules = ${literal(def.rules)}`);
    return assemble(
      object.owner,
      [`CREATE COLLATION ${base} (${items.join(", ")});\n`],
      commentOn("COLLATION", base, object.comment),
    );
  }
  const parser = def.parser ? dotted(def.parser[0], def.parser[1]) : 'pg_catalog."default"';
  return assemble(
    object.owner,
    [
      `CREATE TEXT SEARCH CONFIGURATION ${base} (PARSER = ${parser});\n`,
      ...mappings(base, def.maps),
    ],
    commentOn("TEXT SEARCH CONFIGURATION", base, object.comment),
  );
}

/** CREATE AGGREGATE with what differs from the defaults. */
function aggregateDdl(/** @type {string} */ target, /** @type {Record<string, any>} */ def) {
  const items = [`SFUNC = ${def.sfunc}`, `STYPE = ${def.stype}`];
  const plain = def.kind === "n";
  const modify = { r: "READ_ONLY", s: "SHAREABLE", w: "READ_WRITE" };
  if (def.sspace) items.push(`SSPACE = ${def.sspace}`);
  if (def.finalfunc) items.push(`FINALFUNC = ${def.finalfunc}`);
  if (def.finalExtra) items.push("FINALFUNC_EXTRA");
  if (def.finalfunc && def.finalModify !== (plain ? "r" : "w"))
    items.push(`FINALFUNC_MODIFY = ${modify[/** @type {"r"} */ (def.finalModify)] ?? "READ_ONLY"}`);
  for (const [key, word] of /** @type {const} */ ([
    ["combine", "COMBINEFUNC"],
    ["serial", "SERIALFUNC"],
    ["deserial", "DESERIALFUNC"],
  ]))
    if (def[key]) items.push(`${word} = ${def[key]}`);
  if (def.initcond !== null && def.initcond !== undefined)
    items.push(`INITCOND = ${literal(def.initcond)}`);
  if (def.msfunc) {
    items.push(`MSFUNC = ${def.msfunc}`, `MINVFUNC = ${def.minvfunc}`, `MSTYPE = ${def.mstype}`);
    if (def.msspace) items.push(`MSSPACE = ${def.msspace}`);
    if (def.mfinalfunc) items.push(`MFINALFUNC = ${def.mfinalfunc}`);
    if (def.mfinalExtra) items.push("MFINALFUNC_EXTRA");
    if (def.mfinalfunc && def.mfinalModify !== "r")
      items.push(
        `MFINALFUNC_MODIFY = ${modify[/** @type {"r"} */ (def.mfinalModify)] ?? "READ_ONLY"}`,
      );
    if (def.minitcond !== null && def.minitcond !== undefined)
      items.push(`MINITCOND = ${literal(def.minitcond)}`);
  }
  if (def.sortop) items.push(`SORTOP = OPERATOR(${opName(def.sortop[0], def.sortop[1])})`);
  if (def.parallel === "s") items.push("PARALLEL = SAFE");
  else if (def.parallel === "r") items.push("PARALLEL = RESTRICTED");
  if (def.kind === "h") items.push("HYPOTHETICAL");
  return `CREATE AGGREGATE ${target} ${lines(items)};\n`;
}

/** ADD MAPPING per run of token types that share their dictionaries, in the parser's order. */
function mappings(/** @type {string} */ name, /** @type {unknown} */ maps) {
  /** @type {Map<string, string[]>} */
  const byDicts = new Map();
  for (const [token, dicts] of /** @type {[string, string[]][]} */ (
    Array.isArray(maps) ? maps : []
  )) {
    const key = (dicts ?? []).join(", ");
    byDicts.set(key, [...(byDicts.get(key) ?? []), token]);
  }
  return [...byDicts].map(
    ([dicts, tokens]) =>
      `ALTER TEXT SEARCH CONFIGURATION ${name}\n    ADD MAPPING FOR ${tokens.join(", ")} WITH ${dicts};\n`,
  );
}
