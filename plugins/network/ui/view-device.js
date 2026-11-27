// A device's card (NET-05, NET-07): its name, kind, IP address, MAC address, manufacturer (or "random
// MAC address"), ping in ms with fast, normal or slow, when it was first and last seen, its open
// ports; "Who is this?" to name it, "Check ports", and "Explain simply" with what the brain said or
// the plugin's own sentence.
import { fill, h, term, timeText } from "./dom.js";
import { kindIcon, portIcon } from "./icons.js";
import { KINDS } from "./kinds.js";
import { labelOf, pingText, vendorText } from "./labels.js";
import { portInfo } from "./ports.js";
import { statusBadge } from "./view-map.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 * @typedef {{ state: "working" } | { state: "done", summary: string, steps: string[], fixed: boolean }} Said
 */

/** @param {Document} doc @param {T} t @param {Device} d */
export function openPorts(doc, t, d) {
  if (d.open === null) return h(doc, "p", { class: "desk-muted" }, t("device.portsUnchecked"));
  if (d.open.length === 0) return h(doc, "p", { class: "desk-muted" }, t("device.portsNone"));
  return h(
    doc,
    "ul",
    { class: "ports" },
    d.open.map((port) => {
      const risky = d.risky.includes(port);
      const { service } = portInfo(port);
      return h(
        doc,
        "li",
        { class: `port${risky ? " risky" : ""}` },
        portIcon(doc),
        h(doc, "span", { class: "port-number" }, String(port)),
        h(doc, "span", { class: "port-service" }, service),
        risky ? h(doc, "span", { class: "port-risk" }, "!") : null,
      );
    }),
  );
}

/** The explanation block. @param {Document} doc @param {T} t @param {Said | undefined} said */
export function saidBlock(doc, t, said) {
  if (!said) return null;
  if (said.state === "working")
    return h(doc, "p", { class: "said desk-muted", role: "status" }, t("explain.working"));
  return h(
    doc,
    "section",
    { class: "said desk-card", "aria-label": t("explain.title") },
    h(doc, "h4", {}, t("explain.title")),
    said.fixed ? h(doc, "p", { class: "desk-muted" }, t("explain.fixed")) : null,
    h(doc, "p", {}, said.summary),
    said.steps.length > 0
      ? h(
          doc,
          "ol",
          {},
          said.steps.map((step) => h(doc, "li", {}, step)),
        )
      : null,
  );
}

/** "Who is this?". @param {Document} doc @param {T} t @param {Device} d */
function whoForm(doc, t, d) {
  return h(
    doc,
    "form",
    { class: "who", "data-form": "who", "data-mac": d.mac, "aria-label": t("who.title") },
    h(doc, "h4", {}, t("who.title")),
    h(
      doc,
      "label",
      {},
      t("who.name"),
      h(doc, "input", {
        class: "desk-field",
        name: "name",
        value: d.name ?? d.mdns ?? "",
        maxlength: 60,
        autocomplete: "off",
      }),
    ),
    h(
      doc,
      "label",
      {},
      t("who.kind"),
      h(
        doc,
        "select",
        { class: "desk-field", name: "kind" },
        KINDS.map((k) => h(doc, "option", { value: k, selected: k === d.kind }, t(`kind.${k}`))),
      ),
    ),
    h(
      doc,
      "label",
      { class: "check" },
      h(doc, "input", { type: "checkbox", class: "desk-check", name: "mine", checked: d.mine }),
      t("who.mine"),
    ),
    h(
      doc,
      "div",
      { class: "actions" },
      h(doc, "button", { type: "submit", class: "desk-btn desk-btn-primary" }, t("who.save")),
      h(
        doc,
        "button",
        { type: "button", class: "desk-btn desk-btn-quiet", "data-act": "who-cancel" },
        t("who.cancel"),
      ),
    ),
  );
}

/**
 * Draw the card into `host`, or hide it with no device.
 * @param {HTMLElement} host @param {T} t
 * @param {{ device: Device | null, who: boolean, said?: Said, language: string, canCheck: boolean }} input
 */
export function renderDevice(host, t, input) {
  const doc = /** @type {Document} */ (host.ownerDocument);
  const d = input.device;
  host.hidden = !d;
  if (!d) return;
  const row = (/** @type {Node} */ label, /** @type {string | Node} */ value, mono = false) => [
    h(doc, "dt", {}, label),
    h(doc, "dd", { class: mono ? "mono" : "" }, value),
  ];
  const kind = d.kindGuessed
    ? t("device.guessed", { kind: t(`kind.${d.kind}`) })
    : t(`kind.${d.kind}`);
  const role = d.gateway
    ? t("device.router")
    : d.self
      ? t("device.self")
      : d.mine
        ? t("device.mine")
        : null;
  fill(
    host,
    h(
      doc,
      "header",
      { class: "device-head" },
      kindIcon(doc, d.kind),
      h(doc, "h3", { id: "device-title" }, labelOf(t, d)),
      h(
        doc,
        "button",
        {
          type: "button",
          class: "desk-icon-btn",
          "data-act": "close-device",
          "aria-label": t("device.close"),
        },
        "×",
      ),
    ),
    h(
      doc,
      "p",
      { class: "device-sub" },
      statusBadge(doc, t, d),
      role ? h(doc, "span", { class: "desk-badge" }, role) : null,
      h(doc, "span", { class: "desk-muted" }, d.online ? t("device.online") : t("device.offline")),
    ),
    h(
      doc,
      "dl",
      { class: "facts" },
      row(term(doc, t, "kind"), kind),
      row(term(doc, t, "ipAddress"), d.ip, true),
      row(term(doc, t, "macAddress"), d.mac, true),
      row(d.randomMac ? term(doc, t, "randomMac") : term(doc, t, "manufacturer"), vendorText(t, d)),
      d.mdns ? row(term(doc, t, "mdns"), d.mdns, true) : [],
      row(term(doc, t, "ping"), pingText(t, d)),
      row(doc.createTextNode(t("device.first")), timeText(d.first, input.language)),
      row(doc.createTextNode(t("device.last")), timeText(d.last, input.language)),
    ),
    h(
      doc,
      "h4",
      {},
      h(doc, "dfn", { class: "term", title: t("help.port"), tabindex: 0 }, t("device.ports")),
    ),
    openPorts(doc, t, d),
    h(
      doc,
      "div",
      { class: "actions" },
      h(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn",
          "data-act": "who",
          "data-mac": d.mac,
          "aria-expanded": input.who ? "true" : "false",
        },
        t("device.who"),
      ),
      !d.self && input.canCheck
        ? h(
            doc,
            "button",
            { type: "button", class: "desk-btn", "data-act": "check", "data-mac": d.mac },
            t("device.checkPorts"),
          )
        : null,
      h(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet",
          "data-act": "explain-device",
          "data-mac": d.mac,
        },
        t("device.explain"),
      ),
    ),
    input.who ? whoForm(doc, t, d) : null,
    saidBlock(doc, t, input.said),
  );
}
