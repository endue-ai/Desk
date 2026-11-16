// Enough YAML to read API descriptions: block mappings and sequences by indentation, plain,
// quoted and block (| and >) scalars, flow [ ] and { } collections, comments, and the scalar
// types (numbers, true/false, null). Anchors and aliases are not read; tags are ignored.

/** @typedef {{ indent: number, text: string, raw: string, no: number }} Line */

/** Remove a comment that starts outside quotes. @param {string} s */
function uncomment(s) {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:[{,]/.test(s[i - 1] ?? "")) quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1] ?? ""))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/** A scalar's value. @param {string} s */
function scalar(s) {
  const t = s
    .trim()
    .replace(/^!\S+\s+/, "")
    .replace(/^&\S+\s+/, "");
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^[-+]?\d+$/.test(t)) return Number(t);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('"'))
    return JSON.parse(
      t
        .replace(/\\\//g, "/")
        .replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1")
        .replace(/\t/g, "\\t"),
    );
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith("[") || t.startsWith("{")) return flow(t);
  return t;
}

/** A flow collection: [a, b] or {a: 1}. @param {string} text */
function flow(text) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] ?? "")) i++;
  };
  /** @returns {unknown} */
  const value = () => {
    ws();
    const ch = text[i];
    if (ch === "[") {
      i++;
      const out = [];
      ws();
      while (text[i] !== "]" && i < text.length) {
        out.push(value());
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
      return out;
    }
    if (ch === "{") {
      i++;
      /** @type {Record<string, unknown>} */
      const out = {};
      ws();
      while (text[i] !== "}" && i < text.length) {
        const key = String(atom(true));
        ws();
        if (text[i] === ":") i++;
        out[key] = value();
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
      return out;
    }
    return atom(false);
  };
  /** @param {boolean} isKey */
  const atom = (isKey) => {
    ws();
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" && ch === '"' ? 2 : 1;
      const s = text.slice(i, j + 1);
      i = j + 1;
      return scalar(s);
    }
    let j = i;
    while (j < text.length && !/[,\]}]/.test(text[j] ?? "") && !(isKey && text[j] === ":")) j++;
    const s = text.slice(i, j);
    i = j;
    return scalar(s);
  };
  return value();
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#[{-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

/** Parse YAML text into plain values. @param {string} text */
export function parseYaml(text) {
  /** @type {Line[]} */
  const lines = [];
  text.split(/\r?\n/).forEach((raw, no) => {
    if (/^(---|\.\.\.)\s*$/.test(raw) || /^%/.test(raw)) return;
    const text2 = uncomment(raw);
    if (text2.trim() === "") lines.push({ indent: -1, text: "", raw, no });
    else lines.push({ indent: /^ */.exec(raw)?.[0].length ?? 0, text: text2.trim(), raw, no });
  });
  let i = 0;
  const skip = () => {
    while (i < lines.length && lines[i]?.indent === -1) i++;
  };
  const keyOf = (/** @type {string} */ k) =>
    String(k.startsWith('"') || k.startsWith("'") ? scalar(k) : k);

  /** A block scalar's text after `|` or `>` on a line indented `ind`. @param {string} head @param {number} ind */
  const block = (head, ind) => {
    const fold = head.startsWith(">");
    const chomp = head.includes("-") ? "strip" : head.includes("+") ? "keep" : "clip";
    /** @type {string[]} */
    const body = [];
    let inner = -1;
    while (i < lines.length) {
      const l = /** @type {Line} */ (lines[i]);
      if (l.indent !== -1 && l.indent <= ind) break;
      if (l.indent !== -1 && inner < 0) inner = l.indent;
      body.push(l.indent === -1 ? "" : l.raw.slice(inner));
      i++;
    }
    let out = fold
      ? body.reduce(
          (acc, line, n) =>
            n === 0
              ? line
              : line === ""
                ? `${acc}\n`
                : acc.endsWith("\n")
                  ? acc + line
                  : `${acc} ${line}`,
          "",
        )
      : body.join("\n");
    if (chomp === "strip") out = out.replace(/\n+$/, "");
    else if (chomp === "clip") out = `${out.replace(/\n+$/, "")}\n`;
    else out = `${out}\n`;
    return out;
  };

  /** A value written after a key or a dash: inline, a block scalar, or a nested block. @param {string | undefined} rest @param {number} ind */
  const after = (rest, ind) => {
    const r = (rest ?? "").replace(/^&\S+\s*/, "").trim();
    if (/^[|>][-+0-9]*$/.test(r)) return block(r, ind);
    if (r !== "") return scalar(r);
    skip();
    const next = lines[i];
    if (!next) return null;
    if (next.indent > ind) return node(next.indent);
    if (next.indent === ind && next.text.startsWith("-")) return node(ind);
    return null;
  };

  /** @param {number} ind @returns {unknown} */
  const node = (ind) => {
    skip();
    const first = lines[i];
    if (!first || first.indent < ind) return null;
    if (first.text === "-" || first.text.startsWith("- ")) {
      const out = [];
      while (i < lines.length) {
        skip();
        const l = lines[i];
        if (!l || l.indent !== first.indent || !(l.text === "-" || l.text.startsWith("- "))) break;
        const rest = l.text.slice(1).trimStart();
        const offset = l.indent + (l.text.length - rest.length);
        if (rest && KEY.test(rest) && !/^["'[{]/.test(rest)) {
          lines[i] = { ...l, indent: offset, text: rest };
          out.push(node(offset));
        } else {
          i++;
          out.push(after(rest, l.indent));
        }
      }
      return out;
    }
    const m = KEY.exec(first.text);
    if (!m) {
      i++;
      return scalar(first.text);
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    while (i < lines.length) {
      skip();
      const l = lines[i];
      if (!l || l.indent !== first.indent) break;
      const km = KEY.exec(l.text);
      if (!km) break;
      i++;
      out[keyOf(km[1] ?? "")] = after(km[2], l.indent);
    }
    return out;
  };
  return node(0);
}
