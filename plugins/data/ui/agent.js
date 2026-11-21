// What an agent reads through Data (ADR 0088): the file in the Data window in use, as the value at a
// JSON Pointer, nested to a depth, with what did not parse. Secrets stay secret: every value the view
// would draw as dots (a dotenv value, a value under a key that looks like a password or token) comes
// back as "[secret]", whether or not the person revealed it on screen, and the raw text is never
// answered. It leaves the screen as it is. Data opens a file only through the desk (desk.files.open),
// which also brings its window into use.
import { isMasked } from "./secrets.js";
import { childrenOf, isBranch, numberOf, resolve } from "./tree.js";

/**
 * @typedef {import("./tree.js").DataNode} DataNode
 * @typedef {{ buffer: string, path: string, name: string, opened: import("./formats.js").Opened }} Open
 */

/** How deep one read nests by default and at most, and how many children a branch answers. */
export const DEPTH = { usual: 3, most: 8 };
export const CHILDREN = 200;
export const SECRET = "[secret]";

/**
 * The value at the end of `chain` as plain data: branches nested to `depth` (deeper ones say how
 * many children they hold), long branches cut to CHILDREN, masked scalars as SECRET.
 * @param {DataNode[]} chain root first
 * @param {number} depth
 * @returns {unknown}
 */
export function plainAt(chain, depth) {
  const node = /** @type {DataNode} */ (chain.at(-1));
  if (!isBranch(node)) {
    if (isMasked(chain, true)) return SECRET;
    if (node.kind === "number") return numberOf(node);
    if (node.kind === "binary")
      return `[${node.value instanceof Uint8Array ? node.value.length : 0} bytes]`;
    return node.value ?? null;
  }
  const children = childrenOf(node);
  if (depth <= 0) return { [`…${node.kind === "array" ? "items" : "keys"}`]: children.length };
  const shown = children.slice(0, CHILDREN).map((child) => plainAt([...chain, child], depth - 1));
  if (node.kind === "array")
    return children.length > CHILDREN ? [...shown, `…${children.length - CHILDREN} more`] : shown;
  /** @type {Record<string, unknown>} */
  const out = {};
  children.slice(0, CHILDREN).forEach((child, i) => {
    out[String(child.key)] = shown[i];
  });
  if (children.length > CHILDREN) out["…"] = `${children.length - CHILDREN} more keys`;
  return out;
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null }} deps
 */
export function answerAgents(commands, deps) {
  commands.on("endue.data.read", (raw) => {
    const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
    const open = deps.open();
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const file = asked
      ? open.find((f) => f.path === asked || f.name === asked)
      : (open.find((f) => f.buffer === deps.shown()) ?? open[0]);
    if (!file) {
      if (asked)
        throw new Error(
          `The Data window in use has no ${asked}; open it with desk.files.open first.`,
        );
      throw new Error("No file is open in Data; open one with desk.files.open first.");
    }
    const { opened } = file;
    const doc = opened.doc;
    if (!doc)
      return {
        path: file.path,
        format: opened.label,
        value: null,
        reason: "Data shows only details of this file.",
      };
    const pointer = typeof a.pointer === "string" ? a.pointer : "";
    const index =
      Number.isInteger(a.document) && Number(a.document) >= 1 ? Number(a.document) - 1 : 0;
    const root = doc.roots[index];
    if (!root)
      throw new Error(`${file.name} has ${doc.roots.length} document(s), not ${index + 1}.`);
    const chain = resolve(root, pointer);
    if (!chain) throw new Error(`${pointer} names nothing in ${file.name}.`);
    const asked_ = Number(a.depth);
    const depth =
      Number.isInteger(asked_) && asked_ >= 0 ? Math.min(asked_, DEPTH.most) : DEPTH.usual;
    return {
      path: file.path,
      format: opened.label,
      documents: doc.roots.length,
      pointer,
      value: plainAt(chain, depth),
      errors: doc.errors.slice(0, 20),
    };
  });
}
