// The Containers section: every container, grouped by Compose stack (a stack folds and acts as one),
// filtered by state and the search, with live CPU and memory, ports that open in the browser, a
// button for what each row most needs, a menu for the rest, and actions on every marked row.

import { sparkline } from "./chart.js";
import { button, dot, h, icon, pill } from "./dom.js";
import { memory, percent, short } from "./format.js";
import { containerMenu } from "./menus.js";
import { dotState, portUrl, problemOf, since, stateLabel } from "./model.js";
import { containerFields, matches, parseQuery } from "./query.js";
import { createTable } from "./table.js";
import { rowActions, stackHead } from "./view-rows.js";

/** @typedef {import("./parse.js").Container} Container @typedef {import("./studio.js").App} App */

const FILTERS = /** @type {const} */ ([
  ["all", "All"],
  ["running", "Running"],
  ["stopped", "Stopped"],
  ["paused", "Paused"],
  ["problems", "Problems"],
]);

const pass = (/** @type {string} */ filter, /** @type {Container} */ c) =>
  filter === "running"
    ? c.state === "running"
    : filter === "stopped"
      ? c.state === "exited" || c.state === "created" || c.state === "dead"
      : filter === "paused"
        ? c.state === "paused"
        : filter === "problems"
          ? problemOf(c) !== null
          : true;

