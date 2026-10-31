// HCL 2 native syntax (`.hcl`, Terraform's `.tf` and `.tfvars`) into the typed tree: blocks with
// their labels (`resource "aws_instance" "web"`), attributes, tuples, objects, strings, heredocs,
// numbers, booleans, null and the three kinds of comments. Every other expression (references,
// calls, conditionals, for expressions) and every template with `${...}` keeps its text.

import { errorAt, lineStarts, positionOf } from "../lines.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {"attr" | "line" | "tuple" | "object"} Context Where an expression ends
 */

class HclFail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

const IDENT = /[A-Za-z_][A-Za-z0-9_-]*/y;
const NUMBER = /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
/** @type {Record<string, string>} */
const ESCAPES = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

/** @param {string} text @returns {DataDoc} */
export function parseHcl(text) {
  const parser = new Hcl(text);
  /** @type {DataNode} */
  const root = { kind: "object", children: [], line: 1, col: 1, from: 0, to: text.length };
  const errors = [];
  try {
    parser.body(root, false);
  } catch (error) {
    if (!(error instanceof HclFail)) throw error;
    errors.push(errorAt(parser.lines, error.offset, error.message));
  }
  return { roots: [root], errors, warnings: [] };
}

class Hcl {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.lines = lineStarts(text);
  }

  /** @param {number} at */
  where(at) {
    return positionOf(this.lines, at);
  }

  /** Blanks and comments; with `lines`, line breaks too. */
  space(lines = false) {
    const { text } = this;
    for (;;) {
      const c = text[this.pos];
      if (c === " " || c === "\t" || c === "\r" || (lines && c === "\n")) this.pos++;
      else if (c === "#" || (c === "/" && text[this.pos + 1] === "/")) {
        const nl = text.indexOf("\n", this.pos);
        this.pos = nl < 0 ? text.length : nl;
      } else if (c === "/" && text[this.pos + 1] === "*") {
        const close = text.indexOf("*/", this.pos + 2);
        if (close < 0) throw new HclFail(this.pos, "A comment is not closed.");
        this.pos = close + 2;
      } else break;
    }
  }

  /**
   * Attributes and blocks into `node`, up to its `}` (or the end of the file at the top).
   * @param {DataNode} node
   * @param {boolean} braced
   */
  body(node, braced) {
    const { text } = this;
    const children = /** @type {DataNode[]} */ (node.children);
    for (;;) {
      this.space(true);
      const at = this.pos;
      if (at >= text.length) {
        if (braced) throw new HclFail(at, "A block is not closed: expected }.");
        return;
      }
      if (text[at] === "}" && braced) {
        this.pos++;
        node.to = this.pos;
        return;
      }
      IDENT.lastIndex = at;
      const name = IDENT.exec(text)?.[0];
      if (!name)
        throw new HclFail(
          at,
          `Unexpected ${JSON.stringify(text[at])}: expected an attribute or a block.`,
        );
      this.pos += name.length;
      this.space();
      if (text[this.pos] === "=" && text[this.pos + 1] !== "=") {
        this.pos++;
        this.space();
        const value = this.expression(braced ? "line" : "attr");
        children.push(Object.assign(value, { key: name }, this.where(at)));
        this.endItem(braced);
        continue;
      }
      const labels = [];
      for (;;) {
        this.space();
        const c = text[this.pos];
        if (c === '"') {
          const start = this.pos;
          this.quoted();
          labels.push(text.slice(start, this.pos));
        } else if (c && /[A-Za-z_]/.test(c)) {
          IDENT.lastIndex = this.pos;
          const label = IDENT.exec(text)?.[0] ?? "";
          labels.push(label);
          this.pos += label.length;
        } else break;
      }
      if (text[this.pos] !== "{") throw new HclFail(this.pos, `Expected "=" or "{" after ${name}.`);
      this.pos++;
      /** @type {DataNode} */
      const block = {
        kind: "object",
        key: [name, ...labels].join(" "),
        tag: "block",
        children: [],
        ...this.where(at),
        from: at,
      };
      children.push(block);
      this.body(block, true);
    }
  }

  /** After an attribute: the end of the line, or in a one-line block its `}`. */
  endItem(/** @type {boolean} */ braced) {
    this.space();
    const c = this.text[this.pos];
    if (c === "\n") this.pos++;
    else if (c !== undefined && !(braced && c === "}"))
      throw new HclFail(this.pos, `Unexpected ${JSON.stringify(c)} after the attribute.`);
  }

  /** A quoted string at the cursor; its value, and whether it is a template with `${` or `%{`. */
  quoted() {
    const { text } = this;
    const start = this.pos++;
    let out = "";
    let template = false;
    for (;;) {
      const c = text[this.pos];
      if (c === undefined || c === "\n") throw new HclFail(start, "A string is not closed.");
      if (c === '"') {
        this.pos++;
        return { value: out, template };
      }
      if (c === "\\") {
        const e = text[this.pos + 1] ?? "";
        if (e === "u" || e === "U") {
          const size = e === "u" ? 4 : 8;
          out += String.fromCodePoint(
            Number.parseInt(text.slice(this.pos + 2, this.pos + 2 + size), 16) || 0xfffd,
          );
          this.pos += 2 + size;
        } else {
          out += ESCAPES[e] ?? e;
          this.pos += 2;
        }
        continue;
      }
      if ((c === "$" || c === "%") && text[this.pos + 1] === c && text[this.pos + 2] === "{") {
        out += `${c}{`;
        this.pos += 3;
        continue;
      }
      if ((c === "$" || c === "%") && text[this.pos + 1] === "{") {
        template = true;
        const close = this.skipBraces(this.pos + 1);
        out += text.slice(this.pos, close);
        this.pos = close;
        continue;
      }
      out += c;
      this.pos++;
    }
  }

  /** The end of the braces opening at `at`, with strings inside them. */
  skipBraces(/** @type {number} */ at) {
    const { text } = this;
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return i + 1;
      else if (c === '"') {
        const save = this.pos;
        this.pos = i;
        this.quoted();
        i = this.pos - 1;
        this.pos = save;
      }
    }
    throw new HclFail(at, "An interpolation is not closed.");
  }

  /**
   * A value: a literal, tuple, object, string or heredoc when it is one whole, else the
   * expression's text.
   * @param {Context} context
   * @returns {DataNode}
   */
  expression(context) {
    const at = this.pos;
    const node = this.literal();
    if (node) {
      const end = this.pos;
      this.space();
      if (this.ends(context)) {
        this.pos = end;
        return Object.assign(node, this.where(at), { from: at, to: end });
      }
    }
    this.pos = at;
    const end = this.scanExpression(context);
    const value = this.text.slice(at, end).trim();
    if (value === "") throw new HclFail(at, "Expected a value.");
    this.pos = end;
    return { kind: "string", value, tag: "expression", ...this.where(at), from: at, to: end };
  }

  /** Whether the cursor is where an expression in `context` ends. */
  ends(/** @type {Context} */ context) {
    const c = this.text[this.pos];
    if (c === undefined || c === "\n") return true;
    if (context === "tuple") return c === "," || c === "]";
    if (context === "object") return c === "," || c === "}";
    return context === "line" && c === "}";
  }

  /** @returns {DataNode | undefined} */
  literal() {
    const { text } = this;
    const at = this.pos;
    const c = text[at];
    if (c === '"') {
      const { value, template } = this.quoted();
      return template
        ? {
            kind: "string",
            value: text.slice(at + 1, this.pos - 1),
            tag: "template",
            line: 0,
            col: 0,
          }
        : { kind: "string", value, line: 0, col: 0 };
    }
    if (text.startsWith("<<", at)) return this.heredoc();
    if (c === "[" && !/^\[\s*for\s/.test(text.slice(at, at + 12))) return this.tuple();
    if (c === "{" && !/^\{\s*for\s/.test(text.slice(at, at + 12))) return this.object();
    NUMBER.lastIndex = at;
    const number = c && /[0-9]/.test(c) ? NUMBER.exec(text)?.[0] : undefined;
    if (number) {
      this.pos += number.length;
      return { kind: "number", value: number, line: 0, col: 0 };
    }
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, at) && !/[A-Za-z0-9_-]/.test(text[at + word.length] ?? "")) {
        this.pos += word.length;
        return word === "null"
          ? { kind: "null", value: null, line: 0, col: 0 }
          : { kind: "boolean", value: word === "true", line: 0, col: 0 };
      }
    }
    return undefined;
  }

  /** `<<EOT` or `<<-EOT` (which removes the lines' common indentation) up to its marker line. */
  heredoc() {
    const { text } = this;
    const m = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n/.exec(
      text.slice(this.pos, this.pos + 200),
    );
    if (!m) throw new HclFail(this.pos, "A heredoc needs a marker and a line break: <<EOT.");
    const marker = m[2] ?? "";
    let lineStart = this.pos + m[0].length;
    const body = [];
    for (;;) {
      if (lineStart >= text.length)
        throw new HclFail(this.pos, `The heredoc is not closed: expected ${marker}.`);
      const nl = text.indexOf("\n", lineStart);
      const end = nl < 0 ? text.length : nl;
      const line = text.slice(lineStart, end).replace(/\r$/, "");
      if (line.trim() === marker) {
        this.pos = end;
        break;
      }
      body.push(line);
      lineStart = end + 1;
    }
    if (m[1] === "-") {
      const indents = body
        .filter((l) => l.trim() !== "")
        .map((l) => l.length - l.trimStart().length);
      const cut = indents.length ? Math.min(...indents) : 0;
      for (let i = 0; i < body.length; i++) body[i] = (body[i] ?? "").slice(cut);
    }
    return /** @type {DataNode} */ ({
      kind: "string",
      value: body.map((l) => `${l}\n`).join(""),
      tag: "heredoc",
      line: 0,
      col: 0,
    });
  }

  /** @returns {DataNode} */
  tuple() {
    this.pos++;
    /** @type {DataNode[]} */
    const children = [];
    for (;;) {
      this.space(true);
      if (this.text[this.pos] === "]") break;
      if (this.pos >= this.text.length)
        throw new HclFail(this.pos, "A list is not closed: expected ].");
      const item = this.expression("tuple");
      children.push(Object.assign(item, { key: children.length }));
      this.space(true);
      if (this.text[this.pos] === ",") this.pos++;
      else if (this.text[this.pos] !== "]") throw new HclFail(this.pos, 'Expected "," or "]".');
    }
    this.pos++;
    return { kind: "array", children, line: 0, col: 0 };
  }

  /** @returns {DataNode} */
  object() {
    const { text } = this;
    this.pos++;
    /** @type {DataNode[]} */
    const children = [];
    for (;;) {
      this.space(true);
      if (text[this.pos] === "}") break;
      if (this.pos >= text.length)
        throw new HclFail(this.pos, "An object is not closed: expected }.");
      const at = this.pos;
      let key;
      if (text[at] === '"') key = this.quoted().value;
      else {
        IDENT.lastIndex = at;
        key = IDENT.exec(text)?.[0];
        if (!key) throw new HclFail(at, "Expected a key in the object.");
        this.pos += key.length;
      }
      this.space();
      if (text[this.pos] !== "=" && text[this.pos] !== ":")
        throw new HclFail(this.pos, `Expected "=" after ${key}.`);
      this.pos++;
      this.space();
      const value = this.expression("object");
      children.push(Object.assign(value, { key }, this.where(at)));
      this.space();
      if (text[this.pos] === ",") this.pos++;
    }
    this.pos++;
    return { kind: "object", children, line: 0, col: 0 };
  }

  /** The end of an expression's text: brackets, strings and heredocs inside it are skipped. */
  scanExpression(/** @type {Context} */ context) {
    const { text } = this;
    let depth = 0;
    let at = this.pos;
    while (at < text.length) {
      const c = text[at] ?? "";
      if (depth === 0) {
        this.pos = at;
        if (
          this.ends(context) ||
          c === "#" ||
          text.startsWith("//", at) ||
          text.startsWith("/*", at)
        )
          break;
      }
      if (c === '"') {
        this.pos = at;
        this.quoted();
        at = this.pos;
        continue;
      }
      if (text.startsWith("<<", at) && /^<<-?[A-Za-z_]/.test(text.slice(at, at + 4))) {
        this.pos = at;
        this.heredoc();
        at = this.pos;
        continue;
      }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break;
        depth--;
      }
      at++;
    }
    if (depth > 0) throw new HclFail(this.pos, "A bracket in this expression is not closed.");
    return at;
  }
}
