// What backup and restore share: the PostgreSQL connection they work on, the server's version (read
// as the plugin's own reading, which asks only for a password), the program checked against it,
// the grant of a path asked for once, and what a backup wrote measured. No DOM.

import { engineOf } from "../../engines/index.js";
import { errorText } from "../../tabs.js";
import { majorOf } from "./args.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../clients.js").Client} Client
 */

/** The PostgreSQL connections, as a form lists them. */
export const postgresOf = (/** @type {Deps} */ deps) =>
  deps.manager.list().filter((c) => c.engine === "postgresql");

/**
 * The connection named, else the one on screen, the only one, or one picked.
 * @param {Deps} deps
 * @param {unknown} ref
 * @param {string} title
 * @returns {Promise<Connection | undefined>}
 */
export async function choosePostgres(deps, ref, title) {
  const only = (/** @type {Connection} */ conn) => {
    if (conn.engine === "postgresql") return conn;
    throw new Error(
      `${conn.name} is ${engineOf(conn.engine).title}: pg_dump and pg_restore work on PostgreSQL.`,
    );
  };
  if (typeof ref === "string" && ref !== "") {
    const conn = deps.manager.get(ref);
    if (!conn) throw new Error(`No connection is named ${ref}.`);
    return only(conn);
  }
  const shown = deps.consoles.current();
  const here = shown ? deps.manager.get(shown.connection) : undefined;
  if (here?.engine === "postgresql") return here;
  const list = postgresOf(deps);
  if (list.length === 0)
    throw new Error("No PostgreSQL connection yet: add one with Database: new connection.");
  if (list.length === 1) return list[0];
  const items = list.map((c) => ({
    id: c.id,
    label: c.name,
    ...(c.tag !== "none" ? { detail: c.tag } : {}),
  }));
  const picked = await deps.pick(title, items);
  return picked ? deps.manager.get(picked) : undefined;
}

/** The server's version as server_version_num (170006); a failure is said in the server's words. */
export async function serverVersion(/** @type {Deps} */ deps, /** @type {Connection} */ conn) {
  const done = await deps.execute(conn, "SHOW server_version_num", { catalog: true });
  const error = done.result.error ?? done.result.statements[0]?.error;
  if (error) throw new Error(`Could not reach ${conn.name}: ${errorText(error)}`);
  const value = Number(done.result.statements[0]?.sets[0]?.rows[0]?.[0]);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${conn.name} did not say its version.`);
  return value;
}

/** "PostgreSQL 17" from 170006. */
export const release = (/** @type {number} */ version) =>
  `PostgreSQL ${Math.floor(version / 10000)}`;

/**
 * pg_dump or pg_restore, at least the server's major version; otherwise it says so, and how to fix
 * it, before anything runs.
 * @param {Deps} deps
 * @param {"pg_dump" | "pg_restore"} name
 * @param {Connection} conn
 * @param {number} server server_version_num
 * @returns {Promise<Client>}
 */
export async function programFor(deps, name, conn, server) {
  const program = await deps.clients.program(name);
  const need = Math.floor(server / 10000);
  if (majorOf(program.version) >= need) return program;
  const setting = name === "pg_dump" ? "endue.database.pg-dump" : "endue.database.pg-restore";
  throw new Error(
    `${program.command} ${program.version} is older than ${conn.name}'s server (${release(server)}): ${name} ${need} or newer is needed. Install it, or name it in the setting ${setting}.`,
  );
}

/**
 * Ask once for the grant of a path the program will write or read; a dialog's choice holds it, so
 * that is answered without a question.
 * @param {Pick<Deps, "bridge">} deps
 * @param {"fs:read" | "fs:write"} permission
 * @param {string} path
 * @param {string} reason
 */
export async function askPath(deps, permission, path, reason) {
  const decision = await deps.bridge
    .call("perm.request", { permission: { permission, paths: [path] }, reason })
    .catch(() => ({ granted: false }));
  if (!decision.granted)
    throw new Error(`Not allowed to ${permission === "fs:read" ? "read" : "write"} ${path}.`);
}

/** A size as the person reads it: `812 B`, `48 KiB`, `3.2 MiB`, `1.4 GiB`. */
export function sizeText(/** @type {number} */ bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${units[unit]}`;
}

/** What a backup wrote: a file's size, or the sum of a folder's files; undefined when unread. */
export async function sizeOf(/** @type {Pick<Deps, "bridge">} */ deps, /** @type {string} */ path) {
  const scope = { permission: /** @type {const} */ ("fs:read"), paths: [path] };
  const stat = await deps.bridge.call("fs.stat", { path, scope }).catch(() => undefined);
  if (!stat) return undefined;
  if (stat.kind !== "dir") return stat.size;
  const listed = await deps.bridge.call("fs.list", { path, scope }).catch(() => undefined);
  return listed?.entries.reduce((sum, e) => sum + (e.kind === "file" ? (e.size ?? 0) : 0), 0);
}

/** Where the password comes from, as the panel says it (never the password itself). */
export const passwordNote = (/** @type {string | undefined} */ password) =>
  password
    ? "The password typed this session goes in PGPASSWORD of the program's environment only."
    : "No password given: libpq reads ~/.pgpass, else the server must not ask for one.";

/** The last line of a path. */
export const fileName = (/** @type {string} */ path) =>
  path.replace(/\/+$/u, "").split("/").at(-1) ?? path;
