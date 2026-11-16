// A container's resource use over the last minutes, from the studio's one docker stats stream: CPU
// (of one core, as docker counts it), memory against its limit, network in and out per second, and
// the figures of the latest tick.

import { areaChart } from "./chart.js";
import { h } from "./dom.js";
import { bytes, memory, percent } from "./format.js";

/** @typedef {import("./studio.js").App} App */

/** Bytes per second between ticks of a running total. */
export function rates(/** @type {number[]} */ totals, step = 1.5) {
  const out = [];
  for (let i = 1; i < totals.length; i++)
    out.push(Math.max(0, ((totals[i] ?? 0) - (totals[i - 1] ?? 0)) / step));
  return out;
}

/** @param {App} app @param {import("./parse.js").Container} c */
export function createStatsView(app, c) {
  const cpu = areaChart({
    label: "CPU",
    series: [{ name: "CPU", values: [], color: "--desk-chart-1" }],
    format: percent,
    points: 90,
    floor: 5,
    height: 150,
  });
  const mem = areaChart({
    label: "Memory",
    series: [{ name: "Memory", values: [], color: "--desk-chart-2" }],
    format: (v) => memory(v),
    points: 90,
    height: 150,
  });
  const net = areaChart({
    label: "Network",
    series: [
      { name: "Received", values: [], color: "--desk-chart-3" },
      { name: "Sent", values: [], color: "--desk-chart-4" },
    ],
    format: (v) => `${bytes(v)}/s`,
    points: 89,
    floor: 1024,
    height: 150,
  });
  const figures = h("div.figures");
  const figure = (/** @type {string} */ label) => {
    const value = h("b");
    const sub = h("small");
    return { el: h("div.figure-tile", null, h("span", null, label), value, sub), value, sub };
  };
  const fCpu = figure("CPU");
  const fMem = figure("Memory");
  const fNet = figure("Network");
  const fIo = figure("Disk I/O");
  const fPids = figure("Processes");
  figures.append(fCpu.el, fMem.el, fNet.el, fIo.el, fPids.el);
  const legend = h(
    "ul.legend.inline",
    null,
    h(
      "li",
      null,
      h("span.key", { style: { "--series": "var(--desk-chart-3)" } }),
      h("span.legend-name", null, "Received"),
    ),
    h(
      "li",
      null,
      h("span.key", { style: { "--series": "var(--desk-chart-4)" } }),
      h("span.legend-name", null, "Sent"),
    ),
  );
  const note = h(
    "p.stats-note",
    { hidden: true },
    "This container is not running: it has no resource use.",
  );
  const element = h(
    "section.stats-view",
    null,
    note,
    figures,
    h(
      "div.stats-grid",
      null,
      h(
        "article.card.chart-card",
        null,
        h(
          "header.card-head",
          null,
          h("h2", null, "CPU"),
          h("span.card-sub", null, "100% is one core"),
        ),
        cpu.element,
      ),
      h(
        "article.card.chart-card",
        null,
        h("header.card-head", null, h("h2", null, "Memory")),
        mem.element,
      ),
      h(
        "article.card.chart-card.wide",
        null,
        h("header.card-head", null, h("h2", null, "Network"), legend),
        net.element,
      ),
    ),
  );

  const draw = () => {
    const hist = app.live.history.get(c.id);
    note.hidden = Boolean(hist) && c.state === "running";
    if (!hist) return;
    const s = hist.latest;
    cpu.update({ series: [{ name: "CPU", values: [...hist.cpu], color: "--desk-chart-1" }] });
    mem.update({
      series: [{ name: "Memory", values: [...hist.mem], color: "--desk-chart-2" }],
      max: undefined,
    });
    const rx = rates(hist.netIn);
    const tx = rates(hist.netOut);
    net.update({
      series: [
        { name: "Received", values: rx, color: "--desk-chart-3" },
        { name: "Sent", values: tx, color: "--desk-chart-4" },
      ],
    });
    fCpu.value.textContent = percent(s.cpu);
    fCpu.sub.textContent = "of one core";
    fMem.value.textContent = memory(s.mem);
    fMem.sub.textContent = s.memLimit ? `of ${memory(s.memLimit)} (${percent(s.memPerc)})` : "";
    fNet.value.textContent = `${bytes(rx.at(-1) ?? 0)}/s`;
    fNet.sub.textContent = `${bytes(s.netIn)} in · ${bytes(s.netOut)} out`;
    fIo.value.textContent = bytes(s.blockIn + s.blockOut);
    fIo.sub.textContent = `${bytes(s.blockIn)} read · ${bytes(s.blockOut)} written`;
    fPids.value.textContent = String(s.pids);
    fPids.sub.textContent = "PIDs";
  };
  const off = app.live.onStats(draw);
  queueMicrotask(draw);
  return { element, dispose: () => off() };
}
