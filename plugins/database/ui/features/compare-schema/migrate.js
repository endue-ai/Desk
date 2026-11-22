// The migration script between two schemas (PG-53, ADR 0338): what makes the target like the source,
// for the objects the person chose, in an order that applies. Views, materialized views and triggers
// that go (or are built again) are dropped first; then, in the order of what each needs (order.js),
// types, sequences, functions, tables (a new one by the table form's CREATE without its foreign keys,
// a changed one by its ALTER writer over aligned designs, align.js), views and triggers; the new
// tables' foreign keys after them all; and last the tables, functions, sequences and types that go.
// Destructive and risky steps carry their words as `-- ` lines; what it will not write is `held`. Pure.

import { qualified, quoteName, quoteText } from "../../sql/quote.js";
import { alterSteps } from "../table-design/alter.js";
import { insideText } from "../table-design/script.js";
import { MARKS as TABLE_MARKS } from "../table-design/words.js";
import { align } from "./align.js";
import { factsFor, keyOf } from "./model.js";
import { norm, rebaseText } from "./normalize.js";
import { sequenceClauses } from "./objects.js";
import { createOrder, dropOrder } from "./order.js";
import { foreignSteps, tableSteps } from "./table.js";
import { DROPS, HELD, MARKS } from "./words.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("./model.js").Model} Model
 * @typedef {import("../table-design/read.js").Facts} Facts
 * @typedef {import("../table-design/alter-columns.js").Step} Step
 * @typedef {{ steps: Step[], held: string[], text: string }} Migration
 *   `steps` run in one transaction; `text` is the script as shown and as a console gets it.
 */

const PG = "postgresql";
const FIRST = new Set(["trigger", "view", "materialized view"]);

/** An object of the source written for the target's schema. */
export function rebase(/** @type {Obj} */ o, /** @type {string} */ from, /** @type {string} */ to) {
  if (from === to) return o;
  const moved = { ...o, ddl: rebaseText(o.ddl, from, to) };
  if (o.body !== undefined) moved.body = rebaseText(o.body, from, to);
  if (o.table) {
    const t = o.table;
    const kept = (/** @type {any} */ p) =>
      p.kept === undefined ? p : { ...p, kept: rebaseText(p.kept, from, to) };
    moved.table = {
      ...t,
      schema: to,
      primaryKey: t.primaryKey && kept(t.primaryKey),
      uniques: t.uniques.map(kept),
      checks: t.checks.map(kept),
      indexes: t.indexes.map(kept),
      others: t.others.map(kept),
      foreignKeys: t.foreignKeys.map((f) =>
        kept({ ...f, refSchema: f.refSchema === from ? to : f.refSchema }),
      ),
      columns: t.columns.map((c) => ({
        ...c,
        type: c.type.startsWith(`${from}.`) ? `${to}${c.type.slice(from.length)}` : c.type,
        default: rebaseText(c.default, from, to),
        generated: rebaseText(c.generated, from, to),
      })),
    };
  }
  return moved;
}

/** An object's name as DDL writes it in a schema. */
function sqlName(/** @type {Obj} */ o, /** @type {string} */ schema) {
  if (o.kind === "function")
    return `${qualified(PG, schema, o.name.replace(/\(.*$/su, ""))}(${o.args ?? ""})`;
  if (o.kind === "trigger") {
    const on = o.on ?? "";
    return `${quoteName(PG, o.name.slice(on.length + 1))} ON ${qualified(PG, schema, on)}`;
  }
  return qualified(PG, schema, o.name);
}

/** The DROP of an object. */
function dropOf(/** @type {Obj} */ o, /** @type {string} */ schema) {
  const what =
    o.kind === "function"
      ? o.routine === "procedure"
        ? "PROCEDURE"
        : "FUNCTION"
      : o.kind === "type"
        ? o.typeKind === "domain"
          ? "DOMAIN"
          : "TYPE"
        : o.kind.toUpperCase();
  return {
    sql: `DROP ${what} ${sqlName(o, schema)}`,
    marks: [DROPS[o.kind](`${schema}.${o.name}`)],
  };
}

/** The steps of an enum that gains values; held when one goes or they move. */
function enumSteps(
  /** @type {Obj} */ was,
  /** @type {Obj} */ now,
  /** @type {string} */ schema,
  /** @type {string[]} */ held,
) {
  const before = was.labels ?? [];
  const after = now.labels ?? [];
  const gone = before.filter((l) => !after.includes(l));
  if (gone.length) held.push(HELD.enumRemoved(`${schema}.${now.name}`, gone));
  const kept = after.filter((l) => before.includes(l));
  if (kept.join("\u0000") !== before.filter((l) => after.includes(l)).join("\u0000"))
    held.push(HELD.type(`${schema}.${now.name}`));
  /** @type {Step[]} */
  const steps = [];
  const have = new Set(before);
  after.forEach((label, i) => {
    if (have.has(label)) return;
    const prev = after
      .slice(0, i)
      .reverse()
      .find((l) => have.has(l));
    const next = after.slice(i + 1).find((l) => have.has(l));
    const where =
      prev !== undefined
        ? ` AFTER ${quoteText(PG, prev)}`
        : next !== undefined
          ? ` BEFORE ${quoteText(PG, next)}`
          : "";
    steps.push({
      sql: `ALTER TYPE ${qualified(PG, schema, now.name)} ADD VALUE ${quoteText(PG, label)}${where}`,
      marks: [MARKS.enumValue],
    });
    have.add(label);
  });
  return steps;
}

