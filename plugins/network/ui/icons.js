// The drawings' marks, as SVG paths on a 24-unit grid in the text colour: one per kind of device,
// the open-port mark the checkup draws per port, and the three status shapes, so a device's state
// reads from its shape and its word as well as its colour (NET-04).
import { s } from "./dom.js";

/** @type {Record<string, string>} */
const KIND_PATHS = {
  router: "M3 13h18v6H3z M7 13V7 M17 13V7 M6.5 16h.01 M10 16h2",
  computer: "M3 4h18v12H3z M8 20h8 M12 16v4",
  laptop: "M5 6h14v9H5z M2 18h20",
  phone: "M8 2h8v20H8z M11 18h2",
  tablet: "M5 3h14v18H5z M11 18h2",
  tv: "M3 6h18v11H3z M8 21h8 M9 3l3 3 3-3",
  speaker: "M7 3h10v18H7z M12 7h.01 M9 14a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  camera: "M3 8h12v8H3z M15 11l6-3v8l-6-3",
  printer: "M6 9V3h12v6 M4 9h16v7H4z M7 14h10v7H7z",
  console: "M6 8h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8z M8 12h3 M9.5 10.5v3 M16 11h.01 M15 13h.01",
  storage: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  watch: "M8 6h8v12H8z M9 2h6v4 M9 18v4h6v-4",
  smartHome: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z",
  unknown:
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14 M12 17h.01",
};

/** @param {Document} doc @param {string} d @param {string} className */
function icon(doc, d, className) {
  return s(
    doc,
    "svg",
    { class: className, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    s(doc, "path", {
      d,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
}

/** A device's mark. @param {Document} doc @param {string} kind */
export function kindIcon(doc, kind) {
  return icon(doc, KIND_PATHS[kind] ?? KIND_PATHS.unknown, "kind-icon");
}

/** The mark of an open port: a frame standing ajar. @param {Document} doc */
export function portIcon(doc) {
  return icon(doc, "M5 21V3h11v18 M3 21h16 M16 4l4 2v14l-4 1 M13 12h.01", "port-icon");
}

/** The status shapes: a circle with a tick, a diamond with a question mark, a triangle with a bang. */
const STATUS_PATHS = {
  known: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M8 12.5l2.5 2.5L16 9.5",
  new: "M12 2.5L21.5 12L12 21.5L2.5 12z M10 9.5a2 2 0 1 1 2.8 1.8c-.5.2-.8.6-.8 1.2v.5 M12 16h.01",
  caution: "M12 3L22 20H2z M12 9v5 M12 17h.01",
};

/** @param {Document} doc @param {"known" | "new" | "caution"} status */
export function statusIcon(doc, status) {
  return icon(doc, STATUS_PATHS[status], `status-icon status-${status}`);
}
