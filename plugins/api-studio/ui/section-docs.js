// The Docs section: Markdown about a request, folder or collection, written in an editor and read
// as a page, kept in the same file as the request so the docs travel with it.

import { codeEditor } from "./code-editor.js";
import { h, icon } from "./dom.js";
import { markdown } from "./markdown.js";
import { addSections } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

/** A docs editor with a Read/Write switch. @param {Studio} S @param {Tab} tab @param {{ minLines?: number }} [options] */
export function docsEditor(S, tab, options = {}) {
  let writing = tab.req.docs.trim() === "";
  const body = h("div.as-docs-body");
  const openLink = (/** @type {string} */ url) =>
    S.ctx.bridge
      .call("shell.open", { url, scope: { permission: "shell:open", schemes: ["http", "https"] } })
      .catch(() => S.app.toast("The desk could not open the link.", "error"));
  const toggle = h("div.desk-tabs.as-seg");
  /** @param {boolean} w */
  const show = (w) => () => {
    writing = w;
    draw(true);
  };
  const draw = (focus = false) => {
    toggle.replaceChildren(
      h(
        `button.desk-tab${writing ? "" : ".is-selected"}`,
        { type: "button", "aria-pressed": String(!writing), onClick: show(false) },
        icon("eye", 13),
        " Read",
      ),
      h(
        `button.desk-tab${writing ? ".is-selected" : ""}`,
        { type: "button", "aria-pressed": String(writing), onClick: show(true) },
        icon("edit", 13),
        " Write",
      ),
    );
    if (writing) {
      const ed = codeEditor({
        value: tab.req.docs,
        lang: "text",
        label: "Docs",
        minLines: options.minLines ?? 14,
        placeholder:
          "# What this does\n\nWhen to call it, what it needs, what comes back. Markdown.",
        onChange: (v) => {
          tab.req.docs = v;
          S.app.emit("req", { field: "docs" });
        },
      });
      body.replaceChildren(ed.el);
      if (focus) ed.focus();
    } else
      body.replaceChildren(
        tab.req.docs.trim()
          ? markdown(tab.req.docs, { openLink })
          : h("p.as-hint", null, "No docs yet."),
      );
  };
  draw();
  return h("div.as-docs", null, h("div.as-docs-bar", null, toggle), body);
}

addSections([
  {
    id: "docs",
    label: "Docs",
    badge: (tab) => tab.req.docs.trim() !== "",
    draw: (S, tab) => ({ el: h("div.as-section", null, docsEditor(S, tab)) }),
  },
]);
