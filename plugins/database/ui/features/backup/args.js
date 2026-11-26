import { t as messageText } from "../../strings/index.js";
// pg_dump's and pg_restore's argument lists from the forms' options (ADR 0313): each option its own
// argument in `--name=value` form, so no value can become another option, and no shell between.
// The connection goes in libpq's PG* variables, as the core's session gets it (engines/pg-session.js),
// and the password only in PGPASSWORD of the spawned process's environment; the command line shown
// leaves it out. A path under the home folder is passed as `./…` from the home folder the program
// starts in. Pure.

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {"custom" | "directory" | "tar" | "plain"} Format
 * @typedef {"all" | "schema" | "data"} Content
 * @typedef {"default" | "none" | "gzip" | "lz4" | "zstd"} Method
 * @typedef {{
 *   format: Format, scope: "database" | "schemas" | "tables", schemas: string[], tables: string[],
 *   content: Content, noOwner: boolean, noPrivileges: boolean, method: Method, level: number | null,
 *   jobs: number, inserts: boolean,
 * }} DumpOptions
 * @typedef {{
 *   clean: boolean, ifExists: boolean, create: boolean, content: Content, noOwner: boolean,
 *   noPrivileges: boolean, jobs: number, singleTransaction: boolean,
 * }} RestoreOptions
 */

export const FORMATS = /** @type {const} */ (["custom", "directory", "tar", "plain"]);
export const METHODS = /** @type {const} */ (["default", "none", "gzip", "lz4", "zstd"]);
/** The file name each format suggests; the directory format names a folder. */
export const EXTENSIONS = { custom: ".dump", directory: "", tar: ".tar", plain: ".sql" };
export const JOBS_MAX = 32;
const LEVELS = { gzip: [1, 9], lz4: [1, 12], zstd: [1, 22] };

/** @type {Readonly<DumpOptions>} */
export const DUMP_DEFAULTS = Object.freeze({
  format: "custom",
  scope: "database",
  schemas: [],
  tables: [],
  content: "all",
  noOwner: false,
  noPrivileges: false,
  method: "default",
  level: null,
  jobs: 1,
  inserts: true,
});

/** @type {Readonly<RestoreOptions>} */
export const RESTORE_DEFAULTS = Object.freeze({
  clean: false,
  ifExists: false,
  create: false,
  content: "all",
  noOwner: false,
  noPrivileges: false,
  jobs: 1,
  singleTransaction: false,
});

const flag = (/** @type {unknown} */ value, /** @type {boolean} */ fallback) =>
  typeof value === "boolean" ? value : fallback;
const names = (/** @type {unknown} */ value) =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/u) : [])
    .map((name) => String(name).trim())
    .filter((name) => name !== "");
const oneOf = (
  /** @type {readonly string[]} */ list,
  /** @type {unknown} */ value,
  fallback = "",
) => (typeof value === "string" && list.includes(value) ? value : fallback);

function jobsOf(/** @type {unknown} */ value) {
  if (value === undefined || value === null || value === "") return 1;
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > JOBS_MAX)
    throw new Error(
      messageText("features.backup.args.jobsAreAWholeNumberFrom", { JOBS_MAX: String(JOBS_MAX) }),
    );
  return jobs;
}

/** The major version of a program's or a server's version text: 17 from "17.6" or "18beta1". */
export const majorOf = (/** @type {string} */ version) => Number.parseInt(version, 10) || 0;

/**
 * A backup's options from a form's answer or a command's arguments, checked: what does not apply to
 * the format is dropped, what cannot be is refused in one sentence.
 * @param {Record<string, unknown>} raw
 * @param {number} major the pg_dump's major version (lz4 and zstd from 16)
 * @returns {DumpOptions}
 */
