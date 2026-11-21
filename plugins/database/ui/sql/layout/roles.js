// What the grammar made of each token (ADR 0292), read from the statement's parse tree: which
// keywords it reads as names (a column, relation, function, role, alias or option named like a
// keyword, which keep their spelling), which keywords spell a type (in lower case unless the style
// keeps the case as typed), which operators stand between two operands (a space either side), and
// the text each token is written as, its keyword's case by the style. The tree holds a
// struct-typed field (a RangeVar, a RoleSpec, a TypeName) without its kind, so those are known by
// their fields. Pure, iterative.
import { kindOf } from "../parse/tree.js";

/**
 * @typedef {import("./tokens.js").Token} Token
 * @typedef {import("./style.js").Style} Style
 * @typedef {Record<string, any>} Fields
 */

/** Nodes whose `location` is the first token of a name. */
const NAMED_AT = new Set(["ColumnRef", "RangeVar", "ColumnDef", "CommonTableExpr"]);
/** Where a ResTarget is a column being set, so its `location` is that column's name. */
const SET_TARGETS = new Set([
  "InsertStmt.cols",
  "UpdateStmt.targetList",
  "OnConflictClause.targetList",
  "MergeWhenClause.targetList",
]);
/** Fields that hold a name as a plain string. */
const NAME_FIELDS = new Set(
  (
    "name aliasname colname conname idxname relname schemaname catalogname ctename portalname " +
    "trigname policy_name servername fdwname subname pubname newname dbname extname amname " +
    "tablespacename rolename rulename eventname label refname"
  ).split(" "),
);
/** Operators written with a space either side wherever they stand. */
const SPACED = new Set(["=", "=>", ":="]);
/** Parents whose strings are a function's or an operator's name or an option's value, not names. */
const VALUE_OF = new Set(["FuncCall", "DefElem", "A_Expr"]);
const BINARY_KINDS = new Set(["AEXPR_OP", "AEXPR_OP_ANY", "AEXPR_OP_ALL"]);

