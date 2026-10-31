// JSON, JSONC and JSON5 into the typed tree. One pass over the text checks it and indexes every
// container (where it starts and ends, how many children it has), and notes duplicate keys and the
// values under secret-looking keys; a container's children are built when the tree opens it, so a
// 50 MB file opens. Numbers stay as written. After an error the tree keeps what parsed before it.

import { errorAt, lineStarts, positionOf } from "../lines.js";
import { isSecretKey } from "../secrets.js";
import { Fail, Lexer } from "./json-lex.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {import("../tree.js").ParseError} ParseError
 * @typedef {import("./json-lex.js").Dialect} Dialect
 */

const OPEN_OBJECT = 0x7b;
const OPEN_ARRAY = 0x5b;
const CLOSE_OBJECT = 0x7d;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const MAX_WARNINGS = 100;

/**
 * Parse a whole text, or the part between `from` and `to` (one line of JSON Lines).
 * @param {string} text
 * @param {Dialect} [dialect]
 * @param {{ from?: number, to?: number, starts?: Uint32Array }} [range]
 * @returns {DataDoc}
 */
export function parseJson(text, dialect = "json", range = {}) {
  const parser = new JsonParser(text, dialect, range);
  return parser.parse();
}

class JsonParser {
  /**
   * @param {string} text
   * @param {Dialect} dialect
   * @param {{ from?: number, to?: number, starts?: Uint32Array }} range
   */
  constructor(text, dialect, range) {
    this.text = text;
    this.dialect = dialect;
    this.from = range.from ?? 0;
    this.to = range.to ?? text.length;
    this.lines = range.starts ?? lineStarts(text);
    this.lex = new Lexer(text, dialect, this.from, this.to);
    /** Containers in the order they open: where each starts and ends, and its child count. */
    /** @type {number[]} */ this.starts = [];
    /** @type {number[]} */ this.ends = [];
    /** @type {number[]} */ this.counts = [];
    /** Where the text stopped parsing; nothing at or after it is built. */
    this.limit = this.to;
    /** @type {ParseError[]} */ this.warnings = [];
    /** @type {Array<[number, number]>} */ this.secrets = [];
  }

  /** @returns {DataDoc} */
  parse() {
    /** @type {ParseError[]} */
    const errors = [];
    let rootStart = -1;
    try {
      this.lex.space();
      rootStart = this.lex.pos;
      if (rootStart >= this.to) throw new Fail(rootStart, "The document is empty.");
      this.scan();
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      this.limit = error.offset;
      errors.push(errorAt(this.lines, error.offset, error.message));
    }
    const roots = [];
    if (rootStart >= 0 && rootStart < this.limit) {
      this.lex.pos = rootStart;
      this.lex.end = this.limit;
      const root = this.node(rootStart, 0);
      if (root) roots.push(root);
    }
    return { roots, errors, warnings: this.warnings, secretRanges: this.secrets };
  }

  /** The one pass: check the text, index its containers, note duplicates and secrets. */
  scan() {
    const { lex, starts, ends, counts } = this;
    /** Open containers, innermost last, with their keys so far (objects) and whether they are secret. */
    /** @type {number[]} */ const stack = [];
    /** @type {Array<Set<string> | null>} */ const keys = [];
    /** @type {boolean[]} */ const secret = [];
    let pending = false;
    let value = true;
    let scalar = false;
    try {
      for (;;) {
        if (value) {
          lex.space();
          const top = stack.length - 1;
          if (top >= 0) counts[stack[top] ?? 0]++;
          const start = lex.pos;
          const c = lex.peek();
          if (c === OPEN_OBJECT || c === OPEN_ARRAY) {
            stack.push(starts.length);
            starts.push(start);
            ends.push(-1);
            counts.push(0);
            keys.push(c === OPEN_OBJECT ? new Set() : null);
            secret.push(pending);
            pending = false;
            lex.pos++;
            lex.space();
            const close = c === OPEN_OBJECT ? CLOSE_OBJECT : CLOSE_ARRAY;
            if (lex.peek() === close) {
              this.close(stack, keys, secret);
              value = false;
            } else if (c === OPEN_OBJECT) pending = this.member(keys);
            continue;
          }
          scalar = true;
          this.scalar();
          scalar = false;
          if (pending) this.secrets.push([start, lex.pos]);
          pending = false;
          value = false;
        }
        if (stack.length === 0) break;
        lex.space();
        const object = keys[keys.length - 1] !== null;
        const close = object ? CLOSE_OBJECT : CLOSE_ARRAY;
        const c = lex.peek();
        if (c === COMMA) {
          lex.pos++;
          lex.space();
          if (lex.peek() === close) {
            if (!lex.trailing)
              throw new Fail(lex.pos - 1, "A trailing comma: JSON does not allow one.");
            this.close(stack, keys, secret);
            continue;
          }
          if (object) pending = this.member(keys);
          value = true;
        } else if (c === close) {
          this.close(stack, keys, secret);
        } else {
          throw lex.unexpected(object ? '"," or "}"' : '"," or "]"');
        }
      }
      lex.space();
      if (lex.pos < this.to) throw new Fail(lex.pos, "Unexpected text after the document.");
    } catch (error) {
      // A value that failed half-way is not a child.
      if (scalar && stack.length > 0) counts[stack[stack.length - 1] ?? 0]--;
      throw error;
    }
  }

