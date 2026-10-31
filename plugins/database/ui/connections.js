// Connections: what one holds, checked before it is kept; connection URIs read and written
// (postgres://, mysql://, mariadb://, sqlite:); and the list in the plugin's store. A password is
// never part of a connection: the person types it when the client asks, it stays in memory for the
// session, and a URI's password is handed back separately for that.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./engines/common.js").EngineId} EngineId
 * @typedef {import("./engines/common.js").SslMode} SslMode
 * @typedef {import("./engines/common.js").Tag} Tag
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

export const ENGINE_IDS = /** @type {const} */ (["postgresql", "mysql", "sqlite"]);
export const TAGS = /** @type {const} */ (["none", "development", "staging", "production"]);
export const SSL_MODES = /** @type {const} */ ([
  "default",
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);
const STORE_KEY = "connections";
const STORE_LIMIT = 60 * 1024;
const SCHEMES = /** @type {Record<string, EngineId>} */ ({
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  sqlite3: "sqlite",
  file: "sqlite",
});

/** A new connection's fields, for the form. */
export function blank(/** @type {EngineId} */ engine = "postgresql") {
  return /** @type {Connection} */ ({
    id: "",
    name: "",
    engine,
    host: engine === "sqlite" ? "" : "localhost",
    port: null,
    database: "",
    user: "",
    ssl: "default",
    sslCa: "",
    file: "",
    tag: "none",
    readOnly: false,
  });
}

/**
 * A connection checked and tidied, or an Error whose message names the field.
 * @param {Partial<Connection>} raw
 * @param {Connection[]} [others] The other connections, whose names it must not take.
 * @returns {Connection}
 */
export function normalize(raw, others = []) {
  const engine = /** @type {EngineId} */ (raw.engine);
  if (!ENGINE_IDS.includes(engine))
    throw new Error("Engine: pick PostgreSQL, MySQL / MariaDB or SQLite.");
  const base = blank(engine);
  // Only the known fields, so nothing else a store or an agent hands in is kept.
  const conn = /** @type {Connection} */ (
    Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        raw[/** @type {keyof Connection} */ (key)] ?? value,
      ]),
    )
  );
  conn.engine = engine;
  conn.host = text("Host", conn.host, 255).trim();
  conn.database = text("Database", conn.database, 255);
  conn.user = text("User", conn.user, 255);
  conn.sslCa = path("CA file", text("CA file", conn.sslCa, 1024).trim(), false);
  conn.file = text("File", conn.file, 1024).trim();
  if (/\s/u.test(conn.host)) throw new Error("Host: no spaces.");
  if (conn.port !== null && conn.port !== undefined && `${conn.port}` !== "") {
    const port = Number(conn.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Port: a number from 1 to 65535.");
    conn.port = port;
  } else conn.port = null;
  if (!SSL_MODES.includes(conn.ssl)) throw new Error("SSL: pick one of the modes.");
  if (!TAGS.includes(conn.tag)) throw new Error("Environment: pick one of the tags.");
  conn.readOnly = conn.readOnly === true;
  if (engine === "sqlite") {
    if (!conn.file) throw new Error("File: the database file, like ~/data/app.db.");
    if (conn.file !== ":memory:") conn.file = path("File", conn.file, true);
    conn.host = "";
    conn.port = null;
  }
  conn.name = text("Name", conn.name, 80).trim() || defaultName(conn);
  const taken = others.find(
    (o) => o.id !== conn.id && o.name.toLowerCase() === conn.name.toLowerCase(),
  );
  if (taken) throw new Error(`Name: "${conn.name}" is taken.`);
  if (!/^[a-z0-9-]{1,40}$/u.test(conn.id)) throw new Error("The connection has no id.");
  return conn;
}

