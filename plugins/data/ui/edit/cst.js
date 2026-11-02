// The lossless JSON model (ADR 0071): JSON and JSONC as tokens over the file's own bytes. Every byte
// belongs to one token: the BOM, a run of white space, a comment, a punctuation mark, a string, a
// number or a word, each with the bytes it was written with. One pass checks the file and indexes
// its containers; a container's members are lexed when asked for, so a 64 MiB file is not held as
// millions of objects. An edit replaces one scalar's bytes, and `serialize` writes the file with
// only those bytes changed.

/**
 * @typedef {"json" | "jsonc"} Dialect
 * @typedef {"bom" | "space" | "comment" | "punct" | "string" | "number" | "word"} TokenKind
 * @typedef {{ kind: TokenKind, start: number, end: number }} Token
 * @typedef {"object" | "array" | "string" | "number" | "boolean" | "null"} ValueKind
 * @typedef {{ kind: ValueKind, start: number, end: number, ref?: number }} Value A value's bytes
 *   [start, end); a container's `ref` numbers it in the index
 * @typedef {{ key?: Token, value: Value }} Member
 */

const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const SLASH = 0x2f;
const STAR = 0x2a;
const MINUS = 0x2d;
const ESCAPES = new Set([...'"\\/bfnrt'].map((c) => c.charCodeAt(0)));
const WORDS = /** @type {const} */ ([
  ["true", "boolean"],
  ["false", "boolean"],
  ["null", "null"],
]).map(([word, kind]) => ({ bytes: [...word].map((c) => c.charCodeAt(0)), kind }));
const CACHED = 16;

export class JsonSyntaxError extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(`${message} (byte ${offset})`);
    this.offset = offset;
  }
}

const isSpace = (/** @type {number | undefined} */ c) =>
  c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
const isDigit = (/** @type {number | undefined} */ c) => c !== undefined && c >= 0x30 && c <= 0x39;
const isHex = (/** @type {number | undefined} */ c) =>
  c !== undefined && (isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66));

/** The tokens of one dialect over bytes: each method takes a start and returns where it ends. */
class Lexer {
  /** @param {Uint8Array} bytes @param {Dialect} dialect */
  constructor(bytes, dialect) {
    this.bytes = bytes;
    this.comments = dialect === "jsonc";
  }

  /** @param {number} at */
  unexpected(at, expected = "") {
    const c = this.bytes[at];
    const found = c === undefined ? "the end" : JSON.stringify(String.fromCharCode(c));
    return new JsonSyntaxError(
      at,
      `Unexpected ${found}${expected ? `: expected ${expected}` : ""}.`,
    );
  }

