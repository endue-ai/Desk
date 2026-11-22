// @vitest-environment jsdom
// A result of 1,000 columns in the grid (ui/view-grid.js): drawn the first time, and scrolled
// sideways from its first column to its last a screen at a time, each scroll a paint of the lane in
// view (ui/grid/lane.js). The DOM is jsdom's, so a time is the plugin's work to make the elements,
// not the browser's layout and paint; timed on the process's CPU clock. No server.
import { describe, expect, it } from "vitest";
import { createGrid } from "../../../plugins/database/ui/view-grid.js";
import { cpuClock, fastest } from "../lib/calibrated";
import { calibration, hold } from "./hold";

const COLUMNS = 1_000;
const ROWS = 1_000;
const columns = Array.from({ length: COLUMNS }, (_, i) => `c${i + 1}`);
const rows = Array.from({ length: ROWS }, (_, r) => columns.map((c) => `v${c.slice(1)}-${r + 1}`));
const tab = () => ({
  label: "Result",
  kind: "rows" as const,
  statement: 0,
  set: { columns, rows, truncated: false },
});
const context = { edit: null, server: false, key: "result:c-perf:1:0" };

function mounted() {
  document.body.innerHTML = `<div id="results"><div id="result"></div></div>`;
  const host = document.getElementById("result") as HTMLElement;
  const grid = createGrid(document, host, () => undefined);
  return { host, grid };
}

describe("a result of 1,000 columns in the grid", () => {
  it("draws, and scrolls sideways a screen at a time to its last column", async () => {
    mounted().grid.render(tab(), true, context);
    let at = calibration(cpuClock);
    const drawn = await fastest(
      3,
      () => {
        const { host, grid } = mounted();
        grid.render(tab(), true, context);
        expect(host.querySelectorAll("[role=columnheader]").length).toBeLessThan(60);
      },
      cpuClock,
    );
    hold("grid.firstDrawMs", drawn, at);

    const { host, grid } = mounted();
    grid.render(tab(), true, context);
    const scroller = host.querySelector(".scroller") as HTMLElement;
    const wide = grid.columns().widths.reduce((sum, px) => sum + px, 0);
    expect(wide).toBeGreaterThan(COLUMNS * 20);
    at = calibration(cpuClock);
    let steps = 0;
    const sweep = await fastest(
      3,
      () => {
        steps = 0;
        const begun = cpuClock();
        for (let left = 0; left <= wide; left += 960) {
          scroller.scrollLeft = left;
          scroller.dispatchEvent(new Event("scroll"));
          steps++;
        }
        return (cpuClock() - begun) / steps;
      },
      cpuClock,
    );
    const last = host.querySelector(`[role=columnheader][aria-colindex="${COLUMNS}"]`);
    expect(last).not.toBeNull();
    console.info(`perf-database grid: ${steps} screens sideways`);
    hold("grid.sidewaysScreenMs", sweep, at);
  });
});
