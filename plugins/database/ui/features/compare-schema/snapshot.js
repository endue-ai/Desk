// A schema saved to compare against later (PG-53, ADR 0338): one JSON file, versioned, holding the
// model as read (its objects in a stable order), the schema's name, where it was read from (a
// connection's name, never its address or password) and when. Pure.

import { sorted } from "./model.js";

/** @typedef {import("./model.js").Model} Model */

export const SNAPSHOT = "endue.database.schema";
const VERSION = 1;
const KINDS = new Set([
  "type",
  "sequence",
  "function",
  "table",
  "view",
  "materialized view",
  "trigger",
]);

/** A snapshot's text. */
export function snapshotText(
  /** @type {Model} */ model,
  /** @type {{ from: string, at: Date }} */ about,
) {
  const body = {
    format: SNAPSHOT,
    version: VERSION,
    schema: model.schema,
    from: about.from,
    saved: about.at.toISOString(),
    objects: sorted(model.objects),
  };
  return `${JSON.stringify(body, null, 1)}\n`;
}

/** A snapshot's model; a file that is not one throws in words. */
export function snapshotModel(/** @type {string} */ text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("it is not JSON");
  }
  if (body?.format !== SNAPSHOT) throw new Error("it is not a saved schema");
  if (body.version !== VERSION)
    throw new Error(`it is of version ${body.version}, and this reads ${VERSION}`);
  if (typeof body.schema !== "string" || !Array.isArray(body.objects))
    throw new Error("it has no schema");
  for (const o of body.objects)
    if (!o || !KINDS.has(o.kind) || typeof o.name !== "string" || typeof o.ddl !== "string")
      throw new Error("an object in it is not one");
  /** @type {Model} */
  const model = { format: 1, schema: body.schema, objects: body.objects };
  return { model, from: String(body.from ?? ""), saved: String(body.saved ?? "") };
}
