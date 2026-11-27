// A result drawn as a chart (PG-44, ADR 0336): Database: draw the result as a chart opens a Chart
// tab after the result on screen (Chart in the result's toolbar), drawn by chart/view.js; Database:
// export the chart writes it as SVG or PNG (Export in the tab writes a PNG); a settings change of a
// starred query's chart is kept with it. The footer's totals of a selection are the grid's
// (chart/totals.js). No DOM here.

import { exportChart } from "./export.js";
import { keepSettings, openChart } from "./open.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "chart",
  commands: (deps) => ({
    "endue.database.chart": (args) => openChart(deps, args),
    "endue.database.chart-export": (args) => exportChart(deps, args),
  }),
  actions: (deps) => ({
    chart: () => openChart(deps, {}),
    chartExport: () => exportChart(deps, { format: "png" }),
    chartChanged: (/** @type {import("../../chart/aggregate.js").Settings} */ settings) =>
      keepSettings(deps, settings),
  }),
  styles: [new URL("./chart.css", import.meta.url).href],
};
