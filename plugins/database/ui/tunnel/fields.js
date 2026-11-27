import { t } from "../strings/index.js";
// A PostgreSQL connection's SSH tunnel (PG-10, ADR 0359), checked before it is kept: the SSH host,
// its port and user, how it signs in (a key file the core reads, the SSH agent, or a password asked
// when the server wants it), and an optional jump host written `user@host:port`, which signs in as
// the SSH host does (the same key file; the agent for the agent or a password). Kept only when the
// connection has a tunnel, so one without reads as before. A key, a passphrase or a password is
// never a field. No DOM.

/** @typedef {import("../engines/common.js").Connection} Connection */

/** The fields, as `SIGN_IN` lists them: a change to any closes the connection's sessions. */
export const TUNNEL = /** @type {const} */ ([
  "sshHost",
  "sshPort",
  "sshUser",
  "sshAuth",
  "sshKey",
  "sshJump",
]);
/** The ways a hop signs in, in the form's order. */
export const SSH_AUTH = /** @type {const} */ (["key", "agent", "password"]);

/** A host db.open takes: a name or an IPv4 address. */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/u;
const USER = /^[^\s@:]{1,256}$/u;

/** A field's text: one line, at most `max` characters. */
function text(
  /** @type {string} */ field,
  /** @type {unknown} */ value,
  /** @type {number} */ max,
) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string")
    throw new Error(t("tunnel.fields.textExpected", { field: String(field) }));
  if (/[\n\r\0]/u.test(value))
    throw new Error(t("tunnel.fields.oneLinePlease", { field: String(field) }));
  if (value.length > max)
    throw new Error(
      t("tunnel.fields.atMostCharacters", { field: String(field), max: String(max) }),
    );
  return value.trim();
}

/** A port typed or kept: 1 to 65535, or none. */
function port(/** @type {string} */ field, /** @type {unknown} */ value) {
  if (value === undefined || value === null || `${value}` === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535)
    throw new Error(t("tunnel.fields.aNumberFromTo", { field: String(field) }));
  return n;
}

/**
 * A jump host written `user@host:port` (user and port optional), or an Error naming the field.
 * @param {string} written
 * @param {string} user the SSH host's user, when the jump host names none
 */
export function jumpOf(written, user) {
  const match = /^(?:([^@\s]+)@)?([^:@\s]+)(?::(\d+))?$/u.exec(written);
  if (!match) throw new Error(t("tunnel.fields.jumpHostUserHostPortLike"));
  const host = match[2] ?? "";
  if (!HOST.test(host))
    throw new Error(t("tunnel.fields.jumpHostIsNotAHost", { host: String(host) }));
  const who = match[1] ?? user;
  if (!USER.test(who)) throw new Error(t("tunnel.fields.jumpHostTheUserHasNo"));
  return { host, port: port("Jump host", match[3]) ?? 22, user: who };
}

/**
 * The tunnel fields a connection keeps: none without an SSH host.
 * @param {Record<string, unknown>} raw
 * @param {Connection} conn the connection's other fields, checked
 * @returns {Partial<Pick<Connection, typeof TUNNEL[number]>>}
 */
export function tunnelOf(raw, conn) {
  if (conn.engine !== "postgresql") return {};
  const host = text("SSH host", raw.sshHost, 253);
  if (!host) return {};
  if (!HOST.test(host)) throw new Error(t("tunnel.fields.sshHostAHostNameOr"));
  const user = text("SSH user", raw.sshUser, 256);
  if (!user) throw new Error(t("tunnel.fields.sshUserWhoSignsInOn"));
  if (!USER.test(user)) throw new Error(t("tunnel.fields.sshUserNoSpacesOr"));
  const auth = raw.sshAuth === undefined || raw.sshAuth === "" ? "key" : raw.sshAuth;
  if (!SSH_AUTH.includes(/** @type {never} */ (auth)))
    throw new Error(t("tunnel.fields.signInWithAKeyFile"));
  /** @type {Partial<Pick<Connection, typeof TUNNEL[number]>>} */
  const out = { sshHost: host, sshUser: user, sshAuth: /** @type {"key"} */ (auth) };
  const sshPort = port("SSH port", raw.sshPort);
  if (sshPort !== undefined) out.sshPort = sshPort;
  const key = text("SSH key file", raw.sshKey, 1024);
  if (auth === "key") {
    if (!key) throw new Error(t("tunnel.fields.sshKeyFileThePrivateKey"));
    if (!/^(\/|~\/|[A-Za-z]:[\\/])/u.test(key))
      throw new Error(t("tunnel.fields.sshKeyFileAFullPath"));
    out.sshKey = key;
  }
  const jump = text("Jump host", raw.sshJump, 512);
  if (jump) {
    jumpOf(jump, user);
    out.sshJump = jump;
  }
  return out;
}

/** Whether the connection goes through an SSH tunnel. */
export const tunneled = (/** @type {Connection} */ conn) =>
  conn.engine === "postgresql" && Boolean(conn.sshHost);
