/** Small system-setting glyphs, drawn as vectors so they remain crisp at every scale. */
const paths: Record<string, string> = {
  general: "M9 3h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V7l3-1 1-3Zm3 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  appearance: "M12 2a10 10 0 1 0 0 20V2Zm0 0a10 10 0 0 1 0 20",
  keyboard: "M3 5h18v14H3V5Zm3 4h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10",
  notifications: "M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3v-5Zm4 11h4M11 2h2",
  accessibility: "M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM4 9l8 2 8-2M12 11v5m0 0-4 6m4-6 4 6",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
};
export function settingsIcon(name: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.65",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] ?? paths.general ?? "");
  svg.append(path);
  return svg;
}