  /** The trivia token at `at` (the BOM, a run of white space, one comment), or null. */
  trivia(/** @type {number} */ at) {
    const { bytes } = this;
    if (at === 0 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return { kind: /** @type {TokenKind} */ ("bom"), end: 3 };
    if (isSpace(bytes[at])) {
      let end = at + 1;
      while (isSpace(bytes[end])) end++;
      return { kind: /** @type {TokenKind} */ ("space"), end };
    }
    const end = this.comment(at);
    return end > at ? { kind: /** @type {TokenKind} */ ("comment"), end } : null;
  }

  /** Where the comment at `at` ends (before its line break), or `at` when there is none. */
  comment(/** @type {number} */ at) {
    const { bytes } = this;
    if (!this.comments || bytes[at] !== SLASH) return at;
    if (bytes[at + 1] === SLASH) {
      let end = at + 2;
      while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end++;
      return end;
    }
    if (bytes[at + 1] !== STAR) return at;
    for (let end = at + 2; end + 1 < bytes.length; end++)
      if (bytes[end] === STAR && bytes[end + 1] === SLASH) return end + 2;
    throw new JsonSyntaxError(at, "A comment is not closed.");
  }

  /** Past every trivia token from `at`. */
  skip(/** @type {number} */ at) {
    for (let token = this.trivia(at); token; token = this.trivia(at)) at = token.end;
    return at;
  }

  /** The scalar at `at`: its token kind, value kind and end. */
  scalar(/** @type {number} */ at) {
    const c = this.bytes[at];
    if (c === QUOTE)
      return { token: /** @type {TokenKind} */ ("string"), kind: "string", end: this.string(at) };
    if (c === MINUS || isDigit(c))
      return { token: /** @type {TokenKind} */ ("number"), kind: "number", end: this.number(at) };
    for (const word of WORDS) {
      if (word.bytes.every((b, i) => this.bytes[at + i] === b))
        return {
          token: /** @type {TokenKind} */ ("word"),
          kind: word.kind,
          end: at + word.bytes.length,
        };
    }
    throw this.unexpected(at, "a value");
  }

  /** @param {number} at The opening quote. */
  string(at) {
    const { bytes } = this;
    for (let pos = at + 1; ; ) {
      const c = bytes[pos];
      if (c === undefined) throw new JsonSyntaxError(at, "A string is not closed.");
      if (c === QUOTE) return pos + 1;
      if (c === BACKSLASH) {
        const e = bytes[pos + 1];
        if (e === 0x75) {
          for (let i = 2; i < 6; i++)
            if (!isHex(bytes[pos + i]))
              throw new JsonSyntaxError(pos, "A \\u escape needs four hex digits.");
          pos += 6;
        } else if (e !== undefined && ESCAPES.has(e)) pos += 2;
        else throw new JsonSyntaxError(pos, "An unknown escape in a string.");
        continue;
      }
      if (c < 0x20) throw new JsonSyntaxError(pos, "A control character in a string.");
      pos++;
    }
  }

  /** @param {number} at */
  number(at) {
    const { bytes } = this;
    let pos = bytes[at] === MINUS ? at + 1 : at;
    const digits = () => {
      if (!isDigit(bytes[pos])) throw new JsonSyntaxError(pos, "A number needs a digit here.");
      while (isDigit(bytes[pos])) pos++;
    };
    if (bytes[pos] === 0x30) pos++;
    else digits();
    if (bytes[pos] === 0x2e) {
      pos++;
      digits();
    }
    if (bytes[pos] === 0x65 || bytes[pos] === 0x45) {
      pos++;
      if (bytes[pos] === 0x2b || bytes[pos] === MINUS) pos++;
      digits();
    }
    return pos;
  }
}

/**
 * Check `bytes` as JSON (or JSONC) and index its containers. Throws a JsonSyntaxError where the
 * bytes stop being the dialect.
 * @param {Uint8Array} bytes
 * @param {Dialect} [dialect]
 */
export function parseCst(bytes, dialect = "json") {
  const lex = new Lexer(bytes, dialect);
  /** @type {number[]} */ const starts = [];
  /** @type {number[]} */ const ends = [];
  /** Open containers, innermost last, and whether each is an object. */
  /** @type {number[]} */ const stack = [];
  /** @type {boolean[]} */ const objects = [];
  /** Past a member's key and colon, at its value. */
  const member = (/** @type {number} */ at) => {
    if (bytes[at] !== QUOTE) throw lex.unexpected(at, "a key in double quotes");
    at = lex.skip(lex.string(at));
    if (bytes[at] !== COLON) throw lex.unexpected(at, '":"');
    return lex.skip(at + 1);
  };
  const close = (/** @type {number} */ at) => {
    ends[/** @type {number} */ (stack.pop())] = at;
    objects.pop();
    return at + 1;
  };
  let pos = lex.skip(0);
  if (pos >= bytes.length) throw new JsonSyntaxError(pos, "The document is empty.");
  const rootStart = pos;
  let value = true;
  for (;;) {
    if (value) {
      const c = bytes[pos];
      if (c === OPEN_OBJECT || c === OPEN_ARRAY) {
        stack.push(starts.length);
        objects.push(c === OPEN_OBJECT);
        starts.push(pos);
        ends.push(-1);
        pos = lex.skip(pos + 1);
        if (bytes[pos] === (c === OPEN_OBJECT ? CLOSE_OBJECT : CLOSE_ARRAY)) {
          pos = close(pos);
          value = false;
        } else if (c === OPEN_OBJECT) pos = member(pos);
        continue;
      }
      pos = lex.scalar(pos).end;
      value = false;
    }
    if (stack.length === 0) break;
    pos = lex.skip(pos);
    const object = objects[objects.length - 1];
    const closer = object ? CLOSE_OBJECT : CLOSE_ARRAY;
    if (bytes[pos] === COMMA) {
      pos = lex.skip(pos + 1);
      if (bytes[pos] === closer) {
        if (!lex.comments)
          throw new JsonSyntaxError(pos, "A trailing comma: JSON does not allow one.");
        pos = close(pos);
      } else {
        if (object) pos = member(pos);
        value = true;
      }
    } else if (bytes[pos] === closer) pos = close(pos);
    else throw lex.unexpected(pos, object ? '"," or "}"' : '"," or "]"');
  }
  pos = lex.skip(pos);
  if (pos < bytes.length) throw new JsonSyntaxError(pos, "Unexpected text after the document.");
  return new Cst(bytes, lex, starts, ends, rootStart);
}

export class Cst {
  /**
   * @param {Uint8Array} bytes
   * @param {Lexer} lex
   * @param {number[]} starts Where each container opens, in the order they open
   * @param {number[]} ends Where each container closes
   * @param {number} rootStart
   */
  constructor(bytes, lex, starts, ends, rootStart) {
    this.bytes = bytes;
    this.lex = lex;
    this.starts = starts;
    this.ends = ends;
    /** Edited scalars by where they start: the bytes they become. */
    /** @type {Map<number, { start: number, end: number, bytes: Uint8Array }>} */
    this.edits = new Map();
    /** @type {Map<number, Member[]>} */
    this.cache = new Map();
    this.root = this.valueOf(rootStart, 0);
  }

