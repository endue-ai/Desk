// The Volumes section: every volume with its stack, the containers that mount it, its size (once
// docker has measured them) and its driver; filters for in use, unused and anonymous; Browse,
// the menu and delete on each row; Create and Delete unused in the top bar.

import { button, dot, h, icon, pill } from "./dom.js";
import { ago, bytes } from "./format.js";
import { dotState, volumeUse } from "./model.js";
import { matches, parseQuery } from "./query.js";
import { createTable } from "./table.js";

/** @typedef {import("./parse.js").Volume} Volume @typedef {import("./studio.js").App} App */

const FILTERS = /** @type {const} */ ([
  ["all", "All"],
  ["used", "In use"],
  ["unused", "Unused"],
  ["anonymous", "Anonymous"],
]);

/** @param {App} app */
export function createVolumes(app) {
  const prefs = app.prefs("volumes", { filter: "all", sort: "name", dir: 1 });
  let query = parseQuery("");
  let use = volumeUse([]);
  const size = (/** @type {Volume} */ v) => app.store.state.volumeSizes.get(v.name);
  const pass = (/** @type {string} */ f, /** @type {Volume} */ v) =>
    f === "used"
      ? use.has(v.name)
      : f === "unused"
        ? !use.has(v.name)
        : f === "anonymous"
          ? v.anonymous
          : true;
  let largest = 1;

  const table = createTable({
    label: "Volumes",
    keyOf: (v) => v.name,
    sortKey: prefs.sort,
    sortDir: prefs.dir,
    onSort: (key, dir) => app.savePrefs("volumes", { ...prefs, sort: key, dir }),
    open: (v) => app.open({ kind: "volume", id: v.name }),
    menu: (rows, at) => menu(rows, at),
    selected: () => drawBulk(),
    empty: () => h("div.table-empty", null, icon("volume", 28), h("b", null, "No volumes match.")),
    columns: [
      {
        key: "name",
        title: "Volume",
        sort: (a, b) => a.name.localeCompare(b.name),
        cell: (v) =>
          h(
            "div.name-cell",
            null,
            h(`span.image-badge${use.has(v.name) ? "" : ".dangling"}`, null, icon("volume", 15)),
            h(
              "div.name-text",
              null,
              h("b", null, v.anonymous ? `${v.name.slice(0, 12)}…` : v.name),
              h(
                "small",
                null,
                v.anonymous ? "anonymous" : v.project ? `stack ${v.project}` : v.driver,
              ),
            ),
          ),
      },
      {
        key: "use",
        title: "Mounted by",
        width: "24%",
        sort: (a, b) => (use.get(a.name)?.length ?? 0) - (use.get(b.name)?.length ?? 0),
        cell: (v) => {
          const users = use.get(v.name) ?? [];
          if (!users.length) return pill("Unused");
          return h(
            "div.users",
            null,
            users
              .slice(0, 2)
              .map((c) =>
                h(
                  "button.desk-btn.desk-btn-quiet.user-chip",
                  { type: "button", onClick: () => app.open({ kind: "container", id: c.id }) },
                  dot(dotState(c)),
                  c.name,
                ),
              ),
            users.length > 2 ? h("small.muted", null, `+${users.length - 2}`) : null,
          );
        },
      },
      {
        key: "size",
        title: "Size",
        width: "17%",
        sort: (a, b) => (size(b) ?? -1) - (size(a) ?? -1),
        cell: (v) => {
          const n = size(v);
          return n === undefined
            ? h("span.muted", null, "–")
            : h(
                "div.size-cell",
                null,
                h("span.num", null, bytes(n)),
                h(
                  "span.size-bar",
                  null,
                  h("span", {
                    style: { width: `${Math.max(1.5, (n / largest) * 100).toFixed(1)}%` },
                  }),
                ),
              );
        },
      },
      {
        key: "created",
        title: "Created",
        width: "12%",
        sort: (a, b) => b.created - a.created,
        cell: (v) => h("span.muted", null, ago(v.created)),
      },
      {
        key: "actions",
        title: "",
        width: "112px",
        cls: "actions-cell",
        cell: (v) =>
          h(
            "div.row-actions",
            null,
            button({
              label: `Browse ${v.name}`,
              icon: "folder",
              hideLabel: true,
              onClick: () => app.open({ kind: "volume", id: v.name, tab: "files" }),
            }),
            button({
              label: `More for ${v.name}`,
              icon: "more",
              hideLabel: true,
              onClick: (e) => menu([v], /** @type {HTMLElement} */ (e.currentTarget)),
            }),
            button({
              label: `Delete ${v.name}`,
              icon: "trash",
              hideLabel: true,
              kind: "danger-hover",
              onClick: () => void app.objects.removeVolumes([v]),
            }),
          ),
      },
    ],
  });

  const menu = (/** @type {Volume[]} */ rows, /** @type {any} */ at) => {
    const one = rows.length === 1 ? rows[0] : undefined;
    app.overlay.menu(
      [
        ...(one
          ? [
              {
                label: "Open",
                icon: /** @type {const} */ ("volume"),
                run: () => app.open({ kind: "volume", id: one.name }),
              },
              {
                label: "Browse files",
                icon: /** @type {const} */ ("folder"),
                run: () => app.open({ kind: "volume", id: one.name, tab: "files" }),
              },
              {
                label: "Copy the name",
                icon: /** @type {const} */ ("copy"),
                run: () => void app.act.copy(one.name, "the name"),
              },
              /** @type {"-"} */ ("-"),
            ]
          : []),
        {
          label: rows.length > 1 ? `Delete ${rows.length} volumes` : "Delete",
          icon: "trash",
          danger: true,
          run: () => void app.objects.removeVolumes(rows),
        },
      ],
      at,
    );
  };

  const filters = h("div.desk-tabs.filters", { role: "tablist", "aria-label": "Show" });
  const summary = h("div.list-summary");
  const bulk = h("div.bulk", { hidden: true, role: "toolbar", "aria-label": "Marked volumes" });
  const element = h(
    "div.page.list-page",
    null,
    h("div.list-head", null, filters, h("span.grow"), summary),
    bulk,
    table.element,
  );

  const drawBulk = () => {
    const marked = table.selection();
    bulk.hidden = !marked.length;
    if (!marked.length) return;
    bulk.replaceChildren(
      h("b", null, `${marked.length} marked`),
      button({
        label: "Delete",
        icon: "trash",
        kind: "desk-btn-quiet danger-text",
        onClick: () => void app.objects.removeVolumes(marked).then((ok) => ok && table.clear()),
      }),
      h("span.grow"),
      button({ label: "Clear", kind: "desk-btn-quiet", onClick: () => table.clear() }),
    );
  };

  const draw = () => {
    const { volumes, containers, volumeSizes } = app.store.state;
    use = volumeUse(containers);
    largest = Math.max(1, ...volumeSizes.values());
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
              app.savePrefs("volumes", prefs);
              draw();
            },
          },
          label,
          h("span.tab-count", null, String(volumes.filter((v) => pass(id, v)).length)),
        ),
      ),
    );
    const total = [...volumeSizes.values()].reduce((s, n) => s + n, 0);
    summary.replaceChildren(
      h("span.muted", null, total ? `${bytes(total)} in all` : "Measuring…"),
      volumes.some((v) => !use.has(v.name))
        ? button({
            label: "Delete unused",
            icon: "broom",
            kind: "desk-btn-quiet",
            onClick: () => void app.objects.pruneVolumes(),
          })
        : null,
    );
    table.set([
      {
        key: "",
        title: "",
        rows: volumes.filter(
          (v) =>
            pass(prefs.filter, v) &&
            matches(query, [v.name, v.project, v.driver].join(" "), (n) =>
              n === "stack" ? [v.project] : undefined,
            ),
        ),
      },
    ]);
  };

  return {
    element,
    title: "Volumes",
    get subtitle() {
      return "Data that outlives its containers";
    },
    tools: () => [
      button({
        label: "Create a volume",
        icon: "plus",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.createVolume(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("volumes") || changed.has("containers") || changed.has("volumeSizes")) draw();
    },
    search(/** @type {string} */ text) {
      query = parseQuery(text);
      draw();
    },
  };
}
