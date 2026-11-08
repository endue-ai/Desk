// The low level of the YAML reader: a cursor over the text with its lines, indentation, comments,
// document markers, anchors, tags and plain scalars. Quoted and block scalars are in
// yaml-scalars.js, flow collections in yaml-flow.js, and the composer (yaml.js) builds the tree.

export class YamlFail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

export const FLOW_INDICATORS = ",[]{}";

/**
 * @typedef {{ eof: boolean, lineStart: number, contentAt: number, indent: number, marker: boolean }} Line
 */

export class Reader {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.len = text.length;
    this.pos = 0;
  }

  /** @param {number} [at] */
  ch(at = this.pos) {
    return at < this.len ? (this.text[at] ?? "") : "";
  }

  /** Whether `at` is a line break or the end. */
  eolAt(at = this.pos) {
    const c = this.ch(at);
    return c === "" || c === "\n" || c === "\r";
  }

  /** Whether `at` is a space, a tab, a line break or the end. */
  blankAt(at = this.pos) {
    const c = this.ch(at);
    return c === " " || c === "\t" || this.eolAt(at);
  }

  /** @param {number} at */
  lineStartOf(at) {
    return this.text.lastIndexOf("\n", at - 1) + 1;
  }

  /** The 0-based column of `at`. */
  col(at = this.pos) {
    return at - this.lineStartOf(at);
  }

  /** The start of the line after the one `at` is on. */
  nextLine(at = this.pos) {
    const nl = this.text.indexOf("\n", at);
    return nl < 0 ? this.len : nl + 1;
  }

  inlineSpace() {
    while (this.ch() === " " || this.ch() === "\t") this.pos++;
  }

  /** Skip a comment at the cursor (a # after a blank or at a line's start). */
  comment() {
    if (this.ch() !== "#") return;
    const before = this.pos > 0 ? this.ch(this.pos - 1) : "\n";
    if (before !== " " && before !== "\t" && before !== "\n" && before !== "\r") return;
    const nl = this.text.indexOf("\n", this.pos);
    this.pos = nl < 0 ? this.len : nl;
    if (this.ch(this.pos - 1) === "\r") this.pos--;
  }

  /** The rest of the line must be blank or a comment; move to the next line. */
  endLine() {
    this.inlineSpace();
    this.comment();
    if (!this.eolAt())
      throw new YamlFail(this.pos, `Unexpected ${JSON.stringify(this.ch())} here.`);
    this.pos = this.nextLine();
  }

  /** Whether a line starts with the document marker `---` or `...`. */
  isMarker(lineStart, which = "") {
    const three = this.text.slice(lineStart, lineStart + 3);
    if (three !== "---" && three !== "...") return false;
    return (which === "" || three === which) && this.blankAt(lineStart + 3);
  }

  /** The next line with content at or after `from` (a line start): blank and comment lines skipped. */
  peek(from = this.pos) {
    let lineStart = from;
    while (lineStart < this.len) {
      let at = lineStart;
      while (this.ch(at) === " ") at++;
      const indent = at - lineStart;
      while (this.ch(at) === "\t" || this.ch(at) === " ") at++;
      const c = this.ch(at);
      if (c !== "" && c !== "\n" && c !== "\r" && c !== "#") {
        return { eof: false, lineStart, contentAt: at, indent, marker: this.isMarker(lineStart) };
      }
      lineStart = this.nextLine(at);
    }
    return { eof: true, lineStart: this.len, contentAt: this.len, indent: -1, marker: false };
  }

  /** `- ` or `? ` or `: ` at `at`. */
  isIndicator(at, which) {
    return this.ch(at) === which && this.blankAt(at + 1);
  }

  /** A `:` that makes what came before it a key: followed by a blank (or, in flow, an indicator). */
  isKeyColon(flow = false, adjacent = false) {
    if (this.ch() !== ":") return false;
    const next = this.ch(this.pos + 1);
    return this.blankAt(this.pos + 1) || (flow && (FLOW_INDICATORS.includes(next) || adjacent));
  }

  /** An anchor or alias name after its `&` or `*`. */
  name() {
    const start = ++this.pos;
    while (!this.blankAt() && !FLOW_INDICATORS.includes(this.ch())) this.pos++;
    if (this.pos === start) throw new YamlFail(start, "An anchor or alias needs a name.");
    return this.text.slice(start, this.pos);
  }

  /** A tag as written: `!`, `!local`, `!!str`, `!e!x` or `!<verbatim>`. */
  tag() {
    const start = this.pos;
    if (this.ch(start + 1) === "<") {
      const close = this.text.indexOf(">", start);
      if (close < 0) throw new YamlFail(start, "A verbatim tag is not closed.");
      this.pos = close + 1;
    } else {
      while (!this.blankAt() && !FLOW_INDICATORS.includes(this.ch())) this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  /**
   * One line of a plain scalar from the cursor: up to `: `, ` #` or the line's end (and in flow, a
   * flow indicator). Returns its text without trailing blanks; the cursor ends after it.
   */
  plainLine(flow = false) {
    const start = this.pos;
    let at = start;
    let end = start;
    for (;;) {
      const c = this.ch(at);
      if (c === "" || c === "\n" || c === "\r") break;
      if (
        c === ":" &&
        (this.blankAt(at + 1) || (flow && FLOW_INDICATORS.includes(this.ch(at + 1))))
      )
        break;
      if (c === "#" && (this.ch(at - 1) === " " || this.ch(at - 1) === "\t")) break;
      if (flow && FLOW_INDICATORS.includes(c)) break;
      at++;
      if (c !== " " && c !== "\t") end = at;
    }
    this.pos = end;
    return this.text.slice(start, end);
  }

  /**
   * The lines a plain scalar continues on: lines more indented than `n` that are not comments,
   * folded into one space (or one line break per empty line).
   * @param {string} first
   * @param {number} n
   */
  plainMore(first, n, flow = false) {
    let value = first;
    for (;;) {
      const save = this.pos;
      this.inlineSpace();
      if (!this.eolAt()) {
        this.pos = save;
        break;
      }
      let empty = 0;
      let lineStart = this.nextLine();
      let line = this.peekRaw(lineStart);
      while (!line.eof && line.blank) {
        empty++;
        lineStart = this.nextLine(lineStart);
        line = this.peekRaw(lineStart);
      }
      const c = this.ch(line.contentAt);
      if (line.eof || line.marker || c === "#" || (!flow && line.indent <= n)) {
        this.pos = save;
        break;
      }
      if (flow && FLOW_INDICATORS.includes(c)) {
        this.pos = line.contentAt;
        break;
      }
      this.pos = line.contentAt;
      const more = this.plainLine(flow);
      if (more === "") {
        this.pos = save;
        break;
      }
      if (!flow && this.ch() === ":")
        throw new YamlFail(this.pos, "A mapping value is not allowed here.");
      value += empty > 0 ? "\n".repeat(empty) : " ";
      value += more;
    }
    return value;
  }

  /** A line as it is: its indent, first content and whether it is blank. */
  peekRaw(lineStart) {
    let at = lineStart;
    while (this.ch(at) === " ") at++;
    const indent = at - lineStart;
    while (this.ch(at) === "\t") at++;
    const c = this.ch(at);
    return {
      eof: lineStart >= this.len,
      blank: c === "" || c === "\n" || c === "\r",
      contentAt: at,
      indent,
      marker: this.isMarker(lineStart),
    };
  }

  /** @param {number} at A line break. */
  skipBreak(at) {
    if (this.ch(at) === "\r" && this.ch(at + 1) === "\n") return at + 2;
    return at + 1;
  }
}
