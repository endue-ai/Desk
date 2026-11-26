// The statements the privileges panel reads with (PG-54), each one statement over catalogs every
// role may read by default: first which of them this role may read (has_table_privilege), then the
// roles (pg_roles, never pg_authid nor a password column), the memberships, an object's ACL and its
// columns', a table's row security policies, the default privileges, and a role's view: every grant
// that reaches it through PUBLIC, itself or a membership it inherits, with the path. A NULL ACL is
// read as acldefault gives it; names come from pg_get_userbyid, which needs no catalog read. Pure.

import { quoteText } from "../../sql/quote.js";
import { t } from "../../strings/index.js";
import { kindOf, whereOf } from "./kinds.js";

/** @typedef {import("./kinds.js").Target} Target */

const lit = (/** @type {string} */ text) => quoteText("postgresql", text);
const who = (/** @type {string} */ oid) =>
  `CASE WHEN ${oid} = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(${oid})::text END`;
const user = (/** @type {string} */ alias) =>
  `${alias}.nspname !~ '^pg_' AND ${alias}.nspname <> 'information_schema'`;

/** The catalogs the reads use, in the order the probe asks for them. */
export const CATALOGS = /** @type {const} */ ([
  "pg_roles",
  "pg_auth_members",
  "pg_class",
  "pg_attribute",
  "pg_namespace",
  "pg_proc",
  "pg_type",
  "pg_database",
  "pg_default_acl",
  "pg_policy",
  "pg_language",
  "pg_foreign_data_wrapper",
  "pg_foreign_server",
  "pg_tablespace",
]);

/** Who reads, on which version, as a superuser or not, and which catalogs it may read. */
export const PROBE =
  "SELECT current_user::text, pg_catalog.current_setting('server_version_num'), " +
  "pg_catalog.current_setting('is_superuser'), pg_catalog.current_database()::text, " +
  CATALOGS.map((c) => `pg_catalog.has_table_privilege('pg_catalog.${c}', 'SELECT')::text`).join(
    ", ",
  );

/** The roles but PostgreSQL's own (`pg_*`), with their attributes; never a password. */
export const ROLES =
  "SELECT r.rolname::text, r.rolsuper::text, r.rolinherit::text, r.rolcreaterole::text, " +
  "r.rolcreatedb::text, r.rolcanlogin::text, r.rolreplication::text, r.rolbypassrls::text, " +
  "r.rolconnlimit::text, r.rolvaliduntil::text FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_' " +
  "ORDER BY 1 LIMIT 1000";

/** Each membership of a role in another (one row a grant): ADMIN, and 16's INHERIT and SET. */
export const MEMBERSHIPS =
  "SELECT g.rolname::text, u.rolname::text, m.admin_option::text, pg_catalog.to_jsonb(m) ->> " +
  "'inherit_option', pg_catalog.to_jsonb(m) ->> 'set_option', pg_catalog.pg_get_userbyid(m.grantor)::text " +
  "FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid JOIN " +
  "pg_catalog.pg_roles u ON u.oid = m.member WHERE u.rolname !~ '^pg_' ORDER BY 1, 2, 6 LIMIT 5000";

/**
 * An object's ACL entries (its owner and whether the ACL is the default), then its columns'
 * (`columns`: pg_attribute may be read). Each row: column ("" for the object), grantee, privilege,
 * grant option, grantor, owner, default, and `extra`: a relation's columns or a routine's name and
 * identity arguments, as JSON.
 */
