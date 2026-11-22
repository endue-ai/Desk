// PostgreSQL's connection service file (pg_service.conf) read for an import (PG-15): each
// `[service]` a PostgreSQL connection named after it, from `host` (or `hostaddr`), `port`,
// `dbname`, `user`, `sslmode`, `sslrootcert`, `sslcert` and `sslkey`. A password is left out, as
// every other key is, and the entry's notes say so. A line or value that fails refuses the file
// with its line and field. No DOM.

import { newId, normalize } from "../../connections.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./file.js").Read} Read
 */

const READ = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "user",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
]);
/** libpq's modes as the connection keeps them; `allow` tries both, as `prefer` does. */
const SSL = /** @type {Record<string, string>} */ ({
  disable: "disable",
  allow: "prefer",
  prefer: "prefer",
  require: "require",
  "verify-ca": "verify-ca",
  "verify-full": "verify-full",
});
const HEAD = /^\[([^\]]*)\]$/u;

/** Whether the text has a `[service]` line, as a service file does. */
export const looksLikeService = (/** @type {string} */ text) =>
  text.split(/\r?\n/u).some((line) => HEAD.test(line.trim()));

/**
 * @param {string} text
 * @param {() => number} [random]
 * @returns {Read}
 */
export function readService(text, random = Math.random) {
  /** @type {{ name: string, line: number, values: Map<string, string> }[]} */
  const services = [];
  text.split(/\r?\n/u).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const head = HEAD.exec(line);
    if (head) {
      const name = (head[1] ?? "").trim();
      if (!name) throw new Error(`Line ${i + 1}: a service needs a name between [ and ].`);
      services.push({ name, line: i + 1, values: new Map() });
      return;
    }
    const eq = line.indexOf("=");
    if (eq < 1) throw new Error(`Line ${i + 1}: key=value expected.`);
    const current = services.at(-1);
    if (!current) throw new Error(`Line ${i + 1}: a setting before the first [service].`);
    current.values.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  });
  /** @type {Connection[]} */
  const conns = [];
  const entries = services.map((service) => {
    const conn = connectionOf(service, conns, random);
    conns.push(conn);
    const left = [...service.values.keys()].filter((key) => !READ.has(key));
    return { conn, notes: left.length ? [`Left out: ${left.join(", ")}.`] : [] };
  });
  return { kind: "service", version: 0, exported: "", entries };
}

function connectionOf(
  /** @type {{ name: string, line: number, values: Map<string, string> }} */ service,
  /** @type {Connection[]} */ before,
  /** @type {() => number} */ random,
) {
  const v = service.values;
  try {
    const host = v.get("host") || v.get("hostaddr");
    if (host?.includes(",")) throw new Error("Host: one host; a list of hosts is not read.");
    const port = v.get("port");
    if (port?.includes(",")) throw new Error("Port: one port; a list of ports is not read.");
    const mode = v.get("sslmode");
    if (before.some((c) => c.name.toLowerCase() === service.name.toLowerCase()))
      throw new Error("Name: the service is in the file twice.");
    return normalize({
      id: newId(random),
      engine: "postgresql",
      name: service.name,
      ...(host ? { host } : {}),
      port: port ? /** @type {any} */ (port) : null,
      database: v.get("dbname") ?? "",
      user: v.get("user") ?? "",
      ssl: /** @type {any} */ (mode ? (SSL[mode] ?? mode) : "default"),
      sslCa: v.get("sslrootcert") ?? "",
      sslCert: v.get("sslcert") ?? "",
      sslKey: v.get("sslkey") ?? "",
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`Service ${service.name} (line ${service.line}): ${why}`);
  }
}
