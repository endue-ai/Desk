// Snippets: templates with tab stops in the editor component's syntax (`${name}`, the same name
// edited together; Tab and Shift+Tab move between them). The built-in ones write common statements
// at a statement's start and CASE in an expression; the person's own come from the setting
// `endue.database.snippets` (name to template) and are offered in both places, one named like a
// built-in replacing it. Pure.

import { keyOf } from "./rank.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./rank.js").Item} Item
 * @typedef {{ name: string, template: string, where: "statement" | "expression" | "both", own?: boolean }} Snippet
 */

export const MAX_SNIPPETS = 100;
export const MAX_TEMPLATE = 4000;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/u;

const ID = {
  postgresql: "id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
  mysql: "id bigint AUTO_INCREMENT PRIMARY KEY",
  sqlite: "id INTEGER PRIMARY KEY",
};
const UPSERT = {
  postgresql: "ON CONFLICT (${key}) DO UPDATE SET ${column} = excluded.${column}",
  mysql: "ON DUPLICATE KEY UPDATE ${column} = VALUES(${column})",
  sqlite: "ON CONFLICT (${key}) DO UPDATE SET ${column} = excluded.${column}",
};

/** The built-in snippets of a dialect. @returns {Snippet[]} */
function builtins(/** @type {Dialect} */ dialect) {
  /** @type {Array<[string, string, Snippet["where"]]>} */
  const list = [
    ["sel", "SELECT ${columns}\nFROM ${table}\nWHERE ${condition}", "statement"],
    ["selc", "SELECT count(*)\nFROM ${table}\nWHERE ${condition}", "statement"],
    ["ins", "INSERT INTO ${table} (${columns})\nVALUES (${values})", "statement"],
    ["upd", "UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition}", "statement"],
    ["del", "DELETE FROM ${table}\nWHERE ${condition}", "statement"],
    [
      "upsert",
      `INSERT INTO \${table} (\${columns})\nVALUES (\${values})\n${UPSERT[dialect]}`,
      "statement",
    ],
    ["with", "WITH ${name} AS (\n  ${query}\n)\nSELECT ${columns}\nFROM ${name}", "statement"],
    ["ctab", `CREATE TABLE \${name} (\n  ${ID[dialect]},\n  \${column} \${type}\n)`, "statement"],
    ["idx", "CREATE INDEX ${name} ON ${table} (${column})", "statement"],
    ["txn", "BEGIN;\n${statements}\nCOMMIT;", "statement"],
    ["case", "CASE WHEN ${condition} THEN ${result} ELSE ${otherwise} END", "expression"],
  ];
  return list.map(([name, template, where]) => ({ name, template, where }));
}

/**
 * The person's snippets from the setting's value: an object of name to template. A name of letters,
 * digits and `_`, a template of at most MAX_TEMPLATE characters, MAX_SNIPPETS at most; the rest is
 * left out.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export function ownSnippets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, template] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_SNIPPETS) break;
    if (!NAME.test(name) || typeof template !== "string") continue;
    if (template.trim() === "" || template.length > MAX_TEMPLATE) continue;
    out[name] = template;
  }
  return out;
}

/** The built-in snippets with the person's over them. @returns {Snippet[]} */
export function snippetsOf(/** @type {Dialect} */ dialect, /** @type {unknown} */ own = {}) {
  const mine = ownSnippets(own);
  const kept = builtins(dialect).filter((s) => !Object.hasOwn(mine, s.name));
  return [
    ...kept,
    ...Object.entries(mine).map(([name, template]) => ({
      name,
      template,
      where: /** @type {const} */ ("both"),
      own: true,
    })),
  ];
}

/** A template as the text it writes, its tab stops by their names, on one line. */
export function preview(/** @type {string} */ template) {
  return template
    .replace(/[$#]\{(?:\d+:)?((?:\\[{}]|[^}])*)\}/gu, "$1")
    .replace(/\\([{}])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The snippets a place takes: statement ones where a statement starts, expression ones in an
 * expression, nowhere else.
 * @param {Snippet[]} snippets
 * @param {string} place "statement", "expression" or "none"
 * @returns {Item[]}
 */
export function snippetItems(snippets, place) {
  if (place !== "statement" && place !== "expression") return [];
  return snippets
    .filter((s) => s.where === "both" || s.where === place)
    .map((s) => {
      const text = preview(s.template);
      return {
        label: s.name,
        kind: /** @type {const} */ ("snippet"),
        detail: text.length > 40 ? `${text.slice(0, 39)}…` : text,
        info: s.own ? `Your snippet: ${text}` : text,
        insert: s.template,
        snippet: true,
        key: keyOf("snippet", s.name),
      };
    });
}

/** A text as a template's literal part: braces escaped, so none starts a tab stop. */
export const literal = (/** @type {string} */ text) => text.replace(/[{}]/gu, "\\$&");