/** The words of the types SQL writes in its own syntax (INT, DOUBLE PRECISION, CHARACTER VARYING). */
const TYPE_WORDS = new Set(
  (
    "BIGINT BIT BOOLEAN CHAR CHARACTER DEC DECIMAL DOUBLE FLOAT INT INTEGER INTERVAL JSON NATIONAL " +
    "NCHAR NUMERIC PRECISION REAL SETOF SMALLINT TIME TIMESTAMP VARCHAR VARYING"
  ).split(" "),
);
const INTERVAL_FIELDS = new Set(["YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "TO"]);

/**
 * The keywords of the type written at token `i`: its words, then its modifiers in brackets, `[]`
 * and WITH (or WITHOUT) TIME ZONE. Its names that are plain identifiers keep their spelling anyway.
 * @param {Token[]} tokens
 * @param {number} i
 * @param {Set<string>} words the type's names, lower-cased
 * @param {Set<Token>} typed
 */
function markType(tokens, i, words, typed) {
  let interval = false;
  for (let k = i; k < tokens.length; k++) {
    const t = /** @type {Token} */ (tokens[k]);
    if (t.class === "punct" && (t.text === "(" || t.text === "[")) {
      const close = t.text === "(" ? ")" : "]";
      let depth = 0;
      for (; k < tokens.length; k++) {
        const inside = /** @type {Token} */ (tokens[k]);
        if (inside.text === t.text) depth++;
        else if (inside.text === close && --depth === 0) break;
      }
      continue;
    }
    if (t.text === "." || (t.class === "ident" && words.has(t.text.toLowerCase()))) continue;
    if (t.class !== "keyword") return;
    if (TYPE_WORDS.has(t.upper) || words.has(t.text.toLowerCase())) {
      interval ||= t.upper === "INTERVAL";
      typed.add(t);
    } else if (interval && INTERVAL_FIELDS.has(t.upper)) typed.add(t);
    else if (
      (t.upper === "WITH" || t.upper === "WITHOUT") &&
      tokens[k + 1]?.upper === "TIME" &&
      tokens[k + 2]?.upper === "ZONE"
    ) {
      typed
        .add(t)
        .add(/** @type {Token} */ (tokens[k + 1]))
        .add(/** @type {Token} */ (tokens[k + 2]));
      k += 2;
    } else return;
  }
}

/** The kind of a struct-typed field, known by its fields. */
function structOf(/** @type {Fields} */ value) {
  if (Array.isArray(value.names) && "typemod" in value) return "TypeName";
  if (typeof value.roletype === "string") return "RoleSpec";
  if (typeof value.relname === "string") return "RangeVar";
  return "";
}

/**
 * Every node and known struct under `root`, with its parent's kind and the field it is in;
 * `visit` answers false to leave its children out.
 * @param {unknown} root
 * @param {(kind: string, fields: Fields, parent: string, key: string) => boolean | void} visit
 */
function visitTree(root, visit) {
  /** @type {Array<[unknown, string, string]>} */
  const stack = [[root, "", ""]];
  while (stack.length > 0) {
    const [value, parent, key] = /** @type {[unknown, string, string]} */ (stack.pop());
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push([item, parent, key]);
      continue;
    }
    const node = kindOf(value);
    const kind = node || structOf(/** @type {Fields} */ (value));
    const fields = /** @type {Fields} */ (node ? /** @type {Fields} */ (value)[node] : value);
    if (
      kind &&
      (!fields || typeof fields !== "object" || visit(kind, fields, parent, key) === false)
    )
      continue;
    for (const [field, inner] of Object.entries(fields))
      if (inner && typeof inner === "object")
        stack.push([inner, kind || parent, kind ? field : key]);
  }
}

/**
 * Mark the tokens of one statement and write each one's text.
 * @param {Token[]} tokens the statement's
 * @param {unknown} tree its parse tree
 * @param {number} base the byte the statement starts at in the tree's script
 * @param {Style} style
 */
export function markRoles(tokens, tree, base, style) {
  /** @type {Map<number, Token>} */
  const at = new Map(tokens.map((t) => [t.byte + base, t]));
  /** @type {Set<Token>} */
  const named = new Set();
  /** @type {Set<string>} */
  const names = new Set();
  const nameAt = (/** @type {unknown} */ location) => {
    const token = typeof location === "number" ? at.get(location) : undefined;
    if (token) named.add(token);
  };
  const add = (/** @type {unknown} */ name) => {
    if (typeof name === "string") names.add(name.toLowerCase());
  };
  /** @type {Set<Token>} */
  const typed = new Set();
  const index = new Map(tokens.map((t, i) => [t, i]));

  visitTree(tree, (kind, fields, parent, key) => {
    // A type is written in lower case, as PostgreSQL's documentation writes it (ADR 0292).
    if (kind === "TypeName") {
      const first = typeof fields.location === "number" ? at.get(fields.location) : undefined;
      /** @type {Set<string>} */
      const words = new Set();
      for (const part of fields.names ?? []) {
        const sval = part?.String?.sval;
        if (typeof sval === "string") words.add(sval.toLowerCase());
      }
      if (first) markType(tokens, /** @type {number} */ (index.get(first)), words, typed);
      return false;
    }
    if (NAMED_AT.has(kind)) nameAt(fields.location);
    else if (kind === "ResTarget" && SET_TARGETS.has(`${parent}.${key}`)) nameAt(fields.location);
    else if (kind === "RoleSpec" && fields.roletype === "ROLESPEC_CSTRING") nameAt(fields.location);
    else if (kind === "AccessPriv" && parent === "GrantRoleStmt") add(fields.priv_name);
    else if (kind === "FuncCall") {
      // EXTRACT, SUBSTRING, POSITION and the rest written in SQL's own syntax are keywords.
      if (fields.funcformat === "COERCE_SQL_SYNTAX") return undefined;
      nameAt(fields.location);
      for (const part of fields.funcname ?? []) add(part?.String?.sval);
    } else if (kind === "A_Expr" && fields.lexpr && BINARY_KINDS.has(fields.kind)) {
      const op = at.get(fields.location);
      if (op?.class === "op") op.binary = true;
    } else if (kind === "String" && !VALUE_OF.has(parent)) add(fields.sval);
    for (const [field, value] of Object.entries(fields)) if (NAME_FIELDS.has(field)) add(value);
    return undefined;
  });

  tokens.forEach((token, i) => {
    if (token.class !== "keyword") return;
    const before = tokens[i - 1];
    const after = tokens[i + 1];
    const dotted =
      (before?.text === "." && token.touched) || (after?.text === "." && after.touched);
    // Unreserved and column-name keywords can be plain names; the string says the tree has one.
    const plain = token.keyword <= 2 && names.has(token.text.toLowerCase());
    token.name = dotted || plain || named.has(token);
  });
  // A name's qualified parts after it (`schema.name`, `t.col`) are names too.
  for (let i = 0; i + 2 < tokens.length; i++) {
    const token = /** @type {Token} */ (tokens[i]);
    const dot = tokens[i + 1];
    const next = tokens[i + 2];
    if ((token.name || token.class === "ident") && dot?.text === "." && next?.class === "keyword")
      next.name = true;
  }
  for (const token of tokens) {
    if (token.class === "op" && SPACED.has(token.text)) token.binary = true;
    if (typed.has(token)) {
      token.name = true;
      token.out = style.keywordCase === "preserve" ? token.text : token.text.toLowerCase();
    } else
      token.out =
        token.class === "keyword" && !token.name
          ? caseOf(token.text, style.keywordCase)
          : token.text;
  }
}

/** A keyword in the style's case. */
const caseOf = (/** @type {string} */ text, /** @type {Style["keywordCase"]} */ keywordCase) =>
  keywordCase === "upper"
    ? text.toUpperCase()
    : keywordCase === "lower"
      ? text.toLowerCase()
      : text;

/** Whether a token is a keyword the grammar reads as one, by its upper-cased text. */
export const keywordOf = (/** @type {unknown} */ item) => {
  const token = /** @type {Token} */ (item);
  return token && "class" in token && token.class === "keyword" && !token.name ? token.upper : "";
};
