/**
 * The spec files a proposal is checked against, by their `$id`: `UniversalView` and `View` of
 * specs/view/v0 and the item and plugin definitions they reference, `ProfileContribution` and
 * `KeyBinding` of the plugin contributions. Bundled into the runtime, so the desk checks an answer with the very schemas the
 * core checks a view file or a manifest with. Key bindings come as a list (`KEYS`), the one schema
 * of the desk's own: a tool's arguments are an object.
 */

import item from "../../../../specs/item/v0/item.schema.json";
import query from "../../../../specs/item/v0/query.schema.json";
import contributes from "../../../../specs/plugin/v0/contributes.schema.json";
import plugin from "../../../../specs/plugin/v0/plugin.schema.json";
import universal from "../../../../specs/view/v0/universal.schema.json";
import view from "../../../../specs/view/v0/view.schema.json";
import { type SchemaDocument, Schemas } from "./schema";

/** `View`, as an absolute reference. */
export const VIEW = `${view.$id}#/$defs/View`;
/** `UniversalView` (ADR 0087): what desk.propose makes for a view now. */
export const UNIVERSAL = `${universal.$id}#/$defs/UniversalView`;
/** `ProfileContribution`: what desk.profiles keeps. */
export const PROFILE = `${contributes.$id}#/$defs/ProfileContribution`;

const keys = {
  $id: "https://endue.ai/runtime/propose/keys.schema.json",
  $defs: {
    KeyBindings: {
      description: "Key bindings for the person's layer of the keymap.",
      type: "object",
      properties: {
        bindings: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { $ref: `${contributes.$id}#/$defs/KeyBinding` },
        },
      },
      required: ["bindings"],
      additionalProperties: false,
    },
  },
};
/** `{ bindings: KeyBinding[] }`, 1 to 20 of them. */
export const KEYS = `${keys.$id}#/$defs/KeyBindings`;

let shared: Schemas | undefined;

/** The spec schemas, read once. */
export function specSchemas(): Schemas {
  shared ??= new Schemas([
    view,
    universal,
    item,
    query,
    plugin,
    contributes,
    keys,
  ] as unknown as SchemaDocument[]);
  return shared;
}
