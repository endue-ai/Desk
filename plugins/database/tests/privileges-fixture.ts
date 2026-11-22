// A scripted PostgreSQL server for the privileges panel (ui/features/privileges/): who reads and
// which catalogs it may read, the roles (app owns the shop, reports is a group that holds
// pg_read_all_data, ana logs in and is in reports), their memberships, the ACL of public.orders
// (its columns' too), of the schema and of the database, orders' row security and one policy, the
// default privileges, and a role's view; every GRANT, REVOKE, ALTER, CREATE and DROP is recorded and
// left to the rest of the page. A catalog named in `cannot` is refused as a real server refuses it.
// It answers on the stub's sessions (clients.ts scriptedDb); the unit tests and the runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node. Fixture data only.
import type { Answer, Script } from "./clients";

export interface PrivilegesServer {
  script: Script;
  /** Every change statement that ran, in order. */
  ran: string[];
  /** Catalogs this role may not read. */
  cannot: Set<string>;
}

const CATALOGS = [
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
];

// biome-ignore format: one role a line
const ROLES = [
  ["rolname", "rolsuper", "rolinherit", "rolcreaterole", "rolcreatedb", "rolcanlogin", "rolreplication", "rolbypassrls", "rolconnlimit", "rolvaliduntil"],
  ["ana", "f", "t", "f", "f", "t", "f", "f", "3", "2027-01-01 00:00:00+00"],
  ["app", "f", "t", "t", "t", "t", "f", "f", "-1", null],
  ["reports", "f", "t", "f", "f", "f", "f", "f", "-1", null],
];
// biome-ignore format: one membership a line
const MEMBERS = [
  ["role", "member", "admin", "inherit", "set", "grantor"],
  ["pg_read_all_data", "reports", "f", "t", "t", "app"],
  ["reports", "ana", "f", "t", "t", "app"],
];
const ORDERS_COLUMNS = '["id", "person", "total", "note"]';
// biome-ignore format: one ACL entry a line
const ACLS: Record<string, (string | null)[][]> = {
  "public.orders": [
    ["", "app", "SELECT", "f", "app", "app", "f", ORDERS_COLUMNS],
    ["", "app", "INSERT", "f", "app", "app", "f", ORDERS_COLUMNS],
    ["", "app", "UPDATE", "f", "app", "app", "f", ORDERS_COLUMNS],
    ["", "app", "DELETE", "f", "app", "app", "f", ORDERS_COLUMNS],
    ["", "reports", "SELECT", "t", "app", "app", "f", ORDERS_COLUMNS],
    ["", "ana", "INSERT", "f", "reports", "app", "f", ORDERS_COLUMNS],
    ["note", "ana", "UPDATE", "f", "app", null, null, null],
  ],
  "schema:public": [
    ["", "app", "USAGE", "f", "app", "app", "f", null],
    ["", "app", "CREATE", "f", "app", "app", "f", null],
    ["", "PUBLIC", "USAGE", "f", "app", "app", "f", null],
  ],
  database: [
    ["", "PUBLIC", "CONNECT", "f", "app", "app", "t", null],
    ["", "PUBLIC", "TEMPORARY", "f", "app", "app", "t", null],
    ["", "app", "CONNECT", "f", "app", "app", "t", null],
    ["", "app", "CREATE", "f", "app", "app", "t", null],
    ["", "app", "TEMPORARY", "f", "app", "app", "t", null],
  ],
};
const ACL_HEAD = [
  "col",
  "grantee",
  "privilege",
  "grantable",
  "grantor",
  "owner",
  "defaults",
  "extra",
];
// biome-ignore format: one row a line
const POLICIES = [
  ["relrowsecurity", "relforcerowsecurity", "polname", "polcmd", "polpermissive", "roles", "qual", "check"],
  ["t", "f", "own_rows", "r", "t", '["ana"]', "(person = 1)", null],
];
// biome-ignore format: one grant a line
const DEFAULTS = [
  ["owner", "schema", "kind", "grantee", "privilege", "grantable", "grantor"],
  ["app", "public", "r", "reports", "SELECT", "f", "app"],
];
// biome-ignore format: one row a line
const ANA = [
  ["what", "kind", "schema", "name", "privilege", "grantable", "path", "grantor", "owner", "count"],
  ["member", "", "", "reports", "t", "t", '["ana","reports"]', "", "", "6"],
  ["member", "", "", "pg_read_all_data", "t", "t", '["ana","reports","pg_read_all_data"]', "", "", "6"],
  ["grant", "database", "", "shop", "CONNECT", "f", '["PUBLIC"]', "app", "app", "6"],
  ["grant", "schema", "", "public", "USAGE", "f", '["PUBLIC"]', "app", "app", "6"],
  ["grant", "table", "public", "orders", "INSERT", "f", '["ana"]', "reports", "app", "6"],
  ["grant", "table", "public", "orders", "SELECT", "t", '["ana","reports"]', "app", "app", "6"],
];

const denied = (catalog: string): Answer => ({
  error: `permission denied for table ${catalog}`,
  code: "42501",
});

/** The object an ACL read names, by the condition it finds the row with. */
function aclKey(sql: string): string {
  if (sql.includes("x.datname = pg_catalog.current_database()")) return "database";
  const schema = /x\.nspname = '([^']*)'/u.exec(sql)?.[1];
  if (schema !== undefined) return `schema:${schema}`;
  const rel = /to_regclass\('"([^"]*)"\."([^"]*)"'\)/u.exec(sql);
  return rel ? `${rel[1]}.${rel[2]}` : "";
}

/** The scripted server; `other` answers every statement that is not the panel's. */
export function privilegesServer(other: Script = () => ({})): PrivilegesServer {
  const ran: string[] = [];
  const cannot = new Set<string>();
  const script: Script = (sql, who) => {
    if (!who.database) return other(sql, who);
    const text = sql.trim();
    if (
      text.startsWith("SELECT current_user::text, pg_catalog.current_setting('server_version_num')")
    )
      return {
        rows: [
          ["current_user", "version", "super", "db", ...CATALOGS],
          ["app", "170004", "off", "shop", ...CATALOGS.map((c) => String(!cannot.has(c)))],
        ],
      };
    if (text.includes("FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY 1 LIMIT 1000"))
      return cannot.has("pg_roles") ? denied("pg_roles") : { rows: ROLES };
    if (text.startsWith("SELECT g.rolname::text, u.rolname::text, m.admin_option"))
      return cannot.has("pg_auth_members") ? denied("pg_auth_members") : { rows: MEMBERS };
    if (text.startsWith("WITH o AS (SELECT x."))
      return { rows: [ACL_HEAD, ...(ACLS[aclKey(text)] ?? [])] };
    if (text.startsWith("SELECT x.relrowsecurity::text"))
      return aclKey(text) === "public.orders"
        ? { rows: POLICIES }
        : { rows: [POLICIES[0] ?? [], ["f", "f", null, null, null, null, null, null]] };
    if (text.includes("FROM pg_catalog.pg_default_acl d"))
      return cannot.has("pg_default_acl") ? denied("pg_default_acl") : { rows: DEFAULTS };
    if (text.startsWith("WITH RECURSIVE up(oid, path, inherits, sets)"))
      return { rows: text.includes("r.rolname = 'ana'") ? ANA : [ANA[0] ?? []] };
    if (/^(GRANT|REVOKE|ALTER|CREATE|DROP)\b/u.test(text)) {
      ran.push(text);
      return other(sql, who);
    }
    return other(sql, who);
  };
  return { script, ran, cannot };
}
