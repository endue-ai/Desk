// The Wi-Fi channels tab (NET-12–14): each band apart, its 20 MHz channels side by side as columns
// tinted by how congested they are, each network heard a bar across the channels it covers, mine
// marked, the recommended channel flagged, and the verdict in one sentence. A list says the same for
// screen readers. Hidden SSIDs are drawn as channels only, and the reason is said.
import { fill, glossary, h, s, term } from "./dom.js";
import { signalLevel } from "./wifi.js";

/**
 * @typedef {import("./channels.js").BandModel} BandModel
 * @typedef {import("./wifi.js").WifiReport} WifiReport
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

/** A channel's column width per band, in pixels: 2.4 GHz has 13 channels, 5 GHz 25, 6 GHz 59. */
const COLS = { 2.4: 44, 5: 30, 6: 12 };
const BAR = 14;
const TOP = 22;

/** The column of the last drawn channel at or below `ch`. @param {number[]} channels @param {number} ch */
export function columnOf(channels, ch) {
  let col = 0;
  channels.forEach((c, i) => {
    if (c <= ch) col = i;
  });
  return col;
}

/** Rows for the bars so that none overlaps another. @param {Array<{ from: number, to: number }>} bars @param {number[]} channels */
export function stackRows(bars, channels) {
  /** @type {number[]} */
  const ends = [];
  return bars.map((b) => {
    const start = columnOf(channels, b.from);
    let row = ends.findIndex((end) => end < start);
    if (row === -1) row = ends.length;
    ends[row] = columnOf(channels, b.to);
    return row;
  });
}

/** The recommended channel's flag, kept inside the drawing at either end. @param {Document} doc @param {T} t @param {number} at @param {number} width */
function flag(doc, t, at, width) {
  const anchor = at < 70 ? "start" : at > width - 70 ? "end" : "middle";
  const x =
    anchor === "start" ? Math.max(0, at - 6) : anchor === "end" ? Math.min(width, at + 6) : at;
  return s(
    doc,
    "text",
    { x, y: 12, class: "flag", "text-anchor": anchor },
    `▼ ${t("channels.recommended")}`,
  );
}

/** @param {Document} doc @param {T} t @param {BandModel} band */
function lanes(doc, t, band) {
  const channels = band.lanes.map((l) => l.channel);
  const bars = [...(band.current ? [band.current] : []), ...band.networks];
  const rows = stackRows(bars, channels);
  const depth = Math.max(1, ...rows.map((r) => r + 1));
  const COL = COLS[band.band];
  const width = channels.length * COL;
  const height = TOP + depth * (BAR + 4) + 22;
  const x = (/** @type {number} */ ch) => columnOf(channels, ch) * COL;
  const labelEvery = channels.length > 30 ? 4 : 1;
  return s(
    doc,
    "svg",
    {
      class: "lanes",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": t(band.verdict.key, band.verdict.params),
    },
    band.lanes.map((lane, i) =>
      s(doc, "rect", {
        x: i * COL,
        y: TOP - 4,
        width: COL,
        height: height - TOP - 14,
        class: `lane level-${lane.level}${lane.channel === band.recommended ? " recommended" : ""}`,
      }),
    ),
    band.lanes.map((_, i) =>
      i === 0
        ? null
        : s(doc, "line", {
            x1: i * COL,
            y1: TOP - 4,
            x2: i * COL,
            y2: height - 18,
            class: "lane-edge",
          }),
    ),
    bars.map((n, i) =>
      s(
        doc,
        "g",
        { class: `bar${"current" in n && n.current ? " mine" : ""}` },
        s(doc, "rect", {
          x: x(n.from) + 2,
          y: TOP + rows[i] * (BAR + 4),
          width: (columnOf(channels, n.to) - columnOf(channels, n.from) + 1) * COL - 4,
          height: BAR,
          rx: 3,
        }),
        s(
          doc,
          "title",
          {},
          t("channels.network", {
            name:
              "current" in n && n.current
                ? t("channels.current")
                : (n.ssid ?? t("channels.unnamed")),
            channel: n.channel,
            width: n.width,
            security: n.security,
          }),
        ),
      ),
    ),
    band.recommended !== null ? flag(doc, t, x(band.recommended) + COL / 2, width) : null,
    band.lanes.map((lane, i) =>
      i % labelEvery === 0
        ? s(
            doc,
            "text",
            {
              x: i * COL + COL / 2,
              y: height - 4,
              class: "channel-number",
              "text-anchor": "middle",
            },
            String(lane.channel),
          )
        : null,
    ),
  );
}