export function objectSql(/** @type {Target} */ target, /** @type {boolean} */ columns) {
  const row = kindOf(target.kind);
  if (!row)
    throw new Error(
      t("features.privileges.sql.aHasNoPrivilegesOfIts", { kind: String(target.kind) }),
    );
  const where = whereOf(target);
  const relation = row.catalog === "pg_class";
  const extra = row.routine
    ? "pg_catalog.json_build_array(x.proname, pg_catalog.pg_get_function_identity_arguments(x.oid))::text"
    : relation && columns
      ? "(SELECT pg_catalog.json_agg(t.attname ORDER BY t.attnum) FROM pg_catalog.pg_attribute t WHERE " +
        "t.attrelid = x.oid AND t.attnum > 0 AND NOT t.attisdropped)::text"
      : "NULL::text";
  const own =
    `WITH o AS (SELECT x.${row.owner} AS owner, x.${row.acl} AS acl, ${extra} AS extra FROM ` +
    `pg_catalog.${row.catalog} x WHERE ${where}) SELECT ''::text AS col, ${who("a.grantee")}, ` +
    "a.privilege_type::text, a.is_grantable::text, pg_catalog.pg_get_userbyid(a.grantor)::text, " +
    "pg_catalog.pg_get_userbyid(o.owner)::text, (o.acl IS NULL)::text, o.extra FROM o LEFT JOIN " +
    `LATERAL pg_catalog.aclexplode(coalesce(o.acl, pg_catalog.acldefault('${row.letter}', o.owner))) a ON true`;
  if (!(row.columns && columns)) return `${own} ORDER BY 1, 2, 3`;
  return (
    `${own} UNION ALL SELECT t.attname::text, ${who("a.grantee")}, a.privilege_type::text, ` +
    "a.is_grantable::text, pg_catalog.pg_get_userbyid(a.grantor)::text, NULL, NULL, NULL FROM " +
    "pg_catalog.pg_attribute t CROSS JOIN LATERAL pg_catalog.aclexplode(t.attacl) a WHERE t.attrelid = " +
    `(SELECT x.oid FROM pg_catalog.pg_class x WHERE ${where}) AND t.attnum > 0 AND NOT t.attisdropped ` +
    "ORDER BY 1, 2, 3"
  );
}

/** A table's row security (on, forced) and its policies, one row a policy. */
export function policiesSql(/** @type {Target} */ target) {
  return (
    "SELECT x.relrowsecurity::text, x.relforcerowsecurity::text, p.polname::text, p.polcmd::text, " +
    "p.polpermissive::text, (SELECT pg_catalog.json_agg(s.n ORDER BY s.n) FROM (SELECT " +
    `${who("r")} AS n FROM pg_catalog.unnest(p.polroles) r) s)::text, ` +
    "pg_catalog.pg_get_expr(p.polqual, p.polrelid), pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) " +
    "FROM pg_catalog.pg_class x LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = x.oid WHERE " +
    `${whereOf(target)} ORDER BY 3`
  );
}

/** Every default privileges entry: owner, schema ("" for every schema), kind, then each grant. */
export const DEFAULTS =
  "SELECT pg_catalog.pg_get_userbyid(d.defaclrole)::text, coalesce(n.nspname::text, ''), " +
  `d.defaclobjtype::text, ${who("a.grantee")}, a.privilege_type::text, a.is_grantable::text, ` +
  "pg_catalog.pg_get_userbyid(a.grantor)::text FROM pg_catalog.pg_default_acl d LEFT JOIN " +
  "pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace LEFT JOIN LATERAL " +
  "pg_catalog.aclexplode(d.defaclacl) a ON true ORDER BY 1, 2, 3, 4, 5 LIMIT 5000";

/** The most grants a role's view lists; the rest are counted. */
export const LISTED = 2000;

/** The objects a role's view looks at, from the catalogs that may be read. */
function objectsOf(/** @type {ReadonlySet<string>} */ can) {
  const acl = (
    /** @type {string} */ col,
    /** @type {string} */ letter,
    /** @type {string} */ own,
  ) => `coalesce(${col}, pg_catalog.acldefault('${letter}', ${own}))`;
  /** @type {string[]} */
  const parts = [];
  const ns = can.has("pg_namespace");
  if (ns && can.has("pg_class"))
    parts.push(
      "SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN " +
        "'materialized view' WHEN 'f' THEN 'foreign table' ELSE 'table' END, n.nspname::text, " +
        `c.relname::text, c.relowner, ${acl("c.relacl", "r", "c.relowner")} FROM pg_catalog.pg_class c ` +
        "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'v', " +
        `'m', 'f') AND ${user("n")} UNION ALL SELECT 'sequence', n.nspname::text, c.relname::text, ` +
        `c.relowner, ${acl("c.relacl", "s", "c.relowner")} FROM pg_catalog.pg_class c JOIN ` +
        `pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND ${user("n")}`,
    );
  if (ns)
    parts.push(
      `SELECT 'schema', ''::text, n.nspname::text, n.nspowner, ${acl("n.nspacl", "n", "n.nspowner")} ` +
        `FROM pg_catalog.pg_namespace n WHERE ${user("n")}`,
    );
  if (ns && can.has("pg_proc"))
    parts.push(
      "SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, n.nspname::text, " +
        "p.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', " +
        `p.proowner, ${acl("p.proacl", "f", "p.proowner")} FROM pg_catalog.pg_proc p JOIN ` +
        "pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE p.prokind IN ('f', 'p') AND " +
        user("n"),
    );
  if (ns && can.has("pg_type"))
    parts.push(
      `SELECT 'type', n.nspname::text, t.typname::text, t.typowner, ${acl("t.typacl", "T", "t.typowner")} ` +
        "FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE " +
        `t.typtype IN ('d', 'e', 'r', 'm') AND ${user("n")}`,
    );
  if (can.has("pg_database"))
    parts.push(
      `SELECT 'database', '', d.datname::text, d.datdba, ${acl("d.datacl", "d", "d.datdba")} FROM ` +
        "pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()",
    );
  for (const [kind, catalog, p, letter] of [
    ["language", "pg_language", "lan", "l"],
    ["foreign data wrapper", "pg_foreign_data_wrapper", "fdw", "F"],
    ["foreign server", "pg_foreign_server", "srv", "S"],
    ["tablespace", "pg_tablespace", "spc", "t"],
  ])
    if (can.has(catalog))
      parts.push(
        `SELECT '${kind}', '', x.${p}name::text, x.${p}owner, ${acl(`x.${p}acl`, letter, `x.${p}owner`)} ` +
          `FROM pg_catalog.${catalog} x WHERE x.oid >= 16384`,
      );
  return parts;
}

