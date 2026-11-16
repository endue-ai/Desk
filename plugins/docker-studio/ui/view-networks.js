// The Networks section: every network with its driver, subnet and gateway, its stack, and the
// containers connected to it; the three built in (bridge, host, none) marked and kept; Create and
// Remove unused in the top bar.

import { button, h, icon, pill } from "./dom.js";
import { ago } from "./format.js";
import { matches, parseQuery } from "./query.js";
import { createTable } from "./table.js";

/** @typedef {import("./parse.js").Network} Network @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function createNetworks(app) {
  let query = parseQuery("");
  const table = createTable({
    label: "Networks",
    keyOf: (n) => n.id,
    sortKey: "name",
    open: (n) => app.open({ kind: "network", id: n.id }),
    menu: (rows, at) =>
      app.overlay.menu(
        [
          ...(rows.length === 1
            ? [
                {
                  label: "Open",
                  icon: /** @type {const} */ ("network"),
                  run: () => app.open({ kind: "network", id: rows[0]?.id ?? "" }),
                },
                /** @type {"-"} */ ("-"),
              ]
            : []),
          {
            label: "Remove",
            icon: "trash",
            danger: true,
            disabled: rows.every((n) => n.builtin),
            run: () => void app.objects.removeNetworks(rows),
          },
        ],
        at,
      ),
    empty: () =>
      h("div.table-empty", null, icon("network", 28), h("b", null, "No networks match.")),
    columns: [
      {
        key: "name",
        title: "Network",
        sort: (a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
        cell: (n) =>
          h(
            "div.name-cell",
            null,
            h(`span.image-badge${n.members.length ? "" : ".dangling"}`, null, icon("network", 15)),
            h(
              "div.name-text",
              null,
              h(
                "b",
                null,
                n.name,
                n.builtin ? pill("built in") : null,
                n.internal ? pill("internal", "warn") : null,
              ),
              h("small", null, n.project ? `stack ${n.project}` : n.scope),
            ),
          ),
      },
      {
        key: "driver",
        title: "Driver",
        width: "10%",
        sort: (a, b) => a.driver.localeCompare(b.driver),
        cell: (n) => h("span.mono", null, n.driver),
      },
      {
        key: "subnet",
        title: "Subnet",
        width: "16%",
        cell: (n) =>
          h(
            "div.status-cell",
            null,
            h("span.mono", null, n.subnet || "–"),
            n.gateway ? h("small", null, `gateway ${n.gateway}`) : null,
          ),
      },
      {
        key: "members",
        title: "Containers",
        width: "24%",
        sort: (a, b) => a.members.length - b.members.length,
        cell: (n) =>
          n.members.length
            ? h(
                "div.users",
                null,
                n.members.slice(0, 3).map((m) => h("span.user-chip.plain", null, m.name)),
                n.members.length > 3 ? h("small.muted", null, `+${n.members.length - 3}`) : null,
              )
            : h("span.muted", null, "None"),
      },
      {
        key: "created",
        title: "Created",
        width: "11%",
        sort: (a, b) => b.created - a.created,
        cell: (n) => h("span.muted", null, ago(n.created)),
      },
      {
        key: "actions",
        title: "",
        width: "84px",
        cls: "actions-cell",
        cell: (n) =>
          h(
            "div.row-actions",
            null,
            button({
              label: `Open ${n.name}`,
              icon: "chevronRight",
              hideLabel: true,
              onClick: () => app.open({ kind: "network", id: n.id }),
            }),
            button({
              label: `Remove ${n.name}`,
              icon: "trash",
              hideLabel: true,
              kind: "danger-hover",
              disabled: n.builtin,
              onClick: () => void app.objects.removeNetworks([n]),
            }),
          ),
      },
    ],
  });
  const summary = h("div.list-summary");
  const element = h(
    "div.page.list-page",
    null,
    h(
      "div.list-head",
      null,
      h("p.muted.head-note", null, "Containers on one network reach each other by name."),
      h("span.grow"),
      summary,
    ),
    table.element,
  );

  const draw = () => {
    const { networks } = app.store.state;
    const unused = networks.filter((n) => !n.builtin && !n.members.length);
    summary.replaceChildren(
      unused.length
        ? button({
            label: `Remove unused · ${unused.length}`,
            icon: "broom",
            kind: "desk-btn-quiet",
            onClick: () => void app.objects.pruneNetworks(),
          })
        : null,
    );
    table.set([
      {
        key: "",
        title: "",
        rows: networks.filter((n) =>
          matches(
            query,
            [n.name, n.driver, n.subnet, n.project, ...n.members.map((m) => m.name)].join(" "),
            () => undefined,
          ),
        ),
      },
    ]);
  };

  return {
    element,
    title: "Networks",
    get subtitle() {
      return `${app.store.state.networks.length} networks`;
    },
    tools: () => [
      button({
        label: "Create a network",
        icon: "plus",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.createNetwork(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("networks")) draw();
    },
    search(/** @type {string} */ text) {
      query = parseQuery(text);
      draw();
    },
  };
}
