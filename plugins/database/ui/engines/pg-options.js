// A PostgreSQL connection's session options (PG-12, docs/session-options.md): the search path, a role,
// the time zone, the lock and idle-in-transaction timeouts, the application name, and a startup
// script. Each is a field of the connection kept only when set, checked here; the first six are the
// startup parameters every session of the connection signs in with (pg-session.js), the script the
// statements each one runs first (pg-startup.js), held to a console statement's guards on a read-only
// or production connection. A URI carries them as libpq does: `options` (`-c name=value`, a space in
// a value escaped with a backslash) and `application_name`. The search path and the role are also
// how the explorer, completion and the problems read a name without a schema. No DOM.

import { classify } from "../sql/classify.js";
import { split } from "../sql/split.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {"searchPath" | "role" | "timeZone" | "lockTimeout" | "idleTimeout" | "applicationName" | "startup"} Option
 */

/** Each option's field, its name in the form's words and on the server, and its longest value. */
const PARAMETERS = /** @type {const} */ ([
  ["searchPath", "Search path", "search_path", 1024],
  ["role", "Role", "role", 63],
  ["timeZone", "Time zone", "TimeZone", 64],
  ["lockTimeout", "Lock timeout", "lock_timeout", 32],
  ["idleTimeout", "Idle in transaction timeout", "idle_in_transaction_session_timeout", 32],
  ["applicationName", "Application name", "application_name", 63],
]);
const STARTUP_MAX = 8000;
/** The fields, in the form's order: a change to any closes the connection's sessions. */
export const OPTIONS = /** @type {Option[]} */ ([...PARAMETERS.map((p) => p[0]), "startup"]);
/** The server's own search path, when the connection sets none. */
export const DEFAULT_PATH = Object.freeze(["$user", "public"]);

const ZONE = /^[A-Za-z0-9_+\-/:.]+$/u;
const DURATION = /^(\d{1,9})\s*(us|ms|s|min|h|d)?$/u;
const PLAIN = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

/** The search path's names as written: plain or double-quoted, separated by commas; null if not. */
function pathItems(/** @type {string} */ text) {
  /** @type {string[]} */
  const items = [];
  const re = /\s*("(?:[^"]|"")+"|[^,"\s]+)\s*(,|$)/uy;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    const item = m?.[1] ?? "";
    if (!m || (!item.startsWith('"') && item !== "$user" && !PLAIN.test(item))) return null;
    items.push(item);
    at = re.lastIndex;
    if (m[2] === "," && at >= text.length) return null;
  }
  return items;
}

