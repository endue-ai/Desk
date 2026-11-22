// The objects of a model, each with its DDL as this plugin writes it (PG-53, ADR 0338), the same
// whether a server or a file gave them: a table by the table form's writer (table.js), a view and a
// materialized view over their query, a sequence with every parameter, an enum, a domain and a
// composite type from their parts, a routine and a trigger as written. Pure.

import { qualified, quoteName, quoteText } from "../../sql/quote.js";
import { tableDdl } from "./table.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("./model.js").Sequence} Sequence
 * @typedef {import("../table-design/model.js").Design} Design
 * @typedef {import("../table-design/read.js").Facts} Facts
 */

const PG = "postgresql";

/** A query as it follows AS: trimmed, without its `;`. */
const query = (/** @type {string} */ body) => body.trim().replace(/;\s*$/u, "");

/** A table. */
export function tableObj(
  /** @type {Design} */ design,
  /** @type {string} */ partition,
  /** @type {Facts} */ facts,
) {
  /** @type {Obj} */
  const o = { kind: "table", name: design.name, ddl: "", table: { ...design, owner: "" } };
  if (partition) o.partition = partition;
  o.ddl = tableDdl(o, facts);
  return o;
}

/** A view or a materialized view over its query. */
export function viewObj(
  /** @type {"view" | "materialized view"} */ kind,
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {string} */ body,
) {
  const q = query(body);
  const what = kind === "view" ? "VIEW" : "MATERIALIZED VIEW";
  return /** @type {Obj} */ ({
    kind,
    name,
    body: q,
    ddl: `CREATE ${what} ${qualified(PG, schema, name)} AS\n${q}`,
  });
}

/** PostgreSQL's defaults for what a CREATE SEQUENCE leaves out. */
export function sequenceDefaults(/** @type {Partial<Sequence>} */ s) {
  const type = s.type ?? "bigint";
  const top = { smallint: "32767", integer: "2147483647", bigint: "9223372036854775807" };
  const bottom = { smallint: "-32768", integer: "-2147483648", bigint: "-9223372036854775808" };
  const increment = s.increment ?? "1";
  const up = !increment.startsWith("-");
  const key = /** @type {keyof typeof top} */ (type in top ? type : "bigint");
  const min = s.min ?? (up ? "1" : bottom[key]);
  const max = s.max ?? (up ? top[key] : "-1");
  /** @type {Sequence} */
  const full = {
    type,
    start: s.start ?? (up ? min : max),
    increment,
    min,
    max,
    cache: s.cache ?? "1",
    cycle: s.cycle ?? false,
  };
  return full;
}

/** A sequence's CREATE or ALTER clauses. */
export function sequenceClauses(/** @type {NonNullable<Obj["sequence"]>} */ s) {
  return `AS ${s.type} INCREMENT BY ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.max} START WITH ${s.start} CACHE ${s.cache} ${s.cycle ? "CYCLE" : "NO CYCLE"}`;
}

/** A sequence with every parameter. */
export function sequenceObj(
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {Sequence} */ sequence,
) {
  return /** @type {Obj} */ ({
    kind: "sequence",
    name,
    sequence,
    ddl: `CREATE SEQUENCE ${qualified(PG, schema, name)} ${sequenceClauses(sequence)}`,
  });
}

/** An enum. */
export function enumObj(
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {string[]} */ labels,
) {
  const values = labels.map((l) => quoteText(PG, l)).join(", ");
  return /** @type {Obj} */ ({
    kind: "type",
    typeKind: "enum",
    name,
    labels,
    ddl: `CREATE TYPE ${qualified(PG, schema, name)} AS ENUM (${values})`,
  });
}

/** A domain: its base type, default, NOT NULL and checks (a made-up check name left out). */
export function domainObj(
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {{ base: string, default: string, notNull: boolean, checks: { name: string, sql: string }[] }} */ d,
) {
  const parts = [`CREATE DOMAIN ${qualified(PG, schema, name)} AS ${d.base}`];
  if (d.default.trim()) parts.push(`DEFAULT ${d.default.trim()}`);
  if (d.notNull) parts.push("NOT NULL");
  const checks = [...d.checks].sort((a, b) => (a.sql < b.sql ? -1 : a.sql > b.sql ? 1 : 0));
  for (const c of checks)
    parts.push(
      `${c.name && !/_check\d*$/u.test(c.name) ? `CONSTRAINT ${quoteName(PG, c.name)} ` : ""}${c.sql}`,
    );
  return /** @type {Obj} */ ({ kind: "type", typeKind: "domain", name, ddl: parts.join(" ") });
}

/** A composite type from its attributes' names and types. */
export function compositeObj(
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {[string, string][]} */ attributes,
) {
  const list = attributes.map(([a, t]) => `    ${quoteName(PG, a)} ${t}`).join(",\n");
  return /** @type {Obj} */ ({
    kind: "type",
    typeKind: "composite",
    name,
    ddl: `CREATE TYPE ${qualified(PG, schema, name)} AS (\n${list}\n)`,
  });
}

/** A function or a procedure as written, under `name(argument types)`. */
export function routineObj(
  /** @type {string} */ name,
  /** @type {string} */ args,
  /** @type {"function" | "procedure"} */ routine,
  /** @type {string} */ ddl,
) {
  return /** @type {Obj} */ ({
    kind: "function",
    name: `${name}(${args})`,
    args,
    routine,
    ddl: ddl.trim().replace(/;\s*$/u, ""),
  });
}

/** A trigger as written, under `table.trigger`. */
export function triggerObj(
  /** @type {string} */ table,
  /** @type {string} */ name,
  /** @type {string} */ ddl,
) {
  return /** @type {Obj} */ ({
    kind: "trigger",
    name: `${table}.${name}`,
    on: table,
    ddl: ddl.trim().replace(/;\s*$/u, ""),
  });
}
