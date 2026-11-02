/**
 * The spec files a proposed view is checked against, by their `$id`: `View` of specs/view/v0 and the
 * item and plugin definitions it references. Bundled into the runtime, so the desk checks an answer
 * with the very schemas the core checks a view file with.
 */

import item from "../../../../specs/item/v0/item.schema.json";
import query from "../../../../specs/item/v0/query.schema.json";
import contributes from "../../../../specs/plugin/v0/contributes.schema.json";
import plugin from "../../../../specs/plugin/v0/plugin.schema.json";
import view from "../../../../specs/view/v0/view.schema.json";
import { type SchemaDocument, Schemas } from "./schema";

/** `View`, as an absolute reference. */
export const VIEW = `${view.$id}#/$defs/View`;

let shared: Schemas | undefined;

/** The spec schemas, read once. */
export function specSchemas(): Schemas {
  shared ??= new Schemas([view, item, query, plugin, contributes] as unknown as SchemaDocument[]);
  return shared;
}
