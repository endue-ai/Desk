// Database: export every row to a file, and export tables to a folder (PG-64). The format is named
// or picked and its options asked as the result's export asks (filled with that format's last
// options), with gzip besides; the place is the save dialog's (one file) or the folder dialog's
// (several, one file each, a name already there kept: the next free name is taken). Everything is
// read in one read-only transaction with one snapshot, a COPY per file, in the job's panel. No DOM.

import {
  EXPORT_FORMATS,
  EXTENSIONS,
  FIELDS,
  isExportFormat,
  LABELS,
  optionsOf,
} from "../../export/options.js";
import { exportName, FOLDER_KEY } from "../../export.js";
import { OPTIONS_KEY } from "../export/run.js";
import { exportItem } from "./file.js";
import { openSnapshot } from "./snapshot.js";
import { postgresOnly, sourceOf, tableItem } from "./source.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../export/options.js").ExportFormat} ExportFormat
 * @typedef {import("../../export/options.js").ExportOptions} ExportOptions
 * @typedef {ReturnType<typeof import("./jobs.js").createJobs>} Jobs
 * @typedef {import("./source.js").Item} Item
 * @typedef {{ format?: unknown, options?: unknown, compress?: unknown }} FormatArgs
 */

const NOTE = "Every row the server has, read in one snapshot. You choose where the files go next.";

/** The format, its options and whether to compress: from the arguments, else asked. */
async function chooseFormat(
  /** @type {Deps} */ deps,
  /** @type {FormatArgs} */ args,
  /** @type {string} */ title,
) {
  if (args.format !== undefined && !isExportFormat(args.format))
    throw new Error(`${title}: pick ${EXPORT_FORMATS.join(", ")}.`);
  const format = /** @type {ExportFormat | undefined} */ (
    args.format ??
      (await deps.pick(
        title,
        EXPORT_FORMATS.map((id) => ({ id, label: LABELS[id] })),
      ))
  );
  if (!format) throw deps.cancelled("Not exported.");
  const kept = await deps.bridge.call("store.get", { key: OPTIONS_KEY }).catch(() => ({}));
  const store = /** @type {Record<string, unknown>} */ (
    kept?.value && typeof kept.value === "object" ? kept.value : {}
  );
  let options;
  try {
    options = optionsOf(format, /** @type {Record<string, unknown>} */ (store[format] ?? {}));
  } catch {
    options = optionsOf(format, format === "template" ? { row: "{{1}}" } : {});
  }
  let compress = args.compress === true;
  if (args.options !== undefined) {
    if (!args.options || typeof args.options !== "object")
      throw new Error('Export: options is an object, such as { "delimiter": ";" }.');
    options = optionsOf(format, { ...options, .../** @type {object} */ (args.options) });
  } else if (args.format === undefined) {
    const answer =
      /** @type {{ options: Record<string, unknown>, compress?: boolean } | undefined} */ (
        await deps.dialog("export-all-options", {
          format,
          label: LABELS[format],
          fields: FIELDS[format],
          options,
          table: "",
          note: NOTE,
          compress,
          compressible: format !== "xlsx",
        })
      );
    if (!answer) throw deps.cancelled("Not exported.");
    options = optionsOf(format, answer.options);
    compress = answer.compress === true;
  }
  const own = Object.fromEntries(FIELDS[format].map((k) => [k, options[k]]));
  await deps.bridge
    .call("store.set", { key: OPTIONS_KEY, value: { ...store, [format]: own } })
    .catch(() => {});
  return { format, options, gzip: compress && format !== "xlsx" };
}

/** A file name: the item's name made safe, the format's extension, `.gz` when compressed. */
const fileName = (
  /** @type {string} */ name,
  /** @type {ExportFormat} */ format,
  /** @type {boolean} */ gzip,
) =>
  `${name.replace(/[\\/:*?"<>|\p{Cc}\s]+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "") || "table"}.${EXTENSIONS[format]}${gzip ? ".gz" : ""}`;

/**
 * Run the items into their files in one snapshot, in a job's panel.
 * @param {Deps} deps @param {Jobs} jobs @param {Connection} conn
 * @param {{ title: string, format: ExportFormat, options: ExportOptions, gzip: boolean,
 *   files: (folder: Awaited<ReturnType<typeof openSnapshot>>) => Promise<{ item: Item, path: string }[]>,
 *   scope?: import("../../copy/partial.js").WriteScope }} plan
 */
