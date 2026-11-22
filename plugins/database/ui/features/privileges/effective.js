// A role's view (PG-54): what it may do, explained. From roleSql's rows: the roles it inherits from
// and those it may only SET ROLE to, each with its path; every object it may use, each privilege
// with where it comes from (granted to it, to PUBLIC, or to a role it inherits, by which path), and
// what it owns; then what its attributes and PostgreSQL's predefined roles let it do beyond any
// grant. Pure.

/**
 * @typedef {(string | null)[]} Row
 * @typedef {import("./model.js").Role} Role
 * @typedef {{ role: string, path: string[], inherits: boolean, sets: boolean }} Reach
 * @typedef {{ privilege: string, grantable: boolean, path: string[], grantor: string }} Grant
 * @typedef {{ kind: string, schema: string, name: string, owner: string, owns: string[] | null, grants: Grant[] }} Reached
 * @typedef {{ role: string, reach: Reach[], objects: Reached[], total: number, listed: number, powers: string[] }} RoleView
 */

/** What PostgreSQL's predefined roles let a member do, beyond any grant. */
export const PREDEFINED = /** @type {Record<string, string>} */ ({
  pg_read_all_data: "may read every table, view and sequence (pg_read_all_data)",
  pg_write_all_data: "may write every table, view and sequence (pg_write_all_data)",
  pg_read_all_settings: "may read every setting (pg_read_all_settings)",
  pg_read_all_stats: "may read every statistics view (pg_read_all_stats)",
  pg_stat_scan_tables: "may run the functions that lock tables to scan them (pg_stat_scan_tables)",
  pg_monitor: "may read the server's monitoring views and settings (pg_monitor)",
  pg_signal_backend: "may cancel and end other sessions but superusers' (pg_signal_backend)",
  pg_read_server_files: "may read files on the server (pg_read_server_files)",
  pg_write_server_files: "may write files on the server (pg_write_server_files)",
  pg_execute_server_program: "may run programs on the server (pg_execute_server_program)",
  pg_checkpoint: "may run CHECKPOINT (pg_checkpoint)",
  pg_maintain: "may VACUUM, ANALYZE, REINDEX and more on every table (pg_maintain)",
  pg_use_reserved_connections: "may use the reserved connections (pg_use_reserved_connections)",
  pg_create_subscription: "may create subscriptions (pg_create_subscription)",
  pg_database_owner: "has what the database's owner has (pg_database_owner)",
});

const json = (/** @type {string | null | undefined} */ text) => {
  try {
    const value = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};
const yes = (/** @type {unknown} */ v) => v === "t" || v === "true";

/** Where a grant comes from, in words. */
export function throughWords(/** @type {string[]} */ path) {
  if (path[0] === "PUBLIC") return "to PUBLIC";
  if (path.length <= 1) return "directly";
  return `through ${path.at(-1)} (${path.join(" → ")})`;
}

/** What a role's attributes let it do. */
export function attributeWords(/** @type {Role | undefined} */ role) {
  if (!role) return [];
  return [
    ...(role.superuser ? ["is a superuser: every check passes, whatever is granted"] : []),
    ...(role.login ? [] : ["cannot log in (NOLOGIN): only roles that are its members use it"]),
    ...(role.createDb ? ["may create databases"] : []),
    ...(role.createRole ? ["may create, change and drop roles"] : []),
    ...(role.replication ? ["may connect for replication"] : []),
    ...(role.bypassRls ? ["passes every row security policy (BYPASSRLS)"] : []),
    ...(role.inherit ? [] : ["inherits nothing from the roles it joins (NOINHERIT)"]),
  ];
}

/**
 * The view of a role from its rows.
 * @param {string} role
 * @param {Row[]} rows
 * @returns {RoleView}
 */
export function roleViewOf(role, rows) {
  /** @type {Map<string, Reach>} */
  const reach = new Map();
  /** @type {Map<string, Reached>} */
  const objects = new Map();
  let total = 0;
  for (const r of rows) {
    total = Number(r[9] ?? total);
    const path = json(r[6]);
    if (r[0] === "member") {
      const name = r[3] ?? "";
      const known = reach.get(name);
      const inherits = yes(r[4]);
      const sets = yes(r[5]);
      if (!known || (inherits && !known.inherits) || path.length < known.path.length)
        reach.set(name, {
          role: name,
          path: known?.inherits && !inherits ? known.path : path,
          inherits: inherits || (known?.inherits ?? false),
          sets: sets || (known?.sets ?? false),
        });
      continue;
    }
    const key = `${r[1]}\u0000${r[2]}\u0000${r[3]}`;
    let object = objects.get(key);
    if (!object) {
      object = {
        kind: r[1] ?? "",
        schema: r[2] ?? "",
        name: r[3] ?? "",
        owner: r[8] ?? "",
        owns: null,
        grants: [],
      };
      objects.set(key, object);
    }
    if (r[0] === "owner") object.owns = path;
    else
      object.grants.push({
        privilege: r[4] ?? "",
        grantable: yes(r[5]),
        path,
        grantor: r[7] ?? "",
      });
  }
  const list = [...reach.values()].sort(
    (a, b) => a.path.length - b.path.length || a.role.localeCompare(b.role),
  );
  const powers = list
    .filter((m) => m.inherits && Object.hasOwn(PREDEFINED, m.role))
    .map((m) => PREDEFINED[m.role] ?? "");
  return { role, reach: list, objects: [...objects.values()], total, listed: rows.length, powers };
}

/** An object's privileges in one line: `SELECT, INSERT through readers (…); USAGE to PUBLIC`. */
export function grantsLine(/** @type {Reached} */ object) {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const g of object.grants) {
    const words = throughWords(g.path);
    by.set(words, [
      ...(by.get(words) ?? []),
      `${g.privilege}${g.grantable ? " (may grant it)" : ""}`,
    ]);
  }
  const parts = [...by].map(
    ([words, privileges]) => `${[...new Set(privileges)].join(", ")} ${words}`,
  );
  if (object.owns)
    parts.unshift(object.owns.length <= 1 ? "owns it" : `owns it ${throughWords(object.owns)}`);
  return parts.join("; ");
}
