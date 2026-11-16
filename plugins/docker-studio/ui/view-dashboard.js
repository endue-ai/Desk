// The dashboard: what runs and what it costs at a glance. Tiles of counts, CPU and memory over the
// last minutes, what needs attention, the busiest containers, the stacks, disk use and the latest
// events (view-dash-cards.js draws the cards below the charts).

import { areaChart } from "./chart.js";
import { button, h, icon as iconOf } from "./dom.js";
import { bytes, memory, percent, plural } from "./format.js";
import {
  activityCard,
  attentionCard,
  consumersCard,
  diskCard,
  stacksCard,
} from "./view-dash-cards.js";

/**
 * @typedef {import("./studio.js").App} App
 */

/** @param {App} app */
export function createDashboard(app) {
  const tiles = h("section.tiles", { "aria-label": "Summary" });
  const cpu = areaChart({
    label: "CPU used by containers",
    series: [{ name: "CPU", values: [], color: "--desk-chart-1" }],
    format: (v) => percent(v),
    points: 90,
    floor: 5,
  });
  const mem = areaChart({
    label: "Memory used by containers",
    series: [{ name: "Memory", values: [], color: "--desk-chart-2" }],
    format: (v) => memory(v),
    points: 90,
  });
  const cpuNow = h("b.figure");
  const memNow = h("b.figure");
  const cpuSub = h("small");
  const memSub = h("small");
  const charts = h(
    "section.charts",
    null,
    h(
      "article.card.chart-card",
      null,
      h("header.card-head", null, h("h2", null, "CPU"), h("span.card-sub", null, cpuSub), cpuNow),
      cpu.element,
    ),
    h(
      "article.card.chart-card",
      null,
      h(
        "header.card-head",
        null,
        h("h2", null, "Memory"),
        h("span.card-sub", null, memSub),
        memNow,
      ),
      mem.element,
    ),
  );
  const quick = h(
    "section.quick",
    { "aria-label": "Start" },
    button({
      label: "Run a container",
      icon: "play",
      kind: "quick",
      onClick: () => app.dialogs.run(),
    }),
    button({
      label: "Pull an image",
      icon: "download",
      kind: "quick",
      onClick: () => app.dialogs.pull(),
    }),
    button({
      label: "Build an image",
      icon: "build",
      kind: "quick",
      onClick: () => app.dialogs.build(),
    }),
    button({
      label: "Compose up",
      icon: "stack",
      kind: "quick",
      onClick: () => app.dialogs.composeUp(),
    }),
    button({
      label: "Write a Dockerfile",
      icon: "wand",
      kind: "quick",
      onClick: () => app.dialogs.scaffold(),
    }),
  );
  const grid = h("section.dash-grid");
  const element = h("div.page.dashboard", null, quick, tiles, charts, grid);

  const drawCharts = () => {
    const info = app.store.state.engine.info;
    const cores = Math.max(1, info?.cpus ?? 1);
    const cpuValues = app.live.total.cpu.map((v) => v / cores);
    cpu.update({ series: [{ name: "CPU", values: cpuValues, color: "--desk-chart-1" }] });
    mem.update({
      series: [{ name: "Memory", values: [...app.live.total.mem], color: "--desk-chart-2" }],
    });
    const lastCpu = cpuValues.at(-1);
    const lastMem = app.live.total.mem.at(-1);
    cpuNow.textContent = lastCpu === undefined ? "–" : percent(lastCpu);
    memNow.textContent = lastMem === undefined ? "–" : memory(lastMem);
    cpuSub.textContent = `of ${plural(cores, "core")}`;
    memSub.textContent = info?.memory ? `of ${memory(info.memory)}` : "";
  };

  /** @param {any} state */
  const drawTiles = (state) => {
    const by = (/** @type {string} */ s) =>
      state.containers.filter((/** @type {any} */ c) => c.state === s).length;
    const running = by("running");
    const stopped = state.containers.length - running - by("paused");
    const imageSize = state.images.reduce(
      (/** @type {number} */ s, /** @type {any} */ i) => s + i.size,
      0,
    );
    const volumeSize = [...state.volumeSizes.values()].reduce((s, v) => s + v, 0);
    const projects = new Set(
      state.containers.map((/** @type {any} */ c) => c.project).filter(Boolean),
    );
    const live = new Set(
      state.containers
        .filter((/** @type {any} */ c) => c.project && c.state === "running")
        .map((/** @type {any} */ c) => c.project),
    );
    tiles.replaceChildren(
      tile(
        "Running containers",
        String(running),
        `of ${state.containers.length} · ${stopped} stopped · ${by("paused")} paused`,
        "container",
        () => app.go("containers"),
      ),
      tile("Images", String(state.images.length), bytes(imageSize), "image", () =>
        app.go("images"),
      ),
      tile(
        "Volumes",
        String(state.volumes.length),
        volumeSize ? bytes(volumeSize) : "sizes loading",
        "volume",
        () => app.go("volumes"),
      ),
      tile("Compose stacks", String(projects.size), `${live.size} running`, "stack", () =>
        app.go("compose"),
      ),
    );
  };

  /** @param {any} state */
  const drawGrid = (state) => {
    grid.replaceChildren(
      consumersCard(app, state),
      attentionCard(app, state),
      stacksCard(app, state),
      diskCard(app, state),
      activityCard(app, state),
    );
  };

  const offStats = app.live.onStats(() => {
    drawCharts();
    const state = app.store.state;
    const busiest = grid.querySelector(".consumers");
    if (busiest) busiest.replaceWith(consumersCard(app, state));
  });

  return {
    element,
    title: "Dashboard",
    subtitle: "",
    stats: true,
    /** @param {any} state @param {Set<string>} changed */
    update(state, changed) {
      if (
        ["containers", "images", "volumes", "volumeSizes", "projects"].some((k) => changed.has(k))
      )
        drawTiles(state);
      if (["containers", "projects", "disk", "activity", "engine"].some((k) => changed.has(k)))
        drawGrid(state);
      if (changed.has("engine")) drawCharts();
    },
    dispose() {
      offStats();
    },
  };
}

/**
 * @param {string} label @param {string} value @param {string} sub
 * @param {import("./dom.js").IconName} icon @param {() => void} open
 */
function tile(label, value, sub, icon, open) {
  return h(
    "button.desk-btn.desk-btn-quiet.tile",
    { type: "button", onClick: open, "aria-label": `${label}: ${value}` },
    h("span.tile-label", null, label),
    h("span.tile-value", null, value),
    h("span.tile-sub", null, sub),
    h("span.tile-icon", null, iconOf(icon)),
  );
}
