// A chat message's text as the services write it, into blocks and inline nodes the view draws as
// DOM nodes, never as HTML: paragraphs, quotes and code blocks; bold, italic, strike, code, links,
// @mentions, #channels and :emoji:. Slack writes `*bold*` and `~strike~` (its mrkdwn), the others
// `**bold**`, `*italic*` and `~~strike~~` (Markdown). Links open only as http, https or mailto;
// any other scheme stays text. Pure functions, so the tests run them in Node.
import { SHORTCODES } from "./emoji.js";

/**
 * @typedef {{ t: "text", v: string } | { t: "br" } | { t: "code", v: string }
 *   | { t: "strong" | "em" | "del", c: Inline[] } | { t: "link", href: string, c: Inline[] }
 *   | { t: "mention", v: string, broad: boolean } | { t: "channel", v: string }
 *   | { t: "emoji", v: string, name: string }} Inline
 * @typedef {{ t: "p" | "quote", c: Inline[] } | { t: "pre", v: string, lang?: string }} Block
 * @typedef {"slack" | "markdown"} Dialect
 */

const SAFE = /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)$/i;
/** The URL when the plugin may open it (http, https, mailto), else undefined. */
export function safeHref(/** @type {string} */ url) {
  const trimmed = url.trim();
  return SAFE.test(trimmed) ? trimmed : undefined;
}

const BROAD = new Set(["here", "channel", "everyone"]);
const BARE_URL = /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)/i;
const ANGLE = /^<([^<>\s|][^<>|]*)(?:\|([^<>]*))?>/;
const MD_LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;
const MENTION = /^@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;
const CHANNEL = /^#([\p{L}][\p{L}\p{N}_-]*)/u;
const SHORTCODE = /^:([a-z0-9_+-]+):/;
const DISCORD_EMOJI = /^<a?:([A-Za-z0-9_]+):\d+>/;
const MAX_DEPTH = 4;