/** One option's value checked: one line, at most its length, and its own shape. */
function checked(
  /** @type {Option} */ key,
  /** @type {string} */ label,
  /** @type {unknown} */ value,
  max = 0,
) {
  if (typeof value !== "string") throw new Error(`${label}: text expected.`);
  if (/[\0]/u.test(value)) throw new Error(`${label}: no NUL characters.`);
  if (key === "startup") {
    if (value.length > STARTUP_MAX)
      throw new Error(`Startup script: at most ${STARTUP_MAX} characters.`);
    return value.trim();
  }
  if (/[\n\r]/u.test(value)) throw new Error(`${label}: one line, please.`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${label}: at most ${max} characters.`);
  if (!text) return text;
  if (key === "searchPath") {
    const items = pathItems(text);
    if (!items?.length)
      throw new Error(`${label}: schema names separated by commas, like app, public.`);
    return items.join(", ");
  }
  if (key === "timeZone" && !ZONE.test(text))
    throw new Error(`${label}: a zone name like UTC or Asia/Seoul, or an offset like +09:00.`);
  if (key === "lockTimeout" || key === "idleTimeout") {
    const m = DURATION.exec(text);
    if (!m) throw new Error(`${label}: milliseconds, or a number with ms, s, min, h or d.`);
    return `${m[1]}${m[2] ?? ""}`;
  }
  return text;
}

/**
 * The options a connection keeps, checked: only those set, and none but on PostgreSQL. The startup
 * script passes a console statement's guards: nothing a run may not send, no BEGIN or COMMIT, and
 * no write on a read-only or production connection, where no one confirms it at each sign-in.
 * @param {Record<string, unknown>} raw
 * @param {Connection} conn the connection's other fields, checked
 * @returns {Partial<Record<Option, string>>}
 */
export function optionsOf(raw, conn) {
  if (conn.engine !== "postgresql") return {};
  /** @type {Partial<Record<Option, string>>} */
  const out = {};
  for (const [key, label, , max] of PARAMETERS) {
    const value = raw[key] === undefined || raw[key] === null ? "" : raw[key];
    const text = checked(key, label, value, max);
    if (text) out[key] = text;
  }
  const script = checked("startup", "Startup script", raw.startup ?? "");
  if (script) {
    guard({ ...conn, startup: script });
    out.startup = script;
  }
  return out;
}

/** Throws the sentence why the startup script may not run on this connection. */
function guard(/** @type {Connection} */ conn) {
  startupStatements(conn).forEach((statement, i) => {
    const c = classify(statement, "postgresql");
    const at = `Startup script: statement ${i + 1}`;
    if (c.refused) throw new Error(`${at}: ${c.refused}`);
    if (c.kind === "transaction")
      throw new Error(`${at} (${c.verb}): each session runs the script outside a transaction.`);
    if (c.kind !== "write" && c.kind !== "ddl" && !c.opensWrite) return;
    const where = conn.readOnly
      ? "is read-only"
      : conn.tag === "production"
        ? "is tagged production"
        : "";
    if (where) throw new Error(`${at} (${c.verb}) may change data, and ${conn.name} ${where}.`);
  });
}

/** The statements each session of the connection runs first. @returns {Statement[]} */
export function startupStatements(/** @type {Connection} */ conn) {
  return conn.startup ? split(conn.startup, "postgresql") : [];
}

/** The startup parameters the options name, as PostgreSQL spells them. */
export function sessionSettings(/** @type {Connection} */ conn) {
  const fields = /** @type {Record<string, string | undefined>} */ (conn);
  /** @type {Record<string, string>} */
  const out = {};
  if (conn.engine !== "postgresql") return out;
  for (const [key, , name] of PARAMETERS) if (fields[key]) out[name] = String(fields[key]);
  return out;
}

/** The search path as the server walks it (a plain name folded to lower case) and who `$user` is. */
export function pathOf(/** @type {Connection} */ conn) {
  const items = conn.searchPath ? (pathItems(conn.searchPath) ?? []) : [];
  const searchPath = items.length
    ? items.map((s) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/gu, '"') : s.toLowerCase()))
    : [...DEFAULT_PATH];
  return { searchPath, user: conn.role || conn.user || "" };
}

/** What the header says of the options: the role and the search path, when the connection sets them. */
export function headerOf(/** @type {Connection | null} */ conn) {
  if (conn?.engine !== "postgresql") return "";
  return [conn.role ? `as ${conn.role}` : "", conn.searchPath ?? ""].filter(Boolean).join(" · ");
}

/** A URI's `options` and `application_name` as the fields; another setting is refused by name. */
export function readOptions(/** @type {URLSearchParams} */ query) {
  /** @type {Partial<Record<Option, string>>} */
  const out = {};
  const app = query.get("application_name");
  if (app !== null) out.applicationName = app;
  const words = (query.get("options") ?? "").match(/(?:\\.|\S)+/gu) ?? [];
  for (let i = 0; i < words.length; i++) {
    let word = /** @type {string} */ (words[i]);
    if (word === "-c") word = words[++i] ?? "";
    else if (word.startsWith("--")) word = word.slice(2);
    else if (word.startsWith("-c")) word = word.slice(2);
    else throw new Error(`options: ${word} is not a -c setting.`);
    const eq = word.indexOf("=");
    const name = (eq < 0 ? word : word.slice(0, eq)).toLowerCase().replace(/-/gu, "_");
    const value = word.slice(eq + 1).replace(/\\(.)/gu, "$1");
    const found = PARAMETERS.find((p) => p[2].toLowerCase() === name);
    if (eq < 0 || !found)
      throw new Error(`options: ${name} is not one of the connection's session options.`);
    out[found[0]] = value;
  }
  return out;
}

/** The options into a URI's query: `options` of `-c` settings, and `application_name`. */
export function writeOptions(
  /** @type {Connection} */ conn,
  /** @type {URLSearchParams} */ params,
) {
  const settings = sessionSettings(conn);
  const escaped = (/** @type {string} */ v) => v.replace(/[\\\s]/gu, (c) => `\\${c}`);
  const set = Object.entries(settings).filter(([name]) => name !== "application_name");
  if (set.length) params.set("options", set.map(([n, v]) => `-c ${n}=${escaped(v)}`).join(" "));
  if (settings.application_name) params.set("application_name", settings.application_name);
}