async function runJob(deps, jobs, conn, plan) {
  const control = new AbortController();
  let job;
  const snapshot = await openSnapshot(deps, conn, control.signal);
  try {
    const files = await plan.files(snapshot);
    job = await jobs.start(conn, plan.title, {
      title: plan.title,
      format: LABELS[plan.format],
      files: files.map(({ item, path }) => ({
        name: item.name,
        path,
        rows: 0,
        bytes: 0,
        status: "waiting",
      })),
    });
    const stop = () => control.abort();
    job.signal.addEventListener("abort", stop, { once: true });
    /** @type {import("./file.js").Written[]} */
    const written = [];
    for (const [at, { item, path }] of files.entries()) {
      if (control.signal.aborted) break;
      const mark = job;
      mark.file(at, { status: "running" });
      try {
        const done = await exportItem(deps, {
          conn,
          snapshot,
          item,
          path,
          signal: control.signal,
          format: plan.format,
          options: plan.options,
          gzip: plan.gzip,
          ...(plan.scope ? { scope: plan.scope, replace: false } : {}),
          progress: (count) => mark.file(at, count),
        });
        written.push(done);
        mark.file(at, {
          status: "done",
          path: done.path,
          rows: done.rows,
          bytes: done.bytes,
          direct: done.direct,
        });
      } catch (error) {
        mark.file(at, { status: control.signal.aborted ? "cancelled" : "failed" });
        if (control.signal.aborted) break;
        throw error;
      }
    }
    if (control.signal.aborted) {
      job.end("cancelled", "Cancelled: the file under way was discarded, nothing of it stays.");
      throw deps.cancelled("Not exported.");
    }
    const rows = written.reduce((n, w) => n + w.rows, 0);
    const where = written.length === 1 ? (written[0]?.path ?? "") : `${written.length} files`;
    const sentence = `Exported ${rows.toLocaleString("en-US")} rows as ${LABELS[plan.format]} to ${where}.`;
    job.end("done", sentence);
    deps.say(sentence);
    return { files: written, rows };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (job && !control.signal.aborted) job.end("failed", why);
    throw error;
  } finally {
    await snapshot.close();
  }
}

/** Database: export every row to a file. @param {Deps} deps @param {Jobs} jobs */
export async function exportAll(deps, jobs, /** @type {Record<string, any>} */ args) {
  const { conn, item } = await sourceOf(deps, args);
  const { format, options, gzip } = await chooseFormat(deps, args, "Database: export every row as");
  const kept = await deps.bridge.call("store.get", { key: FOLDER_KEY }).catch(() => ({}));
  const folder = typeof kept?.value === "string" ? kept.value : "";
  const name = exportName(item.name, format, new Date());
  const chosen = await deps.bridge.call("dialog.save", {
    title: "Export every row",
    suggestedName: gzip ? `${name}.gz` : name,
    ...(folder ? { startIn: folder } : {}),
    filters: [
      {
        name: LABELS[format],
        extensions: [gzip ? `${EXTENSIONS[format]}.gz` : EXTENSIONS[format]],
      },
    ],
  });
  if (chosen.cancelled || !chosen.path) throw deps.cancelled("Not exported.");
  const path = chosen.path;
  const done = await runJob(deps, jobs, conn, {
    title: item.name,
    format,
    options,
    gzip,
    files: async () => [{ item, path }],
  });
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (at > 0)
    await deps.bridge
      .call("store.set", { key: FOLDER_KEY, value: path.slice(0, at) })
      .catch(() => {});
  void deps.commands.run("desk.files.reveal", { path }).catch(() => {});
  return done;
}

/** The schema whose tables go: named, else picked. */
async function schemaOf(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {unknown} */ given,
) {
  if (typeof given === "string" && given) return given;
  const listed = await deps.execute(
    conn,
    "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY 1",
    { catalog: true },
  );
  const names = (listed.result.statements[0]?.sets[0]?.rows ?? []).map((r) => r[0] ?? "");
  const picked = await deps.pick(
    "Database: export the tables of which schema?",
    names.map((id) => ({ id, label: id })),
  );
  if (!picked) throw deps.cancelled("Not exported.");
  return picked;
}

/** Database: export tables to a folder. @param {Deps} deps @param {Jobs} jobs */
export async function exportTables(deps, jobs, /** @type {Record<string, any>} */ args) {
  const conn = await deps.manager.choose(
    args.connection,
    "Database: export the tables of which connection?",
  );
  if (!conn) throw deps.cancelled("Not exported.");
  postgresOnly(conn);
  const schema = await schemaOf(deps, conn, args.schema);
  const { format, options, gzip } = await chooseFormat(
    deps,
    args,
    "Database: export the tables as",
  );
  const picked = await deps.bridge.call("dialog.open", {
    title: `The folder the tables of ${schema} go to`,
    kind: "folders",
  });
  const folder = picked.cancelled ? undefined : picked.paths?.[0];
  if (!folder) throw deps.cancelled("Not exported.");
  const base = folder.replace(/[\\/]+$/u, "");
  const scope = { permission: /** @type {const} */ ("fs:write"), paths: [base, `${base}/**`] };
  const wanted = Array.isArray(args.tables) ? args.tables.map(String) : undefined;
  return runJob(deps, jobs, conn, {
    title: `${schema} to ${base}`,
    format,
    options,
    gzip,
    scope,
    async files(snapshot) {
      const names = wanted ?? (await snapshot.tables(schema));
      if (names.length === 0) throw new Error(`${schema} has no tables to export.`);
      return names.map((name) => {
        const item = tableItem(schema, name);
        return { item, path: `${base}/${fileName(item.name, format, gzip)}` };
      });
    },
  });
}
