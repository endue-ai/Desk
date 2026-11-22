// The Object and Defaults tabs of the privileges panel (PG-54): an object's owner and matrix, a row
// to add a grantee (or a grantee's column), Review and Discard, and for a table its row security
// and policies with their forms; then the default privileges per owner, schema and kind, each a
// matrix of its own.

import { el } from "../../dom.js";
import { changesOf, matrixOf } from "./acl.js";
import { objectMatrix } from "./changes.js";
import { DEFAULT_KINDS, defaultPrivilegesOf } from "./kinds.js";
import { matrixTable } from "./matrix.js";
import { defaultKey } from "./model.js";
import { button, said } from "./tabs.js";

/**
 * @typedef {import("./controller.js").PrivState} PrivState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Go
 */

const count = (/** @type {number} */ n) => (n === 1 ? "1 change" : `${n} changes`);

/** Add a grantee (or a grantee's column) to the matrix. */
function addRow(
  /** @type {Document} */ doc,
  /** @type {PrivState} */ s,
  /** @type {Go} */ go,
  /** @type {string[]} */ columns,
) {
  const names = ["PUBLIC", ...(s.roles?.roles.map((r) => r.name) ?? [])];
  const who = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      class: "desk-field",
      list: "privileges-grantees",
      placeholder: "reports",
      "aria-label": "Grantee",
      "data-focus": "grantee",
    })
  );
  const column = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", "aria-label": "Column" },
      el(doc, "option", { value: "" }, "The whole object"),
      ...columns.map((c) => el(doc, "option", { value: c }, c)),
    )
  );
  const add = () => who.value.trim() && go("privilegesAdd", who.value, column.value);
  who.addEventListener("keydown", (e) => e.key === "Enter" && add());
  return el(
    doc,
    "div",
    { class: "privileges-tools" },
    who,
    el(
      doc,
      "datalist",
      { id: "privileges-grantees" },
      ...names.map((n) => el(doc, "option", { value: n })),
    ),
    columns.length ? column : undefined,
    button(doc, "Add grantee", add, { "data-focus": "add" }),
  );
}

/** A table's row security and policies. */
function securityOf(/** @type {Document} */ doc, /** @type {PrivState} */ s, /** @type {Go} */ go) {
  const o = s.object;
  if (o.securityError) return said(doc, o.securityError, true);
  const sec = o.security;
  if (!sec) return undefined;
  const ro = s.conn.readOnly;
  const rows = sec.policies.map((/** @type {import("./model.js").Policy} */ p) =>
    el(
      doc,
      "tr",
      { "data-policy": p.name },
      el(doc, "th", { scope: "row" }, p.name),
      el(doc, "td", {}, p.command),
      el(doc, "td", {}, p.permissive ? "permissive" : "restrictive"),
      el(doc, "td", {}, p.roles.join(", ")),
      el(doc, "td", { class: "privileges-expr" }, p.using),
      el(doc, "td", { class: "privileges-expr" }, p.check),
      el(
        doc,
        "td",
        { class: "privileges-actions" },
        button(doc, "Change…", () => go("privilegesPolicy", p.name), {
          class: "desk-btn desk-btn-quiet",
          disabled: ro,
          "data-focus": `policy-${p.name}`,
        }),
        button(doc, "Drop…", () => go("privilegesDropPolicy", p.name), {
          class: "desk-btn desk-btn-quiet",
          disabled: ro,
        }),
      ),
    ),
  );
  return el(
    doc,
    "div",
    { class: "privileges-security" },
    el(doc, "h3", {}, "Row security"),
    el(
      doc,
      "div",
      { class: "privileges-tools" },
      el(
        doc,
        "span",
        {},
        sec.on
          ? sec.forced
            ? "On, forced on its owner too."
            : "On; its owner passes it."
          : "Off: every role with a privilege reaches every row.",
      ),
      button(doc, "Change…", () => go("privilegesRowSecurity"), {
        disabled: ro,
        "data-focus": "rls",
      }),
      button(doc, "New policy…", () => go("privilegesPolicy"), {
        disabled: ro,
        "data-focus": "new-policy",
      }),
    ),
    rows.length
      ? el(
          doc,
          "table",
          { class: "desk-table privileges-policies", "aria-label": "Policies" },
          el(
            doc,
            "thead",
            {},
            el(
              doc,
              "tr",
              {},
              ...["Policy", "For", "As", "To", "USING", "WITH CHECK", ""].map((c) =>
                el(doc, "th", { scope: "col" }, c),
              ),
            ),
          ),
          el(doc, "tbody", {}, ...rows),
        )
      : said(doc, sec.on ? "No policies: no role but its owner reaches a row." : "No policies."),
  );
}

