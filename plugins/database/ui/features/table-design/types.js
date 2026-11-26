// The server's types as the table form offers them (PG-51): each by a label (a pg_catalog type as
// PostgreSQL formats it, `character varying`; another schema's as `schema.name`), written into DDL
// from its parts (a pg_catalog type as formatted, any other quoted), with its length where the type
// takes one and `[]` for an array. A column's type change is judged from the server's casts: the
// same type, a binary-coercible cast (no rewrite), an implicit or assignment cast (a rewrite that can
// fail), or none, which needs USING, which the form never writes. Pure.

import { qualified } from "../../sql/quote.js";
import { t as messageText } from "../../strings/index.js";

/**
 * @typedef {{
 *   oid: string, label: string, schema: string, name: string, builtin: boolean,
 *   modifiable: boolean, category: string, base: string,
 * }} PgType
 *   `name` is the type's own name (typname); `modifiable` that it takes a length (typmodin);
 *   `category` its typcategory (`S` strings, `N` numbers ...); `base` a domain's base type's oid.
 * @typedef {{ types: PgType[], casts: Set<string>, binary: Set<string> }} TypeFacts
 *   `casts` holds `source>target` oids of implicit and assignment casts, `binary` those of them
 *   that need no conversion.
 * @typedef {{ type: string, length: string, array: boolean }} Typed
 * @typedef {"same" | "binary" | "cast" | "using"} Change
 */

const PG = "postgresql";
/** Integer types: what an identity column takes. */
export const INTEGERS = new Set(["smallint", "integer", "bigint"]);
/** pg_catalog types whose longer length (or none) changes only the catalog. */
const GROWS = new Set(["character varying", "bit varying"]);
const LENGTH = /^\d+(\s*,\s*-?\d+)?$/u;

/** A type's label: pg_catalog's as formatted, any other schema's as `schema.name`. */
export const labelOf = (
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {string} */ formatted,
) => (schema === "pg_catalog" ? formatted : `${schema}.${name}`);

/** A type by its label, or undefined. */
export const typeOf = (/** @type {PgType[]} */ types, /** @type {string} */ label) =>
  types.find((t) => t.label === label.trim());

/** Why a column's type cannot be written, or "". */
export function typeProblem(/** @type {PgType[]} */ types, /** @type {Typed} */ typed) {
  if (typed.type.trim() === "") return messageText("features.tableDesign.types.hasNoTypePickOneOf");
  const type = typeOf(types, typed.type);
  if (!type)
    return messageText("features.tableDesign.types.hasTheTypeWhichThisServer", {
      type: String(typed.type),
    });
  const length = typed.length.trim();
  if (length && !type.modifiable)
    return messageText("features.tableDesign.types.hasALengthWhichDoesNot", {
      label: String(type.label),
    });
  if (length && !LENGTH.test(length))
    return messageText("features.tableDesign.types.hasTheLengthWriteANumber", {
      length: String(length),
    });
  return "";
}

/** A column's type as DDL writes it: `character varying(120)`, `"app"."mood"[]`. */
export function typeSql(/** @type {PgType[]} */ types, /** @type {Typed} */ typed) {
  const type = typeOf(types, typed.type);
  if (!type)
    throw new Error(
      messageText("features.tableDesign.types.noTypeOnThisServer", { type: String(typed.type) }),
    );
  const length = typed.length.trim().replace(/\s+/gu, "");
  const mod = length ? `(${length})` : "";
  const array = typed.array ? "[]" : "";
  if (!type.builtin) return `${qualified(PG, type.schema, type.name)}${mod}${array}`;
  // A time type's precision goes after its first word: timestamp(3) with time zone.
  const timed = /^(timestamp|time) (with|without) time zone$/u.exec(type.label);
  if (timed && mod) return `${timed[1]}${mod}${type.label.slice(timed[1]?.length)}${array}`;
  return `${type.label}${mod}${array}`;
}

/** Whether a type is a string type, which any type converts to (an I/O cast). */
const stringy = (/** @type {PgType | undefined} */ t) => t?.category === "S";

/** The oid a cast is looked up by: a domain's base type's. */
const castOid = (/** @type {PgType} */ t) => t.base || t.oid;

/**
 * What changing a column's type from `was` to `now` takes on this server.
 * @param {TypeFacts} facts
 * @param {Typed} was
 * @param {Typed} now
 * @returns {Change}
 */
export function changeOf(facts, was, now) {
  const from = typeOf(facts.types, was.type);
  const to = typeOf(facts.types, now.type);
  if (!from || !to) return "using";
  const lengthWas = was.length.trim();
  const lengthNow = now.length.trim();
  if (from.oid === to.oid && was.array === now.array) {
    if (lengthWas === lengthNow) return "same";
    const grows =
      GROWS.has(to.label) &&
      to.builtin &&
      (lengthNow === "" || (lengthWas !== "" && Number(lengthNow) >= Number(lengthWas)));
    return grows ? "binary" : "cast";
  }
  if (stringy(to) && !now.array) {
    const key = `${castOid(from)}>${castOid(to)}`;
    return !was.array && facts.binary.has(key) ? "binary" : "cast";
  }
  if (was.array !== now.array) return "using";
  const source = castOid(from);
  const target = castOid(to);
  if (source === target) return "cast";
  const key = `${source}>${target}`;
  if (facts.binary.has(key)) return lengthNow ? "cast" : "binary";
  return facts.casts.has(key) ? "cast" : "using";
}
