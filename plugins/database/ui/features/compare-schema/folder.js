// A folder of DDL files read as a model (PG-53, ADR 0338): every statement of every file, whatever
// file holds it. CREATE TABLE, TYPE, DOMAIN, SEQUENCE, VIEW, MATERIALIZED VIEW, FUNCTION, PROCEDURE
// and TRIGGER make objects; CREATE INDEX, ALTER TABLE ... ADD, COMMENT ON TABLE and COLUMN join their
// table; ownership and grants are passed over; a serial column makes its sequence as PostgreSQL does.
// A statement it cannot read is noted, and a table it cannot read is held: compared by its text and
// never changed by a script. Pure.

import { split } from "../../sql/split.js";
import { cursor, items, literal } from "./cursor.js";
import { factsFor } from "./model.js";
import {
  compositeObj,
  domainObj,
  enumObj,
  routineObj,
  sequenceDefaults,
  sequenceObj,
  tableObj,
  triggerObj,
  viewObj,
} from "./objects.js";
import { addConstraint, keyOf, parseComment, parseIndex, parseTable } from "./parse-table.js";
import { argTypes, typeDdl, typed } from "./types.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("./model.js").Model} Model
 * @typedef {{ path: string, text: string }} File
 */

const PASSED =
  /^(ALTER\s+(TABLE|SEQUENCE|VIEW|TYPE|FUNCTION|DOMAIN)\s+(ONLY\s+)?\S+(\s+\S+)?\s+OWNER\s+TO|GRANT|REVOKE|SET|SELECT\s+pg_catalog\.set_config|BEGIN|COMMIT|CREATE\s+SCHEMA)\b/isu;

/** The statement's leading words, folded: `create or replace view`. */
const head = (/** @type {string} */ text) =>
  text
    .replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/u, "")
    .slice(0, 80)
    .toLowerCase()
    .replace(/\s+/gu, " ");

/** A sequence's options: AS, INCREMENT BY, MINVALUE, MAXVALUE, START WITH, CACHE, CYCLE. */
function sequenceOf(/** @type {ReturnType<typeof cursor>} */ c) {
  /** @type {Partial<import("./model.js").Sequence>} */
  const s = {};
  const num = () => {
    const minus = c.take("-") ? "-" : "";
    const v = c.peek();
    c.take(v);
    return `${minus}${v}`;
  };
  while (!c.done) {
    if (c.take("as")) s.type = typed(c.one(), { own: "" }).type;
    else if (c.take("increment")) {
      c.take("by");
      s.increment = num();
    } else if (c.take("minvalue")) s.min = num();
    else if (c.take("maxvalue")) s.max = num();
    else if (c.take("no", "minvalue") || c.take("no", "maxvalue") || c.take("no", "cycle"))
      s.cycle = s.cycle ?? false;
    else if (c.take("start")) {
      c.take("with");
      s.start = num();
    } else if (c.take("cache")) s.cache = num();
    else if (c.take("cycle")) s.cycle = true;
    else if (c.take("owned", "by")) c.rest();
    else throw new Error(`a sequence option it cannot read: ${c.rest()}`);
  }
  return sequenceDefaults(s);
}

/**
 * Read files as one schema's model.
 * @param {string} schema The schema the files are of (their unqualified names are in it).
 * @param {File[]} files
 * @returns {Model}
 */
