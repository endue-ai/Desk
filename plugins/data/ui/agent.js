// What an agent reads through Data (ADR 0088): the file in the Data window in use, as the value at a
// JSON Pointer, nested to a depth, with what did not parse. Secrets stay secret: every value the view
// would draw as dots (a dotenv value, a value under a key that looks like a password or token) comes
// back as "[secret]", whether or not the person revealed it on screen, and the raw text is never
// answered. It leaves the screen as it is. Data opens a file only through the desk (desk.files.open),
// which also brings its window into use.
import { chainOf, search } from "./search.js";
import { isMasked } from "./secrets.js";
import { childrenOf, isBranch, numberOf, pointerOf, resolve } from "./tree.js";

/**
 * @typedef {import("./tree.js").DataNode} DataNode
 * @typedef {import("./tree.js").DataDoc} DataDoc
 * @typedef {import("./data.js").File} Open
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

/** @param {Record<string, unknown>} args */
const coordinates = ({ pointer, document }) => ({
  pointer: typeof pointer === "string" ? pointer : "",
  root: Number.isInteger(document) && Number(document) >= 1 ? Number(document) - 1 : 0,
});

/** @param {DataDoc} doc @param {Record<string, unknown>} args @param {string} name */
function target(doc, args, name) {
  const { pointer, root: index } = coordinates(args);
  const root = doc.roots[index];
  if (!root) throw new Error(`${name} has ${doc.roots.length} document(s), not ${index + 1}.`);
  const chain = resolve(root, pointer);
  if (!chain) throw new Error(`${pointer} names nothing in ${name}.`);
  return { pointer, index, chain };
}

/** @param {DataDoc} doc @param {Record<string, unknown>} args @param {string} name */
export function readDocument(doc, args, name) {
  const { pointer, chain } = target(doc, args, name);
  const count = Number(args.depth);
  const depth = Number.isInteger(count) && count >= 0 ? Math.min(count, DEPTH.most) : DEPTH.usual;
  return {
    documents: doc.roots.length,
    pointer,
    value: plainAt(chain, depth),
    errors: doc.errors.slice(0, 20),
  };
}

/** @param {DataDoc} doc @param {Record<string, unknown>} args @param {string} name */
export function planEdit(doc, args, name) {
  const { pointer, index, chain } = target(doc, args, name);
  const node = chain.at(-1);
  const value = args.value;
  const type = value === null ? "null" : typeof value;
  if (!node || node.kind !== type || (type === "number" && !Number.isFinite(value)))
    throw new Error("Give a scalar value of the field's original type.");
  const path = [index, ...chain.slice(1).map((child, i) => childrenOf(chain[i]).indexOf(child))];
  return { pointer, path, text: typeof value === "string" ? value : JSON.stringify(value) };
}

/** @param {DataDoc} doc @param {string} query */
export function searchDocument(doc, query) {
  const result = search(doc, query, (chain) => isMasked(chain, true));
  return {
    matches: result.matches.slice(0, CHILDREN).map((match) => ({
      ...match,
      pointer: pointerOf(chainOf(doc, match.path)),
    })),
    more: result.more || result.matches.length > CHILDREN,
  };
}

/** @param {DataDoc} doc @param {import("./schema.js").SchemaError[]} errors */
export function visibleProblems(doc, errors) {
  return errors
    .filter((error) => {
      const root = doc.roots[error.root ?? 0];
      const chain = root && resolve(root, error.pointer);
      return !chain || !isMasked(chain, true);
    })
    .slice(0, CHILDREN);
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null,
 *   edit(file: Open, path: number[], text: string): Promise<boolean>,
 *   where?: (buffer: string) => import("./keep.js").Where | undefined }} deps
 */
export function answerAgents(commands, deps) {
  /** @param {string} name @param {(file: Open, args: Record<string, unknown>) => unknown} run */
  const answer = (name, run) =>
    commands.on(`endue.data.${name}`, (raw) => {
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
      return run(file, a);
    });
  answer("read", async (file, a) => {
    const { doc, remote, label: format } = file.opened;
    if (!doc)
      return {
        path: file.path,
        format,
        value: null,
        reason: "Data shows only details of this file.",
      };
    const selected = deps.where?.(file.buffer)?.selected;
    const indexes = selected?.split("/").map(Number);
    const selectedPointer = indexes
      ? remote
        ? (await remote.request("node", { path: indexes }))?.pointer
        : pointerOf(chainOf(doc, indexes))
      : null;
    const data = remote ? await remote.request("agent-read", a) : readDocument(doc, a, file.name);
    return { path: file.path, format, selectedPointer: selectedPointer ?? null, ...data };
  });
  answer("set", async (file, a) => {
    const { doc, remote } = file.opened;
    if (!doc) throw new Error("Data shows only details of this file.");
    const step = remote ? await remote.request("agent-edit", a) : planEdit(doc, a, file.name);
    const changed = await deps.edit(file, step.path, step.text);
    return { path: file.path, pointer: step.pointer, changed };
  });
  answer("search", async (file, a) => {
    const { doc, remote } = file.opened;
    if (typeof a.query !== "string" || !a.query) throw new Error("Give a search query.");
    if (!doc) throw new Error("Data shows only details of this file.");
    const result = remote
      ? await remote.request("agent-search", { query: a.query })
      : searchDocument(doc, a.query);
    return { path: file.path, ...result };
  });
  answer("problems", async (file) => {
    const { doc, remote } = file.opened;
    const errors = file.schema.errors;
    const problems = remote
      ? await remote.request("agent-problems", { errors })
      : doc
        ? visibleProblems(doc, errors)
        : [];
    return { path: file.path, state: file.schema.state, problems };
  });
}
