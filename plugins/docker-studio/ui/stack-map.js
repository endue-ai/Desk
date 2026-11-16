// A stack's services as a map: a column per level (what a service depends on stands left of it),
// a card per service with its state, image and ports, and an arrow from each service to what it
// waits for, solid when it waits for that one to be healthy. A card opens its container.

import { h, svg } from "./dom.js";
import { dotState, stateLabel } from "./model.js";

/** @typedef {import("./compose.js").StackConfig} StackConfig @typedef {import("./parse.js").Container} Container */

const CARD_W = 208;
const CARD_H = 64;
const GAP_X = 96;
const GAP_Y = 22;
const PAD = 24;

/**
 * @param {StackConfig} config
 * @param {Container[]} containers
 * @param {(c: Container) => void} open
 */
export function stackMap(config, containers, open) {
  const columns = /** @type {import("./compose.js").Service[][]} */ ([]);
  for (const s of config.services) {
    if (!columns[s.level]) columns[s.level] = [];
    columns[s.level]?.push(s);
  }
  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  const width = PAD * 2 + columns.length * CARD_W + Math.max(0, columns.length - 1) * GAP_X;
  const height = PAD * 2 + tallest * CARD_H + (tallest - 1) * GAP_Y;
  /** @type {Map<string, { x: number, y: number }>} */
  const at = new Map();
  columns.forEach((col, i) => {
    const list = col ?? [];
    const top = PAD + ((tallest - list.length) * (CARD_H + GAP_Y)) / 2;
    for (const [j, s] of list.entries())
      at.set(s.name, { x: PAD + i * (CARD_W + GAP_X), y: top + j * (CARD_H + GAP_Y) });
  });
  const map = svg("svg", {
    class: "stack-map",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": `The services of ${config.name}`,
  });
  const defs = svg("defs");
  const marker = svg("marker", {
    id: "ds-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto-start-reverse",
  });
  marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrow-head" }));
  defs.append(marker);
  map.append(defs);

  for (const s of config.services) {
    const from = at.get(s.name);
    for (const d of s.depends) {
      const to = at.get(d.name);
      if (!from || !to) continue;
      const x1 = from.x;
      const y1 = from.y + CARD_H / 2;
      const x2 = to.x + CARD_W;
      const y2 = to.y + CARD_H / 2;
      const mid = (x1 + x2) / 2;
      const healthy = d.condition === "service_healthy";
      map.append(
        svg("path", {
          class: `edge${healthy ? " healthy" : ""}${d.condition === "service_completed_successfully" ? " once" : ""}`,
          d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 + 2} ${y2}`,
          "marker-end": "url(#ds-arrow)",
        }),
      );
    }
  }

  for (const s of config.services) {
    const p = at.get(s.name);
    if (!p) continue;
    const c = containers.find((x) => x.service === s.name);
    const state = c ? dotState(c) : "created";
    const g = svg("g", {
      class: `svc st-${state}`,
      transform: `translate(${p.x} ${p.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${s.name}: ${c ? stateLabel(c) : "not created"}`,
    });
    g.append(
      svg("rect", { width: CARD_W, height: CARD_H, rx: 12 }),
      svg("rect", { class: "svc-bar", width: 4, height: CARD_H - 20, x: 0, y: 10, rx: 2 }),
    );
    const name = svg("text", { x: 16, y: 25, class: "svc-name" });
    name.textContent = s.name;
    const image = svg("text", { x: 16, y: 44, class: "svc-image" });
    image.textContent = `${s.build ? "⚒ " : ""}${s.image || "built here"}`.slice(0, 30);
    g.append(name, image);
    if (s.ports.length) {
      const port = svg("text", { x: CARD_W - 12, y: 25, class: "svc-port" });
      port.textContent = `:${String(s.ports[0]).split(":")[0]}`;
      g.append(port);
    }
    if (s.volumes.length) {
      const vol = svg("text", { x: CARD_W - 12, y: 44, class: "svc-vol" });
      vol.textContent = `${s.volumes.length} vol`;
      g.append(vol);
    }
    if (c) {
      g.addEventListener("click", () => open(c));
      g.addEventListener("keydown", (e) => {
        if (/** @type {KeyboardEvent} */ (e).key === "Enter") open(c);
      });
    }
    map.append(g);
  }
  return h(
    "div.stack-map-wrap",
    null,
    map,
    h(
      "ul.legend.inline.map-legend",
      null,
      h("li", null, h("span.edge-key.solid"), h("span.legend-name", null, "waits until healthy")),
      h("li", null, h("span.edge-key"), h("span.legend-name", null, "starts after")),
    ),
  );
}
