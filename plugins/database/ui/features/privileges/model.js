// The privileges panel's reads as data (PG-54): who reads and what it may read (the probe), the
// roles with their attributes, members and memberships, an object's ACL entries, a table's row
// security and policies, and the default privileges per owner, schema and kind. The rows are those
// of sql.js's statements, text as the server sent it. Pure.

import { CATALOGS } from "./sql.js";

/**
 * @typedef {(string | null)[]} Row
 * @typedef {{ user: string, version: number, superuser: boolean, database: string, can: string[], cannot: string[] }} Probe
 * @typedef {{
 *   name: string, superuser: boolean, inherit: boolean, createRole: boolean, createDb: boolean,
 *   login: boolean, replication: boolean, bypassRls: boolean, limit: number, until: string,
 * }} Role
 * @typedef {{ role: string, member: string, admin: boolean, inherit: boolean | null, set: boolean | null, grantor: string }} Membership
 *   `inherit` and `set` are PostgreSQL 16's options, null before 16.
 * @typedef {{ name: string, command: string, permissive: boolean, roles: string[], using: string, check: string }} Policy
 * @typedef {{ on: boolean, forced: boolean, policies: Policy[] }} RowSecurity
 * @typedef {{ owner: string, schema: string, letter: string, entries: import("./acl.js").Entry[] }} DefaultEntry
 */

export const yes = (/** @type {unknown} */ v) => v === "t" || v === "true" || v === "on";

/** The probe's one row. */
export function probeOf(/** @type {Row} */ row) {
  const can = CATALOGS.filter((_, i) => yes(row[4 + i]));
  return /** @type {Probe} */ ({
    user: row[0] ?? "",
    version: Number(row[1] ?? 0),
    superuser: yes(row[2]),
    database: row[3] ?? "",
    can,
    cannot: CATALOGS.filter((c) => !can.includes(c)),
  });
}

/** The roles' rows. @returns {Role[]} */
export function rolesOf(/** @type {Row[]} */ rows) {
  return rows.map((r) => ({
    name: r[0] ?? "",
    superuser: yes(r[1]),
    inherit: yes(r[2]),
    createRole: yes(r[3]),
    createDb: yes(r[4]),
    login: yes(r[5]),
    replication: yes(r[6]),
    bypassRls: yes(r[7]),
    limit: Number(r[8] ?? -1),
    until: r[9] ?? "",
  }));
}

const option = (/** @type {string | null | undefined} */ v) =>
  v === null || v === undefined || v === "" ? null : yes(v);

/** The memberships' rows. @returns {Membership[]} */
export function membershipsOf(/** @type {Row[]} */ rows) {
  return rows.map((r) => ({
    role: r[0] ?? "",
    member: r[1] ?? "",
    admin: yes(r[2]),
    inherit: option(r[3]),
    set: option(r[4]),
    grantor: r[5] ?? "",
  }));
}

/** The roles a role is a member of, and its members, by name. */
export function membersOf(/** @type {Membership[]} */ list, /** @type {string} */ role) {
  const uniq = (/** @type {string[]} */ names) => [...new Set(names)].sort();
  return {
    memberOf: uniq(list.filter((m) => m.member === role).map((m) => m.role)),
    members: uniq(list.filter((m) => m.role === role).map((m) => m.member)),
  };
}

/**
 * An object's ACL rows: its owner, whether its ACL is the default, `extra` (a relation's columns,
 * or a routine's name and identity arguments), and every entry; null when no row names it.
 */
export function objectAclOf(/** @type {Row[]} */ rows) {
  const head = rows.find((r) => r[0] === "") ?? null;
  if (!head) return null;
  /** @type {unknown} */
  let extra = null;
  try {
    extra = head[7] ? JSON.parse(head[7]) : null;
  } catch {
    extra = null;
  }
  const entries = rows
    .filter((r) => r[1] !== null && r[1] !== undefined && r[2])
    .map((r) => ({
      grantee: r[1] ?? "",
      column: r[0] ?? "",
      privilege: r[2] ?? "",
      grantable: yes(r[3]),
      grantor: r[4] ?? "",
    }));
  const list = Array.isArray(extra) ? extra.map(String) : [];
  return {
    owner: head[5] ?? "",
    defaults: yes(head[6]),
    extra: list,
    entries,
  };
}

/** A table's row security and policies. @returns {RowSecurity | null} */
export function rowSecurityOf(/** @type {Row[]} */ rows) {
  const first = rows[0];
  if (!first) return null;
  const policies = rows
    .filter((r) => r[2])
    .map((r) => {
      /** @type {string[]} */
      let roles = [];
      try {
        roles = JSON.parse(r[5] ?? "[]") ?? [];
      } catch {
        roles = [];
      }
      return {
        name: r[2] ?? "",
        command: COMMANDS[/** @type {keyof typeof COMMANDS} */ (r[3] ?? "*")] ?? "ALL",
        permissive: yes(r[4]),
        roles,
        using: r[6] ?? "",
        check: r[7] ?? "",
      };
    });
  return { on: yes(first[0]), forced: yes(first[1]), policies };
}

/** pg_policy.polcmd's letters. */
const COMMANDS = { "*": "ALL", r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" };

/** The default privileges' rows, one entry per owner, schema and kind. @returns {DefaultEntry[]} */
export function defaultsOf(/** @type {Row[]} */ rows) {
  /** @type {Map<string, DefaultEntry>} */
  const by = new Map();
  for (const r of rows) {
    const key = `${r[0]}\u0000${r[1]}\u0000${r[2]}`;
    let entry = by.get(key);
    if (!entry) {
      entry = { owner: r[0] ?? "", schema: r[1] ?? "", letter: r[2] ?? "", entries: [] };
      by.set(key, entry);
    }
    if (r[3] && r[4])
      entry.entries.push({
        grantee: r[3],
        column: "",
        privilege: r[4],
        grantable: yes(r[5]),
        grantor: r[6] ?? "",
      });
  }
  return [...by.values()];
}

/** The key of a default privileges entry. */
export const defaultKey = (/** @type {Pick<DefaultEntry, "owner" | "schema" | "letter">} */ e) =>
  `${e.owner}\u0000${e.schema}\u0000${e.letter}`;
