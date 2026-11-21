// The raw parse tree as libpg_query writes it in JSON: a node is an object with one key, its kind
// (`{ "SelectStmt": { ... } }`), and lists are arrays of nodes. A field the server types as one
// struct (InsertStmt's `relation`, a RangeVar) holds the struct's fields without that key: TYPED
// names them, so a walk sees them as nodes. A field that holds its default (0, false, an empty list)
// is left out, so a `location` of 0 shows as none. Walks are iterative: an expression thousands of
// operators long must not run the stack out. Pure.

/** @typedef {Record<string, any>} Node */

const RANGE_VARS = [
  "InsertStmt.relation",
  "UpdateStmt.relation",
  "DeleteStmt.relation",
  "MergeStmt.relation",
  "IntoClause.rel",
  "CreateStmt.relation",
  "TableLikeClause.relation",
  "Constraint.pktable",
  "AlterTableStmt.relation",
  "PartitionCmd.name",
  "CopyStmt.relation",
  "IndexStmt.relation",
  "CreatePolicyStmt.table",
  "AlterPolicyStmt.table",
  "CreateTrigStmt.relation",
  "CreateTrigStmt.constrrel",
  "RuleStmt.relation",
  "ViewStmt.view",
  "CreateSeqStmt.sequence",
  "AlterSeqStmt.sequence",
  "CompositeTypeStmt.typevar",
  "RenameStmt.relation",
  "AlterObjectSchemaStmt.relation",
  "ClusterStmt.relation",
  "ReindexStmt.relation",
  "VacuumRelation.relation",
  "RefreshMatViewStmt.relation",
  "PublicationTable.relation",
  "CreateStatsStmt.relation",
];
const QUERIES = ["SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"];

/** The kind of each struct-typed field the resolver reads, by `Parent.field`. */
export const TYPED = /** @type {Record<string, string>} */ ({
  ...Object.fromEntries(RANGE_VARS.map((field) => [field, "RangeVar"])),
  ...Object.fromEntries(QUERIES.map((kind) => [`${kind}.withClause`, "WithClause"])),
  ...Object.fromEntries(
    QUERIES.slice(1).map((kind) => [`${kind}.returningClause`, "ReturningClause"]),
  ),
  "CreateTableAsStmt.into": "IntoClause",
  "SelectStmt.intoClause": "IntoClause",
  "SelectStmt.larg": "SelectStmt",
  "SelectStmt.rarg": "SelectStmt",
  "InsertStmt.onConflictClause": "OnConflictClause",
  "OnConflictClause.infer": "InferClause",
  "FuncCall.over": "WindowDef",
  "CallStmt.funccall": "FuncCall",
  "CreateForeignTableStmt.base": "CreateStmt",
});

/** A node's kind, or "" for anything else. */
export function kindOf(/** @type {unknown} */ node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return "";
  const keys = Object.keys(node);
  return keys.length === 1 && /^[A-Z]/u.test(keys[0] ?? "") ? /** @type {string} */ (keys[0]) : "";
}

/** A node's fields, or undefined when it is not of `kind`. */
export function fieldsOf(/** @type {unknown} */ node, /** @type {string} */ kind) {
  return kindOf(node) === kind ? /** @type {Node} */ (node)[kind] : undefined;
}

/** The text of a `String` node (a name part), or undefined. */
export function stringOf(/** @type {unknown} */ node) {
  return fieldsOf(node, "String")?.sval ?? (kindOf(node) === "String" ? "" : undefined);
}

/** A list field as an array (libpg_query leaves an empty list out). */
export const listOf = (/** @type {unknown} */ value) =>
  /** @type {unknown[]} */ (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/**
 * Every node under `root`, depth first, with the kind of its parent node and the field it is in.
 * `visit` answers false to leave a node's children out.
 * @param {unknown} root
 * @param {(kind: string, fields: Node, parent: string, key: string) => boolean | void} visit
 */
export function walk(root, visit) {
  /** @type {Array<[unknown, string, string]>} */
  const stack = [[root, "", ""]];
  while (stack.length > 0) {
    const [value, parent, key] = /** @type {[unknown, string, string]} */ (stack.pop());
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push([value[i], parent, key]);
      continue;
    }
    const kind = kindOf(value);
    if (!kind) {
      // A field object that is not a node (an RawStmt's or a value's inner object).
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [field, inner] = /** @type {[string, unknown]} */ (entries[i]);
        stack.push([inner, parent, field]);
      }
      continue;
    }
    const fields = /** @type {Node} */ (value)[kind];
    if (visit(kind, fields, parent, key) === false || !fields || typeof fields !== "object")
      continue;
    const entries = Object.entries(fields);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [field, inner] = /** @type {[string, unknown]} */ (entries[i]);
      if (!inner || typeof inner !== "object") continue;
      const typed = Array.isArray(inner) ? undefined : TYPED[`${kind}.${field}`];
      stack.push([typed ? { [typed]: inner } : inner, kind, field]);
    }
  }
}

/** Adds `delta` to every `location` (and `*_location`) under `root` that is a place (not -1). */
export function shiftLocations(/** @type {unknown} */ root, /** @type {number} */ delta) {
  if (delta === 0) return;
  /** @type {unknown[]} */
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const record = /** @type {Node} */ (value);
    for (const key of Object.keys(record)) {
      const inner = record[key];
      if (typeof inner === "number") {
        if ((key === "location" || key.endsWith("_location")) && inner >= 0)
          record[key] = inner + delta;
      } else if (inner && typeof inner === "object") stack.push(inner);
    }
  }
}
