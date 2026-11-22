// The Roles and Role tabs of the privileges panel (PG-54): every role with its attributes, what it
// is a member of and who its members are, each with what it may do, Change… and Membership…; and
// one role's view: what its attributes and predefined roles let it do, the roles it inherits from
// or may only SET ROLE to, and every object it may use with where each privilege comes from.

import { el } from "../../dom.js";
import { attributeWords, grantsLine } from "./effective.js";
import { membersOf } from "./model.js";

/**
 * @typedef {import("./controller.js").PrivState} PrivState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Go
 */

/** A button that runs a panel action. */
export function button(
  /** @type {Document} */ doc,
  /** @type {string} */ text,
  /** @type {() => unknown} */ run,
  /** @type {Record<string, string | boolean | undefined>} */ attrs = {},
) {
  const b = el(doc, "button", { type: "button", class: "desk-btn", ...attrs }, text);
  b.addEventListener("click", () => run());
  return b;
}

/** A sentence in place of what could not be read or is not there. */
export const said = (/** @type {Document} */ doc, /** @type {string} */ text, alert = false) =>
  el(
    doc,
    "p",
    {
      class: alert ? "desk-callout privileges-said" : "hint privileges-said",
      ...(alert ? { role: "status" } : {}),
    },
    text,
  );

const YES = (/** @type {boolean} */ v) => (v ? "✓" : "");
const COLUMNS = [
  "Role",
  "Login",
  "Superuser",
  "Create DB",
  "Create role",
  "Replication",
  "Bypass RLS",
  "Inherit",
  "Limit",
  "Valid until",
  "Member of",
  "Members",
  "",
];

/** The Roles tab. */
export function rolesTab(
  /** @type {Document} */ doc,
  /** @type {PrivState} */ s,
  /** @type {Go} */ go,
) {
  const r = s.roles;
  const top = el(
    doc,
    "div",
    { class: "privileges-tools" },
    button(doc, "New role…", () => go("privilegesRole"), {
      "data-focus": "new-role",
      disabled: s.conn.readOnly,
    }),
  );
  if (!r) return el(doc, "div", {}, top);
  if (r.error) return el(doc, "div", {}, top, said(doc, r.error, true));
  const rows = r.roles.map((role) => {
    const { memberOf, members } = membersOf(r.memberships, role.name);
    return el(
      doc,
      "tr",
      { "data-role": role.name },
      el(doc, "th", { scope: "row" }, role.name),
      ...[
        role.login,
        role.superuser,
        role.createDb,
        role.createRole,
        role.replication,
        role.bypassRls,
        role.inherit,
      ].map((v) => el(doc, "td", { class: "privileges-flag" }, YES(v))),
      el(doc, "td", {}, role.limit < 0 ? "" : String(role.limit)),
      el(doc, "td", {}, role.until),
      el(doc, "td", {}, memberOf.join(", ")),
      el(doc, "td", {}, members.join(", ")),
      el(
        doc,
        "td",
        { class: "privileges-actions" },
        button(doc, "What it may do", () => go("privilegesShowRole", role.name), {
          class: "desk-btn desk-btn-quiet",
          "data-focus": `may-${role.name}`,
        }),
        button(doc, "Change…", () => go("privilegesRole", role.name), {
          class: "desk-btn desk-btn-quiet",
          "data-focus": `change-${role.name}`,
          disabled: s.conn.readOnly,
        }),
        button(doc, "Membership…", () => go("privilegesMembership", { member: role.name }), {
          class: "desk-btn desk-btn-quiet",
          "data-focus": `member-${role.name}`,
          disabled: s.conn.readOnly,
        }),
      ),
    );
  });
  return el(
    doc,
    "div",
    {},
    top,
    r.membersError ? said(doc, r.membersError, true) : undefined,
    el(
      doc,
      "div",
      { class: "privileges-matrix-wrap" },
      el(
        doc,
        "table",
        { class: "desk-table privileges-roles", "aria-label": "Roles" },
        el(
          doc,
          "thead",
          {},
          el(doc, "tr", {}, ...COLUMNS.map((c) => el(doc, "th", { scope: "col" }, c))),
        ),
        el(doc, "tbody", {}, ...rows),
      ),
    ),
    said(doc, "Passwords are never read. PostgreSQL's own pg_* roles are left out of the list."),
  );
}

