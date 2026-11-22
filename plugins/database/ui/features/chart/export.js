// A chart as an image (PG-44): SVG (the theme's colours as values) or PNG at 960 by 540, written
// where the person picks in the desk's save dialog, with one perm.request when the desk refuses the
// write, as the ER diagram's export does. The data is counted again from the tab's result and
// settings (in the chart's worker when it is large), so the export needs no DOM: the page's chart
// drawer (chart/page.js) resolves the colours and draws the PNG.

import { chartClient } from "../../chart/client.js";
import { drawChart } from "../../chart/draw.js";
import { chartPageOf } from "../../chart/page.js";
import { withGrant, writeScope } from "../../console-files.js";
import { chartTarget } from "./open.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

export const EXPORT_SIZE = { width: 960, height: 540 };
const NAMES = { svg: "SVG", png: "PNG" };

/** A file name safe on every file system. */
const fileName = (/** @type {string} */ base, /** @type {"svg" | "png"} */ ext) => {
  const safe = base
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 80);
  return `${safe || "chart"}.${ext}`;
};

/**
 * Export the Chart tab on screen where the person picks (or to `args.path`).
 * @param {Deps} deps
 * @param {{ format?: unknown, path?: unknown }} args
 */
export async function exportChart(deps, args) {
  const { target, tab } = chartTarget(deps);
  const chart = tab?.kind === "chart" ? tab.chart : undefined;
  if (!target || !tab || !chart?.settings)
    throw new Error("Export a chart from its tab: open one with Database: draw the result as a chart.");
  const page = chartPageOf();
  if (!page) throw new Error("This page cannot draw the chart as an image.");
  const format =
    args.format === "svg" || args.format === "png"
      ? args.format
      : /** @type {"svg" | "png" | undefined} */ (
          await deps.pick("Database: export the chart as", [
            { id: "png", label: "PNG", detail: "960 by 540" },
            { id: "svg", label: "SVG", detail: "Vector, in the theme's colours" },
          ])
        );
  if (!format) throw deps.cancelled("Not exported.");
  const conn = deps.manager.get(target.connection);
  let path = typeof args.path === "string" && args.path ? args.path : "";
  if (!path) {
    const picked = await deps.bridge.call("dialog.save", {
      title: "Export the chart",
      suggestedName: fileName(`chart-${conn?.name ?? "result"}-${tab.label}`, format),
      filters: [{ name: `${NAMES[format]} image`, extensions: [format] }],
    });
    if (picked.cancelled || !picked.path) throw deps.cancelled("Not exported.");
    path = picked.path;
  }
  const data = await chartClient(deps.startWorker).chart(chart.set, chart.settings);
  const svg = drawChart(data, chart.settings, EXPORT_SIZE, page.palette());
  const content =
    format === "svg" ? svg : (await page.png(svg, EXPORT_SIZE.width, EXPORT_SIZE.height)).base64;
  const scope = writeScope(path);
  await withGrant(
    deps.bridge,
    scope,
    () =>
      deps.bridge.call("fs.write", {
        path,
        content,
        encoding: format === "svg" ? "utf8" : "base64",
        scope,
      }),
    `To export the chart to ${path}`,
  );
  deps.say(`Exported the chart as ${NAMES[format]} to ${path}.`);
  return { path, format };
}
