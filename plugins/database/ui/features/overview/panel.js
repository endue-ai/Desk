// The overview panel's DOM (a div for the header and the links: the page styles bare header and
// nav elements as its own bar): a header with the server, its uptime and when its statistics were
// reset, and Refresh; a sentence for what the role cannot see; links to the sections; and each
// section with its statistic and reset time, then its rows as a table, its empty sentence, what it
// could not read, or how pg_stat_statements is enabled. Open in console runs a section's SQL in the
// connection's console; a heavy statement's Open puts it there. The settings have a search. An
// update draws again in place and keeps the search. Colours come from overview.css's classes.

import { formatValue, numeric, uptime } from "./format.js";
import { blindSpots } from "./probe.js";

/**
 * @typedef {import("./read.js").OverviewState} OverviewState
 * @typedef {import("./read.js").Read} Read
 * @typedef {import("./sql.js").Format} Format
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** A server figure's unit, as the panel formats it. */
const UNIT = /** @type {Record<string, Format>} */ ({
  count: "count",
  bytes: "bytes",
  percent: "percent",
  seconds: "seconds",
  time: "time",
});

/**
 * @param {Document} doc
 * @param {OverviewState} first
 * @param {Act} act
 * @param {{ connection: string }} buffer
 */
export function overviewView(doc, first, act, buffer) {
  const root = doc.createElement("div");
  root.className = "overview";
  let search = "";

  const make = (
    /** @type {string} */ tag,
    /** @type {string} */ className = "",
    /** @type {string} */ text = "",
  ) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  /** A kit button; `more` adds its variant and the panel's own classes. */
  const button = (
    /** @type {string} */ text,
    /** @type {string} */ more,
    /** @type {() => void} */ press,
  ) => {
    const node = /** @type {HTMLButtonElement} */ (make("button", "desk-btn", text));
    if (more) node.classList.add(...more.split(" "));
    node.type = "button";
    node.addEventListener("click", press);
    return node;
  };

  const header = (/** @type {OverviewState} */ s) => {
    const head = make("div", "desk-header ov-header");
    const text = make("div", "desk-header-text");
    text.append(make("h2", "desk-header-title", "Server overview"), make("p", "desk-header-desc"));
    /** @type {HTMLElement} */ (text.lastChild).textContent = describe(s);
    const actions = make("div", "desk-header-actions");
    const refresh = button("Refresh", "", () => act("overviewRefresh", buffer.connection));
    refresh.title = "Read every section again";
    refresh.disabled = s.reading;
    actions.append(refresh);
    head.append(text, actions);
    return head;
  };

  const notes = (/** @type {OverviewState} */ s) => {
    const out = [];
    if (s.reading) {
      const status = make("p", "ov-status");
      status.setAttribute("role", "status");
      const spin = make("span", "desk-spinner");
      spin.setAttribute("aria-hidden", "true");
      status.append(spin, doc.createTextNode(` Reading the statistics of ${s.name}…`));
      out.push(status);
    }
    if (s.failed) {
      const box = make("div", "desk-error");
      box.append(make("p", "", s.failed));
      box.append(button("Try again", "", () => act("overviewRefresh", buffer.connection)));
      out.push(box);
    }
    const blind = s.server ? blindSpots(s.server) : "";
    if (blind) out.push(make("p", "ov-note", blind));
    if (s.server && s.server.versionNum > 0 && s.server.versionNum < 130000)
      out.push(
        make(
          "p",
          "ov-note",
          "This server is older than PostgreSQL 13, the oldest the overview reads: some sections may not be read.",
        ),
      );
    return out;
  };

  const nav = (/** @type {OverviewState} */ s) => {
    const links = make("div", "ov-nav");
    links.setAttribute("role", "navigation");
    links.setAttribute("aria-label", "Sections");
    for (const r of s.sections) {
      const link = /** @type {HTMLAnchorElement} */ (make("a", "", r.title));
      link.href = `#ov-${r.id}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        root.querySelector(`#ov-${r.id}`)?.scrollIntoView({ block: "start" });
      });
      links.append(link);
    }
    return links;
  };

  /** A section's rows as a table, those the search leaves when it has one. */
  const table = (/** @type {Read} */ r) => {
    const names = r.names ?? [];
    const at = (/** @type {string} */ key) => names.indexOf(key);
    const needle = r.search ? search.trim().toLowerCase() : "";
    const rows = (r.rows ?? [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !needle || row.some((v) => (v ?? "").toLowerCase().includes(needle)));
    if (rows.length === 0) return make("p", "ov-empty", `No setting holds “${search.trim()}”.`);
    const wrap = make("div", "ov-scroll");
    const grid = make("table", "desk-table ov-table");
    const head = make("tr");
    for (const column of r.columns)
      head.append(make("th", numeric(column.format) ? "ov-num" : "", column.label));
    // A statement's Open leads its row, in sight however wide the statement column is.
    if (r.id === "statements") head.prepend(make("th", "", "Console"));
    grid.append(make("thead"), make("tbody"));
    /** @type {HTMLElement} */ (grid.firstChild).append(head);
    const body = /** @type {HTMLElement} */ (grid.lastChild);
    for (const { row, index } of rows) {
      const line = make("tr");
      for (const column of r.columns) {
        const raw = row[at(column.key)] ?? null;
        const format =
          r.id === "server" && column.key === "value" ? UNIT[row[at("unit")] ?? ""] : column.format;
        const cell = make("td", numeric(format) ? "ov-num" : "", formatValue(format, raw));
        if (column.format === "query") {
          cell.className = "ov-query";
          cell.title = raw ?? "";
        }
        line.append(cell);
      }
      if (r.id === "statements") {
        const cell = make("td");
        const open = button("Open", "desk-btn-quiet", () =>
          act("overviewStatement", buffer.connection, index),
        );
        open.setAttribute("aria-label", `Open statement ${index + 1} in the console`);
        cell.append(open);
        line.prepend(cell);
      }
      body.append(line);
    }
    wrap.append(grid);
    return wrap;
  };

  const section = (/** @type {Read} */ r, /** @type {OverviewState} */ s) => {
    const box = make("section", "ov-section");
    box.id = `ov-${r.id}`;
    box.setAttribute("aria-labelledby", `ov-${r.id}-title`);
    const head = make("div", "ov-head");
    const title = make("h3", "ov-title", r.title);
    title.id = `ov-${r.id}-title`;
    head.append(title);
    if (r.rows) head.append(make("span", "desk-list-count", count(r.rows.length)));
    if (r.sql && r.rows && !s.reading) {
      const open = button("Open in console", "desk-btn-quiet ov-open", () =>
        act("overviewResult", buffer.connection, r.id),
      );
      open.title =
        "Run this section's SQL in the console: its rows come back as a result to copy or export";
      head.append(open);
    }
    box.append(head, make("p", "ov-source", sourceOf(r)));
    if (r.note && !r.missing) box.append(make("p", "ov-note", r.note));
    if (r.missing) {
      const callout = make("div", "desk-callout ov-callout");
      callout.append(make("p", "desk-callout-body", r.missing));
      box.append(callout);
    } else if (r.failed) {
      const failed = make("div", "desk-error ov-failed");
      failed.append(make("p", "", r.failed));
      box.append(failed);
    } else if (!r.rows) box.append(make("p", "ov-empty", "Not read yet."));
    else if (r.rows.length === 0) box.append(make("p", "ov-empty", r.empty));
    else {
      if (r.search) {
        const label = make("label", "ov-search");
        label.append(make("span", "sr-only", `Search the ${r.title.toLowerCase()}`));
        const field = /** @type {HTMLInputElement} */ (make("input", "desk-field"));
        field.type = "search";
        field.placeholder = "Search the settings";
        field.spellcheck = false;
        field.value = search;
        field.dataset.ovSearch = r.id;
        field.addEventListener("input", () => {
          search = field.value;
          box.lastElementChild?.replaceWith(table(r));
        });
        label.append(field);
        box.append(label);
      }
      box.append(table(r));
    }
    return box;
  };

  const draw = (/** @type {OverviewState} */ s) => {
    const active = doc.activeElement;
    const typing =
      active instanceof HTMLInputElement && root.contains(active) && active.dataset.ovSearch;
    root.replaceChildren(header(s), ...notes(s), nav(s), ...s.sections.map((r) => section(r, s)));
    if (typing) {
      const field = root.querySelector(`[data-ov-search="${typing}"]`);
      if (field instanceof HTMLInputElement) field.focus();
    }
  };

  draw(first);
  return { el: root, update: draw };
}

/** The header's line: the server, its uptime, when it was read and since when it counts. */
function describe(/** @type {OverviewState} */ s) {
  if (!s.server) return s.reading ? `Reading ${s.name}…` : s.name;
  const server = s.server;
  return [
    `PostgreSQL ${server.version.split(" ")[0]}`,
    server.standby ? "standby" : "primary",
    `database ${server.database}`,
    uptime(server.upSeconds),
    `read at ${new Date(s.at).toTimeString().slice(0, 5)}`,
    server.statsReset
      ? `statistics counted since ${formatValue("time", server.statsReset)}`
      : "statistics never reset",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Where a section's figures come from and since when they count. */
function sourceOf(/** @type {Read} */ r) {
  const from = `From ${r.source}`;
  if (r.counters === "none") return `${from} · as read`;
  if (r.counters === "rows") return `${from} · each figure's reset time beside it`;
  if (r.unrecorded) return `${from} · this version keeps no reset time`;
  if (r.since === undefined) return from;
  return r.since
    ? `${from} · counted since ${formatValue("time", r.since)}`
    : `${from} · never reset`;
}

const count = (/** @type {number} */ n) => `${n} row${n === 1 ? "" : "s"}`;
