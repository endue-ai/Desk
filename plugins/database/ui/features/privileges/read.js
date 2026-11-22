// Reading a connection's privileges (PG-54) through deps.execute as the plugin's own reading (it
// asks nothing): the probe, then each section's statements in one run. A section whose catalog this
// role may not read is not asked for and says so; a statement that fails says the server's words in
// its section, and the statements after it run again in a run of their own. No DOM.

import { wordsOf } from "../activity/read.js";
import { roleViewOf } from "./effective.js";
import { kindOf, privilegesOf } from "./kinds.js";
import {
  defaultsOf,
  membershipsOf,
  objectAclOf,
  probeOf,
  rolesOf,
  rowSecurityOf,
} from "./model.js";
import { DEFAULTS, MEMBERSHIPS, objectSql, PROBE, policiesSql, ROLES, roleSql } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Probe} Probe
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {{ rows: (string | null)[][], error: string }} Got
 */

const MAX_ROWS = 5000;

/** Why a section is not read: the catalogs it needs that this role may not read, in words. */
export function cannotRead(
  /** @type {Probe} */ probe,
  /** @type {string[]} */ needs,
  /** @type {string} */ what,
) {
  const missing = needs.filter((c) => probe.cannot.includes(c));
  if (missing.length === 0) return "";
  return `${probe.user} may not read ${missing.join(" or ")}: ${what} cannot be shown.`;
}

/** @param {{ execute: import("../../catalog.js").Execute }} deps */
export function createReader(deps) {
  /** Each statement's rows or its failure; what follows a failure runs again on its own. */
  const many = async (/** @type {Connection} */ conn, /** @type {string[]} */ sqls) => {
    /** @type {Got[]} */
    const got = [];
    let rest = sqls;
    while (rest.length) {
      const { result } = await deps.execute(conn, rest.join(";\n"), {
        catalog: true,
        maxRows: MAX_ROWS,
      });
      if (result.error) throw new Error(wordsOf(result.error));
      const at = result.statements.findIndex((s) => s.error || !s.ran);
      const done = at < 0 ? result.statements : result.statements.slice(0, at);
      for (const s of done) got.push({ rows: s.sets[0]?.rows ?? [], error: "" });
      if (at < 0) break;
      const error = result.statements[at]?.error;
      got.push({ rows: [], error: error ? wordsOf(error) : "Not read." });
      rest = rest.slice(at + 1);
    }
    return got;
  };

  const probe = async (/** @type {Connection} */ conn) => {
    const [got] = await many(conn, [PROBE]);
    if (!got || got.error) throw new Error(got?.error || "Not read.");
    return probeOf(got.rows[0] ?? []);
  };

  /** The roles and their memberships. */
  const roles = async (/** @type {Connection} */ conn, /** @type {Probe} */ p) => {
    const noRoles = cannotRead(p, ["pg_roles"], "the roles");
    if (noRoles) return { roles: [], memberships: [], error: noRoles, membersError: "" };
    const noMembers = cannotRead(p, ["pg_auth_members"], "memberships");
    const [r, m] = await many(conn, noMembers ? [ROLES] : [ROLES, MEMBERSHIPS]);
    return {
      roles: rolesOf(r?.rows ?? []),
      memberships: membershipsOf(m?.rows ?? []),
      error: r?.error ?? "",
      membersError: noMembers || m?.error || "",
    };
  };

  /** An object's ACL and, for a table, its row security. */
  const object = async (
    /** @type {Connection} */ conn,
    /** @type {Probe} */ p,
    /** @type {Target} */ target,
  ) => {
    const row = kindOf(target.kind);
    if (!row) throw new Error(`A ${target.kind} has no privileges of its own.`);
    const blocked = cannotRead(p, [row.catalog], "its privileges");
    if (blocked) return { acl: null, error: blocked, security: null, securityError: "", note: "" };
    const columns = !p.cannot.includes("pg_attribute");
    const table = target.kind === "table";
    const noPolicies = table ? cannotRead(p, ["pg_policy"], "its row security policies") : "";
    const sqls = [
      objectSql(target, columns),
      ...(table && !noPolicies ? [policiesSql(target)] : []),
    ];
    const [a, s] = await many(conn, sqls);
    const acl = a && !a.error ? objectAclOf(a.rows) : null;
    const error = a?.error || (acl ? "" : `No ${target.kind} ${target.name} was found.`);
    return {
      acl,
      error,
      security: s && !s.error ? rowSecurityOf(s.rows) : null,
      securityError: noPolicies || s?.error || "",
      note: row.columns && !columns ? cannotRead(p, ["pg_attribute"], "column grants") : "",
      privileges: privilegesOf(target.kind, p.version),
    };
  };

  /** What a role may do. */
  const role = async (
    /** @type {Connection} */ conn,
    /** @type {Probe} */ p,
    /** @type {string} */ name,
  ) => {
    const blocked = cannotRead(p, ["pg_roles", "pg_auth_members"], "what it may do");
    if (blocked) return { view: null, error: blocked, note: "" };
    const can = new Set(p.can);
    const skipped = ["pg_class", "pg_namespace", "pg_proc", "pg_type", "pg_database"].filter(
      (c) => !can.has(c),
    );
    const [got] = await many(conn, [roleSql(name, can)]);
    if (!got || got.error) return { view: null, error: got?.error || "Not read.", note: "" };
    return {
      view: roleViewOf(name, got.rows),
      error: "",
      note: skipped.length ? cannotRead(p, skipped, "grants on what they hold") : "",
    };
  };

  /** The default privileges. */
  const defaults = async (/** @type {Connection} */ conn, /** @type {Probe} */ p) => {
    const blocked = cannotRead(p, ["pg_default_acl", "pg_namespace"], "default privileges");
    if (blocked) return { entries: [], error: blocked };
    const [got] = await many(conn, [DEFAULTS]);
    return { entries: defaultsOf(got?.rows ?? []), error: got?.error ?? "" };
  };

  return { probe, roles, object, role, defaults };
}
