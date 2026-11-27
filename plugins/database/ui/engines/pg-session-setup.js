// The target and startup settings of a PostgreSQL session.
import { pooled, pooledSettings } from "../auth/pooler.js";
import { t as messageText } from "../strings/index.js";
import { sessionSettings } from "./pg-options.js";

/** @typedef {import("./common.js").Connection} Connection */

/** What the server shows as the session's application (pg_stat_activity.application_name). */
export const APPLICATION = "endue";

/** A host db.open takes: a name or an IPv4 address (no socket folder, no IPv6 yet). */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/u;

/** The server and the sign-in a connection names, or the sentence why it cannot be reached. */
export function targetOf(/** @type {Connection} */ conn) {
  const host = conn.host || "localhost";
  if (!HOST.test(host))
    return messageText("engines.pgSession.isNotAHostNameOr", {
      name: String(conn.name),
      host: String(host),
    });
  if (!conn.user)
    return messageText("engines.pgSession.hasNoUserSetTheRole", { name: String(conn.name) });
  return { host, port: conn.port ?? 5432, database: conn.database || conn.user, user: conn.user };
}

/** The session's settings: its name on the server, ISO dates, the statement timeout, then the
 * connection's own session options (its application name over the plugin's). */
export const settingsOf = (
  /** @type {number} */ timeoutMs,
  /** @type {Connection | undefined} */ conn = undefined,
) =>
  conn && pooled(conn)
    ? pooledSettings(conn, APPLICATION)
    : {
        application_name: APPLICATION,
        DateStyle: "ISO",
        ...(timeoutMs > 0 ? { statement_timeout: String(timeoutMs) } : {}),
        ...(conn ? sessionSettings(conn) : {}),
      };
