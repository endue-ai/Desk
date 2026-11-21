// A statement's tokens as PostgreSQL's own scanner reads them (wasm.js, ADR 0292): each with its
// place, its class, whether it touched the token before it, and the comments attached to it. A
// comment on the line of the token before it trails that token; one on a line of its own leads the
// next token. Then the tokens as a bracket tree, `( )` and `[ ]` each a group of what is inside.
// Pure.
import { createPositions } from "../parse/positions.js";

/**
 * @typedef {import("../parse/wasm.js").RawToken} RawToken
 * @typedef {"keyword" | "ident" | "string" | "number" | "param" | "op" | "punct" | "comment"} Class
 * @typedef {{
 *   text: string, start: number, end: number, byte: number, class: Class, keyword: number,
 *   upper: string, touched: boolean, line: boolean, name: boolean, binary: boolean, out: string,
 *   lead: Comment[], trail: Comment[],
 * }} Token
 *   `start` and `end` are offsets in the statement's text, `byte` the UTF-8 byte it starts at;
 *   `touched`: no space between it and the token before; `line`: a new line before it; `name`: the
 *   grammar reads this keyword as a name (roles.js); `binary`: an operator between two operands;
 *   `out`: the text it is written as.
 * @typedef {{ text: string, block: boolean, own: boolean, after: boolean }} Comment
 *   `own`: on a line of its own (it leads the next token); `after`: a new line follows it.
 * @typedef {{ open: Token, close: Token | null, items: Item[] }} Paren
 * @typedef {Token | Paren} Item
 */

const PUNCT = new Set(["(", ")", "[", "]", ",", ";", ".", ":"]);
const STRING_START = /^(?:'|[EeBbXxNn]'|[Uu]&'|\$(?:[A-Za-z_][\w]*)?\$)/u;

/** The class of a scanner token. */
function classOf(/** @type {RawToken} */ raw) {
  if (raw.tokenName === "SQL_COMMENT" || raw.tokenName === "C_COMMENT") return "comment";
  if (raw.keywordKind > 0) return "keyword";
  if (raw.tokenName === "PARAM") return "param";
  if (raw.tokenName === "ICONST" || raw.tokenName === "FCONST") return "number";
  if (STRING_START.test(raw.text)) return "string";
  if (raw.tokenName === "IDENT" || /^(?:"|[Uu]&")/u.test(raw.text)) return "ident";
  if (PUNCT.has(raw.text)) return "punct";
  return "op";
}

/**
 * The significant tokens of `text` with their comments, from the scanner's tokens of that text.
 * @param {string} text
 * @param {RawToken[]} raw
 * @returns {Token[]}
 */
export function tokensOf(text, raw) {
  const positions = createPositions(text);
  /** @type {Token[]} */
  const tokens = [];
  /** @type {Comment[]} */
  let waiting = [];
  let last = 0;
  for (const r of raw) {
    const start = positions.at(r.start).offset;
    const end = positions.at(r.end).offset;
    const gap = text.slice(last, start);
    last = end;
    const kind = classOf(r);
    const line = gap.includes("\n");
    const previous = tokens[tokens.length - 1];
    if (kind === "comment") {
      const block = r.text.startsWith("/*");
      const comment = { text: text.slice(start, end), block, own: line || !previous, after: false };
      const before = waiting[waiting.length - 1];
      if (before && line) before.after = true;
      if (!comment.own && waiting.length === 0 && previous) previous.trail.push(comment);
      else waiting.push(comment);
      continue;
    }
    const before = waiting[waiting.length - 1];
    if (before && line) before.after = true;
    tokens.push({
      text: text.slice(start, end),
      start,
      end,
      byte: r.start,
      class: kind,
      keyword: r.keywordKind,
      upper: kind === "keyword" ? r.text.toUpperCase() : "",
      touched: gap === "" && tokens.length > 0 && waiting.length === 0,
      line,
      name: false,
      binary: false,
      out: text.slice(start, end),
      lead: waiting,
      trail: [],
    });
    waiting = [];
  }
  // Comments after the last token trail it.
  const final = tokens[tokens.length - 1];
  if (final) final.trail.push(...waiting.map((c) => ({ ...c, own: false })));
  return tokens;
}

/** Whether an item is a bracket group. */
export const isParen = (/** @type {Item | undefined} */ item) =>
  item !== undefined && "open" in item;

/**
 * The tokens as a bracket tree. A closing bracket without its opening one stays a token.
 * @param {Token[]} tokens
 * @returns {Item[]}
 */
export function bracketsOf(tokens) {
  /** @type {Item[]} */
  const root = [];
  /** @type {Array<{ paren: Paren, closer: string }>} */
  const open = [];
  const into = () => open[open.length - 1]?.paren.items ?? root;
  for (const token of tokens) {
    if (token.class === "punct" && (token.text === "(" || token.text === "[")) {
      const paren = { open: token, close: null, items: [] };
      into().push(paren);
      open.push({ paren, closer: token.text === "(" ? ")" : "]" });
    } else if (token.class === "punct" && token.text === open[open.length - 1]?.closer) {
      const done = /** @type {{ paren: Paren }} */ (open.pop());
      done.paren.close = token;
    } else into().push(token);
  }
  return root;
}

/** The first token of an item. */
export const firstOf = (/** @type {Item} */ item) => ("open" in item ? item.open : item);

/** The last token of an item. */
export const lastOf = (/** @type {Item} */ item) =>
  "open" in item ? (item.close ?? item.open) : item;
