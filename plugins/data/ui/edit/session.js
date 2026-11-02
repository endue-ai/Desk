// One open file's edits (ADR 0071), without a DOM, so the page and the worker run the same code.
// The edit tier comes from the format and the file: JSON and JSONC are lossless (an edit rewrites
// one token of the syntax model, cst.js), YAML and TOML are text (an edit is spliced into the text
// and kept only when every other value reads the same, verify.js), the rest read-only. After each
// edit the file opens again from its new bytes, so the tree, raw text and search follow it.

import { openFile } from "../formats.js";
import { chainOf } from "../search.js";
import { isBranch } from "../tree.js";
import { parseCst, serialize } from "./cst.js";
import { jsonLiteral, jsonStringToken, refused, tomlToken, yamlToken } from "./scalars.js";
import { sameExcept } from "./verify.js";

/**
 * @typedef {import("../formats.js").Opened} Opened
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {"lossless" | "text" | "read-only"} EditTier
 * @typedef {{ tier: EditTier, why?: string }} Tiered
 */

/** The largest file edited and saved: 64 MiB. */
export const MAX_EDIT = 64 * 1024 * 1024;
const LOSSLESS = new Set(["json", "jsonc"]);
const TEXT = new Set(["yaml", "toml"]);
const SCALARS = new Set(["string", "number", "boolean", "null"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The edit tier of an opened file, and why it is read-only when it is.
 * @param {Opened} opened
 * @param {Uint8Array} bytes The file's bytes, for its byte order mark
 * @param {number} [size]
 * @returns {Tiered}
 */
export function tierOf(opened, bytes, size = bytes.length) {
  const readOnly = (/** @type {string} */ why) => ({
    tier: /** @type {EditTier} */ ("read-only"),
    why,
  });
  const lossless = LOSSLESS.has(opened.format);
  if (!lossless && !TEXT.has(opened.format))
    return readOnly(`${opened.label} files are not edited here`);
  if (opened.reason !== undefined || !opened.doc || opened.doc.errors.length > 0)
    return readOnly("the file does not parse");
  const wide = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (opened.note !== undefined || wide) return readOnly("the file is not UTF-8");
  if (size > MAX_EDIT) return readOnly("the file is larger than 64 MiB");
  return { tier: lossless ? "lossless" : "text" };
}

/** UTF-8 bytes of text[from, to). */
function utf8Length(
  /** @type {string} */ text,
  /** @type {number} */ from,
  /** @type {number} */ to,
) {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < to) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** `bytes` with [start, end) replaced by `piece`. */
function splice(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ start,
  /** @type {number} */ end,
  /** @type {Uint8Array} */ piece,
) {
  const out = new Uint8Array(bytes.length - (end - start) + piece.length);
  out.set(bytes.subarray(0, start));
  out.set(piece, start);
  out.set(bytes.subarray(end), start + piece.length);
  return out;
}

const sentence = (/** @type {string} */ why) => `${why[0]?.toUpperCase()}${why.slice(1)}.`;

/**
 * @param {string} name
 * @param {Uint8Array} original
 * @param {Opened} [first] The file opened from `original`, when the caller has it
 */
export function createSession(name, original, first = openFile(name, original)) {
  const { tier, why } = tierOf(first, original);
  // A read-only file's bytes are not kept: nothing is edited or written from them.
  let bytes = tier === "read-only" ? new Uint8Array() : original;
  let opened = first;
  /** @type {import("./cst.js").Cst | undefined} */
  let cst;

  /** The scalar at `path`, or a refusal saying why it is not edited. */
  const scalarAt = (/** @type {number[]} */ path) => {
    if (tier === "read-only") throw refused(sentence(why ?? "the file opens read-only"));
    const chain = opened.doc ? chainOf(opened.doc, path) : [];
    const node = chain.length === path.length ? chain.at(-1) : undefined;
    if (!node) throw refused("That value is no longer in the file.");
    if (node.alias)
      throw refused(
        `This value is the alias *${node.alias}: edit the value anchored as &${node.alias}.`,
      );
    if (isBranch(node))
      throw refused(
        "Only strings, numbers, true, false and null are edited here, not objects or arrays.",
      );
    if (node.kind === "date") throw refused("Dates and times are not edited here yet.");
    if (!SCALARS.has(node.kind)) throw refused(`${node.kind} values are not edited here.`);
    return node;
  };
  /** A scalar as written, for the editor of anything but a string. */
  const writtenOf = (/** @type {DataNode} */ node) =>
    (opened.text ?? "").slice(node.from ?? 0, node.to ?? 0).trim();

  /** @param {number[]} path @param {DataNode} node @param {string} text */
  const editJson = (path, node, text) => {
    cst ??= parseCst(bytes, opened.format === "jsonc" ? "jsonc" : "json");
    const value = cst.valueAt(path);
    if (!value || value.ref !== undefined) throw refused("That value is no longer in the file.");
    const raw = decoder.decode(cst.rawOf(value));
    const { token, expected } =
      node.kind === "string"
        ? { token: jsonStringToken(text, raw), expected: { kind: "string", value: text } }
        : jsonLiteral(text);
    const before = cst.setValue(path, encoder.encode(token));
    const next = serialize(cst);
    const reopened = openFile(name, next);
    const chain = reopened.doc ? chainOf(reopened.doc, path) : [];
    const after = chain.length === path.length ? chain.at(-1) : undefined;
    const kept =
      after?.kind === expected.kind && (after.kind !== "string" || after.value === expected.value);
    if (reopened.doc?.errors.length || !kept) {
      cst.setValue(path, before.slice());
      throw refused("That value cannot be written here without changing the rest of the file.");
    }
    return { next, reopened };
  };

  /** @param {number[]} path @param {DataNode} node @param {string} text */
  const editText = (path, node, text) => {
    const source = opened.text ?? "";
    const from = node.from ?? 0;
    let to = node.to ?? from;
    // A plain scalar's span can take the blanks before a comment, a block scalar's its line break.
    while (to > from && " \t\r\n".includes(source[to - 1] ?? "")) to--;
    const raw = source.slice(from, to);
    const write = opened.format === "yaml" ? yamlToken : tomlToken;
    const { token, expected } = write(node, raw, text);
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    const start = bom + utf8Length(source, 0, from);
    const next = splice(bytes, start, start + utf8Length(source, from, to), encoder.encode(token));
    const reopened = openFile(name, next);
    if (!opened.doc || !reopened.doc || !sameExcept(opened.doc, reopened.doc, path, expected))
      throw refused(
        "Changing this value here would change other values too, so it was not changed.",
      );
    return { next, reopened };
  };

  return {
    tier,
    why,
    /** The file as edited so far. */
    get bytes() {
      return bytes;
    },
    get opened() {
      return opened;
    },
    /**
     * What the editor of the value at `path` starts with: a string's value, anything else as written.
     * @param {number[]} path
     */
    valueOf(path) {
      const node = scalarAt(path);
      return { text: node.kind === "string" ? String(node.value) : writtenOf(node) };
    },
    /**
     * Set the value at `path` from the editor's text. Throws an EditRefused error that says why
     * when it cannot; the file is unchanged then.
     * @param {number[]} path
     * @param {string} text
     */
    edit(path, text) {
      const node = scalarAt(path);
      const same = node.kind === "string" ? text === node.value : text.trim() === writtenOf(node);
      if (same) return { changed: false };
      const { next, reopened } =
        tier === "lossless" ? editJson(path, node, text) : editText(path, node, text);
      bytes = next;
      opened = reopened;
      return { changed: true };
    },
  };
}
