// A small YAML reader for the universal data format (ADR 0087), so every plugin frame can read YAML
// without a 200 KB parser in the SDK: YAML 1.2 under the core schema, with block and flow collections,
// plain, quoted and block scalars and comments. Anchors, aliases, tags, directives, complex keys and
// several documents in one stream are refused: data documents do not need them. yaml.test.ts checks
// it against the `yaml` package on the same documents. JSON is YAML and takes JSON.parse first.

import { Flow, put, quoted, resolveScalar, Scan, YamlError } from "./yaml-flow";

export { resolveScalar, YamlError };

/** One line: its indentation, its text without it (trimmed at the end, and as written) and its number. */
type Line = { indent: number; text: string; raw: string; no: number };

const SEQ = /^-( |$)/;
const COMMENT = /(^|\s)#.*$/;
const blank = (line: Line) => line.text === "" || line.text.startsWith("#");
/** A document marker, --- or ..., at the start of a line. */
const marker = (line: Line) => line.indent === 0 && /^(---|\.\.\.)(\s|$)/.test(line.text);

/** A block mapping's key and the text after its colon, or undefined when the line holds none. */
function keyOf(text: string, no: number): { key: string; rest: string } | undefined {
  if (text.startsWith("? ")) throw new YamlError("complex keys are not supported", no);
  if (text.startsWith('"') || text.startsWith("'")) {
    const { value, end } = quoted(text, 0, no);
    const after = text.slice(end);
    const colon = /^\s*:(\s|$)/.exec(after);
    return colon
      ? { key: value, rest: after.slice(colon[0].length - (colon[1] ?? "").length) }
      : undefined;
  }
  if (/^[[{#&*!|>%@`]/.test(text) || SEQ.test(text)) return undefined;
  const colon = /:(\s|$)/.exec(text);
  if (!colon) return undefined;
  const key = text.slice(0, colon.index).trim();
  if (/\s#/.test(key)) return undefined;
  return { key, rest: text.slice(colon.index + 1) };
}

/** Block structure, line by line. */
class Reader {
  at = 0;
  readonly lines: Line[];

  constructor(text: string) {
    this.lines = text.split("\n").map((raw, i) => {
      const indent = /^ */.exec(raw)?.[0].length ?? 0;
      const text = raw.slice(indent).trimEnd();
      if (text.startsWith("\t")) throw new YamlError("tabs cannot indent", i + 1);
      return { indent, text, raw: raw.slice(indent), no: i + 1 };
    });
  }

  peek(): Line | undefined {
    while (this.at < this.lines.length && blank(this.lines[this.at] as Line)) this.at++;
    return this.lines[this.at];
  }

  document(): unknown {
    const first = this.peek();
    if (first?.text.startsWith("%")) throw new YamlError("directives are not supported", first.no);
    if (first && first.indent === 0 && /^---(\s|$)/.test(first.text)) {
      const rest = first.text.slice(3).trim();
      if (rest && !rest.startsWith("#"))
        this.lines[this.at] = { indent: 4, text: rest, raw: rest, no: first.no };
      else this.at++;
    }
    const value = this.node(0);
    const next = this.peek();
    if (next && next.indent === 0 && /^\.\.\.(\s|$)/.test(next.text)) this.at++;
    const after = this.peek();
    if (after && /^---(\s|$)/.test(after.text))
      throw new YamlError("one document per file", after.no);
    if (after) throw new YamlError("unexpected text", after.no);
    return value;
  }

  node(min: number): unknown {
    const line = this.peek();
    if (!line || line.indent < min) return null;
    if (marker(line)) return null;
    if (SEQ.test(line.text)) return this.sequence(line.indent);
    if (keyOf(line.text, line.no)) return this.mapping(line.indent);
    this.at++;
    return this.inline(line.text, line, line.indent - 1);
  }

  sequence(indent: number): unknown[] {
    const out: unknown[] = [];
    for (
      let line = this.peek();
      line && line.indent === indent && SEQ.test(line.text);
      line = this.peek()
    ) {
      const content = line.text.slice(1);
      const spaces = /^ */.exec(content)?.[0].length ?? 0;
      const rest = content.slice(spaces);
      if (rest === "" || rest.startsWith("#")) this.at++;
      else this.lines[this.at] = { ...line, indent: indent + 1 + spaces, text: rest, raw: rest };
      out.push(this.node(indent + 1));
    }
    this.deeper(indent);
    return out;
  }

  mapping(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (
      let line = this.peek();
      line && line.indent === indent && !marker(line);
      line = this.peek()
    ) {
      const pair = keyOf(line.text, line.no);
      if (!pair) {
        if (SEQ.test(line.text)) break;
        throw new YamlError("expected a key", line.no);
      }
      this.at++;
      const rest = pair.rest.trim();
      let value: unknown;
      if (rest === "" || rest.startsWith("#")) {
        const next = this.peek();
        value =
          next && next.indent === indent && SEQ.test(next.text)
            ? this.sequence(indent)
            : this.node(indent + 1);
      } else value = this.inline(rest, line, indent);
      put(out, pair.key, value);
    }
    this.deeper(indent);
    return out;
  }

  /** Refuse a line left over deeper than the collection that just ended. */
  deeper(indent: number): void {
    const next = this.peek();
    if (next && next.indent > indent) throw new YamlError("bad indentation", next.no);
  }

  /** A value that starts on `line` as `text` and may go on over lines deeper than `parent`. */
  inline(text: string, line: Line, parent: number): unknown {
    const c = text[0];
    if (c === "&" || c === "*" || c === "!")
      throw new YamlError("anchors, aliases and tags are not supported", line.no);
    if (c === "|" || c === ">") return this.block(text, line, parent);
    if (c === "[" || c === "{" || c === '"' || c === "'") {
      const scan = new Scan();
      const pieces = [text];
      for (let whole = scan.push(text); !whole && this.at < this.lines.length; ) {
        const next = this.lines[this.at++] as Line;
        const piece = `${" ".repeat(next.indent)}${next.raw}`;
        pieces.push(piece);
        whole = scan.push(piece);
      }
      const source = pieces.join("\n");
      const flow = new Flow(source, line.no);
      const value = flow.value();
      flow.space();
      if (flow.i < source.length) throw new YamlError("unexpected text after a value", line.no);
      return value;
    }
    const parts = [text.replace(COMMENT, "").trim()];
    if (/:(\s|$)/.test(parts[0] as string))
      throw new YamlError("a mapping cannot start inside a scalar", line.no);
    if (COMMENT.test(text)) return resolveScalar(parts[0] as string);
    for (let next = this.lines[this.at]; next; next = this.lines[this.at]) {
      if (next.text !== "" && next.indent <= parent) break;
      if (next.text.startsWith("#")) break;
      if (next.text !== "" && (keyOf(next.text, next.no) || SEQ.test(next.text)))
        throw new YamlError("a mapping cannot start inside a scalar", next.no);
      parts.push(next.text.replace(COMMENT, "").trim());
      this.at++;
    }
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    if (parts.length === 1) return resolveScalar(parts[0] as string);
    let out = parts[0] as string;
    let breaks = 0;
    for (const part of parts.slice(1)) {
      if (part === "") breaks++;
      else {
        out += breaks ? "\n".repeat(breaks) : " ";
        out += part;
        breaks = 0;
      }
    }
    return out;
  }

  /** A literal (|) or folded (>) block scalar under `parent`'s indentation. */
  block(header: string, line: Line, parent: number): string {
    const head = /^([|>])([1-9+-]?)([1-9+-]?)\s*(#.*)?$/.exec(header);
    if (!head) throw new YamlError("bad block scalar header", line.no);
    const flags = `${head[2]}${head[3]}`;
    const chomp = flags.includes("-") ? "strip" : flags.includes("+") ? "keep" : "clip";
    const digit = /[1-9]/.exec(flags)?.[0];
    let indent = digit ? Math.max(parent, 0) + Number(digit) : -1;
    const body: string[] = [];
    for (let next = this.lines[this.at]; next; next = this.lines[this.at]) {
      if (next.text === "") {
        body.push(" ".repeat(next.indent));
        this.at++;
        continue;
      }
      if (indent < 0) indent = next.indent;
      if (next.indent < indent || next.indent <= parent) break;
      body.push(`${" ".repeat(next.indent - indent)}${next.raw}`);
      this.at++;
    }
    const lines = body.map((each) => (each.trim() === "" ? "" : each));
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") end--;
    const content = lines.slice(0, end);
    const trailing = lines.length - end;
    let text: string;
    if (head[1] === "|") text = content.join("\n");
    else {
      text = "";
      let breaks = 0;
      let previous: string | undefined;
      for (const each of content) {
        if (each === "") {
          breaks++;
          continue;
        }
        if (previous === undefined) text += "\n".repeat(breaks);
        else {
          const kept = previous.startsWith(" ") || each.startsWith(" ");
          text += breaks === 0 ? (kept ? "\n" : " ") : "\n".repeat(kept ? breaks + 1 : breaks);
        }
        text += each;
        previous = each;
        breaks = 0;
      }
    }
    if (content.length === 0) return chomp === "keep" ? "\n".repeat(trailing) : "";
    if (chomp === "strip") return text;
    return chomp === "keep" ? `${text}\n${"\n".repeat(trailing)}` : `${text}\n`;
  }
}

/** Parse one YAML document (or JSON) into plain values. */
export function parseYaml(source: string): unknown {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const trimmed = text.trim();
  if (/^[[{"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // YAML flow syntax, then.
    }
  }
  return new Reader(text).document();
}