/** A changed table's ALTER steps: PG-51's writer over the aligned designs, kept parts by their DDL. */
function tableChange(
  /** @type {Obj} */ was,
  /** @type {Obj} */ now,
  /** @type {Facts} */ facts,
  /** @type {string} */ schema,
  /** @type {string[]} */ held,
) {
  const w = /** @type {import("../table-design/model.js").Design} */ (was.table);
  const aligned = align(w, /** @type {any} */ (now.table), { source: schema, target: schema });
  if (norm(was.partition ?? "", schema) !== norm(now.partition ?? "", schema))
    held.push(HELD.partition(`${schema}.${now.name}`));
  /** @type {Step[]} */
  const kept = [];
  const table = qualified(PG, schema, now.name);
  const plain = (/** @type {any[]} */ list, /** @type {"index" | "constraint"} */ kind) =>
    list.filter((p) => {
      if (p.kept === undefined || !String(p.id).startsWith("s")) return true;
      kept.push({
        sql:
          kind === "index"
            ? p.kept
            : `ALTER TABLE ${table} ADD CONSTRAINT ${quoteName(PG, p.name)} ${p.kept}`,
        marks: [],
      });
      return false;
    });
  const design = {
    ...aligned,
    primaryKey:
      aligned.primaryKey && plain([aligned.primaryKey], "constraint")[0]
        ? aligned.primaryKey
        : null,
    uniques: plain(aligned.uniques, "constraint"),
    checks: plain(aligned.checks, "constraint"),
    foreignKeys: plain(aligned.foreignKeys, "constraint"),
    indexes: plain(aligned.indexes, "index"),
    others: plain(aligned.others, "constraint"),
  };
  const altered = alterSteps(w, design, facts);
  held.push(...altered.held);
  return [...altered.steps, ...kept];
}

/** A view's or a routine's CREATE, written to replace the one there. */
const orReplace = (/** @type {string} */ ddl) =>
  ddl.replace(/^\s*CREATE\s+(?!OR\s+REPLACE\b)/iu, "CREATE OR REPLACE ");

/**
 * The script that makes `target` like `source` for the chosen keys.
 * @param {Model} source
 * @param {Model} target
 * @param {Iterable<string>} keys
 * @param {Facts | null} [known] The target's server's facts (its types and casts), when read.
 * @returns {Migration}
 */
export function migrationOf(source, target, keys, known = null) {
  const schema = target.schema;
  const chosen = new Set(keys);
  const src = new Map(source.objects.map((o) => [keyOf(o), rebase(o, source.schema, schema)]));
  const tgt = new Map(target.objects.map((o) => [keyOf(o), o]));
  const facts = factsFor([...tgt.values(), ...src.values()], known);
  /** @type {string[]} */
  const held = [];
  /** @type {Step[]} */
  const steps = [];
  const goes = [...chosen].flatMap((k) =>
    tgt.has(k) && !src.has(k) ? [/** @type {Obj} */ (tgt.get(k))] : [],
  );
  const rebuilt = [...chosen].flatMap((k) => {
    const t = tgt.get(k);
    return t && src.has(k) && (t.kind === "trigger" || t.kind === "materialized view") ? [t] : [];
  });
  for (const o of dropOrder([...goes, ...rebuilt]))
    if (FIRST.has(o.kind)) steps.push(dropOf(o, schema));

  const made = createOrder(
    [...chosen].flatMap((k) => (src.has(k) ? [/** @type {Obj} */ (src.get(k))] : [])),
  );
  /** @type {Step[]} */
  const foreign = [];
  for (const now of made) {
    const was = tgt.get(keyOf(now));
    const name = `${schema}.${now.name}`;
    if (now.held || was?.held) {
      held.push(HELD.unread(name, now.held ?? was?.held ?? ""));
      continue;
    }
    if (now.kind === "table") {
      if (was) steps.push(...tableChange(was, now, facts, schema, held));
      else {
        steps.push(...tableSteps(now, facts, { foreignKeys: false }));
        foreign.push(...foreignSteps(now, [TABLE_MARKS.foreign]));
      }
    } else if (now.kind === "sequence" && now.sequence) {
      const clauses = sequenceClauses(now.sequence);
      steps.push(
        was
          ? { sql: `ALTER SEQUENCE ${sqlName(now, schema)} ${clauses}`, marks: [MARKS.sequence] }
          : { sql: `CREATE SEQUENCE ${sqlName(now, schema)} ${clauses}`, marks: [] },
      );
    } else if (now.kind === "type" && was) {
      if (now.typeKind === "enum" && was.typeKind === "enum")
        steps.push(...enumSteps(was, now, schema, held));
      else held.push(HELD.type(name));
    } else if (now.kind === "view" && was)
      steps.push({ sql: orReplace(now.ddl), marks: [MARKS.replaceView] });
    else if (now.kind === "function" && was)
      steps.push({ sql: orReplace(now.ddl), marks: [MARKS.replaceFunction] });
    else
      steps.push({
        sql: now.ddl.trim().replace(/;\s*$/u, ""),
        marks: now.kind === "materialized view" ? [MARKS.refresh] : [],
      });
  }
  steps.push(...foreign);
  for (const o of dropOrder(goes)) if (!FIRST.has(o.kind)) steps.push(dropOf(o, schema));

  const path = [...new Set([schema, "public"])].map((s) => quoteName(PG, s)).join(", ");
  const all = steps.length
    ? [{ sql: `SET LOCAL search_path TO ${path}`, marks: [] }, ...steps]
    : [];
  const notes = held.map((h) => `-- Not written: ${h}`);
  const parts = [
    ...(notes.length ? [notes.join("\n")] : []),
    ...(all.length ? ["BEGIN;", insideText(all), "COMMIT;"] : []),
  ];
  return { steps: all, held, text: parts.length ? `${parts.join("\n\n")}\n` : "" };
}