export function dumpOptions(raw, major) {
  const format = /** @type {Format} */ (oneOf(FORMATS, raw.format, DUMP_DEFAULTS.format));
  const scope = /** @type {DumpOptions["scope"]} */ (
    oneOf(["database", "schemas", "tables"], raw.scope, "database")
  );
  const schemas = scope === "schemas" ? names(raw.schemas) : [];
  const tables = scope === "tables" ? names(raw.tables) : [];
  if (scope === "schemas" && schemas.length === 0)
    throw new Error(messageText("features.backup.args.chooseASchemaToBackUp"));
  if (scope === "tables" && tables.length === 0)
    throw new Error(messageText("features.backup.args.nameATableToBackUp"));
  const archive = format === "custom" || format === "directory";
  const method = /** @type {Method} */ (
    archive ? oneOf(METHODS, raw.method, "default") : "default"
  );
  if ((method === "lz4" || method === "zstd") && major < 16)
    throw new Error(
      messageText("features.backup.args.compressionNeedsPgDumpOrNewer", {
        method: String(method),
        major: String(major),
      }),
    );
  let level = null;
  if (method === "gzip" || method === "lz4" || method === "zstd") {
    const given = raw.level === "" || raw.level === undefined ? null : Number(raw.level);
    const [low, high] = LEVELS[method];
    if (given !== null && (!Number.isInteger(given) || given < low || given > high))
      throw new Error(
        messageText("features.backup.args.aLevelIsAWholeNumber", {
          method: String(method),
          low: String(low),
          high: String(high),
        }),
      );
    level = given;
  }
  return {
    format,
    scope,
    schemas,
    tables,
    content: /** @type {Content} */ (oneOf(["all", "schema", "data"], raw.content, "all")),
    noOwner: flag(raw.noOwner, false),
    noPrivileges: flag(raw.noPrivileges, false),
    method,
    level,
    jobs: format === "directory" ? jobsOf(raw.jobs) : 1,
    inserts: format === "plain" && flag(raw.inserts, true),
  };
}

/**
 * A restore's options, checked against the archive's format.
 * @param {Record<string, unknown>} raw
 * @param {Exclude<Format, "plain">} format
 * @returns {RestoreOptions}
 */
export function restoreOptions(raw, format) {
  const clean = flag(raw.clean, false);
  const create = flag(raw.create, false);
  const jobs = format === "tar" ? 1 : jobsOf(raw.jobs);
  const singleTransaction = flag(raw.singleTransaction, false);
  if (singleTransaction && jobs > 1)
    throw new Error(messageText("features.backup.args.aSingleTransactionRunsInOne"));
  if (singleTransaction && create)
    throw new Error(messageText("features.backup.args.pgRestoreCannotCreateTheDatabase"));
  return {
    clean,
    ifExists: clean && flag(raw.ifExists, false),
    create,
    content: /** @type {Content} */ (oneOf(["all", "schema", "data"], raw.content, "all")),
    noOwner: flag(raw.noOwner, false),
    noPrivileges: flag(raw.noPrivileges, false),
    jobs,
    singleTransaction,
  };
}

/** A path as a program started in the home folder reads it: `~/a` is `./a`, others as they are. */
export function argPath(/** @type {string} */ path) {
  if (path === "~") return ".";
  return path.startsWith("~/") ? `./${path.slice(2)}` : path;
}

/** Where a connection's chosen entries are written for pg_restore, in the plugin's own folder. */
export const listPath = (/** @type {string} */ id) =>
  `~/.endue/database/restore/${id.replace(/[^\w-]/gu, "_")}.list`;

/** A pattern pg_dump reads as exactly this name (psql's pattern rules: quoted, `"` doubled). */
export const exactName = (/** @type {string} */ name) => `"${name.replaceAll('"', '""')}"`;

/** pg_restore's --dbname: a plain name, or `dbname='…'` when libpq would read it as a connection
 * string (it holds `=` or starts like a URI), so it can name only the database. */
