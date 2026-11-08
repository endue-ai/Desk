// Which client runs an engine, and whether it is new enough. A client is found on the desk's PATH,
// or else in the folders the settings add and where package managers install them (Homebrew keeps
// libpq and mysql-client out of PATH). `--version` says which client it is (mysql or mariadb) and
// whether it has what the plugin uses: psql 13 (--csv, \warn), mysql 8.0.19 or mariadb 10.5
// (--binary-as-hex), sqlite3 3.37 (-safe).

/**
 * @typedef {import("./engines/common.js").EngineId} EngineId
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {"mac" | "linux" | "windows"} Platform
 * @typedef {{ command: string, flavor: "postgresql" | "mysql" | "mariadb" | "sqlite", version: string }} Client
 * @typedef {{ run(invocation: import("./engines/common.js").Invocation, options?: { timeoutMs?: number }): Promise<import("./engines/common.js").Outcome> }} Runner
 */

/** Where clients are installed outside PATH, per platform. */
export const INSTALL_FOLDERS = {
  mac: [
    "/opt/homebrew/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/opt/homebrew/opt/mysql-client/bin",
    "/opt/homebrew/opt/mariadb/bin",
    "/opt/homebrew/opt/sqlite/bin",
    "/usr/local/bin",
    "/usr/local/opt/libpq/bin",
    "/usr/local/opt/mysql-client/bin",
    "/usr/local/opt/sqlite/bin",
    "/Applications/Postgres.app/Contents/Versions/latest/bin",
    "/usr/bin",
    "/bin",
  ],
  linux: ["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"],
  windows: [],
};

/** The oldest client each flavor needs, and what it needs it for. */
export const MINIMUM = {
  postgresql: { version: "13", why: "--csv and \\warn" },
  mysql: { version: "8.0.19", why: "--binary-as-hex" },
  mariadb: { version: "10.5", why: "--binary-as-hex" },
  sqlite: { version: "3.37", why: "-safe" },
};

/** How to install each engine's client, said when it is missing. */
export const INSTALL_HINTS = /** @type {Record<EngineId, string>} */ ({
  postgresql: "Install psql: brew install libpq, or apt install postgresql-client.",
  mysql:
    "Install mysql: brew install mysql-client, or apt install mysql-client (or mariadb-client).",
  sqlite: "Install sqlite3: brew install sqlite, or apt install sqlite3.",
});

/** @returns {Platform} */
export function platformOf(/** @type {string | undefined} */ navigatorPlatform) {
  const platform = (navigatorPlatform ?? "").toLowerCase();
  if (platform.startsWith("mac")) return "mac";
  return platform.startsWith("win") ? "windows" : "linux";
}

/** The PATH tried when a client is not on the desk's own: the settings' folders first. */
export function searchPath(/** @type {Platform} */ platform, /** @type {string[]} */ extra) {
  return [...extra, ...INSTALL_FOLDERS[platform]].join(platform === "windows" ? ";" : ":");
}

/** The programs to try for an engine, in order. */
export function candidates(/** @type {EngineId} */ engine, /** @type {Settings} */ settings) {
  if (engine === "postgresql") return [settings.psql || "psql"];
  if (engine === "sqlite") return [settings.sqlite3 || "sqlite3"];
  return settings.mysql ? [settings.mysql] : ["mysql", "mariadb"];
}

/**
 * The client and version a `--version` line names, or undefined when it is not one of them.
 * @param {string} line
 * @returns {Omit<Client, "command"> | undefined}
 */
export function parseVersion(line) {
  const psql = /\(PostgreSQL\) (\d+(?:\.\d+)*)/u.exec(line);
  if (psql) return { flavor: "postgresql", version: psql[1] ?? "" };
  const maria = /(\d+\.\d+\.\d+)-MariaDB/u.exec(line);
  if (maria) return { flavor: "mariadb", version: maria[1] ?? "" };
  const mysql = /\bVer (\d+\.\d+\.\d+)/u.exec(line);
  if (mysql) return { flavor: "mysql", version: mysql[1] ?? "" };
  const sqlite = /^(3\.\d+\.\d+) \d{4}-\d{2}-\d{2}/u.exec(line.trim());
  if (sqlite) return { flavor: "sqlite", version: sqlite[1] ?? "" };
  return undefined;
}

/** -1, 0 or 1 as `a` is older, the same or newer than `b`, part by part. */
export function compareVersions(/** @type {string} */ a, /** @type {string} */ b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The sentence for a client older than the plugin needs, or "". */
export function tooOld(/** @type {Client} */ client) {
  const need = MINIMUM[client.flavor];
  if (compareVersions(client.version, need.version) >= 0) return "";
  return `${client.command} ${client.version} is too old: ${need.version} or newer is needed (for ${need.why}).`;
}

/**
 * Finds and remembers each engine's client for the session.
 * @param {Runner} runner
 * @param {() => Settings} settings
 */
export function createClients(runner, settings) {
  /** @type {Map<EngineId, Promise<Client>>} */
  const found = new Map();

  /** @param {string} command */
  const probe = async (command) => {
    const outcome = await runner.run(
      {
        command,
        args: ["--version"],
        env: {},
        nonce: "",
        statements: [],
        maxRows: 0,
        stopAfter: 0,
      },
      { timeoutMs: 10_000 },
    );
    const parsed = parseVersion(`${outcome.stdout}\n${outcome.stderr}`.trim().split("\n")[0] ?? "");
    if (!parsed) throw new Error(`${command} --version did not say which client it is.`);
    return { command, ...parsed };
  };

  /** @param {EngineId} engine @returns {Promise<Client>} */
  const find = async (engine) => {
    /** @type {unknown} */
    let failure;
    for (const command of candidates(engine, settings())) {
      try {
        const client = await probe(command);
        const old = tooOld(client);
        if (old) throw new Error(old);
        return client;
      } catch (error) {
        failure = error;
        if (/** @type {{ kind?: string }} */ (error)?.kind !== "missing") break;
      }
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    const missing = /** @type {{ kind?: string }} */ (failure)?.kind === "missing";
    throw Object.assign(new Error(missing ? `${message} ${INSTALL_HINTS[engine]}` : message), {
      kind: missing ? "missing" : "client",
    });
  };

  return {
    /** The client for an engine, found once per session (a failure is tried again next time). */
    get(/** @type {EngineId} */ engine) {
      let entry = found.get(engine);
      if (!entry) {
        entry = find(engine);
        found.set(engine, entry);
        entry.catch(() => found.delete(engine));
      }
      return entry;
    },
    /** Forget what was found, after the settings change or for a fresh check. */
    reset() {
      found.clear();
    },
  };
}
