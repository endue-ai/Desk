// A schema as the comparison holds it (PG-53, ADR 0338): its objects, each by kind and name, with
// what it is made of. A table is PG-51's design (features/table-design/model.js), its owner left
// out; a sequence its parameters; an enum its values; anything else its DDL. The same model comes
// from a connection (read.js), a folder of DDL files (folder.js) and a snapshot (snapshot.js). The
// facts the table form's writer needs (its types) are made from the designs when no server gave
// them. Pure.

/**
 * @typedef {import("../table-design/model.js").Design} Design
 * @typedef {import("../table-design/read.js").Facts} Facts
 * @typedef {"type" | "sequence" | "function" | "table" | "view" | "materialized view" | "trigger"} Kind
 * @typedef {{
 *   type: string, start: string, increment: string, min: string, max: string, cache: string,
 *   cycle: boolean,
 * }} Sequence
 * @typedef {{
 *   kind: Kind, name: string, ddl: string, table?: Design, partition?: string,
 *   sequence?: Sequence, labels?: string[], typeKind?: "enum" | "domain" | "composite",
 *   body?: string, routine?: "function" | "procedure", args?: string, on?: string, held?: string,
 * }} Obj
 *   `name`: a function's is `name(argument types)`, a trigger's `table.trigger`; `ddl` the object's
 *   DDL as written (a table's is made from its design); `body` a view's query; `args` a routine's
 *   argument types as DROP takes them; `on` a trigger's table; `held` why the object cannot be
 *   changed by a script (a file that did not read).
 * @typedef {{ format: 1, schema: string, objects: Obj[], notes?: string[] }} Model
 *   `notes`: what a folder held that was not read.
 */

/** The kinds in the order they are created. */
export const KINDS = /** @type {const} */ ([
  "type",
  "sequence",
  "function",
  "table",
  "view",
  "materialized view",
  "trigger",
]);

/** An object's key: its kind and name. */
export const keyOf = (/** @type {Pick<Obj, "kind" | "name">} */ o) => `${o.kind} ${o.name}`;

/** Objects in a stable order: by kind, then name. */
export const sorted = (/** @type {Obj[]} */ objects) =>
  [...objects].sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

/** A type's label split: `app.mood` is app's mood; a pg_catalog type has no dot. */
function partsOf(/** @type {string} */ label) {
  const at = label.indexOf(".");
  return at < 0 ? null : { schema: label.slice(0, at), name: label.slice(at + 1) };
}

/** The types the designs name, as the table form's writer takes them, after `known`'s own. */
export function factsFor(/** @type {Obj[]} */ objects, /** @type {Facts | null} */ known = null) {
  const types = [...(known?.types ?? [])];
  const have = new Set(types.map((t) => t.label));
  for (const o of objects)
    for (const c of o.table?.columns ?? []) {
      if (have.has(c.type) || c.type === "") continue;
      have.add(c.type);
      const parts = partsOf(c.type);
      types.push({
        oid: `label:${c.type}`,
        label: c.type,
        schema: parts?.schema ?? "pg_catalog",
        name: parts?.name ?? c.type,
        builtin: !parts,
        modifiable: true,
        category: "",
        base: "",
      });
    }
  /** @type {Facts} */
  const facts = {
    version: known?.version ?? 0,
    types,
    casts: known?.casts ?? new Set(),
    binary: known?.binary ?? new Set(),
    roles: known?.roles ?? [],
    methods: known?.methods ?? [],
  };
  return facts;
}

/** A model's object by key. */
export const indexOf = (/** @type {Model} */ model) =>
  new Map(model.objects.map((o) => [keyOf(o), o]));
