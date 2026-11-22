// Database: export the result to a file (PG-61). The format is named or picked; a format picked in
// the palette opens the options dialog, filled with the options that format had last time, and
// options given as arguments (an agent's, a key's) skip it. The place is always the save dialog's:
// the command takes no path. An .xlsx can hold every result of the console, a sheet each. An
// export of the rows held says so when the server has more. No DOM.

import { EXPORT_FORMATS, FIELDS, isExportFormat, LABELS, optionsOf } from "../../export/options.js";
import { exportResult } from "../../export.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../export/options.js").ExportFormat} ExportFormat
 * @typedef {import("../../export/options.js").ExportOptions} ExportOptions
 */

/** The store key of each format's last options. */
export const OPTIONS_KEY = "export-options";
const TITLE = "Database: export the result as";
const DETAILS = /** @type {Partial<Record<ExportFormat, string>>} */ ({
  xlsx: "Typed cells, a sheet per result",
  template: "A row written through {{column}} placeholders",
});

/** A format's last options, or its defaults when they no longer hold. */
const lastOf = (
  /** @type {Record<string, unknown>} */ kept,
  /** @type {ExportFormat} */ format,
) => {
  try {
    return optionsOf(format, /** @type {Record<string, unknown>} */ (kept[format] ?? {}));
  } catch {
    return optionsOf(format, format === "template" ? { row: "{{1}}" } : {});
  }
};

/** Only the options a format reads, as they are kept. */
const ownOf = (/** @type {ExportOptions} */ o, /** @type {ExportFormat} */ format) =>
  Object.fromEntries(FIELDS[format].map((k) => [k, o[k]]));

/**
 * @param {Deps} deps
 * @param {{ format?: unknown, options?: unknown, sheets?: unknown }} args
 */
export async function exportShown(deps, args) {
  if (args.format !== undefined && !isExportFormat(args.format))
    throw new Error(`${TITLE}: pick ${EXPORT_FORMATS.join(", ")}.`);
  const format = /** @type {ExportFormat | undefined} */ (
    args.format ??
      (await deps.pick(
        TITLE,
        EXPORT_FORMATS.map((id) => ({
          id,
          label: LABELS[id],
          ...(DETAILS[id] ? { detail: DETAILS[id] } : {}),
        })),
      ))
  );
  if (!format) throw deps.cancelled("Not exported.");
  const { shown, set, name, options } = deps.tools.exportable();
  const results = (shown.shown?.tabs ?? []).filter(
    (t) => t.set && (t.kind === "rows" || t.kind === "pinned"),
  );
  const kept = await deps.bridge.call("store.get", { key: OPTIONS_KEY }).catch(() => ({}));
  const store = /** @type {Record<string, unknown>} */ (
    kept?.value && typeof kept.value === "object" ? kept.value : {}
  );
  let settings = lastOf(store, format);
  let all = args.sheets === "all";
  if (args.options !== undefined) {
    if (!args.options || typeof args.options !== "object")
      throw new Error('Export: options is an object, such as { "delimiter": ";" }.');
    settings = optionsOf(format, { ...settings, .../** @type {object} */ (args.options) });
  } else if (args.format === undefined) {
    const answer =
      /** @type {{ options: Record<string, unknown>, sheets?: string } | undefined} */ (
        await deps.dialog("export-options", {
          format,
          label: LABELS[format],
          fields: FIELDS[format],
          options: settings,
          table: options.table ?? "",
          rows: (options.rows ?? set.rows).length,
          partial: set.truncated,
          results: format === "xlsx" ? results.length : 0,
        })
      );
    if (!answer) throw deps.cancelled("Not exported.");
    settings = optionsOf(format, answer.options);
    all = answer.sheets === "all";
  }
  const parts =
    format === "xlsx" && all && results.length > 1
      ? results.map((t) => ({
          name: t.label,
          set: /** @type {import("../../engines/common.js").ResultSet} */ (t.set),
          base: options.dialect ? { dialect: options.dialect } : {},
        }))
      : undefined;
  const done = await exportResult(deps.bridge, {
    set,
    format,
    name,
    options,
    settings,
    ...(parts ? { parts } : {}),
    ...(deps.startWorker ? { startWorker: deps.startWorker } : {}),
  });
  if (!done) throw deps.cancelled("Not exported.");
  await deps.bridge
    .call("store.set", { key: OPTIONS_KEY, value: { ...store, [format]: ownOf(settings, format) } })
    .catch(() => {});
  const sheets = parts ? ` in ${parts.length} sheets` : "";
  const more = done.partial
    ? " (the rows loaded: the server has more; load more rows first for the rest)"
    : "";
  deps.say(`Exported ${done.rows} rows as ${LABELS[format]}${sheets} to ${done.path}${more}.`);
  void deps.commands.run("desk.files.reveal", { path: done.path }).catch(() => {});
  return done;
}
