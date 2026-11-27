// What draws a chart as an image in the page (PG-44): the chart's palette with the theme's tokens
// resolved to colours, and a PNG from the export's SVG (the ER diagram's imager draws it). ui/main.js
// provides it, so the feature's export runs without a DOM of its own; tests provide their own.

import { createImager } from "../features/diagram/image.js";
import { SERIES } from "./draw.js";

/**
 * @typedef {import("./draw.js").Palette} Palette
 * @typedef {{
 *   palette(): Palette,
 *   png(svg: string, width: number, height: number): Promise<{ base64: string }>,
 * }} ChartPage
 */

/** @type {ChartPage | undefined} */
let provided;

/** Set the page's chart drawer (ui/main.js), or none. */
export const provideChartPage = (/** @type {ChartPage | undefined} */ page) => {
  provided = page;
};
/** The page's chart drawer, or undefined where nothing draws. */
export const chartPageOf = () => provided;

/** @param {Document} doc @returns {ChartPage} */
export function createChartPage(doc) {
  const win = /** @type {Window} */ (doc.defaultView);
  const imager = createImager(doc);
  return {
    palette() {
      const probe = doc.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      (doc.body ?? doc.documentElement).append(probe);
      try {
        const color = (/** @type {string} */ token) => {
          probe.style.color = `var(${token})`;
          return win.getComputedStyle(probe).color;
        };
        probe.style.font = "var(--desk-text-xs) var(--desk-font-sans)";
        const style = win.getComputedStyle(probe);
        return {
          series: SERIES.map(color),
          text: color("--desk-text"),
          muted: color("--desk-text-muted"),
          grid: color("--desk-border"),
          background: color("--desk-background"),
          font: style.fontFamily || "sans-serif",
          size: style.fontSize || "12px",
        };
      } finally {
        probe.remove();
      }
    },
    png: (svg, width, height) => imager.png(svg, width, height, 1),
  };
}
