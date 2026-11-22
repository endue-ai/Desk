// Which client runs an engine, and whether it is new enough. PostgreSQL needs none: its sessions are
// the core's (engines/pg-session.js, ADR 0281). A client is found on the desk's PATH, or else in the
// folders the settings add and where package managers install them (Homebrew keeps libpq and
// mysql-client out of PATH). `--version` says which client it is (mysql or mariadb) and whether it
// has what the plugin uses: mysql 8.0.19 or mariadb 10.5 (--binary-as-hex), sqlite3 3.37 (-safe).
// PostgreSQL's pg_dump and pg_restore (features/backup/) are programs found the same way, each
// named by a setting of its own, from version 13, also where each system's PostgreSQL packages put
// them: the Windows installer's folder per major, Debian's and Red Hat's per-major folders,
// Homebrew's kegs (docs/platforms.md). A program keeps its bare name: the core adds `.exe` on
// Windows (PATHEXT), and the manifest grants programs by name (ADR 0260).

/**
 * @typedef {import("./engines/common.js").EngineId} EngineId
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {"mac" | "linux" | "windows"} Platform
 * @typedef {{ command: string, flavor: "postgresql" | "mysql" | "mariadb" | "sqlite", version: string }} Client
 *   PostgreSQL's is BUILT_IN: no command, no version.
 * @typedef {{ run(invocation: import("./engines/common.js").Invocation, options?: { timeoutMs?: number }): Promise<import("./engines/common.js").Outcome> }} Runner
 */

/** PostgreSQL's majors whose per-major folders are looked in, newest first. */
const MAJORS = [19, 18, 17, 16, 15, 14, 13];
const perMajor = (/** @type {(major: number) => string} */ folder) => MAJORS.map(folder);

/** Where clients are installed outside PATH, per platform. */
export const INSTALL_FOLDERS = {
  mac: [
    "/opt/homebrew/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/opt/homebrew/opt/mysql-client/bin",
    "/opt/homebrew/opt/mariadb/bin",
    "/opt/homebrew/opt/sqlite/bin",
    ...perMajor((n) => `/opt/homebrew/opt/postgresql@${n}/bin`),
    "/usr/local/bin",
    "/usr/local/opt/libpq/bin",
    "/usr/local/opt/mysql-client/bin",
    "/usr/local/opt/sqlite/bin",
    ...perMajor((n) => `/usr/local/opt/postgresql@${n}/bin`),
    "/Applications/Postgres.app/Contents/Versions/latest/bin",
    "/usr/bin",
    "/bin",
  ],
  linux: [
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/snap/bin",
    ...perMajor((n) => `/usr/lib/postgresql/${n}/bin`),
    ...perMajor((n) => `/usr/pgsql-${n}/bin`),
  ],
  windows: perMajor((n) => `C:\\Program Files\\PostgreSQL\\${n}\\bin`),
};

/** The oldest client each flavor needs, and what it needs it for. */
export const MINIMUM = {
  mysql: { version: "8.0.19", why: "--binary-as-hex" },
  mariadb: { version: "10.5", why: "--binary-as-hex" },
  sqlite: { version: "3.37", why: "-safe" },
};

/** How to install each engine's client, said when it is missing. */
export const INSTALL_HINTS = /** @type {Partial<Record<EngineId, string>>} */ ({
  mysql:
    "Install mysql: brew install mysql-client, or apt install mysql-client (or mariadb-client).",
  sqlite: "Install sqlite3: brew install sqlite, or apt install sqlite3.",
});

/** How to install one of PostgreSQL's programs on `platform`, said when it is missing. */
export function installHint(/** @type {string} */ name, /** @type {Platform} */ platform) {
  if (platform === "windows")
    return `Install ${name}: the PostgreSQL installer for Windows puts it in C:\\Program Files\\PostgreSQL\\<version>\\bin.`;
  return `Install ${name}: brew install libpq, or apt install postgresql-client.`;
}

/** PostgreSQL's own programs, by name: the setting that names another one. */
export const PROGRAMS = /** @type {const} */ ({ pg_dump: "pgDump", pg_restore: "pgRestore" });
/** @typedef {keyof typeof PROGRAMS} Program */
const PROGRAM_MINIMUM = "13";

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

/** The runner's options for `platform`: how it stops a program, and the PATH it tries after the desk's. */
export const runsOn = (
  /** @type {Platform} */ platform,
  /** @type {() => string[]} */ folders,
) => ({ platform, searchPath: () => searchPath(platform, folders()) });

/** PostgreSQL's "client": the core's sessions, nothing to find or run. @type {Client} */
export const BUILT_IN = Object.freeze({ command: "", flavor: "postgresql", version: "" });

