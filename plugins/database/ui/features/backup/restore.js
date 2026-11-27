// Database: restore a database (PG-62, ADR 0313). The dump comes from the open dialog (a file, or a
// folder for a directory archive) and its grant is asked for; pg_restore --list says what it holds,
// or that it is a plain SQL file. The form asks into which connection and how, and which entries;
// an agent's arguments only fill it. A read-only connection refuses; production is always asked,
// its environment named. pg_restore runs in its log panel; a plain SQL file runs as a script in a
// console (run-file.js, PG-24), never through psql -f. Settings newer than the server that
// pg_restore sets are skipped, not a failure (restore-outcome.js, #647). No DOM.

import { outputBytes } from "../../run.js";
import { t } from "../../strings/index.js";
import { runFile } from "../consoles/run-file.js";
import {
  argPath,
  commandLine,
  connectionEnv,
  listPath,
  RESTORE_DEFAULTS,
  restoreArgs,
  restoreOptions,
} from "./args.js";
import {
  askPath,
  fileName,
  passwordNote,
  postgresOf,
  programFor,
  serverVersion,
} from "./common.js";
import { logState } from "./job.js";
import {
  oneTransactionRefusal,
  plainSkips,
  skippedNote,
  skippedSettings,
} from "./restore-outcome.js";
import { errorWords, isPlain, listFile, parseToc } from "./toc.js";
import { readToc } from "./toc-reader.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../clients.js").Platform} Platform
 * @typedef {import("../../clients.js").Client} Client
 * @typedef {import("./toc.js").Toc} Toc
 * @typedef {ReturnType<typeof import("./job.js").createJobs>} Jobs
 * @typedef {{ id: string, name: string, tag: string, readOnly: boolean, database: string, env: Record<string, string> }} Target
 * @typedef {{
 *   file: string, format: Toc["format"] | "plain", database: string, from: string, by: string,
 *   program: { command: string, version: string, platform?: Platform }, connections: Target[], connection: string,
 *   entries: Array<Omit<import("./toc.js").Entry, "line">>, options: import("./args.js").RestoreOptions,
 * }} RestoreModel
 * @typedef {{ connection: string, options?: Record<string, unknown>, chosen?: number[] | null }} RestoreAnswer
 */

/**
 * How many entries a verbose line says were made or loaded. Parallel jobs write to one stream a
 * piece at a time, so one job's pieces land in another's line: the words are counted wherever they
 * are (and never past the entries chosen).
 */
