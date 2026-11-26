// One item of a whole export to one file (PG-64): its COPY in the export's transaction (the
// server's CSV or text bytes when they are the file, copy/direct.js, else the text format the
// plugin rewrites), each page through the file's pipe (export/pipe-client.js, in a worker) and
// appended to the temporary file (copy/partial.js), which takes its name once the COPY ended well.
// A cancel or a failure leaves nothing at either name. Progress: the rows and bytes written. No DOM.

import { copySql, directOf } from "../../copy/direct.js";
import { copyOut } from "../../copy/index.js";
import { partialFile } from "../../copy/partial.js";
import { startPipe } from "../../export/pipe-client.js";
import { t } from "../../strings/index.js";
import { failureOf } from "./snapshot.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./source.js").Item} Item
 * @typedef {import("../../export/options.js").ExportFormat} ExportFormat
 * @typedef {import("../../export/options.js").ExportOptions} ExportOptions
 * @typedef {Awaited<ReturnType<typeof import("./snapshot.js").openSnapshot>>} Snapshot
 * @typedef {{ rows: number, bytes: number }} Count
 * @typedef {{ path: string, rows: number, bytes: number, direct: boolean }} Written
 */

/**
 * @param {Pick<Deps, "bridge" | "execute" | "startWorker">} deps
 * @param {{
 *   conn: Connection, snapshot: Snapshot, item: Item, path: string, signal: AbortSignal,
 *   format: ExportFormat, options: ExportOptions, gzip: boolean,
 *   scope?: import("../../copy/partial.js").WriteScope, replace?: boolean,
 *   progress(count: Count): void,
 * }} job
 * @returns {Promise<Written>}
 */
export async function exportItem(deps, job) {
  const { snapshot, item, format, options } = job;
  const meta = {
    ...(await snapshot.describe(item.query)),
    ...(item.table ? { table: item.table } : {}),
  };
  const direct = directOf(format, options, { columns: meta.columns, version: snapshot.version });
  const pipe = await startPipe(
    {
      format,
      options,
      meta,
      gzip: job.gzip && format !== "xlsx",
      sheet: item.name,
      ...(direct ? { direct: direct.format } : {}),
    },
    deps.startWorker,
  );
  const file = partialFile(deps.bridge, job.path, {
    ...(job.scope ? { scope: job.scope } : {}),
    ...(job.replace === false ? { replace: false } : {}),
  });
  let bytes = 0;
  const put = async (/** @type {import("../../export/pipe.js").Out[]} */ outs) => {
    for (const out of outs) {
      await file.write(out);
      bytes += out.bytes;
    }
    job.progress({ rows: pipe.rows(), bytes });
  };
  try {
    const run = await copyOut(
      deps.execute,
      job.conn,
      copySql(item.query, direct),
      {
        write: async (chunk) =>
          put(await pipe.push({ data: chunk.data, encoding: chunk.encoding })),
        close: async () => put(await pipe.end()),
      },
      {
        session: snapshot.session,
        signal: job.signal,
        catalog: true,
        interactive: false,
        name: item.name,
      },
    );
    const why = failureOf(run);
    if (why || job.signal.aborted)
      throw new Error(job.signal.aborted ? t("features.exportAll.file.cancelled") : why);
    const path = await file.finish();
    const rows = pipe.rows();
    return { path, rows, bytes, direct: direct !== undefined };
  } catch (error) {
    await file.discard();
    throw error;
  } finally {
    pipe.stop();
  }
}
