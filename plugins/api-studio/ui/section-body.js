// The Body section: what kind of body the request sends (none, JSON, text, XML, a form, a
// multipart form, a file, or a GraphQL query with its variables) and its editor. JSON and XML can
// be tidied; JSON is checked as it is typed, {{variables}} allowed where a value goes.

import { codeEditor } from "./code-editor.js";
import { button, h, icon } from "./dom.js";
import { prettyJson, prettyXml } from "./highlight.js";
import { kvTable } from "./kv-table.js";
import { BODY_MODES } from "./model.js";
import { varField } from "./var-field.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

/** Whether JSON with {{variables}} parses once each one stands for a value. @param {string} text */
export function jsonProblem(text) {
  if (!text.trim()) return undefined;
  const stand = text.replace(/"[^"\n]*\{\{[^}]+\}\}[^"\n]*"|\{\{[^}]+\}\}/g, (m) =>
    m.startsWith('"') ? m : "0",
  );
  try {
    JSON.parse(stand);
    return undefined;
  } catch (error) {
    return String(/** @type {Error} */ (error).message).replace(/^JSON\.parse: /, "");
  }
}

/** @param {Studio} S @param {Tab} tab */
export function drawBody(S, tab) {
  const b = tab.req.body;
  const modes = h(
    "div.as-body-modes",
    { role: "radiogroup", "aria-label": "Body kind" },
    ...BODY_MODES.map(([mode, label]) =>
      h(
        `button.desk-tab.as-mode${b.mode === mode ? ".is-selected" : ""}`,
        {
          type: "button",
          role: "radio",
          "aria-checked": String(b.mode === mode),
          onClick: () => {
            b.mode = mode;
            S.app.emit("req", { field: "body" });
            root.replaceWith(drawBody(S, tab).el);
          },
        },
        label,
      ),
    ),
  );
  const tools = h("div.as-body-tools");
  const status = h("div.as-body-status");
  let editorEl = /** @type {HTMLElement} */ (h("div"));
  const changed = () => S.app.emit("req", { field: "body" });

  if (b.mode === "json" || b.mode === "text" || b.mode === "xml") {
    const lang = b.mode === "text" ? "text" : b.mode;
    const check = () => {
      const problem = b.mode === "json" ? jsonProblem(b.json) : undefined;
      status.replaceChildren(problem ? h("span.as-bad", null, icon("alert", 13), problem) : null);
    };
    const ed = codeEditor({
      value: b[b.mode],
      lang,
      label: "Body",
      minLines: 12,
      placeholder: b.mode === "json" ? '{\n  "name": "{{name}}"\n}' : "",
      scopes: () => S.scopes(tab),
      onChange: (v) => {
        b[/** @type {"json" | "text" | "xml"} */ (b.mode)] = v;
        check();
        changed();
      },
    });
    editorEl = ed.el;
    check();
    if (b.mode !== "text")
      tools.append(
        button({
          label: "Beautify",
          icon: "braces",
          kind: "desk-btn-quiet",
          onClick: () => {
            const mode = /** @type {"json" | "xml"} */ (b.mode);
            const next = mode === "json" ? prettyJsonKeepingVars(b.json) : prettyXml(b.xml);
            b[mode] = next;
            ed.set(next);
            check();
            changed();
          },
        }),
      );
  } else if (b.mode === "form" || b.mode === "multipart") {
    const multi = b.mode === "multipart";
    editorEl = kvTable({
      rows: multi ? b.multipart : b.form,
      scopes: () => S.scopes(tab),
      files: multi,
      title: multi ? "Parts" : "Fields",
      keyHint: "Add a field",
      onPickFile: () => S.pickFile(),
      onChange: (rows) => {
        if (multi) b.multipart = rows;
        else b.form = rows;
        changed();
      },
    }).el;
  } else if (b.mode === "file") {
    const path = varField({
      value: b.file,
      label: "File to send",
      placeholder: "~/Desktop/upload.bin",
      scopes: () => S.scopes(tab),
      onChange: (v) => {
        b.file = v;
        changed();
      },
    });
    editorEl = h(
      "div.as-file",
      null,
      h("p.as-hint", null, "The file's bytes are the body, as they are on disk."),
      h(
        "div.as-file-row",
        null,
        path.el,
        button({
          label: "Choose…",
          icon: "file",
          onClick: async () => {
            const chosen = await S.pickFile();
            if (!chosen) return;
            b.file = chosen;
            path.set(chosen);
            changed();
          },
        }),
      ),
    );
  } else if (b.mode === "graphql") {
    const query = codeEditor({
      value: b.graphql.query,
      lang: "text",
      label: "Query",
      minLines: 10,
      placeholder: "query {\n  users { id name }\n}",
      scopes: () => S.scopes(tab),
      onChange: (v) => {
        b.graphql.query = v;
        changed();
      },
    });
    const vars = codeEditor({
      value: b.graphql.variables,
      lang: "json",
      label: "Variables",
      minLines: 10,
      placeholder: '{ "first": 10 }',
      scopes: () => S.scopes(tab),
      onChange: (v) => {
        b.graphql.variables = v;
        changed();
      },
    });
    editorEl = h(
      "div.as-gql",
      null,
      h("div.as-gql-col", null, h("div.as-gql-label", null, "Query"), query.el),
      h("div.as-gql-col", null, h("div.as-gql-label", null, "Variables"), vars.el),
    );
  } else {
    editorEl = h(
      "div.as-empty-note",
      null,
      icon("info", 18),
      h("p", null, "This request sends no body."),
      h("p.as-hint", null, "Choose JSON, a form or another kind above to add one."),
    );
  }
  const root = h(
    "div.as-section.as-body",
    null,
    h("div.as-body-top", null, modes, tools),
    editorEl,
    status,
  );
  return { el: root };
}

/** Beautify JSON that may hold bare {{variables}} where values go. @param {string} text */
export function prettyJsonKeepingVars(text) {
  /** @type {string[]} */
  const held = [];
  const stand = text.replace(/(?<!")\{\{[^}]+\}\}(?!")/g, (m) => {
    held.push(m);
    return `"__as_var_${held.length - 1}__"`;
  });
  const pretty = prettyJson(stand);
  if (pretty === stand) return text;
  return pretty.replace(/"__as_var_(\d+)__"/g, (_, i) => held[Number(i)] ?? "");
}