const counts = (/** @type {string} */ line) =>
  line.match(/creating [A-Z]|processing data for table "/gu)?.length ?? 0;

/** The dump to restore: a file or a folder, from the open dialog. */
async function chooseSource(/** @type {Deps} */ deps) {
  const kind = await deps.pick(t("features.backup.restore.databaseRestoreFrom"), [
    {
      id: "files",
      label: t("features.backup.restore.aFile"),
      detail: t("features.backup.restore.aCustomOrTarArchiveOr"),
    },
    {
      id: "folders",
      label: t("features.backup.restore.aFolder"),
      detail: t("features.backup.restore.aDirectoryArchive"),
    },
  ]);
  if (!kind) throw deps.cancelled(t("features.backup.restore.notRestored"));
  const picked = await deps.bridge.call("dialog.open", {
    kind: /** @type {"files" | "folders"} */ (kind),
    title:
      kind === "files"
        ? t("features.backup.restore.restoreFromWhichFile")
        : t("features.backup.restore.restoreFromWhichFolder"),
  });
  const path = picked.cancelled ? undefined : picked.paths[0];
  if (!path) throw deps.cancelled(t("features.backup.restore.notRestored"));
  return path;
}

/** What the dump holds: pg_restore's list, or that it is a plain SQL file. */
async function listOf(
  /** @type {Deps} */ deps,
  /** @type {string} */ path,
  /** @type {() => Promise<Client>} */ program,
) {
  if (/\.sql$/iu.test(path)) return { plain: true, toc: undefined };
  const { command } = await program();
  const outcome = await deps.runner.run({
    command,
    args: ["--list", argPath(path)],
    env: { LC_ALL: "C" },
    cwd: "~",
    nonce: "",
    statements: [],
    maxRows: 0,
    stopAfter: 0,
  });
  if (outcome.code !== 0) {
    if (isPlain(outcome.stderr)) return { plain: true, toc: undefined };
    throw new Error(
      t("features.backup.restore.cannotRead", {
        command: String(command),
        value: String(fileName(path)),
        value2: String(errorWords(outcome.stderr, "pg_restore")),
      }),
    );
  }
  const bytes = outputBytes(outcome)?.stdout;
  const toc = bytes ? await readToc(bytes, deps.startWorker) : parseToc(outcome.stdout);
  if (!toc.format)
    throw new Error(
      t("features.backup.restore.isNotAnArchivePgRestore", { value: String(fileName(path)) }),
    );
  return { plain: false, toc };
}

/** The form's starting options: the command's arguments, or the defaults when they cannot be. */
function startingOptions(/** @type {Record<string, unknown>} */ args, /** @type {Toc} */ toc) {
  try {
    return restoreOptions(args, toc.format || "custom");
  } catch {
    return { ...RESTORE_DEFAULTS };
  }
}

/** The question a production connection is asked first, and what the options will do. */
function question(
  /** @type {Connection} */ conn,
  /** @type {string} */ path,
  /** @type {import("./args.js").RestoreOptions} */ o,
  /** @type {Toc} */ toc,
) {
  return {
    title: t("features.backup.restore.restoreInto", {
      value: String(fileName(path)),
      name: String(conn.name),
    }),
    reasons: [
      t("features.backup.restore.isTaggedProduction", { name: String(conn.name) }),
      t("features.backup.restore.intoTheDatabaseOn", {
        value: String(conn.database || t("features.backup.restore.ofTheConnection")),
        value2: String(conn.host || t("features.backup.restore.theLocalServer")),
      }),
      ...(o.clean ? [t("features.backup.restore.cleanDropsEachObjectInThe")] : []),
      ...(o.create
        ? [
            t("features.backup.restore.createMakesTheDatabase", {
              value: String(toc.database || t("features.backup.restore.theDumpWasMadeFrom")),
            }),
          ]
        : []),
    ],
  };
}

/**
 * @param {Deps} deps
 * @param {Jobs} jobs
 * @param {Record<string, unknown>} args
 */
export async function restore(deps, jobs, args) {
  const targets = postgresOf(deps);
  if (targets.length === 0)
    throw new Error(t("features.backup.restore.noPostgresqlConnectionYetAddOne"));
  const path = typeof args.path === "string" && args.path ? args.path : await chooseSource(deps);
  await askPath(deps, "fs:read", path, `To read ${fileName(path)} with pg_restore`);
  const program = () => deps.clients.program("pg_restore");
  const { plain, toc } = await listOf(deps, path, program);
  const shown = deps.consoles.current();
  const named = typeof args.connection === "string" ? deps.manager.get(args.connection) : undefined;
  const here = shown ? deps.manager.get(shown.connection) : undefined;
  const preferred = [named, here].find((c) => c?.engine === "postgresql") ?? targets[0];
  const format = toc?.format || "plain";
  const options = toc ? startingOptions(args, toc) : { ...RESTORE_DEFAULTS };
  const client = plain ? undefined : await program();
  /** @type {RestoreModel} */
  const model = {
    file: path,
    format,
    database: toc?.database ?? "",
    from: toc?.from ?? "",
    by: toc?.by ?? "",
    program: {
      command: client?.command ?? "",
      version: client?.version ?? "",
      platform: deps.clients.platform,
    },
    connections: targets.map((c) => ({
      id: c.id,
      name: c.name,
      tag: c.tag,
      readOnly: c.readOnly,
      database: c.database,
      env: connectionEnv(c, undefined),
    })),
    connection: preferred?.id ?? "",
    entries: (toc?.entries ?? []).map(({ line: _line, ...entry }) => entry),
    options,
  };
  const answer = /** @type {RestoreAnswer | undefined} */ (await deps.dialog("restore", model));
  if (!answer) throw deps.cancelled(t("features.backup.restore.notRestored"));
  const conn = deps.manager.get(answer.connection);
  if (conn?.engine !== "postgresql")
    throw new Error(t("features.backup.restore.restoreIntoAPostgresqlConnection"));
  if (conn.readOnly)
    throw new Error(
      t("features.backup.restore.isReadOnlyNothingIsRestored", { name: String(conn.name) }),
    );
  const server = await serverVersion(deps, conn);
  const serverMajor = Math.floor(server / 10000);
  if (plain || !toc || !client)
    return runFile(deps, { path, connection: conn.id }, plainSkips(serverMajor));

  const chosen = Array.isArray(answer.chosen) ? answer.chosen : null;
  if (chosen && chosen.length === 0)
    throw new Error(t("features.backup.restore.chooseAnEntryToRestore"));
  const chosenOptions = restoreOptions(answer.options ?? {}, toc.format || "custom");
  const restorer = await programFor(deps, "pg_restore", conn, server);
  const refused = chosenOptions.singleTransaction
    ? oneTransactionRefusal(restorer.version, serverMajor)
    : undefined;
  if (refused) throw new Error(refused);
  if (conn.tag === "production") {
    const { title, reasons } = question(conn, path, chosenOptions, toc);
    if (!(await deps.confirm(title, reasons)))
      throw deps.cancelled(t("features.backup.restore.notRestored"));
  }
  const some = chosen && chosen.length < toc.entries.length;
  const list = some ? listPath(conn.id) : undefined;
  if (list) {
    const scope = { permission: /** @type {const} */ ("fs:write"), paths: [list] };
    const content = listFile(toc.entries, chosen ?? []);
    await deps.bridge.call("fs.write", {
      path: list,
      content,
      encoding: "utf8",
      createDirs: true,
      scope,
    });
  }
  const argv = restoreArgs(chosenOptions, {
    path,
    database: conn.database,
    ...(list ? { list } : {}),
  });
  const password = deps.manager.passwords.get(conn.id);
  const total = some ? (chosen?.length ?? 0) : toc.entries.length;
  const state = logState(
    {
      kind: "restore",
      title: t("features.backup.restore.restoreInto2", {
        value: String(fileName(path)),
        name: String(conn.name),
      }),
      command: commandLine(
        restorer.command,
        argv,
        connectionEnv(conn, undefined),
        deps.clients.platform,
      ),
      password: passwordNote(password, deps.clients.platform),
      noun: "entries",
      total,
    },
    Date.now(),
  );
  const done = await jobs.run({
    conn,
    name: `restore: ${conn.name} · ${fileName(path)}`,
    state,
    invocation: {
      command: restorer.command,
      args: argv,
      env: connectionEnv(conn, password),
      cwd: "~",
      nonce: "",
      statements: [],
      maxRows: 0,
      stopAfter: 0,
    },
    counts,
    finish: async (outcome, last) => {
      const took = `${((Date.now() - last.started) / 1000).toFixed(1)} s`;
      if (outcome.cancelled)
        return {
          status: "cancelled",
          result: t("features.backup.restore.cancelledHoldsWhatWasRestoredSo", {
            name: String(conn.name),
          }),
        };
      const ignored = /errors ignored on restore: (\d+)/u.exec(outcome.stderr)?.[1];
      // Settings pg_restore sets that the server does not know are skipped, not a failure (#647).
      const skipped = outcome.code === 1 ? skippedSettings(outcome.stderr, serverMajor) : null;
      if (outcome.code !== 0 && !skipped)
        return {
          status: "failed",
          result: ignored
            ? `Restored into ${conn.name} with ${ignored} errors, in ${took}: ${errorWords(outcome.stderr, "pg_restore")}`
            : `pg_restore failed: ${errorWords(outcome.stderr, "pg_restore") || t("features.backup.restore.itEndedWith", { value: String(outcome.code ?? outcome.signal) })}`,
        };
      return {
        status: "done",
        result: `Restored ${fileName(path)} into ${conn.name} in ${took}: ${total} entries.${skipped ? ` ${skippedNote(skipped, serverMajor, restorer.version)}` : ""}`,
      };
    },
  });
  deps.say(done.result || t("features.backup.restore.restore", { status: String(done.status) }));
  return { status: done.status, connection: conn.name, said: done.result };
}