/** The Object tab. */
export function objectTab(
  /** @type {Document} */ doc,
  /** @type {PrivState} */ s,
  /** @type {Go} */ go,
) {
  const top = el(
    doc,
    "div",
    { class: "privileges-tools" },
    button(doc, "Pick an object…", () => go("privilegesPick"), { "data-focus": "pick" }),
    button(doc, "This database", () => go("privilegesDatabase"), {
      class: "desk-btn desk-btn-quiet",
      "data-focus": "database",
    }),
  );
  const o = s.object;
  if (!s.target)
    return el(doc, "div", {}, top, said(doc, "Pick an object to see who may do what with it."));
  if (!o) return el(doc, "div", {}, top);
  if (o.error) return el(doc, "div", {}, top, said(doc, o.error, true));
  const matrix = /** @type {import("./acl.js").Matrix} */ (objectMatrix(s));
  const changes = changesOf(matrix, s.edits).length;
  const columns = s.target.kind === "function" || s.target.kind === "procedure" ? [] : o.acl.extra;
  const review = button(
    doc,
    changes ? `Review ${count(changes)}…` : "Review changes…",
    () => go("privilegesReview"),
    {
      class: "desk-btn desk-btn-primary",
      disabled: changes === 0 || s.conn.readOnly,
      "data-focus": "review",
    },
  );
  return el(
    doc,
    "div",
    {},
    top,
    el(
      doc,
      "h3",
      {},
      `${s.target.kind} ${s.target.schema && s.target.kind !== "schema" ? `${s.target.schema}.` : ""}${s.target.name}`,
    ),
    el(
      doc,
      "p",
      { class: "hint" },
      `Owned by ${o.acl.owner}, who may always grant, alter and drop it.${o.acl.defaults ? " Nothing was granted on it yet: these are PostgreSQL's defaults." : ""}`,
    ),
    o.note ? said(doc, o.note, true) : undefined,
    matrixTable(doc, matrix, s.edits, {
      label: `Privileges of ${s.target.name}`,
      press: (cell) => go("privilegesPress", cell),
      readOnly: s.conn.readOnly,
    }),
    s.conn.readOnly ? undefined : addRow(doc, s, go, columns),
    el(
      doc,
      "div",
      { class: "privileges-tools" },
      review,
      button(doc, "Discard", () => go("privilegesDiscard", "object"), {
        class: "desk-btn desk-btn-quiet",
        disabled: changes === 0 && s.extra.length === 0,
      }),
    ),
    s.target.kind === "table" ? securityOf(doc, s, go) : undefined,
  );
}

/** The Defaults tab. */
export function defaultsTab(
  /** @type {Document} */ doc,
  /** @type {PrivState} */ s,
  /** @type {Go} */ go,
) {
  const d = s.defaults;
  const version = s.probe?.version ?? 0;
  let changes = 0;
  const entries = (d?.entries ?? []).map((entry) => {
    const key = defaultKey(entry);
    const edits = s.defaultEdits[key] ?? {};
    const matrix = matrixOf(entry.entries, defaultPrivilegesOf(entry.letter, version), entry.owner);
    changes += changesOf(matrix, edits).length;
    const kind =
      DEFAULT_KINDS[/** @type {keyof typeof DEFAULT_KINDS} */ (entry.letter)]?.label ??
      entry.letter;
    const where = entry.schema ? `in schema ${entry.schema}` : "in every schema";
    return el(
      doc,
      "div",
      { class: "privileges-default", "data-entry": key },
      el(doc, "h3", {}, `New ${kind} made by ${entry.owner} ${where}`),
      matrixTable(doc, matrix, edits, {
        label: `Default privileges on ${kind} by ${entry.owner} ${where}`,
        press: (cell) => go("privilegesPress", { ...cell, entry: key }),
        readOnly: s.conn.readOnly,
      }),
    );
  });
  return el(
    doc,
    "div",
    {},
    el(
      doc,
      "div",
      { class: "privileges-tools" },
      button(doc, "New default privileges…", () => go("privilegesNewDefault"), {
        disabled: s.conn.readOnly,
        "data-focus": "new-default",
      }),
      button(
        doc,
        changes ? `Review ${count(changes)}…` : "Review changes…",
        () => go("privilegesReviewDefaults"),
        {
          class: "desk-btn desk-btn-primary",
          disabled: changes === 0 || s.conn.readOnly,
          "data-focus": "review-defaults",
        },
      ),
      button(doc, "Discard", () => go("privilegesDiscard", "defaults"), {
        class: "desk-btn desk-btn-quiet",
        disabled: changes === 0,
      }),
    ),
    d?.error ? said(doc, d.error, true) : undefined,
    d && !d.error && entries.length === 0
      ? said(
          doc,
          "No default privileges: new objects get PostgreSQL's (the owner has every privilege; PUBLIC may run functions and use types).",
        )
      : undefined,
    ...entries,
  );
}
