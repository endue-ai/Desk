// Markdown for a request's or folder's docs, drawn as DOM nodes (never as HTML from the text):
// headings, paragraphs, emphasis, inline and fenced code (coloured), lists, quotes, rules,
// tables, links (opened by the desk's browser) and {{variables}} marked as in fields.

import { h } from "./dom.js";
import { paint, runs } from "./highlight.js";

/** @typedef {{ openLink?(url: string): void }} MdOptions */

/** Inline text: `code`, **bold**, *italic*, [links](url), {{vars}}. @param {string} text @param {MdOptions} opts @returns {Node[]} */
export function inline(text, opts) {
  /** @type {Node[]} */
  const out = [];
  const re =
    /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)|(\{\{[^{}]+\}\})/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    if (m[1] !== undefined) out.push(h("code.md-code", null, m[1]));
    else if (m[2] !== undefined || m[3] !== undefined)
      out.push(h("strong", null, ...inline(m[2] ?? m[3] ?? "", opts)));
    else if (m[4] !== undefined || m[5] !== undefined)
      out.push(h("em", null, ...inline(m[4] ?? m[5] ?? "", opts)));
    else if (m[6] !== undefined) {
      const url = m[7] ?? "";
      const safe = /^https?:\/\//i.test(url);
      out.push(
        h(
          "a.md-link",
          {
            href: safe ? url : undefined,
            title: url,
            onClick: (/** @type {MouseEvent} */ e) => {
              e.preventDefault();
              if (safe) opts.openLink?.(url);
            },
          },
          m[6],
        ),
      );
    } else if (m[8] !== undefined) out.push(h("span.var.var-set", null, m[8]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

/** @param {string} line */
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** Markdown text as an element. @param {string} text @param {MdOptions} [opts] */
export function markdown(text, opts = {}) {
  const root = h("div.md");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) body.push(lines[i++]);
      i++;
      const pre = h("pre.md-pre");
      const lang = (fence[1] ?? "").toLowerCase();
      paint(pre, runs(body.join("\n"), lang === "javascript" ? "js" : lang));
      root.append(pre);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      root.append(
        h(
          `h${Math.min(4, (heading[1] ?? "#").length + 1)}.md-h`,
          null,
          ...inline(heading[2] ?? "", opts),
        ),
      );
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s1]*$/.test(line)) {
      root.append(h("hr.md-hr"));
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? ""))
        quote.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      root.append(h("blockquote.md-quote", null, markdown(quote.join("\n"), opts)));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? ""))
        rows.push(cells(lines[i++] ?? ""));
      root.append(
        h(
          "table.desk-table.md-table",
          null,
          h("thead", null, h("tr", null, ...head.map((c) => h("th", null, ...inline(c, opts))))),
          h(
            "tbody",
            null,
            ...rows.map((r) => h("tr", null, ...r.map((c) => h("td", null, ...inline(c, opts))))),
          ),
        ),
      );
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1] ?? "");
      const list = h(ordered ? "ol.md-list" : "ul.md-list");
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i] ?? "")) {
        const item = (lines[i++] ?? "").replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        list.append(
          task
            ? h(
                "li.md-task",
                null,
                h("span.md-box", null, task[1] === " " ? "☐" : "☑"),
                ...inline(task[2] ?? "", opts),
              )
            : h("li", null, ...inline(item, opts)),
        );
      }
      root.append(list);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,4}\s|```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i] ?? "")
    )
      para.push(lines[i++]);
    root.append(h("p.md-p", null, ...inline(para.join(" "), opts)));
  }
  return root;
}
