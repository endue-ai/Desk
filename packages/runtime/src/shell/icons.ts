/** Line icons on a 24 viewBox: stroke 2, round caps and joins, colour from the surrounding text. */

const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  tasks: "M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18h4",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  brain: "M9 3h6v4h4v6h-4v4H9v-4H5V7h4zM12 7v6M9 10h6",
  drawer: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  floating: "M3 3h14v4M3 3v14h4M9 9h12v12H9z",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
  close: "M6 6l12 12M18 6L6 18",
  raise: "M12 19V5M6 11l6-6 6 6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  note: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  sunrise: "M12 3v4M5 10l1.5 1.5M19 10l-1.5 1.5M3 17h18M7 17a5 5 0 0 1 10 0M8 21h8",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  review: "M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  palette:
    "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H15a2 2 0 0 0-1 3.7A2 2 0 0 1 12 21zM7.5 11h.01M10 7h.01M15 7h.01",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  file: "M6 3h8l5 5v13H6zM14 3v5h5",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7 3 10l2 1v2l-2 1 1 3 2-.5L7.5 18 7 20l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  "split-right": "M4 5h16v14H4zM12 5v14",
  "split-down": "M4 5h16v14H4zM4 12h16",
};

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 20): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("data-icon", name);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[name] ?? PATHS.sparkle ?? "");
  svg.append(path);
  return svg;
}