export function dbnameArg(/** @type {string} */ name) {
  if (!name.includes("=") && !/^postgres(?:ql)?:\/\//iu.test(name)) return `--dbname=${name}`;
  return `--dbname=dbname='${name.replace(/['\\]/gu, (c) => `\\${c}`)}'`;
}

const compressArg = (/** @type {DumpOptions} */ o, /** @type {number} */ major) => {
  if (o.method === "default") return [];
  if (major < 16) return [`--compress=${o.method === "none" ? 0 : (o.level ?? 6)}`];
  if (o.method === "none") return ["--compress=none"];
  return [`--compress=${o.method}${o.level === null ? "" : `:${o.level}`}`];
};

/**
 * pg_dump's arguments for a backup into `path`.
 * @param {DumpOptions} o
 * @param {string} path
 * @param {number} major the pg_dump's major version
 */
export function dumpArgs(o, path, major) {
  return [
    `--format=${o.format}`,
    "--verbose",
    "--no-password",
    ...o.schemas.map((s) => `--schema=${exactName(s)}`),
    ...o.tables.map((t) => `--table=${t}`),
    ...(o.schemas.length || o.tables.length ? ["--strict-names"] : []),
    ...(o.content === "schema" ? ["--schema-only"] : o.content === "data" ? ["--data-only"] : []),
    ...(o.noOwner ? ["--no-owner"] : []),
    ...(o.noPrivileges ? ["--no-privileges"] : []),
    ...compressArg(o, major),
    ...(o.jobs > 1 ? [`--jobs=${o.jobs}`] : []),
    ...(o.inserts ? ["--inserts"] : []),
    `--file=${argPath(path)}`,
  ];
}

/**
 * pg_restore's arguments for a restore of `path` into `database`.
 * @param {RestoreOptions} o
 * @param {{ path: string, database: string, list?: string }} target `list` is the chosen entries'
 *   list file, when not all are chosen.
 */
export function restoreArgs(o, { path, database, list }) {
  return [
    "--verbose",
    "--no-password",
    dbnameArg(database),
    ...(o.clean ? ["--clean"] : []),
    ...(o.ifExists ? ["--if-exists"] : []),
    ...(o.create ? ["--create"] : []),
    ...(o.content === "schema" ? ["--schema-only"] : o.content === "data" ? ["--data-only"] : []),
    ...(o.noOwner ? ["--no-owner"] : []),
    ...(o.noPrivileges ? ["--no-privileges"] : []),
    ...(o.jobs > 1 ? [`--jobs=${o.jobs}`] : []),
    ...(o.singleTransaction ? ["--single-transaction"] : []),
    ...(list ? [`--use-list=${argPath(list)}`] : []),
    argPath(path),
  ];
}

/**
 * The environment a program connects with: libpq's PG* variables, the password only when one was
 * typed this session (else libpq reads the person's ~/.pgpass). The client certificate and key go
 * as paths; libpq has no variable for a key's passphrase, so an encrypted key works on the
 * session path only (ADR 0331). A path under the home folder goes as `./…`, as the file arguments do.
 * @param {Connection} conn
 * @param {string | undefined} password
 */
export function connectionEnv(conn, password) {
  /** @type {Record<string, string>} */
  const env = {};
  const set = (/** @type {string} */ key, /** @type {string | undefined} */ value) => {
    if (value) env[key] = value;
  };
  set("PGHOST", conn.host);
  set("PGPORT", conn.port ? String(conn.port) : "");
  set("PGDATABASE", conn.database);
  set("PGUSER", conn.user);
  set("PGPASSWORD", password);
  set("PGSSLMODE", conn.ssl === "default" ? "" : conn.ssl);
  // libpq does not expand `~`; the program starts in the home folder, so `~/a` goes as `./a`.
  set("PGSSLROOTCERT", conn.sslCa && argPath(conn.sslCa));
  set("PGSSLCERT", conn.sslCert && argPath(conn.sslCert));
  set("PGSSLKEY", conn.sslKey && argPath(conn.sslKey));
  set("PGCONNECT_TIMEOUT", "10");
  set("PGAPPNAME", "endue");
  set("LC_ALL", "C");
  return env;
}

const SAFE = /^[A-Za-z0-9_./:=@%+,-]+$/u;
/** A word as a POSIX shell reads it back. */
export const shellWord = (/** @type {string} */ word) =>
  SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

const POWERSHELL_SAFE = /^[A-Za-z0-9_./:=%+\\-][A-Za-z0-9_./:=@%+\\-]*$/u;
/** A word as PowerShell reads it back: bare when safe (no `@`, `$`, `,` or `;` that it reads), else quoted. */
export const powershellWord = (/** @type {string} */ word) =>
  POWERSHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "''")}'`;

/**
 * The exact command line, as a terminal of the system would run it from the home folder, without
 * the password: POSIX shell words, or on Windows PowerShell's (`$env:` variables, `&` to call).
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {import("../../clients.js").Platform} [platform]
 */
export function commandLine(command, args, env, platform = "mac") {
  const vars = Object.entries(env).filter(([key]) => key !== "PGPASSWORD");
  if (platform === "windows") {
    const sets = vars.map(([key, value]) => `$env:${key}='${value.replaceAll("'", "''")}'; `);
    return `${sets.join("")}& ${[command, ...args].map(powershellWord).join(" ")}`;
  }
  const words = vars.map(([key, value]) => `${key}=${shellWord(value)}`);
  return [...words, shellWord(command), ...args.map(shellWord)].join(" ");
}

/** The name a backup suggests: the database and the minute, `shop-2026-11-21-0930.dump`. */
export function suggestedName(
  /** @type {string} */ database,
  /** @type {Format} */ format,
  at = new Date(),
) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const base = (database || "database").replace(/[^\w.-]+/gu, "_");
  return `${base}-${when}${EXTENSIONS[format]}`;
}
