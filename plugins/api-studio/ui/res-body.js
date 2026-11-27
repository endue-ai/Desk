// A response's body. JSON shows Pretty (indented, coloured, numbered), Tree (folding, each value
// with its path) and Raw, and a filter narrows it to a path ($.data[*].name); a page adds
// Preview (drawn in a sealed frame), an image shows as itself, an event stream as its events.
// Find marks matches; Wrap folds long lines. Large bodies draw plain; binary ones are described.

import { button, fill, h, icon } from "./dom.js";
import { asText, read } from "./expr.js";
import { bytes, contentKind } from "./format.js";
import { paint, prettyJson, prettyXml, runs } from "./highlight.js";
import { mark, parseEvents } from "./res-find.js";
import { jsonTree } from "./res-tree.js";
import { bodyText } from "./send.js";

/**
 * @typedef {import("./send.js").Response} Response
 * @typedef {{ view: string, wrap: boolean, filter: string, onView(view: string): void,
 *   onWrap(wrap: boolean): void, onFilter(filter: string): void, onSave(): void,
 *   onCopy(text: string, said?: string): void, onCapture?(path: string): void,
 *   onAssert?(path: string, value: unknown): void }} BodyOptions
 */

const PLAIN_PAST = 2_000_000;

/** What a body is and how to draw it. @param {Response} res */
export function bodyInfo(res) {
  let kind = contentKind(res.contentType);
  if (/event-stream/i.test(res.contentType)) kind = "events";
  const text = kind === "image" || kind === "binary" ? "" : bodyText(res);
  if (kind === "unknown" || kind === "text") {
    const t = text.trim();
    if (/^[[{]/.test(t)) {
      try {
        JSON.parse(t);
        kind = "json";
      } catch {
        /* text */
      }
    } else if (/^<(\?xml|!doctype html|html)/i.test(t)) kind = /^<\?xml/i.test(t) ? "xml" : "html";
    else if (kind === "unknown") kind = isBinary(res.body) ? "binary" : "text";
  }
  return { kind, text };
}

/** Whether bytes look binary: a NUL, or many control bytes in the first 4 KB. @param {Uint8Array} body */
function isBinary(body) {
  const head = body.subarray(0, 4096);
  let control = 0;
  for (const b of head) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return head.length > 0 && control / head.length > 0.1;
}

/** The views a kind of body offers, first the default. @param {string} kind */
export function viewsOf(kind) {
  if (kind === "json")
    return [
      ["pretty", "Pretty"],
      ["tree", "Tree"],
      ["raw", "Raw"],
    ];
  if (kind === "html")
    return [
      ["pretty", "Pretty"],
      ["preview", "Preview"],
      ["raw", "Raw"],
    ];
  if (kind === "image") return [["preview", "Preview"]];
  if (kind === "events")
    return [
      ["events", "Events"],
      ["raw", "Raw"],
    ];
  return [
    ["pretty", "Pretty"],
    ["raw", "Raw"],
  ];
}

/** Numbered, coloured (or plain) text. @param {string} shown @param {string} lang @param {boolean} wrap @param {boolean} colour */
function codeBox(shown, lang, wrap, colour) {
  const code = h("pre.as-code");
  const lines = shown.split("\n").length;
  const gutter = h(
    "div.as-gutter",
    { "aria-hidden": "true" },
    Array.from({ length: Math.min(lines, 20000) }, (_, i) => `${i + 1}`).join("\n"),
  );
  if (colour && shown.length < PLAIN_PAST) paint(code, runs(shown, lang));
  else code.textContent = shown;
  return { el: h(`div.as-codebox${wrap ? ".is-wrap" : ""}`, null, gutter, code), code };
}

/**
 * A page drawn as a picture: the HTML is parsed, stripped of what could run or fetch, and put in
 * an SVG image's foreignObject, which draws it with its own styles but runs no script and loads
 * nothing, and needs no frame (the desk allows plugins none).
 * @param {string} html
 */
export function pagePicture(html, width = 960, height = 1600) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, iframe, object, embed, link, meta, base, form"))
    el.remove();
  for (const el of doc.querySelectorAll("*"))
    for (const attr of [...el.attributes])
      if (/^on/i.test(attr.name) || /^(src|href|srcset|action)$/i.test(attr.name))
        el.removeAttribute(attr.name);
  const styles = [...doc.querySelectorAll("style")]
    .map((s) => new XMLSerializer().serializeToString(s))
    .join("");
  const body = doc.body
    ? [...doc.body.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join("")
    : "";
  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="page">${styles}${body}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

/** An event's data, as JSON when it is JSON. @param {string} data */
function eventData(data) {
  const pre = h("pre.as-event-data");
  const isJson = /^[[{]/.test(data.trim());
  paint(pre, runs(isJson ? prettyJson(data) : data, isJson ? "json" : "text"));
  return pre;
}

/** @param {Response} res @param {BodyOptions} opts */
export function responseBody(res, opts) {
  const { kind, text } = bodyInfo(res);
  const views = viewsOf(kind);
  const view = views.some(([v]) => v === opts.view) ? opts.view : (views[0]?.[0] ?? "raw");
  const json = kind === "json";
  const seg = h(
    "div.desk-tabs.as-seg",
    { role: "tablist" },
    ...views.map(([v, label]) =>
      h(
        `button.desk-tab${v === view ? ".is-selected" : ""}`,
        {
          type: "button",
          "aria-pressed": String(v === view),
          dataset: { view: v },
          onClick: () => opts.onView(v ?? "pretty"),
        },
        label,
      ),
    ),
  );
  const find = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-find", {
      type: "search",
      placeholder: "Find",
      "aria-label": "Find in body",
    })
  );
  const found = h("span.as-find-count");
  const filter = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-filter", {
      type: "text",
      value: opts.filter,
      placeholder: "Filter: $.data[*].name",
      "aria-label": "Filter by a path",
      spellcheck: "false",
    })
  );
  const filterNote = h("span.as-filter-note");
  const content = h("div.as-res-content");
  /** @type {ReturnType<typeof jsonTree> | undefined} */
  let tree;
  /** @type {HTMLElement | undefined} */
  let code;

  /** The value the views show: the whole body, or what the filter reads. */
  const value = () => {
    const parsed = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })();
    const q = filter.value.trim();
    if (!json || !q) return { value: parsed };
    try {
      const got = read(
        q.startsWith("$") || q.startsWith("res") ? q : `$.${q.replace(/^\./, "")}`,
        res,
      );
      return got === undefined
        ? { value: undefined, problem: "Nothing at that path" }
        : { value: got };
    } catch (error) {
      return { value: undefined, problem: String(/** @type {Error} */ (error).message) };
    }
  };

  const draw = () => {
    tree = undefined;
    code = undefined;
    if (kind === "binary") {
      fill(
        content,
        h(
          "div.as-binary",
          null,
          icon("file", 28),
          h(
            "p",
            null,
            `${bytes(res.size)} of binary data (${res.contentType || "no content type"}).`,
          ),
          h("p.as-hint", null, "Save it to a file to open it with another program."),
        ),
      );
      return;
    }
    if (kind === "image") {
      const url = URL.createObjectURL(
        new Blob([/** @type {BlobPart} */ (res.body)], { type: res.contentType }),
      );
      fill(
        content,
        h("div.as-preview-image", null, h("img", { src: url, alt: "The response's image" })),
      );
      return;
    }
    if (view === "preview") {
      fill(
        content,
        h(
          "div.as-preview",
          null,
          h("img.as-preview-page", { src: pagePicture(text), alt: "The response drawn as a page" }),
        ),
      );
      return;
    }
    if (view === "events") {
      const events = parseEvents(text);
      fill(
        content,
        h(
          "div.as-events",
          null,
          ...events.map((e, i) =>
            h(
              "div.as-event",
              null,
              h(
                "div.as-event-head",
                null,
                h("span.as-event-n", null, String(i + 1)),
                h("span.as-event-name", null, e.event),
                e.id ? h("span.as-hint", null, `id ${e.id}`) : null,
              ),
              eventData(e.data),
            ),
          ),
          events.length ? null : h("p.as-hint", null, "No events in the body."),
        ),
      );
      return;
    }
    const got = value();
    filterNote.textContent = got.problem ?? (filter.value.trim() ? "Filtered" : "");
    filterNote.classList.toggle("is-bad", !!got.problem);
    if (json && view === "tree") {
      if (got.value === undefined)
        return fill(content, h("p.as-res-note", null, got.problem ?? "Nothing to show."));
      tree = jsonTree(got.value, {
        onCopy: opts.onCopy,
        onCapture: opts.onCapture,
        onAssert: opts.onAssert,
      });
      fill(content, h(`div.as-treebox${opts.wrap ? ".is-wrap" : ""}`, null, tree.el));
      return;
    }
    const filtered = json && filter.value.trim() && view !== "raw";
    const shown =
      view === "raw"
        ? text
        : filtered
          ? got.value === undefined
            ? ""
            : JSON.stringify(got.value, null, 2)
          : json
            ? prettyJson(text)
            : kind === "xml" || kind === "html"
              ? prettyXml(text)
              : text;
    const box = codeBox(shown, kind === "html" ? "html" : kind, opts.wrap, view !== "raw");
    code = box.code;
    fill(content, box.el);
  };

  find.addEventListener("input", () => {
    if (!code) return;
    draw();
    const q = find.value;
    if (!q || !code) {
      found.textContent = "";
      return;
    }
    const n = mark(code, q);
    found.textContent = n ? `${n}` : "None";
    code.querySelector("mark")?.scrollIntoView({ block: "center" });
  });
  filter.addEventListener("input", () => {
    opts.onFilter(filter.value);
    draw();
  });

  const shownText = () => (code ? (code.textContent ?? "") : text);
  const bar = h(
    "div.as-res-bar",
    null,
    seg,
    h("span.as-kind", null, kind === "unknown" ? "TEXT" : kind.toUpperCase()),
    h("span.as-grow"),
    view === "tree"
      ? h(
          "div.as-tree-tools",
          null,
          button({
            label: "Expand",
            icon: "plus",
            kind: "desk-btn-quiet as-tree-btn",
            title: "Open every level",
            onClick: () => tree?.all(true),
          }),
          button({
            label: "Collapse",
            icon: "chevronRight",
            kind: "desk-btn-quiet as-tree-btn",
            title: "Close every level",
            onClick: () => tree?.all(false),
          }),
        )
      : view !== "preview" && view !== "events"
        ? h("div.as-find-box", null, icon("search", 14), find, found)
        : null,
    button({
      label: "Wrap lines",
      icon: "wrap",
      hideLabel: true,
      kind: `as-wrap${opts.wrap ? " is-on" : ""}`,
      onClick: () => opts.onWrap(!opts.wrap),
    }),
    button({
      label: "Copy body",
      icon: "copy",
      hideLabel: true,
      onClick: () =>
        opts.onCopy(view === "tree" ? asText(value().value) : shownText(), "Body copied"),
    }),
    button({
      label: "Save body to a file",
      icon: "download",
      hideLabel: true,
      onClick: opts.onSave,
    }),
  );
  draw();
  const filterRow =
    json && view !== "raw"
      ? h("div.as-filter-box", null, icon("filter", 14), filter, filterNote)
      : null;
  return h("div.as-res-body", null, bar, filterRow, content);
}
