// An export's file (PG-61): one result in a text format, or every result given as the sheets of an
// .xlsx, as the bytes fs.write takes, and the answer a worker posts for it (worker.js). The rows
// written are the selection's when there is one. No DOM.

import { contentOf, encodeText } from "./bytes.js";
import { exportText, picked } from "./text.js";
import { xlsxOf } from "./xlsx.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../results.js").FormatOptions} FormatOptions
 * @typedef {import("./options.js").ExportFormat} ExportFormat
 * @typedef {import("./options.js").ExportOptions} ExportOptions
 * @typedef {{ name: string, set: ResultSet, base: FormatOptions }} Part
 *   One result: its sheet's name, the set, and its dialect, table, types and selection.
 * @typedef {{ format: ExportFormat, options: ExportOptions, parts: Part[], deflate?: boolean }} Job
 * @typedef {import("./bytes.js").FileContent & { rows: number }} Written
 */

/** Cells a job writes. */
export const cellsOf = (/** @type {Job} */ job) =>
  job.parts.reduce(
    (n, p) => n + (p.base.rows ?? p.set.rows).length * (p.base.columns ?? p.set.columns).length,
    0,
  );

/** @param {Job} job @returns {Promise<Written>} */
export async function exportFile(job) {
  const { format, options, parts } = job;
  const rows = parts.reduce((n, p) => n + (p.base.rows ?? p.set.rows).length, 0);
  if (format === "xlsx") {
    const sheets = parts.map(({ name, set, base }) => {
      const { pick, columns, rows: chosen } = picked(set, base);
      return {
        name,
        columns,
        rows: chosen,
        oids: pick.map((i) => set.types?.[i]),
        types: pick.map((i) => base.types?.[i]),
      };
    });
    const bytes = await xlsxOf(sheets, options, { deflate: job.deflate ?? true });
    return { ...contentOf(bytes), rows };
  }
  const part = parts[0];
  if (!part) throw new Error("Export: no result to write.");
  return { ...encodeText(exportText(part.set, format, options, part.base), options), rows };
}

/** A worker's answer to `{ id, job }`: the file, or the sentence of what went wrong. */
export async function answerJob(/** @type {{ id: number, job: Job }} */ message) {
  try {
    return { id: message.id, ...(await exportFile(message.job)) };
  } catch (error) {
    return { id: message.id, error: error instanceof Error ? error.message : String(error) };
  }
}
