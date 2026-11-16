// The Map tab (NET-04): the router in the middle of a floor plan under a roof line, each device in a
// cell of its own around it with a wire to the router, its mark, its name, its IP address and its
// status as a shape and a word as well as a colour. A plain list of every device follows for the
// keyboard, screen readers and networks bigger than the plan.
import { fill, h, s } from "./dom.js";
import { kindIcon, statusIcon } from "./icons.js";
import { labelOf, pingText } from "./labels.js";
import { mapModel } from "./layout.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

/** A device's status as a shape and a word. @param {Document} doc @param {T} t @param {Device} d */
export function statusBadge(doc, t, d) {
  return h(
    doc,
    "span",
    { class: `badge status-${d.status}`, title: t(`status.${d.status}.help`) },
    statusIcon(doc, d.status),
    h(doc, "span", {}, t(`status.${d.status}`)),
  );
}

/** @param {Document} doc @param {T} t @param {Device} d @param {boolean} selected @param {boolean} hub */
function cell(doc, t, d, selected, hub) {
  return h(
    doc,
    "button",
    {
      type: "button",
      class: `desk-btn desk-btn-quiet room status-${d.status}${hub ? " hub" : ""}${d.mine ? " mine" : ""}`,
      "data-act": "device",
      "data-mac": d.mac,
      "aria-pressed": selected ? "true" : "false",
      "aria-label": `${labelOf(t, d)}, ${t(`kind.${d.kind}`)}, ${d.ip}, ${t(`status.${d.status}`)}`,
    },
    kindIcon(doc, d.kind),
    h(doc, "span", { class: "room-name" }, labelOf(t, d)),
    h(doc, "span", { class: "room-ip" }, d.ip),
    statusBadge(doc, t, d),
  );
}

/**
 * Draw the plan into `host`.
 * @param {Element} host @param {T} t
 * @param {{ devices: Device[], selected: string | null, cidr: string | null }} input
 */
export function renderMap(host, t, input) {
  const doc = /** @type {Document} */ (host.ownerDocument);
  const model = mapModel(input.devices);
  if (!model.router && model.cells.length === 0) {
    fill(host, h(doc, "p", { class: "desk-empty" }, t("map.empty")));
    return model;
  }
  const { cols, rows, center } = model;
  const wires = s(
    doc,
    "svg",
    {
      class: "wires",
      viewBox: `0 0 ${cols} ${rows}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    model.cells.map((c) =>
      s(doc, "line", {
        x1: center.col + 0.5,
        y1: center.row + 0.5,
        x2: c.col + 0.5,
        y2: c.row + 0.5,
        class: `wire status-${c.device.status}`,
        "vector-effect": "non-scaling-stroke",
      }),
    ),
  );
  const floor = h(doc, "div", {
    class: "floor",
    role: "group",
    "aria-label": t("map.title", { cidr: input.cidr ?? "" }),
    style: `grid-template-columns: repeat(${cols}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, auto);`,
  });
  if (model.router) {
    const hub = cell(doc, t, model.router, input.selected === model.router.mac, true);
    hub.setAttribute("style", `grid-row: ${center.row + 1}; grid-column: ${center.col + 1};`);
    floor.append(hub);
  }
  for (const c of model.cells) {
    const el = cell(doc, t, c.device, input.selected === c.device.mac, false);
    el.setAttribute("style", `grid-row: ${c.row + 1}; grid-column: ${c.col + 1};`);
    floor.append(el);
  }
  const roof = s(
    doc,
    "svg",
    { class: "roof", viewBox: "0 0 100 12", preserveAspectRatio: "none", "aria-hidden": "true" },
    s(doc, "path", { d: "M1 11.5L50 1L99 11.5", "vector-effect": "non-scaling-stroke" }),
  );
  const online = input.devices.filter((d) => d.online).length;
  const shown = model.cells.length + (model.router ? 1 : 0);
  fill(
    host,
    h(doc, "h2", { class: "panel-title" }, t("map.title", { cidr: input.cidr ?? "" })),
    legend(doc, t),
    h(doc, "div", { class: "plan" }, roof, h(doc, "div", { class: "house" }, wires, floor)),
    model.away > 0
      ? h(doc, "p", { class: "desk-muted" }, t("map.away", { count: model.away }))
      : null,
    online > shown
      ? h(doc, "p", { class: "desk-muted" }, t("map.more", { count: online - shown }))
      : null,
    deviceList(doc, t, input.devices, input.selected),
  );
  return model;
}

/** @param {Document} doc @param {T} t */
function legend(doc, t) {
  /** @type {Array<"known" | "new" | "caution">} */
  const all = ["known", "new", "caution"];
  return h(
    doc,
    "ul",
    { class: "legend", "aria-label": t("map.legend") },
    all.map((status) =>
      h(
        doc,
        "li",
        { class: `badge status-${status}`, title: t(`status.${status}.help`) },
        statusIcon(doc, status),
        h(doc, "span", {}, t(`status.${status}`)),
      ),
    ),
  );
}

/** Every device as a table row. @param {Document} doc @param {T} t @param {Device[]} devices @param {string | null} selected */
function deviceList(doc, t, devices, selected) {
  return h(
    doc,
    "details",
    { class: "desk-details devices", open: devices.length <= 12 },
    h(doc, "summary", {}, `${t("map.list")} (${devices.length})`),
    h(
      doc,
      "table",
      { class: "desk-table" },
      h(
        doc,
        "thead",
        {},
        h(
          doc,
          "tr",
          {},
          ["kind", "ipAddress", "macAddress", "manufacturer", "ping"].map((k) =>
            h(doc, "th", { scope: "col" }, t(`term.${k}`)),
          ),
          h(doc, "th", { scope: "col" }, ""),
        ),
      ),
      h(
        doc,
        "tbody",
        {},
        devices.map((d) =>
          h(
            doc,
            "tr",
            {
              class: d.online ? "" : "away",
              "aria-selected": d.mac === selected ? "true" : "false",
            },
            h(
              doc,
              "td",
              {},
              h(
                doc,
                "button",
                {
                  type: "button",
                  class: "desk-btn desk-btn-quiet row-open",
                  "data-act": "device",
                  "data-mac": d.mac,
                },
                kindIcon(doc, d.kind),
                labelOf(t, d),
              ),
            ),
            h(doc, "td", { class: "mono" }, d.ip),
            h(doc, "td", { class: "mono" }, d.mac),
            h(
              doc,
              "td",
              {},
              d.randomMac ? t("device.randomMac") : (d.vendor ?? t("device.vendorUnknown")),
            ),
            h(doc, "td", {}, pingText(t, d)),
            h(doc, "td", {}, statusBadge(doc, t, d)),
          ),
        ),
      ),
    ),
  );
}
