// What hangs under a table beyond its keys, indexes and triggers (PG-50): its partitions at every
// level with their bounds (under the root table), the tables it inherits from, its row-level
// security policies and its rules. One statement for every schema of a pass; each row names the
// table, the part's kind and name, what the explorer shows and the rest as JSON. Pure.

import { t } from "../../strings/index.js";
import { assemble, commentOn, dotted, ident } from "./ddl.js";
import { inSchemas, json, markOf } from "./sql.js";

/**
 * @typedef {import("../common.js").Part} Part
 * @typedef {(string | null)[]} Row
 */

const OWNED = "c.relkind IN ('r', 'p', 'f')";
const xmins = (/** @type {string} */ a, /** @type {string} */ b) =>
  `pg_catalog.sum(${a}.xmin::text::bigint + ${b}.xmin::text::bigint)`;
const inherits = (/** @type {string} */ ns, /** @type {string} */ other) =>
  `SELECT ${ns}.relnamespace AS ns, pg_catalog.count(*) AS c, ${xmins("i", other)} AS x FROM ` +
  "pg_catalog.pg_inherits i JOIN pg_catalog.pg_class k ON k.oid = i.inhrelid JOIN pg_catalog.pg_class " +
  "p ON p.oid = i.inhparent GROUP BY 1";
const descriptions = (/** @type {string} */ catalog, /** @type {string} */ rel) =>
  markOf(
    `pg_catalog.pg_description d JOIN pg_catalog.${catalog} o ON o.oid = d.objoid AND d.classoid = ` +
      `'pg_catalog.${catalog}'::pg_catalog.regclass JOIN pg_catalog.pg_class c ON c.oid = o.${rel}`,
    "c.relnamespace",
    "d",
  );
const comment = (/** @type {string} */ catalog, /** @type {string} */ oid) =>
  `(SELECT d.description FROM pg_catalog.pg_description d WHERE d.objoid = ${oid} AND d.classoid = ` +
  `'pg_catalog.${catalog}'::pg_catalog.regclass AND d.objsubid = 0)`;

const PARTITIONS =
  "SELECT n.nspname, r.relname, 'partition', c.relname, pg_catalog.pg_get_expr(c.relpartbound, c.oid), " +
  "pg_catalog.json_build_object('schema', cn.nspname, 'parent', (SELECT pg_catalog.json_build_array(" +
  "pn.nspname, p.relname) FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class p ON p.oid = " +
  "i.inhparent JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace WHERE i.inhrelid = c.oid), " +
  "'key', CASE WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid) END, 'foreign', " +
  "c.relkind = 'f')::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace cn ON cn.oid = " +
  "c.relnamespace JOIN pg_catalog.pg_class r ON r.oid = pg_catalog.pg_partition_root(c.oid) JOIN " +
  `pg_catalog.pg_namespace n ON n.oid = r.relnamespace WHERE %IN% AND c.relispartition AND ${OWNED}`;

const INHERITS =
  "SELECT n.nspname, c.relname, 'inherits', p.relname, pg_catalog.concat_ws('.', pn.nspname, " +
  "p.relname), pg_catalog.json_build_object('schema', pn.nspname, 'seq', i.inhseqno)::text FROM " +
  "pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid JOIN " +
  "pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN pg_catalog.pg_class p ON p.oid = " +
  "i.inhparent JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace WHERE %IN% AND NOT " +
  `c.relispartition AND ${OWNED}`;

const POLICIES =
  "SELECT n.nspname, c.relname, 'policy', pol.polname, CASE pol.polcmd WHEN 'r' THEN 'select' WHEN " +
  "'a' THEN 'insert' WHEN 'w' THEN 'update' WHEN 'd' THEN 'delete' ELSE 'all' END || CASE WHEN " +
  "pol.polpermissive THEN '' ELSE ' · restrictive' END, pg_catalog.json_build_object('cmd', " +
  "pol.polcmd, 'permissive', pol.polpermissive, 'roles', ARRAY(SELECT CASE WHEN u.r = 0 THEN NULL " +
  "ELSE pg_catalog.pg_get_userbyid(u.r) END FROM pg_catalog.unnest(pol.polroles) WITH ORDINALITY " +
  "u(r, o) ORDER BY u.o), 'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'check', " +
  "pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), 'comment', " +
  `${comment("pg_policy", "pol.oid")})::text FROM pg_catalog.pg_policy pol JOIN pg_catalog.pg_class ` +
  "c ON c.oid = pol.polrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE %IN% AND " +
  "NOT c.relispartition";

