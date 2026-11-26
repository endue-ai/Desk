// Opening a result's Chart tab (PG-44): right after the result's own tab, once per result, picked;
// its settings are the command's arguments over the tab's, else over the ones kept with the starred
// query the result's statement is (chart/kept.js), else the result's defaults. A settings change
// for a starred query's result is kept with it. No DOM.

import { keepChart, keptChart } from "../../chart/kept.js";
import { settingsFor } from "../../chart/model.js";
import { t as messageText } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../tabs.js").Tab} Tab
 * @typedef {import("../../chart/aggregate.js").Settings} Settings
 */

const KEYS = /** @type {const} */ (["type", "x", "y", "series", "aggregate"]);

/** The console on screen and the result tab a chart is of (the chart's own when it is on screen). */
export function chartTarget(/** @type {Deps} */ deps) {
  const target = deps.consoles.current();
  const tabs = target?.shown?.tabs ?? [];
  const tab = tabs[target?.tab ?? -1];
  return { target, tabs, tab };
}

/** The statement a result tab shows: a pinned one's own, else its run's. */
export function statementOf(
  /** @type {ReturnType<typeof chartTarget>["target"]} */ target,
  /** @type {Tab} */ tab,
) {
  return tab.pin?.sql ?? target?.execution?.statements[tab.statement]?.text ?? "";
}

/** Keep a chart's settings with the starred query its result is, if it is one. */
export async function keepSettings(/** @type {Deps} */ deps, /** @type {Settings} */ settings) {
  const { target, tab } = chartTarget(deps);
  if (!target || !tab) return undefined;
  const sql = statementOf(target, tab);
  if (!sql) return undefined;
  return keepChart(deps.bridge, target.connection, sql, settings).catch(() => undefined);
}

/**
 * Open (or pick again) the Chart tab of the result on screen.
 * @param {Deps} deps
 * @param {Record<string, unknown>} args
 */
export async function openChart(deps, args) {
  const { target, tabs, tab } = chartTarget(deps);
  const set = tab?.kind === "chart" ? tab.chart?.set : tab?.set;
  if (!target || !tab || !set)
    throw new Error(messageText("features.chart.open.drawAChartOfAResult"));
  let index = tabs.findIndex((t) => t.kind === "chart" && t.chart?.set === set);
  if (index < 0) {
    index = tabs.indexOf(tab) + 1;
    tabs.splice(index, 0, {
      label:
        tab.label === "Result"
          ? messageText("features.chart.open.chart")
          : messageText("features.chart.open.chart2", { label: String(tab.label) }),
      kind: "chart",
      statement: tab.statement,
      ...(tab.pin ? { pin: tab.pin } : {}),
      chart: { set },
    });
  }
  const chartTab = /** @type {Tab} */ (tabs[index]);
  const chart = /** @type {NonNullable<Tab["chart"]>} */ (chartTab.chart);
  const sql = statementOf(target, chartTab);
  const kept = chart.settings ? undefined : await keptChart(deps.bridge, target.connection, sql);
  /** @type {Record<string, unknown>} */
  const given = {};
  for (const key of KEYS) if (args[key] !== undefined) given[key] = args[key];
  const base = chart.settings ?? kept;
  // Settings kept from an earlier run fall back to the defaults when the columns changed since.
  let settings;
  try {
    settings = settingsFor(set, { ...base, ...given });
  } catch (error) {
    if (!base) throw error;
    settings = settingsFor(set, given);
  }
  const changed = JSON.stringify(settings) !== JSON.stringify(chart.settings);
  chart.settings = settings;
  deps.consoles.tab(index);
  if (changed && Object.keys(given).length) await keepSettings(deps, settings);
  return { tab: chartTab.label, settings };
}
