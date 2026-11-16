// A response's body: Pretty (indented and coloured, with line numbers), Raw (as it came), and
// Preview (a page drawn in a sealed frame, an image as an image). Find highlights matches; Wrap
// folds long lines. Bodies past a size are shown plain, and binary ones are described, not drawn.

import { button, h, icon } from "./dom.js";
import { bytes, contentKind } from "./format.js";
import { paint, prettyJson, prettyXml, runs } from "./highlight.js";
import { bodyText } from "./send.js";

/** @typedef {import("./send.js").Response} Response */

const PLAIN_PAST = 2_000_000;

/** What a body is and how to draw it. @param {Response} res */
export function bodyInfo(res) {
  let kind = contentKind(res.contentType);
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

/** @param {Response} res @param {{ view: string, wrap: boolean, onView(view: string): void, onWrap(wrap: boolean): void, onSave(): void, onCopy(text: string): void }} opts */
export function responseBody(res, opts) {
  const { kind, text } = bodyInfo(res);
  const pretty =
    kind === "json" ? prettyJson(text) : kind === "xml" || kind === "html" ? prettyXml(text) : text;
  const views = [
    ["pretty", "Pretty"],
    ["raw", "Raw"],
    ...(kind === "html" || kind === "image" ? [["preview", "Preview"]] : []),
  ];
  const view = views.some(([v]) => v === opts.view)
    ? opts.view
    : kind === "image"
      ? "preview"
      : "pretty";
  const seg = h(
    "div.desk-tabs.as-seg",
    { role: "tablist" },
    ...views.map(([v, label]) =>
      h(
        `button.desk-tab${v === view ? ".is-selected" : ""}`,
        {
          type: "button",
          "aria-pressed": String(v === view),
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
  const bar = h(
    "div.as-res-bar",
    null,
    seg,
    h("span.as-kind", null, kind === "unknown" ? "text" : kind.toUpperCase()),
    h("span.as-grow"),
    view !== "preview" ? h("div.as-find-box", null, icon("search", 14), find, found) : null,
    button({
      label: "Wrap lines",
      icon: "wrap",
      hideLabel: true,
      kind: `as-wrap${opts.wrap ? ".is-on" : ""}`,
      onClick: () => opts.onWrap(!opts.wrap),
    }),
    button({
      label: "Copy body",
      icon: "copy",
      hideLabel: true,
      onClick: () => opts.onCopy(view === "pretty" ? pretty : text),
    }),
    button({
      label: "Save body to a file",
      icon: "download",
      hideLabel: true,
      onClick: opts.onSave,
    }),
  );

  /** @type {HTMLElement} */
  let content;
  if (kind === "binary" && view !== "preview") {
    content = h(
      "div.as-binary",
      null,
      icon("file", 28),
      h("p", null, `${bytes(res.size)} of binary data (${res.contentType || "no content type"}).`),
      h("p.as-hint", null, "Save it to a file to open it with another program."),
    );
  } else if (view === "preview" && kind === "image") {
    const url = URL.createObjectURL(
      new Blob([/** @type {BlobPart} */ (res.body)], { type: res.contentType }),
    );
    content = h("div.as-preview-image", null, h("img", { src: url, alt: "The response's image" }));
  } else if (view === "preview") {
    const frame = /** @type {HTMLIFrameElement} */ (
      h("iframe.as-preview-frame", {
        sandbox: "",
        title: "The response drawn as a page",
        referrerpolicy: "no-referrer",
      })
    );
    frame.srcdoc = text;
    content = h("div.as-preview", null, frame);
  } else {
    const shown = view === "pretty" ? pretty : text;
    const code = h("pre.as-code");
    const lines = shown.split("\n").length;
    const gutter = h(
      "div.as-gutter",
      { "aria-hidden": "true" },
      Array.from({ length: Math.min(lines, 20000) }, (_, i) => `${i + 1}`).join("\n"),
    );
    if (view === "pretty" && shown.length < PLAIN_PAST)
      paint(code, runs(shown, kind === "html" ? "html" : kind));
    else code.textContent = shown;
    content = h(`div.as-codebox${opts.wrap ? ".is-wrap" : ""}`, null, gutter, code);
    const base = /** @type {Element} */ (code.cloneNode(true));
    const restore = () =>
      code.replaceChildren(.../** @type {Element} */ (base.cloneNode(true)).childNodes);
    find.addEventListener("input", () => {
      const q = find.value;
      restore();
      if (!q) {
        found.textContent = "";
        return;
      }
      const n = mark(code, q);
      found.textContent = n ? `${n}` : "None";
      code.querySelector("mark")?.scrollIntoView({ block: "center" });
    });
  }
  return h("div.as-res-body", null, bar, content);
}

/** Mark every match of a text in an element's text nodes; returns how many. @param {Element} root @param {string} query */
function mark(root, query) {
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(/** @type {Text} */ (n));
  let count = 0;
  for (const node of nodes) {
    const text = node.data;
    const lower = text.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;
    const frag = document.createDocumentFragment();
    let from = 0;
    while (at >= 0 && count < 5000) {
      frag.append(text.slice(from, at), h("mark.as-hit", null, text.slice(at, at + query.length)));
      count++;
      from = at + query.length;
      at = lower.indexOf(needle, from);
    }
    frag.append(text.slice(from));
    node.replaceWith(frag);
  }
  return count;
}
