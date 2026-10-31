// TOML 1.0 into the typed tree: key/value pairs with bare, quoted and dotted keys, tables, arrays of
// tables, inline tables and arrays, every string kind, numbers as written, and offset and local
// dates and times. A key or table defined twice is an error at its line; the tree keeps what parsed
// before the first error.

import { errorAt, lineStarts, positionOf } from "../lines.js";
import { BARE_KEY, bareEnd, classify, readString, TomlFail } from "./toml-values.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {"header" | "implicit" | "dotted" | "inline" | "value"} Origin How a table came to be
 */

/** @param {string} text @returns {DataDoc} */
export function parseToml(text) {
  return new Toml(text).parse();
}

class Toml {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.lines = lineStarts(text);
    /** @type {DataNode} */
    this.root = { kind: "object", children: [], line: 1, col: 1, from: 0, to: text.length };
    /** How each table was made, which decides whether it may be defined again. */
    /** @type {Map<DataNode, Origin>} */
    this.origin = new Map([[this.root, "header"]]);
    this.table = this.root;
  }

  /** @param {number} at */
  where(at) {
    return positionOf(this.lines, at);
  }

  /** @returns {DataDoc} */
  parse() {
    const errors = [];
    try {
      for (;;) {
        this.space(true);
        if (this.pos >= this.text.length) break;
        const c = this.text[this.pos];
        if (c === "[") this.header();
        else this.pair(this.table);
        this.endLine();
      }
    } catch (error) {
      if (!(error instanceof TomlFail)) throw error;
      errors.push(errorAt(this.lines, error.offset, error.message));
    }
    return { roots: [this.root], errors, warnings: [] };
  }

  /** Blanks and comments; with `lines`, line breaks too. */
  space(lines = false) {
    const { text } = this;
    for (;;) {
      const c = text[this.pos];
      if (c === " " || c === "\t" || (lines && (c === "\n" || c === "\r"))) this.pos++;
      else if (c === "#") {
        const nl = text.indexOf("\n", this.pos);
        this.pos = nl < 0 ? text.length : nl;
        if (text[this.pos - 1] === "\r") this.pos--;
      } else break;
    }
  }

  endLine() {
    this.space();
    const c = this.text[this.pos];
    if (c === "\r" && this.text[this.pos + 1] === "\n") this.pos += 2;
    else if (c === "\n") this.pos++;
    else if (c !== undefined)
      throw new TomlFail(
        this.pos,
        `Unexpected ${JSON.stringify(c)}: expected the end of the line.`,
      );
  }

  /** A key, bare or quoted, with its dotted parts. */
  key() {
    /** @type {Array<{ name: string, at: number }>} */
    const parts = [];
    for (;;) {
      this.space();
      const at = this.pos;
      const c = this.text[at];
      if (c === '"' || c === "'") {
        if (this.text.startsWith(c.repeat(3), at))
          throw new TomlFail(at, "A key cannot be a multi-line string.");
        const { value, end } = readString(this.text, at);
        parts.push({ name: value, at });
        this.pos = end;
      } else {
        while (BARE_KEY.test(this.text[this.pos] ?? "")) this.pos++;
        if (this.pos === at)
          throw new TomlFail(at, `Unexpected ${JSON.stringify(c ?? "end")}: expected a key.`);
        parts.push({ name: this.text.slice(at, this.pos), at });
      }
      this.space();
      if (this.text[this.pos] !== ".") return parts;
      this.pos++;
    }
  }

  /**
   * The child table `name` of `table`, made when missing; an array of tables gives its last table.
   * @param {DataNode} table
   * @param {{ name: string, at: number }} part
   * @param {Origin} made
   */
  descend(table, part, made) {
    const children = /** @type {DataNode[]} */ (table.children);
    let child = children.find((c) => c.key === part.name);
    if (!child) {
      child = {
        kind: "object",
        key: part.name,
        children: [],
        ...this.where(part.at),
        from: part.at,
      };
      children.push(child);
      this.origin.set(child, made);
      return child;
    }
    if (child.kind === "array" && child.tag === "array of tables") {
      const last = child.children?.at(-1);
      if (last) return last;
    }
    const origin = this.origin.get(child);
    if (child.kind !== "object" || origin === "inline" || origin === "value")
      throw new TomlFail(part.at, `${JSON.stringify(part.name)} is already a value.`);
    return child;
  }

  /** `[table]` or `[[array of tables]]`. */
  header() {
    const at = this.pos;
    const array = this.text.startsWith("[[", at);
    this.pos += array ? 2 : 1;
    const parts = this.key();
    if (!this.text.startsWith(array ? "]]" : "]", this.pos))
      throw new TomlFail(this.pos, `Expected "${array ? "]]" : "]"}" to end the header.`);
    this.pos += array ? 2 : 1;
    const last = /** @type {{ name: string, at: number }} */ (parts.pop());
    let table = this.root;
    for (const part of parts) table = this.descend(table, part, "implicit");
    const children = /** @type {DataNode[]} */ (table.children);
    const found = children.find((c) => c.key === last.name);
    if (array) {
      let list = found;
      if (!list) {
        list = {
          kind: "array",
          key: last.name,
          tag: "array of tables",
          children: [],
          ...this.where(at),
          from: at,
        };
        children.push(list);
      } else if (list.tag !== "array of tables")
        throw new TomlFail(last.at, `${JSON.stringify(last.name)} is not an array of tables.`);
      const items = /** @type {DataNode[]} */ (list.children);
      /** @type {DataNode} */
      const entry = {
        kind: "object",
        key: items.length,
        children: [],
        ...this.where(at),
        from: at,
      };
      items.push(entry);
      this.origin.set(entry, "header");
      this.table = entry;
      return;
    }
    if (found) {
      if (found.kind !== "object" || this.origin.get(found) !== "implicit")
        throw new TomlFail(last.at, `The table ${JSON.stringify(last.name)} is defined twice.`);
      this.origin.set(found, "header");
      Object.assign(found, this.where(at));
      this.table = found;
      return;
    }
    /** @type {DataNode} */
    const made = { kind: "object", key: last.name, children: [], ...this.where(at), from: at };
    children.push(made);
    this.origin.set(made, "header");
    this.table = made;
  }

  /**
   * `key = value` into `table`.
   * @param {DataNode} table
   */
  pair(table) {
    const parts = this.key();
    if (this.text[this.pos] !== "=") throw new TomlFail(this.pos, 'Expected "=" after the key.');
    this.pos++;
    this.space();
    const last = /** @type {{ name: string, at: number }} */ (parts.pop());
    let into = table;
    for (const part of parts) into = this.descend(into, part, "dotted");
    const children = /** @type {DataNode[]} */ (into.children);
    if (children.some((c) => c.key === last.name))
      throw new TomlFail(last.at, `The key ${JSON.stringify(last.name)} is defined twice.`);
    const value = this.value();
    Object.assign(value, { key: last.name }, this.where(parts[0]?.at ?? last.at));
    children.push(value);
  }

  /** @returns {DataNode} */
  value() {
    const { text } = this;
    const at = this.pos;
    const c = text[at];
    if (c === '"' || c === "'") {
      const { value, end } = readString(text, at);
      this.pos = end;
      return { kind: "string", value, ...this.where(at), from: at, to: end };
    }
    if (c === "[") return this.array();
    if (c === "{") return this.inline();
    const end = bareEnd(text, at);
    const raw = text.slice(at, end);
    const type = raw === "" ? undefined : classify(raw);
    if (!type)
      throw new TomlFail(
        at,
        raw === "" ? "Expected a value." : `${JSON.stringify(raw)} is not a TOML value.`,
      );
    this.pos = end;
    /** @type {DataNode} */
    const node = {
      kind: type.kind,
      value: type.kind === "boolean" ? raw === "true" : raw,
      ...this.where(at),
      from: at,
      to: end,
    };
    if (type.tag) node.tag = type.tag;
    return node;
  }

  /** An array, over lines, with comments and a trailing comma. */
  array() {
    const at = this.pos++;
    /** @type {DataNode[]} */
    const children = [];
    for (;;) {
      this.space(true);
      if (this.text[this.pos] === "]") break;
      if (this.pos >= this.text.length) throw new TomlFail(at, "An array is not closed.");
      const item = this.value();
      item.key = children.length;
      children.push(item);
      this.space(true);
      if (this.text[this.pos] === ",") this.pos++;
      else if (this.text[this.pos] !== "]")
        throw new TomlFail(this.pos, 'Expected "," or "]" in an array.');
    }
    this.pos++;
    return /** @type {DataNode} */ ({
      kind: "array",
      children,
      ...this.where(at),
      from: at,
      to: this.pos,
    });
  }

  /** An inline table on one line; it cannot be extended later. */
  inline() {
    const at = this.pos++;
    /** @type {DataNode} */
    const node = { kind: "object", children: [], ...this.where(at), from: at };
    this.origin.set(node, "inline");
    this.space();
    if (this.text[this.pos] === "}") {
      this.pos++;
      node.to = this.pos;
      return node;
    }
    for (;;) {
      this.pair(node);
      this.space();
      const c = this.text[this.pos];
      this.pos++;
      if (c === "}") break;
      if (c !== ",") throw new TomlFail(this.pos - 1, 'Expected "," or "}" in an inline table.');
    }
    this.markInline(node);
    node.to = this.pos;
    return node;
  }

  /** Tables made by dotted keys inside an inline table are frozen with it. */
  markInline(/** @type {DataNode} */ node) {
    for (const child of node.children ?? []) {
      if (child.kind === "object" && this.origin.get(child) === "dotted") {
        this.origin.set(child, "inline");
        this.markInline(child);
      }
    }
  }
}