/** @param {Document} doc @param {T} t @param {BandModel} band */
function bandSection(doc, t, band) {
  const busy = band.lanes.filter((l) => l.count > 0);
  return h(
    doc,
    "section",
    { class: "band", "aria-labelledby": `band-${band.band}` },
    h(
      doc,
      "h3",
      { id: `band-${band.band}` },
      t("channels.band", { band: band.band }),
      h(
        doc,
        "span",
        { class: "desk-muted" },
        ` · ${t("channels.networks", { count: band.networks.length })}`,
      ),
    ),
    h(
      doc,
      "p",
      { class: `verdict verdict-${band.verdict.key.split(".").at(-1)}` },
      t(band.verdict.key, band.verdict.params),
    ),
    h(doc, "div", { class: "lanes-scroll" }, lanes(doc, t, band)),
    h(
      doc,
      "ul",
      { class: "lane-list visually-hidden" },
      busy.map((l) =>
        h(
          doc,
          "li",
          {},
          t("channels.lane", { channel: l.channel, level: t(`level.${l.level}`), count: l.count }),
        ),
      ),
    ),
  );
}

/**
 * @param {HTMLElement} host @param {T} t
 * @param {{ report: WifiReport | null, bands: BandModel[], refusal: { text: string, todo: string } | null }} input
 */
export function renderChannels(host, t, input) {
  const doc = /** @type {Document} */ (host.ownerDocument);
  const r = input.report;
  const mine = r?.current;
  fill(
    host,
    h(
      doc,
      "div",
      { class: "panel-head" },
      h(doc, "h2", { class: "panel-title" }, t("channels.title")),
      h(
        doc,
        "button",
        { type: "button", class: "desk-btn", "data-act": "listen" },
        t("action.listen"),
      ),
    ),
    h(doc, "p", { class: "desk-muted" }, t("channels.listenOnly")),
    input.refusal
      ? h(
          doc,
          "div",
          { class: "desk-error", role: "alert" },
          h(doc, "p", {}, input.refusal.text),
          h(doc, "p", {}, input.refusal.todo),
        )
      : null,
    !r && !input.refusal ? h(doc, "p", { class: "desk-empty" }, t("channels.empty")) : null,
    r && mine
      ? h(
          doc,
          "p",
          { class: "mine-line" },
          t("channels.mine", {
            channel: mine.channel,
            band: mine.band,
            width: mine.width,
            rssi: mine.rssi ?? "?",
            signal: t(`signal.${signalLevel(mine.rssi)}`),
            noise: mine.noise ?? "?",
            rate: mine.rate ?? "?",
          }),
          " ",
          term(doc, t, "signal"),
        )
      : null,
    r && !mine ? h(doc, "p", { class: "desk-muted" }, t("channels.notJoined")) : null,
    r?.hidden
      ? h(
          doc,
          "div",
          { class: "note desk-card", role: "note" },
          h(doc, "p", {}, t("channels.hidden")),
          h(doc, "p", { class: "desk-muted" }, t("channels.hidden.do")),
        )
      : null,
    input.bands.map((band) => bandSection(doc, t, band)),
    r
      ? h(
          doc,
          "dl",
          { class: "explain-terms desk-muted" },
          ["wifiChannel", "congestion"].flatMap((name) => [
            h(doc, "dt", {}, term(doc, t, name)),
            h(doc, "dd", {}, t(`help.${name}`)),
          ]),
        )
      : null,
    glossary(doc, t),
  );
}
