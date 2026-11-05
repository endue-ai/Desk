// The scalars and flow collections of the YAML reader (yaml.ts): plain scalars under the core
// schema, quoted scalars with their escapes and folding, and [a, b] / {k: v} collections.

/** Text that is not the YAML this reader takes, with the line it stopped at. */
export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = "YamlError";
    this.line = line;
  }
}

/** A plain scalar's value under the core schema: null, a boolean, a number or the text itself. */
export function resolveScalar(text: string): unknown {
  if (text === "" || /^(~|null|Null|NULL)$/.test(text)) return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?[0-9]+$/.test(text)) return Number(text);
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)) return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return Number.NaN;
  return text;
}

const ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xa0",
  L: " ",
  P: " ",
};

/** Line folding inside quotes: one break is a space, n breaks are n − 1 newlines. */
const foldQuoted = (text: string) =>
  text.replace(/[ \t]*(\n[ \t]*)+/g, (run) => {
    const breaks = run.split("\n").length - 1;
    return breaks === 1 ? " " : "\n".repeat(breaks - 1);
  });

/** Spaces and line breaks from a position (sticky, so nothing is copied). */
const SPACE = /[ \t]*(\n[ \t]*)*/y;
const BLANKS = /[ \t]*/y;

/** Read a quoted scalar starting at `text[from]`: its value and where it ends. */
export function quoted(text: string, from: number, no: number): { value: string; end: number } {
  const quote = text[from];
  let out = "";
  let i = from + 1;
  for (; i < text.length; i++) {
    const c = text[i] as string;
    if (quote === "'") {
      if (c === "'" && text[i + 1] === "'") {
        out += "'";
        i++;
      } else if (c === "'") return { value: foldQuoted(out), end: i + 1 };
      else out += c;
      continue;
    }
    if (c === '"') return { value: out, end: i + 1 };
    if (c === "\n" || c === " " || c === "\t") {
      SPACE.lastIndex = i;
      const run = SPACE.exec(text)?.[0] || c;
      out += run.includes("\n") ? foldQuoted(run) : run;
      i += run.length - 1;
    } else if (c === "\\") {
      const e = text[i + 1] ?? "";
      if (e === "\n") {
        BLANKS.lastIndex = i + 2;
        i += 1 + (BLANKS.exec(text)?.[0].length ?? 0);
      } else if (e === "x" || e === "u" || e === "U") {
        const size = e === "x" ? 2 : e === "u" ? 4 : 8;
        const hex = text.slice(i + 2, i + 2 + size);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== size)
          throw new YamlError("bad escape", no);
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        i += 1 + size;
      } else if (e in ESCAPES) {
        out += ESCAPES[e];
        i++;
      } else throw new YamlError(`unknown escape \\${e}`, no);
    } else out += c;
  }
  throw new YamlError("a quoted scalar does not end", no);
}

/** Define a key as an own property, even __proto__, as JSON.parse does. */
export function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Flow collections and scalars inside them: [a, b], {k: v}. */
export class Flow {
  i = 0;
  constructor(
    readonly text: string,
    readonly no: number,
  ) {}

  space(): void {
    while (this.i < this.text.length) {
      if (/\s/.test(this.text[this.i] as string)) this.i++;
      else if (this.text[this.i] === "#" && /\s/.test(this.text[this.i - 1] ?? " "))
        while (this.i < this.text.length && this.text[this.i] !== "\n") this.i++;
      else break;
    }
  }

  value(key = false): unknown {
    this.space();
    const c = this.text[this.i];
    if (c === "[") return this.list();
    if (c === "{") return this.map();
    if (c === '"' || c === "'") {
      const { value, end } = quoted(this.text, this.i, this.no);
      this.i = end;
      return value;
    }
    if (c === "&" || c === "*" || c === "!")
      throw new YamlError("anchors, aliases and tags are not supported", this.no);
    const start = this.i;
    while (this.i < this.text.length) {
      const here = this.text[this.i] as string;
      const next = this.text[this.i + 1] ?? " ";
      if (",[]{}".includes(here)) break;
      if (here === ":" && (key || /[\s,\]}]/.test(next))) break;
      if (here === "#" && /\s/.test(this.text[this.i - 1] ?? "")) break;
      this.i++;
    }
    const plain = this.text.slice(start, this.i).replace(/\s+/g, " ").trim();
    return key ? plain : resolveScalar(plain);
  }

  list(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    for (;;) {
      this.space();
      if (this.text[this.i] === "]") break;
      out.push(this.value());
      this.space();
      if (this.text[this.i] === ",") this.i++;
      else if (this.text[this.i] !== "]")
        throw new YamlError("expected , or ] in a flow list", this.no);
    }
    this.i++;
    return out;
  }

  map(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    for (;;) {
      this.space();
      if (this.text[this.i] === "}") break;
      const key = String(this.value(true));
      this.space();
      let value: unknown = null;
      if (this.text[this.i] === ":") {
        this.i++;
        this.space();
        if (!",}".includes(this.text[this.i] ?? "}")) value = this.value();
      }
      put(out, key, value);
      this.space();
      if (this.text[this.i] === ",") this.i++;
      else if (this.text[this.i] !== "}")
        throw new YamlError("expected , or } in a flow map", this.no);
    }
    this.i++;
    return out;
  }
}

/**
 * Brackets and quotes across the lines of one value, pushed a line at a time so a long value is read
 * once: whether what came so far closes every bracket and quote it opened.
 */
export class Scan {
  depth = 0;
  quote = "";

  push(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.quote) {
        if (c === "\\" && this.quote === '"') i++;
        else if (c === this.quote) {
          if (c === "'" && text[i + 1] === "'") i++;
          else this.quote = "";
        }
      } else if (c === '"' || c === "'") this.quote = c;
      else if (c === "[" || c === "{") this.depth++;
      else if (c === "]" || c === "}") this.depth--;
      else if (c === "#" && /\s/.test(text[i - 1] ?? " ")) break;
    }
    return this.depth <= 0 && !this.quote;
  }
}