/** The programs to try for an engine, in order; none for PostgreSQL. */
export function candidates(/** @type {EngineId} */ engine, /** @type {Settings} */ settings) {
  if (engine === "postgresql") return [];
  if (engine === "sqlite") return [settings.sqlite3 || "sqlite3"];
  return settings.mysql ? [settings.mysql] : ["mysql", "mariadb"];
}

/** The program to try for one of PostgreSQL's own programs. */
export function programCandidates(/** @type {Program} */ name, /** @type {Settings} */ settings) {
  return [settings[PROGRAMS[name]] || name];
}

/** What `pg_dump --version` (or pg_restore's) says: `pg_dump (PostgreSQL) 18.1`. */
export function parseProgram(/** @type {string} */ line) {
  const postgres = /\(PostgreSQL\) (\d+(?:\.\d+)*)/u.exec(line);
  return postgres
    ? { flavor: /** @type {const} */ ("postgresql"), version: postgres[1] ?? "" }
    : undefined;
}

/** The sentence for a pg_dump or pg_restore older than the plugin reads, or "". */
function programTooOld(/** @type {Client} */ client) {
  if (compareVersions(client.version, PROGRAM_MINIMUM) >= 0) return "";
  return `${client.command} ${client.version} is too old: ${PROGRAM_MINIMUM} or newer is needed.`;
}

/**
 * The client and version a `--version` line names, or undefined when it is not one of them.
 * @param {string} line
 * @returns {Omit<Client, "command"> | undefined}
 */
export function parseVersion(line) {
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
  const need = client.flavor === "postgresql" ? undefined : MINIMUM[client.flavor];
  if (!need) return "";
  if (compareVersions(client.version, need.version) >= 0) return "";
  return `${client.command} ${client.version} is too old: ${need.version} or newer is needed (for ${need.why}).`;
}

/**
 * Finds and remembers each engine's client for the session.
 * @param {Runner} runner
 * @param {() => Settings} settings
 * @param {Platform} [platform] the system the desk runs on: its install hints and command lines
 */
export function createClients(runner, settings, platform = "mac") {
  /** @type {Map<string, Promise<Client>>} */
  const found = new Map();

  /** @param {string} command @param {(line: string) => Omit<Client, "command"> | undefined} parse */
  const probe = async (command, parse) => {
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
    const first = `${outcome.stdout}\n${outcome.stderr}`.trim().split(/\r?\n/u)[0] ?? "";
    const parsed = parse(first);
    if (!parsed) throw new Error(`${command} --version did not say which client it is.`);
    return { command, ...parsed };
  };

  /**
   * The first of `commands` that runs and is new enough.
   * @param {string[]} commands
   * @param {string} hint how to install it, said when none is found
   * @param {(line: string) => Omit<Client, "command"> | undefined} parse
   * @param {(client: Client) => string} old
   * @returns {Promise<Client>}
   */
  const find = async (commands, hint, parse, old) => {
    /** @type {unknown} */
    let failure;
    for (const command of commands) {
      try {
        const client = await probe(command, parse);
        const why = old(client);
        if (why) throw new Error(why);
        return client;
      } catch (error) {
        failure = error;
        if (/** @type {{ kind?: string }} */ (error)?.kind !== "missing") break;
      }
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    const missing = /** @type {{ kind?: string }} */ (failure)?.kind === "missing";
    throw Object.assign(new Error(missing ? `${message} ${hint}`.trim() : message), {
      kind: missing ? "missing" : "client",
    });
  };

  /** @param {string} key @param {() => Promise<Client>} look */
  const once = (key, look) => {
    let entry = found.get(key);
    if (!entry) {
      entry = look();
      found.set(key, entry);
      entry.catch(() => found.delete(key));
    }
    return entry;
  };

  return {
    platform,
    /** The client for an engine, found once per session (a failure is tried again next time). */
    get(/** @type {EngineId} */ engine) {
      if (engine === "postgresql") return Promise.resolve(BUILT_IN);
      return once(engine, () =>
        find(candidates(engine, settings()), INSTALL_HINTS[engine] ?? "", parseVersion, tooOld),
      );
    },
    /** pg_dump or pg_restore, found once per session as a client is. */
    program(/** @type {Program} */ name) {
      return once(name, () =>
        find(
          programCandidates(name, settings()),
          installHint(name, platform),
          parseProgram,
          programTooOld,
        ),
      );
    },
    /** Forget what was found, after the settings change or for a fresh check. */
    reset() {
      found.clear();
    },
  };
}