/** The Role tab: what one role may do. */
export function roleTab(
  /** @type {Document} */ doc,
  /** @type {PrivState} */ s,
  /** @type {Go} */ go,
) {
  const names = s.roles?.roles.map((r) => r.name) ?? [];
  const select = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", "aria-label": "Role", "data-focus": "role-pick" },
      el(doc, "option", { value: "" }, "Pick a role"),
      ...names.map((n) => el(doc, "option", { value: n }, n)),
    )
  );
  select.value = s.role;
  select.addEventListener("change", () => select.value && go("privilegesShowRole", select.value));
  const top = el(doc, "div", { class: "privileges-tools" }, select);
  const v = s.view;
  if (!s.role || !v)
    return el(
      doc,
      "div",
      {},
      top,
      s.role ? undefined : said(doc, "Pick a role to see everything it may do and why."),
    );
  if (v.error || !v.view) return el(doc, "div", {}, top, said(doc, v.error || "Not read.", true));
  const view = v.view;
  const role = s.roles?.roles.find((r) => r.name === s.role);
  const powers = [...attributeWords(role), ...view.powers];
  const inherits = view.reach.filter((m) => m.inherits);
  const sets = view.reach.filter((m) => !m.inherits && m.sets);
  /** @type {Map<string, typeof view.objects>} */
  const byKind = new Map();
  for (const o of view.objects) byKind.set(o.kind, [...(byKind.get(o.kind) ?? []), o]);
  const list = (/** @type {string[]} */ items) =>
    el(doc, "ul", { class: "privileges-list" }, ...items.map((t) => el(doc, "li", {}, t)));
  return el(
    doc,
    "div",
    { class: "privileges-role" },
    top,
    v.note ? said(doc, v.note, true) : undefined,
    powers.length ? el(doc, "h3", {}, `What ${s.role} is`) : undefined,
    powers.length ? list(powers) : undefined,
    el(doc, "h3", {}, "Has the privileges of"),
    list([
      `PUBLIC, as every role does`,
      ...inherits.map((m) => `${m.role} (${m.path.join(" → ")})`),
    ]),
    sets.length ? el(doc, "h3", {}, "May SET ROLE to, without inheriting") : undefined,
    sets.length ? list(sets.map((m) => `${m.role} (${m.path.join(" → ")})`)) : undefined,
    el(doc, "h3", {}, "May use"),
    view.objects.length === 0
      ? said(doc, "Nothing is granted to it, to PUBLIC or to a role it inherits.")
      : undefined,
    view.objects.length
      ? el(
          doc,
          "table",
          { class: "desk-table privileges-reach", "aria-label": "May use" },
          el(
            doc,
            "thead",
            {},
            el(
              doc,
              "tr",
              {},
              el(doc, "th", { scope: "col" }, "Object"),
              el(doc, "th", { scope: "col" }, "What it may do, and why"),
            ),
          ),
          el(
            doc,
            "tbody",
            {},
            ...[...byKind].flatMap(([kind, objects]) =>
              objects.map((o) =>
                el(
                  doc,
                  "tr",
                  {},
                  el(
                    doc,
                    "th",
                    { scope: "row" },
                    `${kind} ${o.schema ? `${o.schema}.${o.name}` : o.name}`,
                  ),
                  el(doc, "td", {}, grantsLine(o)),
                ),
              ),
            ),
          ),
        )
      : undefined,
    view.total > view.listed
      ? said(doc, `${view.listed} of ${view.total} grants are listed.`)
      : undefined,
  );
}
