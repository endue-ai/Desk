// A small CommonMark subset for desk-markdown, without a DOM: headings, paragraphs, emphasis, strong,
// inline and fenced code, lists, quotes, links and images. Raw HTML is text; nothing here can
// produce a script, a handler, a style or a request.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "em" | "strong"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; alt: string };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

/** The link schemes that may become links; anything else stays text. */
const SAFE = /^(https?:|mailto:)/i;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^(`{3,}|~{3,})/;
const QUOTE = /^>\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;

/** The blocks of a Markdown source. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let at = 0;
  const starts = (line: string) =>
    line.trim() === "" ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line);
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const fence = FENCE.exec(line);
    if (line.trim() === "") {
      at += 1;
    } else if (HEADING.test(line)) {
      const [, marks = "#", text = ""] = HEADING.exec(line) ?? [];
      blocks.push({ kind: "heading", level: marks.length, children: parseInline(text) });
      at += 1;
    } else if (fence) {
      const close = fence[1] ?? "```";
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !(lines[at] ?? "").startsWith(close)) body.push(lines[at++] ?? "");
      blocks.push({ kind: "code", text: body.join("\n") });
      at += 1;
    } else if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at] ?? ""))
        quoted.push((lines[at++] ?? "").replace(QUOTE, ""));
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted.join("\n")) });
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (at < lines.length && pattern.test(lines[at] ?? ""))
        items.push(parseInline(pattern.exec(lines[at++] ?? "")?.[1] ?? ""));
      blocks.push({ kind: "list", ordered, items });
    } else {
      const text: string[] = [line.trim()];
      at += 1;
      while (at < lines.length && !starts(lines[at] ?? "")) text.push((lines[at++] ?? "").trim());
      blocks.push({ kind: "paragraph", children: parseInline(text.join(" ")) });
    }
  }
  return blocks;
}

/** Inline syntax, tried in order at each position: what it matches and what it makes. */
const INLINE: Array<[RegExp, (m: RegExpExecArray) => Inline[]]> = [
  [/^\\([\\`*_[\]()!#>~-])/, (m) => [{ kind: "text", text: m[1] ?? "" }]],
  [/^(`+)([\s\S]*?[^`])\1(?!`)/, (m) => [{ kind: "code", text: (m[2] ?? "").trim() }]],
  [/^!\[([^\]]*)\]\(([^)\s]*)\)/, (m) => [{ kind: "image", alt: m[1] ?? "" }]],
  [
    /^\[([^\]]+)\]\(([^)\s]*)\)/,
    ([, label = "", href = ""]) =>
      SAFE.test(href) ? [{ kind: "link", href, children: parseInline(label) }] : parseInline(label),
  ],
  [/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, (m) => [{ kind: "strong", children: parseInline(m[2] ?? "") }]],
  [/^(\*|_)(?=\S)([\s\S]*?\S)\1(?!\1)/, (m) => [{ kind: "em", children: parseInline(m[2] ?? "") }]],
];

/** The inline parts of one block's text, with neighbouring text joined. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (inline: Inline) => {
    const last = out[out.length - 1];
    if (inline.kind === "text" && last?.kind === "text") last.text += inline.text;
    else out.push(inline);
  };
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    let taken = 0;
    for (const [pattern, make] of INLINE) {
      const match = pattern.exec(rest);
      if (!match) continue;
      for (const inline of make(match)) push(inline);
      taken = match[0].length;
      break;
    }
    if (taken === 0) {
      push({ kind: "text", text: text[at] ?? "" });
      taken = 1;
    }
    at += taken;
  }
  return out;
}