  /**
   * Read a member's key and its colon; flag a duplicate. Returns whether the key looks secret.
   * @param {Array<Set<string> | null>} keys
   */
  member(keys) {
    const { lex } = this;
    const start = lex.pos;
    const key = lex.key();
    const seen = keys[keys.length - 1];
    if (seen?.has(key)) {
      if (this.warnings.length < MAX_WARNINGS)
        this.warnings.push(errorAt(this.lines, start, `Duplicate key ${JSON.stringify(key)}.`));
    } else seen?.add(key);
    lex.space();
    if (lex.peek() !== COLON) throw lex.unexpected('":"');
    lex.pos++;
    return isSecretKey(key);
  }

  /**
   * @param {number[]} stack
   * @param {Array<Set<string> | null>} keys
   * @param {boolean[]} secret
   */
  close(stack, keys, secret) {
    const index = stack.pop() ?? 0;
    keys.pop();
    this.ends[index] = this.lex.pos;
    this.lex.pos++;
    if (secret.pop()) this.secrets.push([this.starts[index] ?? 0, this.lex.pos]);
  }

  /** Check one scalar at `pos`. */
  scalar() {
    const { lex } = this;
    const c = lex.peek();
    if (c === 0x22 || (lex.five && c === 0x27)) lex.string();
    else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) lex.number();
    else if (lex.five && (c === 0x2b || c === 0x2e || c === 0x49 || c === 0x4e)) lex.number();
    else lex.word();
  }

  /**
   * The node for the value at `start`, or undefined when the error cut it.
   * @param {number} start
   * @param {number} next The first container that may start here.
   * @returns {DataNode | undefined}
   */
  node(start, next) {
    const { lex, text } = this;
    const { line, col } = positionOf(this.lines, start);
    const c = text.charCodeAt(start);
    if (c === OPEN_OBJECT || c === OPEN_ARRAY) {
      const ref = this.containerAt(start, next);
      const end = this.ends[ref] ?? -1;
      lex.pos = end >= 0 ? end + 1 : this.limit;
      return {
        kind: c === OPEN_OBJECT ? "object" : "array",
        line,
        col,
        from: start,
        to: lex.pos,
        count: this.counts[ref] ?? 0,
        lazy: this,
        ref,
      };
    }
    try {
      lex.pos = start;
      if (c === 0x22 || (lex.five && c === 0x27)) {
        const end = lex.string();
        return { kind: "string", value: lex.decode(start, end), line, col, from: start, to: end };
      }
      if (c === 0x74 || c === 0x66 || c === 0x6e) {
        const word = lex.word();
        const value = word === "null" ? null : word === "true";
        return {
          kind: word === "null" ? "null" : "boolean",
          value,
          line,
          col,
          from: start,
          to: lex.pos,
        };
      }
      const end = lex.number();
      return { kind: "number", value: text.slice(start, end), line, col, from: start, to: end };
    } catch (error) {
      if (error instanceof Fail) return undefined;
      throw error;
    }
  }

  /**
   * The index of the container that starts at `start`: containers are numbered as they open, so
   * their starts are sorted.
   * @param {number} start
   * @param {number} low
   */
  containerAt(start, low) {
    const { starts } = this;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((starts[mid] ?? 0) < start) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /**
   * Build the children of container `ref` (Lazy.children).
   * @param {number} ref
   * @returns {DataNode[]}
   */
  children(ref) {
    const { lex, text } = this;
    const start = this.starts[ref] ?? 0;
    const end = (this.ends[ref] ?? -1) >= 0 ? (this.ends[ref] ?? 0) : this.limit;
    const object = text.charCodeAt(start) === OPEN_OBJECT;
    const close = object ? CLOSE_OBJECT : CLOSE_ARRAY;
    /** @type {DataNode[]} */
    const out = [];
    const seen = new Set();
    lex.end = end;
    lex.pos = start + 1;
    try {
      for (;;) {
        lex.space();
        const c = lex.peek();
        if (c === -1 || c === close) break;
        if (c === COMMA) {
          lex.pos++;
          continue;
        }
        const keyStart = lex.pos;
        let key;
        if (object) {
          key = lex.key();
          lex.space();
          if (lex.peek() !== COLON) break;
          lex.pos++;
          lex.space();
        }
        if (lex.pos >= end) break;
        const node = this.node(lex.pos, ref + 1);
        if (!node) break;
        lex.end = end;
        node.key = object ? key : out.length;
        if (object) {
          Object.assign(node, positionOf(this.lines, keyStart));
          if (seen.has(key)) node.duplicate = true;
          seen.add(key);
        }
        out.push(node);
      }
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
    }
    return out;
  }
}