  /** The value whose first byte is at `at`; `low` is the first container it can be. */
  valueOf(/** @type {number} */ at, low = 0) {
    const c = this.bytes[at];
    if (c !== OPEN_OBJECT && c !== OPEN_ARRAY) {
      const { kind, end } = this.lex.scalar(at);
      return /** @type {Value} */ ({ kind, start: at, end });
    }
    // Containers are numbered as they open, so their starts are sorted.
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.starts[mid] ?? 0) < at) low = mid + 1;
      else high = mid;
    }
    const kind = c === OPEN_OBJECT ? "object" : "array";
    return /** @type {Value} */ ({ kind, start: at, end: (this.ends[low] ?? 0) + 1, ref: low });
  }

  /** A container's members, in order: an object's with their keys. */
  members(/** @type {Value} */ container) {
    const { ref } = container;
    if (ref === undefined) return [];
    const kept = this.cache.get(ref);
    if (kept) return kept;
    const { bytes, lex } = this;
    const object = container.kind === "object";
    /** @type {Member[]} */
    const out = [];
    let at = lex.skip(container.start + 1);
    while (at < container.end - 1) {
      if (bytes[at] === COMMA) {
        at = lex.skip(at + 1);
        continue;
      }
      /** @type {Token | undefined} */
      let key;
      if (object) {
        key = { kind: "string", start: at, end: lex.string(at) };
        at = lex.skip(lex.skip(key.end) + 1);
      }
      const value = this.valueOf(at, ref + 1);
      out.push(key ? { key, value } : { value });
      at = lex.skip(value.end);
    }
    if (this.cache.size >= CACHED)
      this.cache.delete(/** @type {number} */ (this.cache.keys().next().value));
    this.cache.set(ref, out);
    return out;
  }

  /** The value at a path: 0 for the root, then member indexes. */
  valueAt(/** @type {number[]} */ path) {
    const [root, ...rest] = path;
    if (root !== 0) return undefined;
    let at = this.root;
    for (const index of rest) {
      const next = this.members(at)[index];
      if (!next) return undefined;
      at = next.value;
    }
    return at;
  }

  /** The bytes a value has now: its edit's, else the file's. */
  rawOf(/** @type {Value} */ value) {
    return this.edits.get(value.start)?.bytes ?? this.bytes.subarray(value.start, value.end);
  }

  /**
   * Make the scalar at `path` the token in `bytes`, which must be one scalar of the dialect. Its
   * original bytes again drop the edit. Returns the bytes it had.
   * @param {number[]} path
   * @param {Uint8Array} bytes
   */
  setValue(path, bytes) {
    const value = this.valueAt(path);
    if (!value || value.ref !== undefined) throw new JsonSyntaxError(0, "No scalar at that path.");
    const token = new Lexer(bytes, this.lex.comments ? "jsonc" : "json");
    if (token.scalar(0).end !== bytes.length)
      throw new JsonSyntaxError(0, "The new value is not one JSON scalar.");
    const before = this.rawOf(value);
    const original = this.bytes.subarray(value.start, value.end);
    if (bytes.length === original.length && bytes.every((b, i) => b === original[i]))
      this.edits.delete(value.start);
    else this.edits.set(value.start, { start: value.start, end: value.end, bytes });
    return before;
  }

  /** Every token of the file, in order: together they are its bytes, each byte once. */
  *tokens() {
    const { bytes, lex } = this;
    for (let at = 0; at < bytes.length; ) {
      const trivia = lex.trivia(at);
      const c = bytes[at];
      /** @type {{ kind: TokenKind, end: number }} */
      let token;
      if (trivia) token = trivia;
      else if (c === OPEN_OBJECT || c === CLOSE_OBJECT || c === OPEN_ARRAY || c === CLOSE_ARRAY)
        token = { kind: "punct", end: at + 1 };
      else if (c === COMMA || c === COLON) token = { kind: "punct", end: at + 1 };
      else {
        const { token: kind, end } = lex.scalar(at);
        token = { kind, end };
      }
      yield/** @type {Token} */ ({ kind: token.kind, start: at, end: token.end });
      at = token.end;
    }
  }
}

/** The file as the model has it: its bytes with each edited scalar's replaced. */
export function serialize(/** @type {Cst} */ cst) {
  const edits = [...cst.edits.values()].sort((a, b) => a.start - b.start);
  const { bytes } = cst;
  const size = edits.reduce((n, e) => n + e.bytes.length - (e.end - e.start), bytes.length);
  const out = new Uint8Array(size);
  let from = 0;
  let to = 0;
  for (const edit of edits) {
    out.set(bytes.subarray(from, edit.start), to);
    to += edit.start - from;
    out.set(edit.bytes, to);
    to += edit.bytes.length;
    from = edit.end;
  }
  out.set(bytes.subarray(from), to);
  return out;
}
