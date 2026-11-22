// Database: back up a database (PG-62, ADR 0313). A PostgreSQL connection's server is read for its
// version, pg_dump is found and checked against it, the form asks what to back up and how (an
// agent's arguments only fill it: nothing runs until the person submits it), the save dialog names
// the file or folder, its grant is asked for, and pg_dump runs in its log panel. The end says what
// was written and its size. No DOM.

import {
  commandLine,
  connectionEnv,
  dumpArgs,
  dumpOptions,
  majorOf,
  suggestedName,
} from "./args.js";
import {
  askPath,
  choosePostgres,
  fileName,
  passwordNote,
  programFor,
  release,
  serverVersion,
  sizeOf,
  sizeText,
} from "./common.js";
import { logState } from "./job.js";
import { errorWords } from "./toc.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../clients.js").Platform} Platform
 * @typedef {import("./args.js").DumpOptions} DumpOptions
 * @typedef {ReturnType<typeof import("./job.js").createJobs>} Jobs
 * @typedef {{
 *   connection: string, database: string, tag: string, server: string,
 *   program: { command: string, version: string, platform?: Platform }, schemas: string[], path: string,
 *   env: Record<string, string>, password: string, options: DumpOptions,
 * }} BackupModel
 *   What the backup form shows; `env` has no password; `path` is "" until the save dialog names one.
 */

const DIALOG_NAMES = {
  custom: "PostgreSQL custom archive",
  tar: "Tar archive",
  plain: "SQL script",
};

/** The form's starting options: the command's arguments over the defaults. */
function given(/** @type {Record<string, unknown>} */ args, /** @type {number} */ major) {
  const raw = { ...args };
  if (raw.schemas !== undefined && raw.scope === undefined) raw.scope = "schemas";
  if (raw.tables !== undefined && raw.scope === undefined) raw.scope = "tables";
  try {
    return dumpOptions(raw, major);
  } catch {
    return dumpOptions({ ...raw, scope: "database" }, major);
  }
}

/** Ask where to save, as the format writes it: a file, or a folder pg_dump creates. */
async function chooseTarget(
  /** @type {Deps} */ deps,
  /** @type {DumpOptions} */ options,
  /** @type {Connection} */ conn,
) {
  const suggested = suggestedName(conn.database, options.format);
  const extension = suggested.split(".").at(-1) ?? "";
  const title =
    options.format === "directory"
      ? "Name the folder the backup is written into"
      : "Save the backup as";
  const named = options.format === "directory" ? undefined : DIALOG_NAMES[options.format];
  const chosen = await deps.bridge.call("dialog.save", {
    title,
    suggestedName: suggested,
    ...(named ? { filters: [{ name: named, extensions: [extension] }] } : {}),
  });
  if (chosen.cancelled || !chosen.path) throw deps.cancelled("Not backed up.");
  return chosen.path;
}

/**
 * How many tables' rows a verbose line says were written. An archive says "dumping contents" for
 * each; a plain file says "processing data" for each, and "dumping contents" too unless INSERTs.
 * Parallel jobs write to one stream a piece at a time (`pg_dump:`, ` `, the words), so one job's
 * pieces land in another's line: the words are counted wherever they are.
 */
const counter = (/** @type {string} */ format) => {
  const said =
    format === "plain" ? /processing data for table "/gu : /dumping contents of table "/gu;
  return (/** @type {string} */ line) => line.match(said)?.length ?? 0;
};

/**
 * @param {Deps} deps
 * @param {Jobs} jobs
 * @param {Record<string, unknown>} args
 */
export async function backup(deps, jobs, args) {
  const conn = await choosePostgres(deps, args.connection, "Database: back up which connection?");
  if (!conn) throw deps.cancelled("Not backed up.");
  const server = await serverVersion(deps, conn);
  const program = await programFor(deps, "pg_dump", conn, server);
  const major = majorOf(program.version);
  const schemas = await deps.catalog.schemas(conn, true).catch(() => []);
  const password = deps.manager.passwords.get(conn.id);
  const env = connectionEnv(conn, password);
  const shown = connectionEnv(conn, undefined);
  /** @type {BackupModel} */
  const model = {
    connection: conn.name,
    database: conn.database,
    tag: conn.tag,
    server: release(server),
    program: {
      command: program.command,
      version: program.version,
      platform: deps.clients.platform,
    },
    schemas,
    path: typeof args.path === "string" ? args.path : "",
    env: shown,
    password: passwordNote(password, deps.clients.platform),
    options: given(args, major),
  };
  const answer = /** @type {Record<string, unknown> | undefined} */ (
    await deps.dialog("backup", model)
  );
  if (!answer) throw deps.cancelled("Not backed up.");
  const options = dumpOptions(answer, major);
  const path = model.path || (await chooseTarget(deps, options, conn));
  await askPath(deps, "fs:write", path, `To write the backup of ${conn.name} with pg_dump`);
  const argv = dumpArgs(options, path, major);
  const what = options.format === "directory" ? "folder" : "file";
  const state = logState(
    {
      kind: "backup",
      title: `Back up ${conn.name} to ${fileName(path)}`,
      command: commandLine(program.command, argv, shown, deps.clients.platform),
      password: passwordNote(password, deps.clients.platform),
      noun: "tables",
    },
    Date.now(),
  );
  const done = await jobs.run({
    conn,
    name: `backup: ${conn.name} · ${fileName(path)}`,
    state,
    invocation: {
      command: program.command,
      args: argv,
      env,
      cwd: "~",
      nonce: "",
      statements: [],
      maxRows: 0,
      stopAfter: 0,
    },
    counts: counter(options.format),
    finish: async (outcome, last) => {
      const took = `${((Date.now() - last.started) / 1000).toFixed(1)} s`;
      if (outcome.cancelled)
        return {
          status: "cancelled",
          result: `Cancelled: what pg_dump wrote so far stays in ${path}; it is not a whole backup.`,
        };
      if (outcome.code !== 0)
        return {
          status: "failed",
          result: `pg_dump failed: ${errorWords(outcome.stderr, "pg_dump") || `it ended with ${outcome.code ?? outcome.signal}.`}`,
        };
      const size = await sizeOf(deps, path);
      const measured = size === undefined ? "" : ` (${sizeText(size)})`;
      const rows = last.done
        ? `, with ${last.done === 1 ? "1 table's" : `${last.done} tables'`} rows`
        : "";
      return { status: "done", result: `Wrote the ${what} ${path}${measured} in ${took}${rows}.` };
    },
  });
  deps.say(done.result || `Backup ${done.status}.`);
  return { status: done.status, path, said: done.result };
}