/** A field's text: a string without line breaks or NUL, at most `max` characters. */
function text(
  /** @type {string} */ field,
  /** @type {unknown} */ value,
  /** @type {number} */ max,
) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field}: text expected.`);
  if (/[\n\r\0]/u.test(value)) throw new Error(`${field}: one line, please.`);
  if (value.length > max) throw new Error(`${field}: at most ${max} characters.`);
  return value;
}

/** A path the clients can open: absolute or under ~/. */
function path(
  /** @type {string} */ field,
  /** @type {string} */ value,
  /** @type {boolean} */ required,
) {
  if (!value && !required) return "";
  if (value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/u.test(value))
    return value;
  throw new Error(`${field}: a full path, starting with / or ~/.`);
}

/** user@host/db, or the file's name. */
export function defaultName(/** @type {Connection} */ conn) {
  if (conn.engine === "sqlite") return conn.file.slice(conn.file.lastIndexOf("/") + 1) || conn.file;
  const who = conn.user ? `${conn.user}@` : "";
  return `${who}${conn.host || "localhost"}${conn.database ? `/${conn.database}` : ""}`;
}

/**
 * A connection URI read: the fields it gives, and its password apart.
 * @param {string} uri
 * @returns {{ fields: Partial<Connection>, password?: string }}
 */
export function parseUri(uri) {
  const trimmed = uri.trim();
  const scheme = /^([a-z0-9]+):/iu.exec(trimmed)?.[1]?.toLowerCase() ?? "";
  const engine = SCHEMES[scheme];
  if (!engine) throw new Error("A URI starts with postgres://, mysql://, mariadb:// or sqlite:.");
  if (engine === "sqlite") {
    let rest = trimmed.slice(scheme.length + 1).replace(/^\/\/(?=\/|~)/u, "");
    rest = decodeURIComponent(rest.split("?")[0] ?? "");
    return { fields: { engine, file: rest } };
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That URI cannot be read.");
  }
  const query = url.searchParams;
  const sslRaw = (
    query.get("sslmode") ??
    query.get("ssl-mode") ??
    query.get("ssl_mode") ??
    ""
  ).toLowerCase();
  const ssl = /** @type {SslMode} */ (
    {
      true: "require",
      required: "require",
      preferred: "prefer",
      disabled: "disable",
      verify_ca: "verify-ca",
      verify_identity: "verify-full",
      false: "disable",
    }[sslRaw] ?? (SSL_MODES.includes(/** @type {SslMode} */ (sslRaw)) ? sslRaw : "default")
  );
  const host = decodeURIComponent(url.hostname).replace(/^\[(.*)\]$/u, "$1");
  /** @type {Partial<Connection>} */
  const fields = {
    engine,
    host: host || (query.get("host") ?? ""),
    port: url.port ? Number(url.port) : null,
    database: decodeURIComponent(url.pathname.replace(/^\//u, "")),
    user: decodeURIComponent(url.username) || (query.get("user") ?? ""),
    ssl,
    sslCa: query.get("sslrootcert") ?? query.get("ssl-ca") ?? "",
  };
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return password === undefined ? { fields } : { fields, password };
}

/** The connection as a URI, without a password. */
export function formatUri(/** @type {Connection} */ conn) {
  if (conn.engine === "sqlite") return `sqlite:${conn.file}`;
  const scheme = conn.engine === "postgresql" ? "postgresql" : "mysql";
  const user = conn.user ? `${encodeURIComponent(conn.user)}@` : "";
  const host = conn.host.includes(":") ? `[${conn.host}]` : encodeURIComponent(conn.host);
  const port = conn.port ? `:${conn.port}` : "";
  const db = conn.database ? `/${encodeURIComponent(conn.database)}` : "";
  const params = new URLSearchParams();
  if (conn.ssl !== "default")
    params.set(conn.engine === "postgresql" ? "sslmode" : "ssl-mode", conn.ssl);
  if (conn.sslCa) params.set(conn.engine === "postgresql" ? "sslrootcert" : "ssl-ca", conn.sslCa);
  const query = params.size ? `?${params}` : "";
  return `${scheme}://${user}${host}${port}${db}${query}`;
}

/** A new id: `c-` and ten characters. */
export function newId(/** @type {() => number} */ random = Math.random) {
  let out = "";
  while (out.length < 10) out += Math.floor(random() * 36).toString(36);
  return `c-${out}`;
}

/**
 * The kept connections; entries that no longer pass the checks are left out.
 * @param {Bridge} bridge
 * @returns {Promise<Connection[]>}
 */
export async function loadConnections(bridge) {
  const kept = await bridge.call("store.get", { key: STORE_KEY }).catch(() => ({}));
  const list = Array.isArray(kept.value) ? kept.value : [];
  /** @type {Connection[]} */
  const out = [];
  for (const raw of list) {
    try {
      out.push(normalize(/** @type {Partial<Connection>} */ (raw), out));
    } catch {
      // A hand-edited or older entry that does not pass stays out of the list.
    }
  }
  return out;
}

/** Keep the list; it must fit the store's 64 KiB per value. */
export async function saveConnections(
  /** @type {Bridge} */ bridge,
  /** @type {Connection[]} */ list,
) {
  if (JSON.stringify(list).length > STORE_LIMIT)
    throw new Error("Too many connections to keep: remove some first.");
  await bridge.call("store.set", { key: STORE_KEY, value: list });
}
