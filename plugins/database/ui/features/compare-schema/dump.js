// A schema dumped to a folder (PG-53, ADR 0338): one file per object, `<kind>/<name>.sql`, each the
// object's DDL as this plugin writes it, so a folder in version control changes only where the
// schema did. A name that is not plain lower case (or has a character a file name cannot) gets the
// hash of its own name after it, so `People` and `people` never share a file. Pure.

import { hashOf } from "../../databases.js";
import { sorted } from "./model.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("./model.js").Model} Model
 */

/** The folder each kind's files are in. */
export const FOLDERS = /** @type {Record<Obj["kind"], string>} */ ({
  type: "types",
  sequence: "sequences",
  function: "functions",
  table: "tables",
  view: "views",
  "materialized view": "materialized-views",
  trigger: "triggers",
});

/** An object's file, relative to the folder. */
export function fileOf(/** @type {Obj} */ o) {
  const plain = o.name.replace(/\s+/gu, "");
  const safe = plain.replace(/[^A-Za-z0-9_.(),$-]/gu, "_");
  const name = safe === plain && safe === safe.toLowerCase() ? safe : `${safe}-${hashOf(o.name)}`;
  return `${FOLDERS[o.kind]}/${name}.sql`;
}

/** An object's file's text: its DDL, each statement ending with `;`, and a last newline. */
export function textOf(/** @type {Obj} */ o) {
  const ddl = o.ddl.trim();
  return `${ddl}${ddl.endsWith(";") ? "" : ";"}\n`;
}

/** Every file of a model, by path. */
export const dumpOf = (/** @type {Model} */ model) =>
  sorted(model.objects)
    .map((o) => ({ path: fileOf(o), text: textOf(o) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
