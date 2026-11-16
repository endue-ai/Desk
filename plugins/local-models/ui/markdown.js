// Markdown as models write it, drawn as DOM nodes (never HTML from the text): headings, paragraphs,
// emphasis, inline code, links, lists with tasks, quotes, rules, tables and fenced code with its
// language, a copy button and colours. While an answer streams, an unclosed fence is drawn as code.
import { copyText, h, icon } from "./dom.js";
import { highlight } from "./highlight.js";

/**
 * @typedef {{ live?: boolean, onLink?: (url: string) => void }} Options
 * @typedef {{ type: "code", lang: string, text: string, open: boolean }
 *   | { type: "heading", level: number, text: string }
 *   | { type: "hr" }
 *   | { type: "quote", lines: string[] }
 *   | { type: "list", ordered: boolean, start: number, items: { text: string, task?: boolean, done?: boolean, sub: string[] }[] }
 *   | { type: "table", head: string[], align: string[], rows: string[][] }
 *   | { type: "para", text: string }
 *   | { type: "math", text: string }} Block
 */

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Split a table row into its cells. @param {string} line */
function cells(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** The text's blocks. @param {string} text @returns {Block[]} */
export function parseBlocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {Block[]} */
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(lines[i++]);
      const open = i >= lines.length;
      i++;
      out.push({ type: "code", lang: fence[3].toLowerCase(), text: body.join("\n"), open });
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ type: "math", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push({ type: "quote", lines: quote });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      );
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      out.push({ type: "table", head, align, rows });
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      const indent = item[1].length;
      const ordered = /\d/.test(item[2]);
      /** @type {{ text: string, task?: boolean, done?: boolean, sub: string[] }[]} */
      const items = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered) {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
          items.push({
            text: task ? task[2] : m[3],
            task: Boolean(task),
            done: task ? task[1] !== " " : undefined,
            sub: [],
          });
          i++;
          continue;
        }
        const last = items.at(-1);
        if (
          last &&
          lines[i].trim() &&
          /^\s+/.test(lines[i]) &&
          (lines[i].search(/\S/) > indent || m)
        ) {
          last.sub.push(lines[i].slice(Math.min(indent + 2, lines[i].search(/\S/))));
          i++;
          continue;
        }
        if (
          last &&
          !lines[i].trim() &&
          i + 1 < lines.length &&
          (LIST.exec(lines[i + 1])?.[1].length ?? -1) >= indent &&
          LIST.exec(lines[i + 1])
        ) {
          i++;
          continue;
        }
        break;
      }
      out.push({ type: "list", ordered, start: ordered ? Number.parseInt(item[2], 10) : 1, items });
      continue;
    }
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]) &&
      !LIST.exec(lines[i]) &&
      !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))
    )
      para.push(lines[i++]);
    out.push({ type: "para", text: para.join("\n") });
  }
  return out;
}

