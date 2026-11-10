/** The strip's line icons, drawn like the shell's (24 viewBox, stroke 2, the text's colour). */

const PATHS = {
  tile: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  cascade: "M3 3h11v3M3 3v9h3M7 7h11v3M7 7v9h3M11 11h10v10H11z",
  restore: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
} as const;

export type ArrangeIcon = keyof typeof PATHS;

export function arrangeIcon(name: ArrangeIcon, size = 18): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    "data-icon": `arrange-${name}`,
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
}
