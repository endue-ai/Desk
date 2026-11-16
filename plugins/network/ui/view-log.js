// The Log tab (NET-15): new, returning and departing devices in time order, drawn by the desk's
// universal timeline (ctx.universal, ADR 0087) over inline data. Where the universal element is
// not there (a test page), the same entries are a plain list.
import { fill, h, timeText } from "./dom.js";

/**
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 * @typedef {{ universal: "v0", title: string, entries: Array<Record<string, unknown>> }} Data
 * @typedef {{ open(host: Element, view: any, options?: any): { close(): void } }} Universal
 */

/** The timeline view over the log's data. @param {T} t @param {Data} data */
export function timelineView(t, data) {
  return {
    type: "timeline",
    title: t("log.title"),
    source: { data },
    map: { title: "title", start: "start", group: "group", status: "status", text: "text" },
    options: { order: "desc" },
    actions: [
      {
        command: "endue.network.devices",
        title: t("map.list"),
        args: { mac: "{mac}", show: true },
      },
    ],
    empty: t("log.empty"),
  };
}

/** @param {Universal | undefined} universal */
export function createLogView(universal) {
  /** @type {{ close(): void } | null} */
  let handle = null;
  /** @type {string} */
  let drawn = "";

  /**
   * Draw the log; the same data is not drawn twice.
   * @param {HTMLElement} host @param {T} t @param {Data} data @param {string} language
   */
  const render = (host, t, data, language) => {
    const key = JSON.stringify([language, data.entries.map((e) => e.id)]);
    if (key === drawn && host.childElementCount > 0) return;
    drawn = key;
    handle?.close();
    handle = null;
    const doc = /** @type {Document} */ (host.ownerDocument);
    const title = h(doc, "h2", { class: "panel-title" }, t("log.title"));
    if (data.entries.length === 0) {
      fill(host, title, h(doc, "p", { class: "desk-empty" }, t("log.empty")));
      return;
    }
    const mount = h(doc, "div", { class: "timeline" });
    fill(host, title, mount);
    if (universal && doc.defaultView?.customElements?.get("desk-universal-view")) {
      try {
        handle = universal.open(mount, timelineView(t, data));
        return;
      } catch {
        // Drawn as a list below.
      }
    }
    fill(
      mount,
      h(
        doc,
        "ol",
        { class: "log-list" },
        data.entries.map((e) =>
          h(
            doc,
            "li",
            { class: `log-entry log-${String(e.status)}` },
            h(doc, "time", { datetime: String(e.start) }, timeText(String(e.start), language)),
            h(doc, "span", { class: "desk-badge" }, String(e.group)),
            h(doc, "span", {}, String(e.title)),
            e.text ? h(doc, "span", { class: "desk-muted mono" }, String(e.text)) : null,
          ),
        ),
      ),
    );
  };
  return { render, close: () => handle?.close() };
}