/**
 * What a role may do: its memberships followed through INHERIT (16's inherit_option, else the
 * member's rolinherit) and SET, then every grant to PUBLIC, to it or to a role it inherits, and
 * what those own. Each row: what ("member", "grant", "owner"), kind, schema, name, privilege (a
 * member's: whether it inherits), grant option (a member's: whether it may SET ROLE), the path as
 * JSON, grantor, owner, and how many rows there are in all.
 * @param {string} role
 * @param {ReadonlySet<string>} can The catalogs that may be read.
 */
export function roleSql(role, can) {
  const objects = objectsOf(can);
  const up =
    "WITH RECURSIVE up(oid, path, inherits, sets) AS (SELECT r.oid, ARRAY[r.rolname::text], true, " +
    `true FROM pg_catalog.pg_roles r WHERE r.rolname = ${lit(role)} UNION ALL SELECT m.roleid, ` +
    "up.path || g.rolname::text, up.inherits AND coalesce((pg_catalog.to_jsonb(m) ->> " +
    "'inherit_option')::boolean, u.rolinherit), up.sets AND coalesce((pg_catalog.to_jsonb(m) ->> " +
    "'set_option')::boolean, true) FROM up JOIN pg_catalog.pg_auth_members m ON m.member = up.oid " +
    "JOIN pg_catalog.pg_roles g ON g.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member " +
    "WHERE g.rolname::text <> ALL (up.path) AND pg_catalog.cardinality(up.path) < 16), via(oid, " +
    "path) AS ((SELECT DISTINCT ON (oid) oid, path FROM up WHERE inherits ORDER BY oid, " +
    "pg_catalog.cardinality(path)) UNION ALL SELECT 0::oid, ARRAY['PUBLIC'])";
  const members =
    "SELECT 'member'::text AS what, ''::text AS kind, ''::text AS schema, " +
    "up.path[pg_catalog.cardinality(up.path)] AS name, up.inherits::text AS privilege, " +
    "up.sets::text AS grantable, pg_catalog.array_to_json(up.path)::text AS path, ''::text AS " +
    "grantor, ''::text AS owner FROM up WHERE pg_catalog.cardinality(up.path) > 1";
  const grants = objects.length
    ? ` UNION ALL SELECT 'grant', o.kind, o.schema, o.name, a.privilege_type::text, ` +
      "a.is_grantable::text, pg_catalog.array_to_json(v.path)::text, " +
      "pg_catalog.pg_get_userbyid(a.grantor)::text, pg_catalog.pg_get_userbyid(o.owner)::text FROM " +
      "obj o CROSS JOIN LATERAL pg_catalog.aclexplode(o.acl) a JOIN via v ON v.oid = a.grantee " +
      "UNION ALL SELECT 'owner', o.kind, o.schema, o.name, 'OWNER', 'true', " +
      "pg_catalog.array_to_json(v.path)::text, '', pg_catalog.pg_get_userbyid(o.owner)::text FROM " +
      "obj o JOIN via v ON v.oid = o.owner"
    : "";
  const obj = objects.length
    ? `, obj(kind, schema, name, owner, acl) AS (${objects.join(" UNION ALL ")})`
    : "";
  return (
    `${up}${obj} SELECT e.*, (pg_catalog.count(*) OVER ())::text FROM (${members}${grants}) e ` +
    `ORDER BY CASE e.what WHEN 'member' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, 2, 3, 4, 5 LIMIT ${LISTED}`
  );
}
