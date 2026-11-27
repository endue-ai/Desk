// Where a response's time went and how it travelled: the phases as a waterfall (redirects, DNS,
// TCP, TLS, waiting for the first byte, the download), the connection's facts (address, HTTP
// version, the certificate), and curl's timeline of what was sent and what came back.

import { h, icon } from "./dom.js";
import { bytes, duration } from "./format.js";

/** @typedef {import("./send.js").Response} Response */

export const PHASES = /** @type {const} */ ([
  ["redirect", "Redirects", "c-redirect"],
  ["dns", "DNS lookup", "c-dns"],
  ["tcp", "TCP connect", "c-tcp"],
  ["tls", "TLS handshake", "c-tls"],
  ["wait", "Waiting (time to first byte)", "c-wait"],
  ["download", "Content download", "c-download"],
]);

/** The waterfall: one bar per phase, placed where it started. @param {Response} res */
export function waterfall(res) {
  const t = res.timings;
  const total = Math.max(t.total, 0.001);
  let at = 0;
  const rows = [];
  for (const [key, label, cls] of PHASES) {
    const span = t[key];
    if (key === "redirect" && span <= 0) continue;
    const left = (at / total) * 100;
    const width = Math.max(0.6, (span / total) * 100);
    rows.push(
      h(
        "div.wf-row",
        null,
        h("span.wf-label", null, label),
        h(
          "span.wf-track",
          null,
          h(`span.wf-bar.${cls}`, {
            style: { left: `${Math.min(99.4, left)}%`, width: `${Math.min(100 - left, width)}%` },
          }),
        ),
        h("span.wf-time", null, duration(span)),
      ),
    );
    at += span;
  }
  return h(
    "div.wf",
    null,
    ...rows,
    h(
      "div.wf-row.wf-total",
      null,
      h("span.wf-label", null, "Total"),
      h("span.wf-track"),
      h("span.wf-time", null, duration(t.total)),
    ),
  );
}

/** A stacked bar of the phases for the status line's tooltip. @param {Response} res */
export function miniBar(res) {
  const t = res.timings;
  const total = Math.max(t.total, 0.001);
  return h(
    "span.wf-mini",
    { "aria-hidden": "true" },
    ...PHASES.filter(([k]) => t[k] > 0).map(([k, , cls]) =>
      h(`span.${cls}`, { style: { flex: `${t[k] / total}` } }),
    ),
  );
}

/** @param {Response} res */
function facts(res) {
  /** @type {[string, string][]} */
  const rows = [
    ["URL", res.sent.url],
    ["Remote address", res.remote || "—"],
    ["Protocol", res.httpVersion || "—"],
    ["Response size", `${bytes(res.size)} body, ${bytes(res.headerSize)} headers`],
  ];
  if (res.cert) {
    rows.push(
      ["Certificate", res.cert.subject],
      ["Issued by", res.cert.issuer],
      ["Valid until", res.cert.expire],
    );
  }
  return h("dl.as-facts", null, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
}

/** The Timeline tab: the waterfall, the hops, the facts, then curl's own lines. @param {Response} res */
export function timelineView(res) {
  const hops = res.hops.length
    ? h(
        "div.as-hops",
        null,
        h("h3", null, "Redirects"),
        ...res.hops.map((hop, i) =>
          h(
            "div.as-hop",
            null,
            h("span.as-hop-n", null, String(i + 1)),
            h(`span.status-pill.s-redirect`, null, `${hop.status} ${hop.reason}`),
            icon("chevronRight", 14),
            h("span.as-hop-to", null, hop.location),
          ),
        ),
      )
    : null;
  const log = h(
    "div.as-log",
    { role: "log" },
    ...res.timeline
      .filter((l) => l.kind !== "data")
      .map((l) =>
        h(
          `div.as-log-line.k-${l.kind}`,
          null,
          h("span.as-log-mark", null, l.kind === "out" ? "›" : l.kind === "in" ? "‹" : "•"),
          h("span", null, l.text),
        ),
      ),
  );
  return h(
    "div.as-timeline",
    null,
    h(
      "div.as-tl-grid",
      null,
      h("div.as-tl-card", null, h("h3", null, "Timing"), waterfall(res)),
      h("div.as-tl-card", null, h("h3", null, "Connection"), facts(res)),
    ),
    hops,
    h("div.as-tl-card.as-tl-log", null, h("h3", null, "What curl saw"), log),
  );
}
