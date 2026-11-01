// The problems panel: parse errors and warnings with their line and column, and the JSON Schema's
// state (where the schema came from, or why there is none) with its errors. Every error is a
// button: a parse error scrolls the raw view to its line, a schema error selects its node.

import { CHECKED, nameOf } from "./schemas.js";

/**
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {import("./schema-check.js").SchemaState} SchemaState
 * @typedef {import("./schema.js").SchemaError} SchemaError
 * @typedef {{ line(line: number, col: number): void, node(error: SchemaError): void }} PanelHooks
 */

const MAX_LISTED = 200;
/** @type {Record<string, string>} */
const FROM = {
  picked: "picked with Validate with…",
  $schema: "named by $schema",
  comment: "named by the yaml-language-server comment",
  sibling: "next to the file",
};

/**
 * @param {Document} doc
 * @param {HTMLElement} el
 * @param {PanelHooks} hooks
 */
export function createPanel(doc, el, hooks) {
  /** @type {Opened | null} */
  let opened = null;
  /** @type {SchemaState | null} */
  let schema = null;

  const list = (
    /** @type {string} */ title,
    /** @type {Array<{ text: string, go(): void }>} */ items,
  ) => {
    const section = doc.createElement("section");
    const heading = doc.createElement("h2");
    heading.textContent = title;
    const ul = doc.createElement("ul");
    for (const item of items.slice(0, MAX_LISTED)) {
      const li = doc.createElement("li");
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = item.text;
      button.addEventListener("click", item.go);
      li.append(button);
      ul.append(li);
    }
    if (items.length > MAX_LISTED) {
      const li = doc.createElement("li");
      li.textContent = `and ${(items.length - MAX_LISTED).toLocaleString("en-US")} more`;
      ul.append(li);
    }
    section.append(heading, ul);
    return section;
  };

  const schemaText = (/** @type {SchemaState} */ s) => {
    const name = s.source ? nameOf(s.source) : "";
    const from = s.how ? ` (${FROM[s.how] ?? s.how})` : "";
    switch (s.state) {
      case "none":
        return "No JSON Schema for this file. Validate with… picks one.";
      case "loading":
        return `Checking against ${name}…`;
      case "valid":
        return `Matches the schema ${name}${from}.`;
      case "invalid":
        return `${s.errors.length === 1 ? "1 error" : `${s.errors.length} errors`} against the schema ${name}${from}.`;
      default:
        return s.note ?? "";
    }
  };

  const render = () => {
    const parts = [];
    const docErrors = opened?.doc?.errors ?? [];
    const warnings = opened?.doc?.warnings ?? [];
    const at = (/** @type {{ line: number, col: number, message: string }} */ e) => ({
      text: `Line ${e.line}, column ${e.col}: ${e.message}`,
      go: () => hooks.line(e.line, e.col),
    });
    if (docErrors.length > 0)
      parts.push(list(docErrors.length === 1 ? "Parse error" : "Parse errors", docErrors.map(at)));
    if (warnings.length > 0) parts.push(list("Warnings", warnings.map(at)));
    if (opened?.doc && CHECKED.has(opened.format) && schema) {
      const errors = schema.errors.map((e) => ({
        text: `${e.pointer || "(the root)"}: ${e.message} Line ${e.line}.`,
        go: () => hooks.node(e),
      }));
      const section = list("JSON Schema", errors);
      const state = doc.createElement("p");
      state.className = `schema-state ${schema.state}`;
      state.textContent = schemaText(schema);
      section.querySelector("h2")?.after(state);
      parts.push(section);
    }
    el.replaceChildren(...parts);
    el.hidden = parts.length === 0;
  };

  return {
    /** @param {Opened | null} next @param {SchemaState | null} state */
    show(next, state) {
      opened = next;
      schema = state;
      render();
    },
    /** @param {SchemaState} state */
    schema(state) {
      schema = state;
      render();
    },
  };
}
