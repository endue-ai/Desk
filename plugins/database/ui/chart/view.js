// A result's Chart tab (PG-44): a bar of settings (the type, X, Y, a series column, the aggregate,
// Export), the chart drawn in the theme's chart tokens (draw.js), what it left out and whether every
// row was fetched, and the same numbers as a table for screen readers, exact as aggregate.js counted
// them. The data is counted in the chart's worker past 20,000 cells (client.js); a settings change
// draws again and is told (`chartChanged`), so the feature keeps it with a starred query.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { chartClient } from "./client.js";
import { drawChart, tokenPalette } from "./draw.js";
import {
  AGGREGATE_NAMES,
  AGGREGATES,
  chartTitle,
  settingsFor,
  TYPE_NAMES,
  TYPES,
} from "./model.js";

/**
 * @typedef {import("../tabs.js").Tab} Tab
 * @typedef {import("./aggregate.js").ChartData} ChartData
 * @typedef {import("./aggregate.js").Settings} Settings
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("./client.js").StartWorker} StartWorker
 */

const SIZE = { width: 720, height: 360 };

/** What a chart leaves out, in words: rows not fetched, categories, series, points and values. */
export function chartNote(
  /** @type {ChartData} */ data,
  /** @type {Settings} */ settings,
  /** @type {{ rows: unknown[], truncated: boolean }} */ set,
) {
  const out = [];
  if (set.truncated) out.push(t("chart.truncated", { count: set.rows.length }));
  const { categories, series, points } = data.dropped;
  if (categories) out.push(t("chart.moreCategories", { count: categories, column: settings.x }));
  if (series) out.push(t("chart.moreSeries", { count: series }));
  if (points) out.push(t("chart.morePoints", { count: points }));
  if (data.skipped) out.push(t("chart.skipped", { count: data.skipped }));
  if (settings.type === "scatter" && data.points.length === 0) out.push(t("chart.scatterNeeds"));
  return out.join(" ");
}

