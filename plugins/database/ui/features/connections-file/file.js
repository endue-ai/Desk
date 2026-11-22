// The connections file (PG-15, ADR 0332): what an export writes and an import reads. JSON with a
// format name and a version; each connection carries the fields a connection is made of and nothing
// else, so no password, passphrase or keychain entry can be in it. Reading checks every entry as the
// form does and refuses the whole file with the field named; a pg_service.conf is read by service.js.
// Nothing in a file is ever run: a connection's session options travel, its startup script does not
// (PG-12), so a file never brings statements that run at each sign-in. No DOM.

import { blank, newId, normalize } from "../../connections.js";
import { OPTIONS } from "../../engines/pg-options.js";
import { looksLikeService, readService } from "./service.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ conn: Connection, notes: string[] }} Entry
 *   `notes` say what of the entry was left out (a service file's password, its other keys).
 * @typedef {{ kind: "connections" | "service", version: number, exported: string, entries: Entry[] }} Read
 */

export const FORMAT = "endue.database.connections";
export const VERSION = 1;
/** The most a file may hold: far past the store's 64 KiB of connections. */
export const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 1000;
/** A field named like a secret: never written, and a file that has one is refused. */
export const SECRET = /pass|secret|token|credential/iu;
const ID = /^[a-z0-9-]{1,40}$/u;

/** The session options a file carries when a connection sets them: all but the startup script. */
const OPTIONAL = OPTIONS.filter((key) => key !== "startup");
/** The fields the file carries: those a connection is made of, never a secret's. */
export const FIELDS = [...Object.keys(blank()).filter((key) => !SECRET.test(key)), ...OPTIONAL];

/** The connection as the file holds it: its fields, in their order, without the keychain choice. */
export function entryOf(/** @type {Connection} */ conn) {
  const base = /** @type {Record<string, unknown>} */ (blank(conn.engine));
  const fields = /** @type {Record<string, unknown>} */ (conn);
  const set = FIELDS.filter((key) => !OPTIONAL.includes(/** @type {never} */ (key)) || fields[key]);
  return Object.fromEntries(set.map((key) => [key, fields[key] ?? base[key]]));
}

/** The file's text for these connections. */
export function fileText(/** @type {Connection[]} */ conns, at = new Date()) {
  const file = {
    format: FORMAT,
    version: VERSION,
    exported: at.toISOString(),
    connections: conns.map(entryOf),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const isObject = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** One entry of a connections file checked, or an Error that names the entry and the field. */
function entryFrom(
  /** @type {unknown} */ raw,
  /** @type {number} */ n,
  /** @type {Connection[]} */ before,
  /** @type {() => number} */ random,
) {
  const named = isObject(raw) && typeof (/** @type {any} */ (raw).name) === "string";
  const label = named && /** @type {any} */ (raw).name ? ` (${/** @type {any} */ (raw).name})` : "";
  try {
    if (!isObject(raw)) throw new Error("an object expected.");
    const given = /** @type {Record<string, unknown>} */ (raw);
    const secret = Object.keys(given).find((key) => SECRET.test(key));
    if (secret)
      throw new Error(
        `${secret}: a connections file carries no passwords; take it out of the file.`,
      );
    if (given.readOnly !== undefined && typeof given.readOnly !== "boolean")
      throw new Error("readOnly: true or false.");
    if (given.id !== undefined && (typeof given.id !== "string" || !ID.test(given.id)))
      throw new Error("id: lowercase letters, digits and dashes, at most 40.");
    if (given.id !== undefined && before.some((c) => c.id === given.id))
      throw new Error(`id: ${given.id} is in the file twice.`);
    const known = Object.fromEntries(FIELDS.filter((k) => k in given).map((k) => [k, given[k]]));
    const conn = normalize({ ...known, id: /** @type {string} */ (given.id ?? newId(random)) });
    if (before.some((c) => c.name.toLowerCase() === conn.name.toLowerCase()))
      throw new Error(`Name: "${conn.name}" is in the file twice.`);
    return conn;
  } catch (error) {
    throw new Error(`Connection ${n}${label}: ${message(error)}`);
  }
}

/**
 * A file's text read: a connections file of this plugin, or a pg_service.conf. Throws an Error
 * whose message says why the file is refused, naming the field.
 * @param {string} text
 * @param {() => number} [random] For new ids.
 * @returns {Read}
 */
export function readFile(text, random = Math.random) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (looksLikeService(text)) return readService(text, random);
    throw new Error("it is neither a connections file of Database nor a pg_service.conf.");
  }
  if (!isObject(data) || /** @type {any} */ (data).format !== FORMAT)
    throw new Error(`it is JSON, but not a connections file: it has no "format": "${FORMAT}".`);
  const file = /** @type {Record<string, unknown>} */ (data);
  const version = file.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    throw new Error("version: a whole number, 1 or more.");
  if (version > VERSION)
    throw new Error(
      `it is version ${version}, written by a newer Database; this one reads version ${VERSION}: update the desk to import it.`,
    );
  if (!Array.isArray(file.connections)) throw new Error("connections: a list expected.");
  if (file.connections.length > MAX_ENTRIES)
    throw new Error(`connections: at most ${MAX_ENTRIES}.`);
  /** @type {Connection[]} */
  const conns = [];
  file.connections.forEach((raw, i) => {
    conns.push(entryFrom(raw, i + 1, conns, random));
  });
  return {
    kind: "connections",
    version,
    exported: typeof file.exported === "string" ? file.exported : "",
    entries: conns.map((conn) => ({ conn, notes: [] })),
  };
}
