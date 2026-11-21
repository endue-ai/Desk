// The server's roles and tablespaces (PG-50), in one small statement with the database level of a
// pass, never per schema. A role is read from pg_roles without its password (pg_authid is not read);
// predefined `pg_*` roles and the built-in tablespaces are left out. The fingerprint is an md5 of
// pg_roles' columns, since pg_authid's row versions cannot be read by most roles. Pure.

import { assemble, commentOn, ident, literal } from "./ddl.js";
import { countOf, described, digestOf, json } from "./sql.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {(string | null)[]} Row
 */

const ROLE_COLUMNS =
  "r.oid, r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, " +
  "r.rolreplication, r.rolbypassrls, r.rolconnlimit, r.rolvaliduntil";

// pg_auth_members' inherit_option and set_option (16 and later) through to_jsonb, on every version.
const ROLES =
  "SELECT '' AS nspname, 'role', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE '' END, " +
  "pg_catalog.json_build_object('super', r.rolsuper, 'inherit', r.rolinherit, 'createRole', " +
  "r.rolcreaterole, 'createDb', r.rolcreatedb, 'login', r.rolcanlogin, 'replication', " +
  "r.rolreplication, 'bypassRls', r.rolbypassrls, 'limit', r.rolconnlimit, 'until', " +
  "r.rolvaliduntil::text, 'in', (SELECT pg_catalog.json_agg(pg_catalog.json_build_array(g.rolname, " +
  "m.admin_option, pg_catalog.to_jsonb(m) ->> 'inherit_option', pg_catalog.to_jsonb(m) ->> " +
  "'set_option') ORDER BY g.rolname) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON " +
  "g.oid = m.roleid WHERE m.member = r.oid))::text, NULL, r.oid::text, d.description FROM " +
  `pg_catalog.pg_roles r ${described("pg_authid", "r.oid", "d", "pg_shdescription")} WHERE ` +
  "r.rolname !~ '^pg_'";

const TABLESPACES =
  "SELECT '', 'tablespace', t.spcname, pg_catalog.pg_tablespace_location(t.oid), " +
  "pg_catalog.json_build_object('location', pg_catalog.pg_tablespace_location(t.oid), 'options', " +
  "pg_catalog.to_json(t.spcoptions))::text, pg_catalog.pg_get_userbyid(t.spcowner), t.oid::text, " +
  `d.description FROM pg_catalog.pg_tablespace t ${described("pg_tablespace", "t.oid", "d", "pg_shdescription")} ` +
  "WHERE t.oid >= 16384";

/** @type {import("../../schema-cache/kinds.js").Kind} */
export const reader = {
  id: "server",
  label: "roles and tablespaces",
  level: "database",
  marks: [
    digestOf("pg_catalog.pg_roles r", `pg_catalog.concat_ws(':', ${ROLE_COLUMNS})`),
    countOf("pg_catalog.pg_auth_members x", "x"),
    countOf("pg_catalog.pg_tablespace x", "x"),
    countOf("pg_catalog.pg_shdescription x", "x"),
  ],
  sql: () => `${ROLES} UNION ALL ${TABLESPACES} ORDER BY 1, 2, 3`,
};

/** The server's roles and tablespaces from the reader's rows. */
export function objectsOf(/** @type {Row[]} */ rows) {
  return rows.map(
    ([kind, name, detail, extra, owner, oid, comment]) =>
      /** @type {SchemaObject} */ ({
        schema: "",
        name: name ?? "",
        kind: kind === "tablespace" ? "tablespace" : "role",
        detail: detail ?? "",
        rows: null,
        ident: oid ?? "",
        owner: owner ?? "",
        comment: comment ?? "",
        def: json(extra),
      }),
  );
}

const flag = (/** @type {unknown} */ on, /** @type {string} */ word) => (on ? word : `NO${word}`);

/** CREATE ROLE with its attributes and memberships, or CREATE TABLESPACE; never a password. */
export function ddl(/** @type {SchemaObject} */ object) {
  const def = /** @type {Record<string, any>} */ (object.def ?? {});
  const name = ident(object.name);
  if (object.kind === "tablespace") {
    const options = (Array.isArray(def.options) ? def.options : []).map(
      (/** @type {string} */ o) => {
        const at = o.indexOf("=");
        return `${ident(o.slice(0, at))} = ${literal(o.slice(at + 1))}`;
      },
    );
    const with_ = options.length ? ` WITH (${options.join(", ")})` : "";
    // A tablespace in place (pg_tblspc/<oid>, a developer setting) is made again with ''.
    const location = String(def.location ?? "");
    const inPlace = location.startsWith("pg_tblspc/");
    return assemble(
      object.owner,
      [
        ...(inPlace ? ["-- In place: SET allow_in_place_tablespaces = on first.\n"] : []),
        `CREATE TABLESPACE ${name} LOCATION ${literal(inPlace ? "" : location)}${with_};\n`,
      ],
      commentOn("TABLESPACE", name, object.comment),
    );
  }
  const attributes = [
    flag(def.super, "SUPERUSER"),
    flag(def.inherit, "INHERIT"),
    flag(def.createRole, "CREATEROLE"),
    flag(def.createDb, "CREATEDB"),
    flag(def.login, "LOGIN"),
    flag(def.replication, "REPLICATION"),
    flag(def.bypassRls, "BYPASSRLS"),
  ];
  if (Number(def.limit) >= 0) attributes.push(`CONNECTION LIMIT ${Number(def.limit)}`);
  if (def.until) attributes.push(`VALID UNTIL ${literal(def.until)}`);
  const grants = (def.in ?? []).map(
    (
      /** @type {[string, boolean, string | null, string | null]} */ [role, admin, inherit, set],
    ) => {
      const options = [
        ...(admin ? ["ADMIN TRUE"] : []),
        // A membership inherits as its role does unless it says otherwise (PostgreSQL 16+).
        ...(inherit === "false" && def.inherit ? ["INHERIT FALSE"] : []),
        ...(inherit === "true" && !def.inherit ? ["INHERIT TRUE"] : []),
        ...(set === "false" ? ["SET FALSE"] : []),
      ];
      const legacy = inherit === null && admin ? " WITH ADMIN OPTION" : "";
      const with_ = inherit !== null && options.length ? ` WITH ${options.join(", ")}` : legacy;
      return `GRANT ${ident(role)} TO ${name}${with_};\n`;
    },
  );
  return assemble(
    "",
    [`CREATE ROLE ${name} WITH ${attributes.join(" ")};\n`, ...grants],
    commentOn("ROLE", name, object.comment),
  );
}