/** Slack escapes `&`, `<` and `>` in its text; everything else arrives as written. */
const unescaped = (/** @type {string} */ s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Whether position i starts a word: the start, or after a space or an opening mark. */
const atBoundary = (/** @type {string} */ s, /** @type {number} */ i) =>
  i === 0 || /[\s([{"'“‘>~*_]/.test(s.charAt(i - 1));
const wordy = (/** @type {string} */ ch) => /[\p{L}\p{N}]/u.test(ch);

/** A bare URL without the punctuation that ends the sentence around it. */
function trimUrl(/** @type {string} */ url) {
  let out = url;
  while (/[.,;:!?'"\]]$/.test(out) || (out.endsWith(")") && !out.includes("(")))
    out = out.slice(0, -1);
  return out;
}

/** The emphasis delimiters of a dialect: what each opens, longest first. */
const DELIMITERS = {
  slack: [
    ["*", "strong"],
    ["_", "em"],
    ["~", "del"],
  ],
  markdown: [
    ["**", "strong"],
    ["~~", "del"],
    ["*", "em"],
    ["_", "em"],
  ],
};

/**
 * Where an emphasis that opens at `i` with `mark` closes, or -1: the content is not empty, does not
 * start or end with a space, and `_` closes only before a non-letter (so snake_case stays text).
 */
function closing(/** @type {string} */ s, /** @type {number} */ i, /** @type {string} */ mark) {
  const from = i + mark.length;
  if (from >= s.length || /\s/.test(s.charAt(from))) return -1;
  let at = s.indexOf(mark, from + 1);
  while (at > 0) {
    const before = s.charAt(at - 1);
    const after = s.charAt(at + mark.length);
    // A single mark that is half of a double one (`**` inside `*...*`) does not close.
    const doubled = mark.length === 1 && (after === mark || before === mark);
    if (!/\s/.test(before) && !doubled && !(mark === "_" && wordy(after))) return at;
    at = s.indexOf(mark, at + 1);
  }
  return -1;
}

/**
 * The inline nodes of one line or run of text.
 * @param {string} s
 * @param {Dialect} dialect
 * @param {number} [depth]
 * @returns {Inline[]}
 */
export function inline(s, dialect = "markdown", depth = 0) {
  /** @type {Inline[]} */
  const out = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: dialect === "slack" ? unescaped(text) : text });
    text = "";
  };
  const push = (/** @type {Inline} */ node) => {
    flush();
    out.push(node);
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const ch = s.charAt(i);
    if (rest.startsWith("```")) {
      const end = s.indexOf("```", i + 3);
      if (end > i + 3) {
        push({ t: "code", v: s.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "<") {
      const custom = DISCORD_EMOJI.exec(rest);
      if (custom) {
        const name = /** @type {string} */ (custom[1]);
        push({ t: "emoji", v: SHORTCODES[name] ?? `:${name}:`, name });
        i += custom[0].length;
        continue;
      }
      const angle = ANGLE.exec(rest);
      if (angle) {
        const [whole, target = "", label] = angle;
        const node = angleNode(target, label);
        if (node) {
          push(node);
          i += whole.length;
          continue;
        }
      }
    }
    if (ch === "[") {
      const link = MD_LINK.exec(rest);
      const href = link ? safeHref(/** @type {string} */ (link[2])) : undefined;
      if (link && href) {
        const label = /** @type {string} */ (link[1]);
        push({
          t: "link",
          href,
          c: depth < MAX_DEPTH ? inline(label, dialect, depth + 1) : [{ t: "text", v: label }],
        });
        i += link[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H" || ch === "m" || ch === "M") && atBoundary(s, i)) {
      const bare = BARE_URL.exec(rest);
      if (bare) {
        const url = trimUrl(/** @type {string} */ (bare[1]));
        push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    if (ch === "@" && atBoundary(s, i)) {
      const mention = MENTION.exec(rest);
      if (mention) {
        const name = /** @type {string} */ (mention[1]).replace(/[.-]+$/, "");
        push({ t: "mention", v: name, broad: BROAD.has(name.toLowerCase()) });
        i += name.length + 1;
        continue;
      }
    }
    if (ch === "#" && atBoundary(s, i)) {
      const channel = CHANNEL.exec(rest);
      if (channel) {
        push({ t: "channel", v: /** @type {string} */ (channel[1]) });
        i += channel[0].length;
        continue;
      }
    }
    if (ch === ":" && !wordy(s.charAt(i - 1))) {
      const code = SHORTCODE.exec(rest);
      const name = code?.[1];
      if (code && name && SHORTCODES[name]) {
        push({ t: "emoji", v: SHORTCODES[name], name });
        i += code[0].length;
        continue;
      }
    }
    if (depth < MAX_DEPTH && atBoundary(s, i)) {
      const found = DELIMITERS[dialect].find(([mark]) =>
        rest.startsWith(/** @type {string} */ (mark)),
      );
      if (found) {
        const [mark = "", kind] = found;
        const end = closing(s, i, mark);
        if (end > 0) {
          const inner = inline(s.slice(i + mark.length, end), dialect, depth + 1);
          push(/** @type {Inline} */ ({ t: kind, c: inner }));
          i = end + mark.length;
          continue;
        }
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** A Slack-style `<target|label>`: a link, a user, a channel or a broad mention; else none. */
function angleNode(/** @type {string} */ target, /** @type {string | undefined} */ label) {
  const href = safeHref(target);
  if (href)
    return /** @type {Inline} */ ({ t: "link", href, c: [{ t: "text", v: label || target }] });
  if (target.startsWith("@")) {
    const name = (label || target.slice(1)).replace(/^@/, "");
    return /** @type {Inline} */ ({ t: "mention", v: name, broad: false });
  }
  if (target.startsWith("#")) {
    return /** @type {Inline} */ ({
      t: "channel",
      v: (label || target.slice(1)).replace(/^#/, ""),
    });
  }
  if (target.startsWith("!")) {
    const word = target.slice(1).split("^")[0] ?? "";
    if (BROAD.has(word)) return /** @type {Inline} */ ({ t: "mention", v: word, broad: true });
    if (label)
      return /** @type {Inline} */ ({ t: "mention", v: label.replace(/^@/, ""), broad: true });
  }
  return undefined;
}

const QUOTE = /^(>|&gt;) ?/;
const FENCE = "```";

/**
 * A message's text as blocks: fenced code as written, `>` lines as quotes, the rest as paragraphs
 * split at blank lines, with their line breaks kept.
 * @param {string} text
 * @param {Dialect} [dialect]
 * @returns {Block[]}
 */
export function parse(text, dialect = "markdown") {
  /** @type {Block[]} */
  const blocks = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {string[]} */
  let para = [];
  const paragraph = (/** @type {"p" | "quote"} */ t, /** @type {string[]} */ rows) => {
    /** @type {Inline[]} */
    const c = [];
    rows.forEach((row, n) => {
      if (n > 0) c.push({ t: "br" });
      c.push(...inline(row, dialect));
    });
    blocks.push({ t, c });
  };
  const endPara = () => {
    if (para.length > 0) paragraph("p", para);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = /** @type {string} */ (lines[i]);
    const at = line.indexOf(FENCE);
    const before = at >= 0 ? line.slice(0, at) : "";
    // "Look: ```" opens a block on the lines below; "use ```x``` here" stays inline code.
    const trailing = at > 0 && before.trim() !== "" && !line.slice(at + 3).includes(FENCE);
    if (at >= 0 && (before.trim() === "" || trailing)) {
      if (trailing) para.push(before.trimEnd());
      endPara();
      const after = line.slice(at + 3);
      const close = after.indexOf(FENCE);
      if (close >= 0) {
        blocks.push({ t: "pre", v: after.slice(0, close) });
        const tail = after.slice(close + 3).trim();
        if (tail) para.push(tail);
        continue;
      }
      const lang = /^[A-Za-z0-9_+-]+$/.test(after.trim()) ? after.trim() : "";
      /** @type {string[]} */
      const code = lang || after.trim() === "" ? [] : [after];
      let j = i + 1;
      while (j < lines.length && !(/** @type {string} */ (lines[j]).trimEnd().endsWith(FENCE))) {
        code.push(/** @type {string} */ (lines[j]));
        j++;
      }
      if (j < lines.length) {
        const last = /** @type {string} */ (lines[j]).trimEnd();
        if (last.length > FENCE.length) code.push(last.slice(0, -FENCE.length));
      }
      // An unclosed fence with nothing after it is a stray mark, not an empty block.
      if (code.length > 0 || j < lines.length)
        blocks.push({ t: "pre", v: code.join("\n"), ...(lang ? { lang } : {}) });
      i = j;
      continue;
    }
    if (QUOTE.test(line)) {
      endPara();
      /** @type {string[]} */
      const rows = [];
      while (i < lines.length && QUOTE.test(/** @type {string} */ (lines[i]))) {
        rows.push(/** @type {string} */ (lines[i]).replace(QUOTE, ""));
        i++;
      }
      i--;
      paragraph("quote", rows);
      continue;
    }
    if (line.trim() === "") endPara();
    else para.push(line);
  }
  endPara();
  return blocks;
}

/** The text of inline nodes as a person reads it aloud, without marks. @param {Inline[]} nodes */
export function plain(nodes) {
  return nodes
    .map((n) => {
      if (n.t === "text" || n.t === "code") return n.v;
      if (n.t === "br") return "\n";
      if (n.t === "mention") return `@${n.v}`;
      if (n.t === "channel") return `#${n.v}`;
      if (n.t === "emoji") return n.v;
      return plain(n.c);
    })
    .join("");
}