/** @param {Document} doc @param {Act} act @param {StartWorker} [startWorker] */
export function createCharts(doc, act, startWorker) {
  const client = chartClient(startWorker);
  /** @type {{ tab: Tab | null, box: HTMLElement | null }} */
  const shown = { tab: null, box: null };
  let asked = 0;

  /** A select of the bar, by name, with its label. */
  const select = (
    /** @type {string} */ name,
    /** @type {string} */ label,
    /** @type {[string, string][]} */ options,
    /** @type {string} */ value,
  ) => {
    const field = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { class: "desk-field", name },
        ...options.map(([v, text]) => el(doc, "option", { value: v }, text)),
      )
    );
    field.value = value;
    return el(doc, "label", { class: "chart-field" }, `${label} `, field);
  };

  /** The table a screen reader reads instead of the picture. */
  const tableOf = (/** @type {ChartData} */ data, /** @type {Settings} */ s) => {
    const row = (/** @type {string[]} */ cells, /** @type {string} */ tag) =>
      el(doc, "tr", {}, ...cells.map((c) => el(doc, tag, {}, c)));
    const head =
      s.type === "scatter"
        ? [s.x, s.y, ...(s.series ? [s.series] : [])]
        : [s.x, ...(data.series.length > 1 ? data.series.map((x) => x.name) : [s.y || "rows"])];
    const body =
      s.type === "scatter"
        ? data.points.map((p) => [
            p.x,
            p.y,
            ...(s.series ? [data.series[p.series]?.name ?? ""] : []),
          ])
        : data.categories.map((k, i) => [k, ...data.series.map((x) => x.values[i] ?? "")]);
    return el(
      doc,
      "table",
      { class: "sr-only" },
      el(doc, "caption", {}, chartTitle(s)),
      row(head, "th"),
      ...body.map((cells) => row(cells, "td")),
    );
  };

  /** Draw the tab's chart with its settings, from the worker's answer when it is not at once. */
  const draw = (/** @type {Tab} */ tab, /** @type {HTMLElement} */ box) => {
    const chart = tab.chart;
    if (!chart) return;
    const settings = chart.settings ?? settingsFor(chart.set);
    chart.settings = settings;
    const figure = /** @type {HTMLElement} */ (box.querySelector(".chart-figure"));
    const note = /** @type {HTMLElement} */ (box.querySelector(".chart-note"));
    const id = ++asked;
    const done = (/** @type {ChartData} */ data) => {
      if (id !== asked || shown.box !== box) return;
      box.removeAttribute("aria-busy");
      const size = {
        width: Math.max(320, figure.clientWidth || SIZE.width),
        height: Math.max(200, figure.clientHeight || SIZE.height),
      };
      const svg = drawChart(data, settings, size, tokenPalette());
      const Parser = doc.defaultView?.DOMParser ?? DOMParser;
      const parsed = new Parser().parseFromString(svg, "image/svg+xml");
      figure.replaceChildren(doc.importNode(parsed.documentElement, true));
      box.querySelector("table.sr-only")?.replaceWith(tableOf(data, settings));
      note.textContent = chartNote(data, settings, chart.set);
    };
    const got = client.chart(chart.set, settings);
    if ("then" in got) {
      box.setAttribute("aria-busy", "true");
      void got.then(done, (error) => {
        if (id === asked) note.textContent = t("chart.failed", { error: error.message });
      });
    } else done(got);
  };

  /** The bar of settings, drawn again from the tab's settings. */
  const bar = (/** @type {Tab} */ tab) => {
    const chart = /** @type {NonNullable<Tab["chart"]>} */ (tab.chart);
    const s = chart.settings ?? settingsFor(chart.set);
    chart.settings = s;
    const names = chart.set.columns.map((c) => /** @type {[string, string]} */ ([c, c]));
    return el(
      doc,
      "div",
      { class: "chart-bar", role: "toolbar", "aria-label": t("chart.label") },
      select(
        "type",
        t("chart.type"),
        TYPES.map((type) => [type, TYPE_NAMES[type]]),
        s.type,
      ),
      select("x", t("chart.x"), names, s.x),
      select("y", t("chart.y"), [["", t("chart.rows")], ...names], s.y),
      select("series", t("chart.series"), [["", t("chart.none")], ...names], s.series),
      select(
        "aggregate",
        t("chart.as"),
        AGGREGATES.map((a) => [a, AGGREGATE_NAMES[a]]),
        s.aggregate,
      ),
      el(doc, "span", { class: "grow" }),
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet",
          "data-chart": "export",
          title: t("chart.exportTitle"),
        },
        t("chart.export"),
      ),
    );
  };

  return {
    /** Whether the host shows this tab's chart already. */
    showing: (/** @type {Tab} */ tab) =>
      shown.tab === tab && shown.box !== null && shown.box.parentElement !== null,
    /** Draw a Chart tab into the result's host. */
    show(/** @type {HTMLElement} */ host, /** @type {Tab} */ tab) {
      if (!tab.chart) return;
      if (shown.tab === tab && shown.box && host.firstChild === shown.box) return;
      const box = el(
        doc,
        "div",
        { class: "chart-box" },
        bar(tab),
        el(doc, "p", { class: "chart-note", role: "status" }),
        el(doc, "div", { class: "chart-figure" }),
        el(doc, "table", { class: "sr-only" }),
      );
      shown.tab = tab;
      shown.box = box;
      box.addEventListener("change", (event) => {
        const field = /** @type {HTMLSelectElement} */ (event.target);
        const chart = tab.chart;
        if (!chart?.settings || !field.name) return;
        chart.settings = { ...chart.settings, [field.name]: field.value };
        act("chartChanged", chart.settings);
        draw(tab, box);
      });
      box.addEventListener("click", (event) => {
        const button = /** @type {HTMLElement} */ (event.target).closest("[data-chart=export]");
        if (button) act("chartExport");
      });
      host.replaceChildren(box);
      draw(tab, box);
    },
  };
}
