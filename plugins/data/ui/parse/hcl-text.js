// The text level of HCL 2: blanks and the three kinds of comments, quoted strings with escapes and
// `${...}` templates, and heredocs. hcl.js reads the structure on top of it.

import { lineStarts, positionOf } from "../lines.js";

/** @typedef {import("../tree.js").DataNode} DataNode */

export class HclFail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

/** @type {Record<string, string>} */
const ESCAPES = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

export class HclText {
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
}
