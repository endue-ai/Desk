// The Checkup tab (NET-09–11): the score out of 100 as a ring and a number, its three items with the
// points each took, the cards of what to do (heaviest first, each with its steps, the device and
// "Explain simply"), and per device its open ports, each drawn with the open-port mark and labelled
// with its port number and service.
import { fill, h, s } from "./dom.js";
import { kindIcon, portIcon } from "./icons.js";
import { labelOf } from "./labels.js";
import { portInfo } from "./ports.js";
import { saidBlock } from "./view-device.js";

/**
 * @typedef {import("./checkup.js").Checkup} Checkup
 * @typedef {import("./checkup.js").Card} Card
 * @typedef {import("./devices.js").Device} Device
 * @typedef {import("./view-device.js").Said} Said
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

/** @param {Document} doc @param {T} t @param {Checkup} c */
function scoreRing(doc, t, c) {
  const circumference = 2 * Math.PI * 42;
  const filled = (c.score / 100) * circumference;
  return h(
    doc,
    "figure",
    { class: `score grade-${c.grade}` },
    s(
      doc,
      "svg",
      {
        viewBox: "0 0 100 100",
        class: "ring",
        role: "img",
        "aria-label": t("checkup.score", { score: c.score }),
      },
      s(doc, "circle", { cx: 50, cy: 50, r: 42, class: "ring-track" }),
      s(doc, "circle", {
        cx: 50,
        cy: 50,
        r: 42,
        class: "ring-fill",
        "stroke-dasharray": `${filled} ${circumference}`,
        transform: "rotate(-90 50 50)",
      }),
      s(
        doc,
        "text",
        { x: 50, y: 56, class: "ring-number", "text-anchor": "middle" },
        String(c.score),
      ),
    ),
    h(
      doc,
      "figcaption",
      {},
      h(doc, "strong", {}, t(`grade.${c.grade}`)),
      " · ",
      t("checkup.score", { score: c.score }),
    ),
  );
}

/** @param {Document} doc @param {T} t @param {Checkup} c */
function items(doc, t, c) {
  return h(
    doc,
    "ul",
    { class: "items" },
    c.items.map((item) => {
      const note =
        item.id === "wifi" && item.level === "not-wifi"
          ? t("item.wifi.notWifi")
          : item.id === "wifi" && item.level === "unknown"
            ? t("item.wifi.unknown")
            : null;
      return h(
        doc,
        "li",
        { class: "item" },
        h(doc, "span", { class: "item-name" }, t(`item.${item.id}`)),
        h(doc, "meter", {
          min: 0,
          max: item.max,
          value: item.max - item.points,
          "aria-label": t(`item.${item.id}`),
        }),
        h(
          doc,
          "span",
          { class: "item-points" },
          t("item.points", { points: item.points, max: item.max }),
        ),
        note ? h(doc, "span", { class: "item-note desk-muted" }, note) : null,
      );
    }),
  );
}

/** @param {Document} doc @param {T} t @param {Card} card @param {Said | undefined} said */
function cardView(doc, t, card, said) {
  const tone =
    card.kind === "port" || card.kind === "wifi"
      ? card.points >= 15
        ? "danger"
        : "warning"
      : "info";
  return h(
    doc,
    "li",
    { class: `todo tone-${tone}` },
    h(
      doc,
      "div",
      { class: "todo-head" },
      card.kind === "port" ? portIcon(doc) : null,
      h(doc, "p", { class: "todo-text" }, t(card.key, card.params)),
      card.points > 0
        ? h(
            doc,
            "span",
            { class: "desk-badge todo-points" },
            t("card.points", { points: card.points }),
          )
        : null,
    ),
    h(doc, "p", { class: "todo-steps" }, t(card.steps)),
    h(
      doc,
      "div",
      { class: "actions" },
      card.mac
        ? h(
            doc,
            "button",
            {
              type: "button",
              class: "desk-btn desk-btn-quiet",
              "data-act": "device",
              "data-mac": card.mac,
            },
            t("card.show"),
          )
        : null,
      card.kind === "unchecked"
        ? h(
            doc,
            "button",
            { type: "button", class: "desk-btn", "data-act": "check-all" },
            t("checkup.checkAll"),
          )
        : null,
      h(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet",
          "data-act": "explain-card",
          "data-card": card.id,
        },
        t("device.explain"),
      ),
    ),
    saidBlock(doc, t, said),
  );
}

/** Each checked device and its open ports. @param {Document} doc @param {T} t @param {Device[]} devices @param {boolean} canCheck */
function byDevice(doc, t, devices, canCheck) {
  const online = devices.filter((d) => d.online && !d.self);
  const checked = online.filter((d) => d.open !== null);
  return h(
    doc,
    "section",
    { class: "by-device", "aria-labelledby": "by-device-title" },
    h(doc, "h3", { id: "by-device-title" }, t("checkup.byDevice")),
    checked.length === 0 ? h(doc, "p", { class: "desk-muted" }, t("checkup.noPorts")) : null,
    h(
      doc,
      "ul",
      { class: "device-ports" },
      online.map((d) =>
        h(
          doc,
          "li",
          { class: `device-row status-${d.status}` },
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
          d.open === null
            ? canCheck
              ? h(
                  doc,
                  "button",
                  { type: "button", class: "desk-btn", "data-act": "check", "data-mac": d.mac },
                  t("device.checkPorts"),
                )
              : h(doc, "span", { class: "desk-muted" }, t("device.portsUnchecked"))
            : d.open.length === 0
              ? h(doc, "span", { class: "desk-muted" }, t("device.portsNone"))
              : h(
                  doc,
                  "ul",
                  { class: "ports" },
                  d.open.map((port) =>
                    h(
                      doc,
                      "li",
                      {
                        class: `port${d.risky.includes(port) ? " risky" : ""}`,
                        title: portInfo(port).service,
                      },
                      portIcon(doc),
                      h(doc, "span", { class: "port-number" }, String(port)),
                      h(doc, "span", { class: "port-service" }, portInfo(port).service),
                    ),
                  ),
                ),
        ),
      ),
    ),
  );
}

/**
 * @param {HTMLElement} host @param {T} t
 * @param {{ checkup: Checkup, devices: Device[], said: Map<string, Said>, canCheck: boolean }} input
 */
export function renderCheckup(host, t, input) {
  const doc = /** @type {Document} */ (host.ownerDocument);
  const c = input.checkup;
  fill(
    host,
    h(doc, "h2", { class: "panel-title" }, t("checkup.title")),
    h(doc, "div", { class: "summary" }, scoreRing(doc, t, c), items(doc, t, c)),
    h(doc, "p", { class: "formula desk-muted" }, t("checkup.formula")),
    h(doc, "h3", {}, t("checkup.todo")),
    c.cards.length === 0
      ? h(doc, "p", { class: "desk-empty" }, t("checkup.none"))
      : h(
          doc,
          "ol",
          { class: "todos" },
          c.cards.map((card) => cardView(doc, t, card, input.said.get(`card:${card.id}`))),
        ),
    byDevice(doc, t, input.devices, input.canCheck),
  );
}
