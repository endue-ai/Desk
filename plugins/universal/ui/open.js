// What desk.universal.open opens, from its arguments: a view as given, one of the person's saved
// views by id (view.get, ADR 0102), a desk file that holds a view or data, a URL's data, or inline
// data (specs/view/v0/universal.schema.json). Data opened without a view shows as a list that
// switches to every other presentation. Pure but for `io`.

/** Every presentation, in the switcher's order, for data opened without a view. */
export const ALL = /** @type {const} */ ([
  "list",
  "kanban",
  "timeline",
  "calendar",
  "text",
  "chat",
  "agent",
  "chart",
  "stat",
  "detail",
]);
const TYPES = new Set(/** @type {readonly string[]} */ (ALL));

/**
 * @typedef {import("../../../packages/bridge/src/index").UniversalView} UniversalView
 * @typedef {import("../../../packages/bridge/src/index").UniversalData} UniversalData
 * @typedef {import("../../../packages/bridge/src/index").UniversalType} UniversalType
 * @typedef {{ view?: unknown, id?: string, file?: string, url?: string, data?: UniversalData,
 *   type?: string, title?: string }} OpenArgs
 * @typedef {{ parse(text: string): unknown, read(path: string): Promise<string>,
 *   get?(id: string): Promise<unknown> }} OpenIo
 */

/**
 * Whether a value has the shape of a universal view (a known type and a source) or of a page of
 * them (sections, ADR 0103).
 * @param {unknown} value
 * @returns {value is UniversalView}
 */
export function isView(value) {
  if (!value || typeof value !== "object") return false;
  const view = /** @type {{ type?: unknown, source?: unknown, sections?: unknown }} */ (value);
  if (Array.isArray(view.sections)) return view.sections.length > 0 && view.sections.every(isView);
  return TYPES.has(String(view.type)) && !!view.source && typeof view.source === "object";
}

/**
 * The view the arguments ask for; `type` shows it as another presentation first.
 * @param {OpenArgs} args
 * @param {OpenIo} io
 * @returns {Promise<UniversalView>}
 */
export async function viewOf(args, io) {
  const type = TYPES.has(String(args.type)) ? /** @type {UniversalType} */ (args.type) : undefined;
  /** @param {UniversalView} view */
  const shown = (view) => ({
    ...view,
    ...(type ? { type } : {}),
    ...(args.title ? { title: args.title } : {}),
  });
  /** @param {UniversalView["source"]} source @returns {UniversalView} */
  const over = (source) => shown({ type: "list", types: [...ALL], source });
  if (args.view !== undefined) {
    if (!isView(args.view))
      throw new Error("view: not a universal view (it needs a type and a source)");
    return shown(args.view);
  }
  if (args.id !== undefined) {
    const saved = io.get ? await io.get(args.id) : undefined;
    if (!isView(saved)) throw new Error(`${args.id} is not a universal view`);
    return shown(saved);
  }
  if (args.data !== undefined) return over({ data: args.data });
  if (args.url !== undefined) {
    if (!/^https?:\/\//.test(args.url)) throw new Error("url: only http and https");
    return over({ url: args.url });
  }
  if (args.file !== undefined) {
    const value = io.parse(await io.read(args.file));
    return isView(value) ? shown(value) : over({ file: args.file });
  }
  throw new Error("Open what? Give a view, an id, a file, a url or data.");
}

/**
 * The narrowest permission a source is read under, to ask for when it was refused.
 * @param {UniversalView["source"] | undefined} source
 * @returns {import("../../../packages/bridge/src/index").Permission | undefined}
 */
export function scopeOf(source) {
  if (!source) return undefined;
  if ("url" in source) return { permission: "net:fetch", hosts: [new URL(source.url).host] };
  if ("file" in source) return { permission: "fs:read", paths: [source.file] };
  if ("command" in source) return { permission: "cmd:invoke", ids: [source.command] };
  if ("items" in source)
    return {
      permission: "data:read",
      ...(source.items.kinds ? { kinds: [...source.items.kinds] } : {}),
    };
  return undefined;
}