export function modelOfFiles(schema, files) {
  /** @type {{ text: string, path: string }[]} */
  const statements = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1)))
    for (const s of split(f.text, "postgresql"))
      if (s.text.trim())
        statements.push({ text: s.text.trim().replace(/;\s*$/u, ""), path: f.path });
  /** @type {string[]} */
  const notes = [];
  /** @type {Obj[]} */
  const objects = [];
  const ours = new Set();
  for (const { text } of statements) {
    const h = head(text);
    const m = /^create (type|domain) (?:if not exists )?([^\s(]+)/u.exec(h);
    if (m) ours.add(cursor(m[2] ?? "").qualified().name);
  }
  const ctx = { schema, ours, seq: { n: 0 } };
  /** @type {Map<string, { obj: Obj, read: ReturnType<typeof parseTable> }>} */
  const tables = new Map();
  const later = [];
  const own = (/** @type {{ schema: string }} */ n) => n.schema === "" || n.schema === schema;
  for (const st of statements) {
    const h = head(st.text);
    const c = cursor(st.text);
    try {
      if (/^create (unlogged |temp |temporary )?table /u.test(h)) {
        const read = parseTable(st.text, ctx);
        read.design.schema = schema;
        tables.set(read.design.name, {
          obj: { kind: "table", name: read.design.name, ddl: "" },
          read,
        });
      } else if (/^create (unique )?index |^alter table |^comment on (table|column) /u.test(h))
        later.push(st);
      else if (/^create (or replace )?(materialized )?view /u.test(h)) {
        c.take("create");
        c.take("or", "replace");
        const kind = c.take("materialized") ? "materialized view" : "view";
        c.take("view");
        c.take("if", "not", "exists");
        const name = c.qualified();
        c.group();
        while (!c.take("as")) c.take(c.peek());
        const body = c.rest().replace(/\s+WITH\s+(NO\s+)?DATA\s*$/iu, "");
        objects.push(viewObj(kind, schema, name.name, body));
      } else if (/^create sequence /u.test(h)) {
        c.take("create", "sequence");
        c.take("if", "not", "exists");
        const name = c.qualified();
        objects.push(sequenceObj(schema, name.name, sequenceOf(c)));
      } else if (/^create type /u.test(h)) {
        c.take("create", "type");
        const name = c.qualified();
        c.take("as");
        if (c.take("enum"))
          objects.push(enumObj(schema, name.name, items(c.group() ?? "").map(literal)));
        else {
          const attrs = items(c.group() ?? "").map((a) => {
            const p = cursor(a);
            const n = p.one();
            const t = typed(p.rest(), { own: schema, ours });
            return /** @type {[string, string]} */ ([n, typeDdl(t)]);
          });
          objects.push(compositeObj(schema, name.name, attrs));
        }
      } else if (/^create domain /u.test(h)) {
        c.take("create", "domain");
        const name = c.qualified();
        c.take("as");
        const base = typed(
          c.until(new Set(["default", "not", "null", "check", "constraint", "collate"])),
          { own: schema, ours },
        );
        const d = {
          base: typeDdl(base),
          default: "",
          notNull: false,
          checks: /** @type {{ name: string, sql: string }[]} */ ([]),
        };
        let named = "";
        while (!c.done) {
          if (c.take("constraint")) named = c.one();
          else if (c.take("default"))
            d.default = c.until(new Set(["not", "null", "check", "constraint"]));
          else if (c.take("not", "null")) d.notNull = true;
          else if (c.take("null")) d.notNull = false;
          else if (c.take("check")) {
            d.checks.push({ name: named, sql: `CHECK (${(c.group() ?? "").trim()})` });
            named = "";
          } else throw new Error(`a domain option it cannot read: ${c.rest()}`);
        }
        objects.push(domainObj(schema, name.name, d));
      } else if (/^create (or replace )?(function|procedure) /u.test(h)) {
        c.take("create");
        c.take("or", "replace");
        const routine = c.take("procedure") ? "procedure" : "function";
        c.take("function");
        const name = c.qualified();
        objects.push(
          routineObj(name.name, argTypes(c.group() ?? "", { own: schema, ours }), routine, st.text),
        );
      } else if (/^create (or replace )?(constraint )?trigger /u.test(h)) {
        const on =
          /\bON\s+((?:"(?:[^"]|"")*"|[\w$]+)(?:\s*\.\s*(?:"(?:[^"]|"")*"|[\w$]+))?)/iu.exec(
            st.text,
          );
        const table = cursor(on?.[1] ?? "").qualified().name;
        c.take("create");
        c.take("or", "replace");
        c.take("constraint");
        c.take("trigger");
        objects.push(triggerObj(table, c.one(), st.text));
      } else if (!PASSED.test(st.text.trim()))
        notes.push(`${st.path}: not read: ${h.slice(0, 60)}`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      notes.push(`${st.path}: ${why}`);
      if (/^create (unlogged |temp |temporary )?table /u.test(h)) {
        const name = cursor(
          st.text.replace(
            /^\s*create\s+(unlogged\s+|temp\s+|temporary\s+)?table\s+(if\s+not\s+exists\s+)?/iu,
            "",
          ),
        ).qualified().name;
        objects.push({
          kind: "table",
          name,
          ddl: st.text,
          held: `${st.path} did not read (${why}).`,
        });
      }
    }
  }
  for (const st of later) {
    const h = head(st.text);
    try {
      if (h.startsWith("comment on")) {
        const cm = parseComment(st.text);
        const t = tables.get(cm.table)?.read.design;
        if (!t) throw new Error(`a comment on ${cm.table}, which no file creates`);
        if (cm.kind === "table") t.comment = cm.value;
        else {
          const col = t.columns.find((x) => x.name === cm.column);
          if (col) col.comment = cm.value;
        }
      } else if (h.startsWith("create")) {
        const ix = parseIndex(st.text);
        const t = tables.get(ix.table.name)?.read.design;
        if (!t || !own(ix.table))
          throw new Error(`an index on ${ix.table.name}, which no file creates`);
        const base = {
          id: `k${++ctx.seq.n}`,
          name: ix.name,
          method: ix.method,
          unique: ix.unique,
          where: ix.where,
          concurrently: false,
        };
        t.indexes.push(
          ix.kept
            ? { ...base, keys: [], kept: ix.kept }
            : { ...base, keys: ix.keys.map((k) => keyOf(t, k)) },
        );
      } else {
        const c = cursor(st.text);
        c.take("alter", "table");
        c.take("only");
        const name = c.qualified();
        const t = tables.get(name.name)?.read.design;
        if (!t || !c.take("add")) throw new Error(`an ALTER TABLE it cannot read`);
        const named = c.take("constraint") ? c.one() : "";
        addConstraint(t, named, st.text.slice(c.at), ctx);
      }
    } catch (error) {
      notes.push(`${st.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const pending = [...tables.values()];
  for (const { read } of pending)
    for (const s of read.serials) {
      const name = `${read.design.name}_${s.column}_seq`;
      if (!objects.some((o) => o.kind === "sequence" && o.name === name))
        objects.push(sequenceObj(schema, name, sequenceDefaults({ type: s.type })));
    }
  // A foreign key that names no columns references the other table's primary key.
  for (const { read } of pending)
    for (const fk of read.design.foreignKeys)
      if (!fk.self && fk.refColumns.length === 0) {
        const ref = tables.get(fk.refTable)?.read.design;
        fk.refColumns = (ref?.primaryKey?.columns ?? []).map(
          (id) => ref?.columns.find((x) => x.id === id)?.name ?? "",
        );
      }
  const facts = factsFor(
    pending.map(({ read }) => ({ kind: "table", name: "", ddl: "", table: read.design })),
  );
  for (const { read } of pending) objects.push(tableObj(read.design, read.partition, facts));
  /** @type {Model} */
  const model = { format: 1, schema, objects };
  if (notes.length) model.notes = notes;
  return model;
}

/** The schema a folder's CREATE statements name most, or "" when they name none. */
export function schemaOfFiles(/** @type {File[]} */ files) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  const create =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")*"|[A-Za-z_][\w$]*)\s*\./giu;
  for (const f of files)
    for (const m of f.text.matchAll(create)) {
      const raw = m[1] ?? "";
      const name = raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw.toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  let best = "";
  for (const [name, n] of counts) if (n > (counts.get(best) ?? 0)) best = name;
  return best;
}