// One alternative per line (groups numbered in this order): code, bold twice, strike, italic twice,
// a link or image, an <autolink>, a bare link, inline math, a line break.
const INLINE = new RegExp(
  [
    /(`+)([\s\S]*?[^`])\1(?!`)/,
    /\*\*([\s\S]+?)\*\*/,
    /__([\s\S]+?)__/,
    /~~([\s\S]+?)~~/,
    /(?<![\w*])\*(?!\s)([\s\S]+?)(?<!\s)\*(?!\*)/,
    /(?<![\w_])_(?!\s)([\s\S]+?)(?<!\s)_(?![\w_])/,
    /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\x22[^\x22]*\x22)?\s*\)/,
    /<(https?:\/\/[^>\s]+)>/,
    /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?\x22\x27])/,
    /(?<![\w$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/,
    /(\n)/,
  ]
    .map((r) => r.source)
    .join("|"),
);

/** Inline markdown as nodes. @param {string} text @param {Options} o @returns {Node[]} */
export function inline(text, o = {}) {
  /** @type {Node[]} */
  const out = [];
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(document.createTextNode(unescapeMd(rest)));
      break;
    }
    if (m.index) out.push(document.createTextNode(unescapeMd(rest.slice(0, m.index))));
    rest = rest.slice(m.index + m[0].length);
    if (m[1]) out.push(h("code.lm-code-inline", null, m[2].replace(/^ (.*) $/, "$1")));
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push(h("strong", null, inline(m[3] ?? m[4], o)));
    else if (m[5] !== undefined) out.push(h("del", null, inline(m[5], o)));
    else if (m[6] !== undefined || m[7] !== undefined)
      out.push(h("em", null, inline(m[6] ?? m[7], o)));
    else if (m[9] !== undefined) out.push(link(m[9], m[8] || m[9], o));
    else if (m[10] !== undefined || m[11] !== undefined)
      out.push(link(m[10] ?? m[11], m[10] ?? m[11], o));
    else if (m[12] !== undefined) out.push(h("span.lm-math", null, m[12]));
    else if (m[13]) out.push(h("br"));
  }
  return out;
}

/** @param {string} text */
const unescapeMd = (text) => text.replace(/\\([\\`*_{}[\]()#+\-.!|~$>])/g, "$1");

/** A link: opened by the desk when the page may, otherwise shown with its address. @param {string} url @param {string} label @param {Options} o */
function link(url, label, o) {
  const safe = /^https?:\/\//i.test(url);
  if (!safe) return h("span.lm-link-text", null, label);
  return h(
    "a.lm-link",
    {
      href: url,
      title: url,
      onClick: (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        o.onLink?.(url);
      },
    },
    label,
  );
}

/** A fenced block: its language, a copy button, the coloured code. @param {Extract<Block, { type: "code" }>} b @param {Options} o */
function codeBlock(b, o) {
  const copy = h(
    "button.desk-btn.desk-btn-quiet.lm-code-copy",
    {
      type: "button",
      onClick: async (/** @type {MouseEvent} */ e) => {
        const button = /** @type {HTMLElement} */ (e.currentTarget);
        if (await copyText(b.text)) {
          button.replaceChildren(icon("check"), "Copied");
          setTimeout(() => button.replaceChildren(icon("copy"), "Copy"), 1400);
        }
      },
    },
    icon("copy"),
    "Copy",
  );
  const code = h("code", { dataset: { lang: b.lang || undefined } });
  code.append(...highlight(b.text, b.lang));
  return h(
    "figure.lm-code",
    { dataset: { open: b.open && o.live ? "1" : undefined } },
    h("figcaption.lm-code-head", null, h("span.lm-code-lang", null, b.lang || "text"), copy),
    h("pre", null, code),
  );
}

/** @param {Block} b @param {Options} o @returns {HTMLElement} */
function blockEl(b, o) {
  switch (b.type) {
    case "code":
      return codeBlock(b, o);
    case "math":
      return h("pre.lm-math-block", null, b.text);
    case "heading":
      return h(`h${Math.min(6, b.level + 1)}.lm-h`, null, inline(b.text, o));
    case "hr":
      return h("hr");
    case "quote": {
      const quote = h("blockquote");
      for (const inner of parseBlocks(b.lines.join("\n"))) quote.append(blockEl(inner, o));
      return quote;
    }
    case "table":
      return h(
        "div.lm-table-wrap",
        null,
        h(
          "table.lm-table",
          null,
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              b.head.map((c, i) =>
                h("th", { style: { "text-align": b.align[i] ?? "left" } }, inline(c, o)),
              ),
            ),
          ),
          h(
            "tbody",
            null,
            b.rows.map((row) =>
              h(
                "tr",
                null,
                b.head.map((_, i) =>
                  h(
                    "td",
                    { style: { "text-align": b.align[i] ?? "left" } },
                    inline(row[i] ?? "", o),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    case "list": {
      const list = h(
        b.ordered ? "ol" : "ul",
        b.ordered && b.start !== 1 ? { start: b.start } : null,
      );
      for (const item of b.items) {
        const li = h("li", {
          dataset: { task: item.task ? (item.done ? "done" : "todo") : undefined },
        });
        if (item.task)
          li.append(h("span.lm-task", { "aria-hidden": "true" }, item.done ? icon("check") : null));
        li.append(...inline(item.text, o));
        if (item.sub.length)
          for (const inner of parseBlocks(item.sub.join("\n"))) li.append(blockEl(inner, o));
        list.append(li);
      }
      return list;
    }
    default:
      return h("p", null, inline(b.text, o));
  }
}

/** Draw markdown into an element, replacing what it held. @param {HTMLElement} el @param {string} text @param {Options} [o] */
export function renderMarkdown(el, text, o = {}) {
  const blocks = parseBlocks(text);
  el.replaceChildren(...blocks.map((b) => blockEl(b, o)));
  el.classList.add("lm-md");
  if (o.live) el.lastElementChild?.classList.add("lm-tail");
  return el;
}
