// One worker owns one document for its lifetime. Replies contain bounded, already-masked views.
import { openFile } from "./formats.js";
import { validate } from "./schema.js";
import { createSchemaCheck } from "./schema-check.js";
import { chainOf, search } from "./search.js";
import { isMasked, maskRanges } from "./secrets.js";
import { childrenOf, countOf, isBranch, pathOf, pointerOf, previewOf, resolve } from "./tree.js";
import { workerRaw } from "./worker-raw.js";
import { workerTree } from "./worker-tree.js";

const cap = (count) => Math.max(0, Math.min(200, Math.floor(count ?? 100)));
const clip = (text, length = 2000) => String(text ?? "").slice(0, length);

export function attachDataWorker(port) {
  let opened;
  let raw;
  let tree;
  let keys = true;
  let revealed = null;
  let masks = [];
  let nextIo = 0;
  const io = new Map();
  const request = (kind, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextIo;
      io.set(id, { resolve, reject });
      port.postMessage({ io: id, kind, args });
    });
  const check = createSchemaCheck(
    { call: (method, params) => request("bridge", { method, params }) },
    (path) => request("read", { path }),
  );
  const snapshot = (chain, key) => {
    const node = chain.at(-1);
    if (!node) return undefined;
    const masked = isMasked(chain, keys);
    return {
      key,
      label: clip(node.key ?? "root", 300),
      kind: node.kind,
      branch: isBranch(node),
      count: countOf(node),
      line: node.line,
      col: node.col,
      pointer: clip(pointerOf(chain)),
      dotted: clip(pathOf(chain)),
      masked,
      preview: masked && key !== revealed ? "••••••••" : previewOf(node),
      tag: clip(node.tag, 100),
      anchor: clip(node.anchor, 100),
      alias: clip(node.alias, 100),
      duplicate: node.duplicate,
      error: node.error ? "Does not parse." : undefined,
    };
  };
  const updateMask = () => {
    masks = opened.doc ? maskRanges(opened.doc, keys) : [];
    const chain = revealed ? chainOf(opened.doc, revealed.split("/").map(Number)) : [];
    const node = chain.at(-1);
    let hidden = masks;
    if (node?.from !== undefined && node.to !== undefined)
      hidden = masks.flatMap(([a, b]) => {
        if (b <= node.from || a >= node.to) return [[a, b]];
        return [...(a < node.from ? [[a, node.from]] : []), ...(b > node.to ? [[node.to, b]] : [])];
      });
    raw.mask(hidden);
  };
  const safeErrors = (errors) =>
    errors.slice(0, 200).map((error) => {
      const root = opened.doc?.roots[error.root ?? 0];
      const chain = root ? resolve(root, error.pointer) : [];
      const node = chain?.at(-1);
      const hidden =
        node &&
        (isMasked(chain, keys) ||
          masks.some(([from, to]) => from < (node.to ?? 0) && to > (node.from ?? Infinity)));
      return {
        ...error,
        pointer: clip(error.pointer),
        message: hidden ? `Validation failed (${error.keyword}).` : clip(error.message, 500),
      };
    });
  const handle = async (method, args) => {
    if (method === "init") {
      keys = args.maskKeys !== false;
      const total = args.bytes.length;
      port.postMessage({ progress: { done: 0, total } });
      opened = openFile(args.name, args.bytes, {
        onProgress: (fraction) =>
          port.postMessage({ progress: { done: Math.floor(total * fraction), total } }),
      });
      raw = workerRaw(opened, []);
      updateMask();
      tree = workerTree(opened.doc, snapshot);
      port.postMessage({ progress: { done: total, total } });
      const { text: _text, bytes: _bytes, doc, ...meta } = opened;
      return {
        ...meta,
        lineCount: raw.count,
        rootCount: doc?.roots.length ?? 0,
        doc: doc
          ? {
              roots: [],
              errors: doc.errors
                .slice(0, 200)
                .map((e) => ({ ...e, message: clip(e.message, 500) })),
              warnings: doc.warnings
                ?.slice(0, 200)
                .map((e) => ({ ...e, message: clip(e.message, 500) })),
            }
          : undefined,
      };
    }
    if (!opened) throw new Error("Open a document first.");
    if (method === "mask") {
      keys = args.keys;
      revealed = args.revealed;
      updateMask();
      return tree.summary();
    }
    if (method === "tree") return tree.act(args);
    if (method === "rows") return tree.rows(Math.max(0, args.from ?? 0), cap(args.count));
    if (method === "lines") return raw.read(args.from ?? 1, cap(args.count), args.current);
    if (method === "node") return snapshot(chainOf(opened.doc, args.path), args.path.join("/"));
    if (method === "children") {
      const chain = chainOf(opened.doc, args.path);
      const children = childrenOf(chain.at(-1));
      const from = Math.max(0, args.from ?? 0);
      return {
        total: children.length,
        items: children
          .slice(from, from + cap(args.count))
          .map((child, i) => snapshot([...chain, child], [...args.path, from + i].join("/"))),
      };
    }
    if (method === "search")
      return search(opened.doc, args.query, (chain) => isMasked(chain, keys));
    if (method === "resolve") {
      const root = opened.doc?.roots[args.root ?? 0];
      const chain = root ? resolve(root, args.pointer) : undefined;
      if (!chain) return undefined;
      return [
        args.root ?? 0,
        ...chain.slice(1).map((node, i) => childrenOf(chain[i]).indexOf(node)),
      ];
    }
    if (method === "validate")
      return safeErrors(
        opened.doc.roots.flatMap((root, i) =>
          validate(root, args.schema, { files: args.files }).map((error) => ({
            ...error,
            root: i,
          })),
        ),
      );
    if (method === "schema") {
      const result = await check({ ...args, opened });
      return { ...result, errors: safeErrors(result.errors) };
    }
    throw new Error("Unknown data operation.");
  };
  port.addEventListener("message", async ({ data }) => {
    if (data.io !== undefined) {
      const pending = io.get(data.io);
      io.delete(data.io);
      if (data.error) pending?.reject(new Error(data.error));
      else pending?.resolve(data.result);
      return;
    }
    try {
      port.postMessage({ id: data.id, result: await handle(data.method, data.args ?? {}) });
    } catch {
      port.postMessage({ id: data.id, error: "Could not process the data document." });
    }
  });
  port.start?.();
}

if (typeof self !== "undefined" && typeof document === "undefined") attachDataWorker(self);