/** @param {App} app */
export function createContainers(app) {
  const prefs = app.prefs("containers", { filter: "all", group: true, sort: "name", dir: 1 });
  let query = parseQuery("");
  const stats = (/** @type {string} */ id) => app.live.history.get(id);

  const table = createTable({
    label: "Containers",
    keyOf: (c) => c.id,
    sortKey: prefs.sort,
    sortDir: prefs.dir,
    onSort: (key, dir) => app.savePrefs("containers", { ...prefs, sort: key, dir }),
    open: (c) => app.open({ kind: "container", id: c.id }),
    menu: (rows, at) => containerMenu(app, rows, at),
    selected: () => drawBulk(),
    rowClass: (c) => (app.act.busy.has(c.id) ? "busy" : ""),
    empty: () =>
      h(
        "div.table-empty",
        null,
        icon("container", 28),
        h(
          "b",
          null,
          query.words.length || query.fields.length
            ? "No container matches."
            : "No containers yet.",
        ),
        button({
          label: "Run a container",
          icon: "play",
          kind: "desk-btn-primary",
          onClick: () => app.dialogs.run(),
        }),
      ),
    columns: [
      {
        key: "name",
        title: "Name",
        sort: (a, b) => a.name.localeCompare(b.name),
        cell: (c) =>
          h(
            "div.name-cell",
            null,
            dot(dotState(c), stateLabel(c)),
            h(
              "div.name-text",
              null,
              h("b", null, c.service && c.project ? c.service : c.name),
              h("small.mono", null, c.service ? c.name : short(c.id)),
            ),
          ),
      },
      {
        key: "image",
        title: "Image",
        width: "21%",
        sort: (a, b) => a.image.localeCompare(b.image),
        cell: (c) =>
          h(
            "button.desk-btn.desk-btn-quiet.cell-link",
            {
              type: "button",
              title: `Open ${c.image}`,
              onClick: () => app.open({ kind: "image", id: c.imageId }),
            },
            c.image,
          ),
      },
      {
        key: "status",
        title: "Status",
        width: "15%",
        sort: (a, b) => a.state.localeCompare(b.state) || b.startedAt - a.startedAt,
        cell: (c) => {
          const problem = problemOf(c);
          const kind = problem
            ? problem.level === "danger"
              ? "bad"
              : "warn"
            : c.state === "running"
              ? "ok"
              : "";
          return h("div.status-cell", null, pill(stateLabel(c), kind), h("small", null, since(c)));
        },
      },
      {
        key: "ports",
        title: "Ports",
        width: "13%",
        cell: (c) =>
          h(
            "div.ports",
            null,
            c.state === "running"
              ? c.ports.slice(0, 2).map((p) =>
                  h(
                    "button.desk-btn.desk-btn-quiet.port",
                    {
                      type: "button",
                      title: `Open ${portUrl(p)}`,
                      onClick: () => app.act.browse(portUrl(p)),
                    },
                    `${p.host}:${p.container}`,
                    icon("external", 11),
                  ),
                )
              : c.ports
                  .slice(0, 2)
                  .map((p) => h("span.port.off", null, `${p.host}:${p.container}`)),
            c.ports.length > 2 ? h("small.muted", null, `+${c.ports.length - 2}`) : null,
          ),
      },
      {
        key: "cpu",
        title: "CPU",
        width: "128px",
        live: true,
        sort: (a, b) => (stats(a.id)?.latest.cpu ?? -1) - (stats(b.id)?.latest.cpu ?? -1),
        cell: (c) => {
          const s = stats(c.id);
          if (c.state !== "running" || !s) return h("span.muted", null, "–");
          return h(
            "div.live-cell",
            null,
            sparkline(s.cpu.slice(-24), { width: 52, height: 18, color: "--desk-chart-1" }),
            h("span", null, percent(s.latest.cpu)),
          );
        },
      },
      {
        key: "mem",
        title: "Memory",
        width: "96px",
        live: true,
        sort: (a, b) => (stats(a.id)?.latest.mem ?? -1) - (stats(b.id)?.latest.mem ?? -1),
        cell: (c) => {
          const s = stats(c.id);
          return c.state === "running" && s
            ? h("span.num", null, memory(s.latest.mem))
            : h("span.muted", null, "–");
        },
      },
      {
        key: "actions",
        title: "",
        width: "132px",
        cls: "actions-cell",
        cell: (c) => rowActions(app, c),
      },
    ],
  });

  const filters = h("div.desk-tabs.filters", { role: "tablist", "aria-label": "Show" });
  const groupToggle = h(
    "label.toggle",
    null,
    h("input.desk-check", {
      type: "checkbox",
      checked: prefs.group,
      onChange: (/** @type {Event} */ e) => {
        prefs.group = /** @type {HTMLInputElement} */ (e.target).checked;
        app.savePrefs("containers", prefs);
        draw();
      },
    }),
    "Group by stack",
  );
  const bulk = h("div.bulk", { hidden: true, role: "toolbar", "aria-label": "Marked containers" });
  const element = h(
    "div.page.list-page",
    null,
    h("div.list-head", null, filters, h("span.grow"), groupToggle),
    bulk,
    table.element,
  );

  const drawFilters = (/** @type {Container[]} */ all) => {
    filters.replaceChildren(
      ...FILTERS.map(([id, label]) =>
        h(
          "button.desk-tab",
          {
            type: "button",
            role: "tab",
            "aria-selected": prefs.filter === id ? "true" : "false",
            onClick: () => {
              prefs.filter = id;
              app.savePrefs("containers", prefs);
              draw();
            },
          },
          label,
          h("span.tab-count", null, String(all.filter((c) => pass(id, c)).length)),
        ),
      ),
    );
  };

  const drawBulk = () => {
    const marked = table.selection();
    bulk.hidden = marked.length === 0;
    if (!marked.length) return;
    const go = (/** @type {import("./actions.js").ContainerOp} */ op) => () => {
      void app.act.container(op, marked).then((ok) => ok && table.clear());
    };
    bulk.replaceChildren(
      h("b", null, `${marked.length} marked`),
      button({ label: "Start", icon: "play", kind: "desk-btn-quiet", onClick: go("start") }),
      button({ label: "Stop", icon: "stop", kind: "desk-btn-quiet", onClick: go("stop") }),
      button({ label: "Restart", icon: "restart", kind: "desk-btn-quiet", onClick: go("restart") }),
      button({ label: "Pause", icon: "pause", kind: "desk-btn-quiet", onClick: go("pause") }),
      button({
        label: "Remove",
        icon: "trash",
        kind: "desk-btn-quiet danger-text",
        onClick: go("remove"),
      }),
      h("span.grow"),
      button({ label: "Clear", kind: "desk-btn-quiet", onClick: () => table.clear() }),
    );
  };

  const draw = () => {
    const all = app.store.state.containers;
    drawFilters(all);
    const shown = all.filter((c) => {
      if (!pass(prefs.filter, c)) return false;
      const f = containerFields(c);
      return matches(query, f.text, f.field);
    });
    if (!prefs.group) return table.set([{ key: "", title: "", rows: shown }]);
    const stacks = app.stacks();
    const groups = stacks
      .map((s) => ({
        key: s.name,
        title: s.name,
        rows: shown.filter((c) => c.project === s.name),
        head: () => stackHead(app, s),
      }))
      .filter((g) => g.rows.length > 0);
    groups.push({ key: "", title: "", rows: shown.filter((c) => !c.project), head: () => [] });
    table.set(groups);
  };

  const off = app.live.onStats(() => table.tick());

  return {
    element,
    title: "Containers",
    get subtitle() {
      const all = app.store.state.containers;
      const running = all.filter((c) => c.state === "running").length;
      return `${running} running of ${all.length}`;
    },
    stats: true,
    tools: () => [
      button({
        label: "Run a container",
        icon: "play",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.run(),
      }),
    ],
    /** @param {any} _state @param {Set<string>} changed */
    update(_state, changed) {
      if (changed.has("containers") || changed.has("projects")) draw();
    },
    search(/** @type {string} */ text) {
      query = parseQuery(text);
      draw();
    },
    dispose: () => off(),
  };
}