const RULES =
  "SELECT n.nspname, c.relname, 'rule', w.rulename, 'on ' || CASE w.ev_type WHEN '1' THEN 'select' " +
  "WHEN '2' THEN 'update' WHEN '3' THEN 'insert' ELSE 'delete' END || CASE WHEN w.is_instead THEN " +
  "' · instead' ELSE '' END, pg_catalog.json_build_object('def', pg_catalog.pg_get_ruledef(w.oid, " +
  `true), 'comment', ${comment("pg_rewrite", "w.oid")})::text FROM pg_catalog.pg_rewrite w JOIN ` +
  "pg_catalog.pg_class c ON c.oid = w.ev_class JOIN pg_catalog.pg_namespace n ON n.oid = " +
  `c.relnamespace WHERE %IN% AND w.rulename <> '_RETURN' AND NOT c.relispartition AND ${OWNED}`;

/** @type {import("../../schema-cache/kinds.js").Kind} */
export const reader = {
  id: "table parts",
  label: t("schema.pg.tableParts.partitionsInheritancePoliciesAndRules"),
  marks: [
    inherits("p", "k"),
    inherits("k", "p"),
    markOf(
      "pg_catalog.pg_policy o JOIN pg_catalog.pg_class c ON c.oid = o.polrelid",
      "c.relnamespace",
      "o",
    ),
    markOf(
      "pg_catalog.pg_rewrite o JOIN pg_catalog.pg_class c ON c.oid = o.ev_class",
      "c.relnamespace",
      "o",
    ),
    descriptions("pg_policy", "polrelid"),
    descriptions("pg_rewrite", "ev_class"),
  ],
  sql: (schemas) =>
    `${[PARTITIONS, INHERITS, POLICIES, RULES]
      .map((part) => part.replace("%IN%", inSchemas(schemas)))
      .join(" UNION ALL ")} ORDER BY 1, 2, 3, 4`,
};

/** The schema's parts by table, from the reader's rows (table, kind, name, detail, JSON). */
export function partsOf(/** @type {Row[]} */ rows, /** @type {string} */ schema) {
  /** @type {Map<string, Part[]>} */
  const out = new Map();
  for (const [table, kind, name, detail, extra] of rows) {
    const def = json(extra);
    const part = /** @type {Part} */ ({
      schema,
      table: table ?? "",
      kind: /** @type {import("../common.js").PartKind} */ (kind ?? "rule"),
      name: name ?? "",
      detail: shownOf(kind ?? "", detail ?? "", def, schema, table ?? ""),
      extra: "",
      def: { ...def, text: detail ?? "" },
    });
    out.set(part.table, [...(out.get(part.table) ?? []), part]);
  }
  return out;
}

/** What the explorer says beside a part: a partition's bound, and its parent below the root. */
function shownOf(
  /** @type {string} */ kind,
  /** @type {string} */ detail,
  /** @type {Record<string, any>} */ def,
  /** @type {string} */ schema,
  /** @type {string} */ table,
) {
  if (kind !== "partition") return detail;
  const [ps, pn] = def.parent ?? [];
  const nested = pn !== undefined && (pn !== table || ps !== schema);
  return [detail, def.key ? "partitioned" : "", nested ? `of ${pn}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The DDL of a partition, an inherited parent, a policy or a rule, from the cached row. */
export function ddl(/** @type {Part} */ part) {
  const def = /** @type {Record<string, any>} */ (part.def ?? {});
  const table = dotted(part.schema, part.table);
  if (part.kind === "partition") {
    const [ps, pn] = def.parent ?? [part.schema, part.table];
    const name = dotted(def.schema ?? part.schema, part.name);
    const key = def.key ? ` PARTITION BY ${def.key}` : "";
    const kind = def.foreign ? "FOREIGN TABLE" : "TABLE";
    return `CREATE ${kind} ${name} PARTITION OF ${dotted(ps, pn)}\n    ${def.text}${key};\n`;
  }
  if (part.kind === "inherits")
    return `ALTER TABLE ${table} INHERIT ${dotted(def.schema ?? part.schema, part.name)};\n`;
  if (part.kind === "rule") {
    const text = String(def.def ?? "").trim();
    const target = `${ident(part.name)} ON ${table}`;
    return assemble(
      "",
      [`${text.endsWith(";") ? text : `${text};`}\n`],
      commentOn("RULE", target, def.comment),
    );
  }
  const cmd =
    { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" }[/** @type {"r"} */ (def.cmd)] ?? "ALL";
  const roles = (def.roles ?? []).map((/** @type {string | null} */ r) =>
    r === null ? "PUBLIC" : ident(r),
  );
  const target = `${ident(part.name)} ON ${table}`;
  const text =
    `CREATE POLICY ${target}\n    AS ${def.permissive === false ? "RESTRICTIVE" : "PERMISSIVE"}\n` +
    `    FOR ${cmd}\n    TO ${roles.length ? roles.join(", ") : "PUBLIC"}` +
    `${def.using ? `\n    USING (${def.using})` : ""}${def.check ? `\n    WITH CHECK (${def.check})` : ""};\n`;
  return assemble("", [text], commentOn("POLICY", target, def.comment));
}
