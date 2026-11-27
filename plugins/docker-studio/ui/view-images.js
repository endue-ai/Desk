// The Images section: every image with its tags, age, size (with a bar against the largest) and the
// containers that use it; filters for in use, unused and dangling; Run, pull again and remove on
// each row; Pull, Build and Remove unused in the top bar.

import { button, h, icon, pill } from "./dom.js";
import { ago, bytes, short } from "./format.js";
import { imageName, imageUse, splitRef } from "./model.js";
import { matches, parseQuery } from "./query.js";
import { createTable } from "./table.js";

/** @typedef {import("./parse.js").Image} Image @typedef {import("./studio.js").App} App */

const FILTERS = /** @type {const} */ ([
  ["all", "All"],
  ["used", "In use"],
  ["unused", "Unused"],
  ["dangling", "Dangling"],
]);

/** @param {App} app */
export function createImages(app) {
  const prefs = app.prefs("images", { filter: "all", sort: "created", dir: 1 });
  let query = parseQuery("");
  let use = imageUse([]);
  let largest = 1;
  const usedBy = (/** @type {Image} */ i) => use.get(i.id) ?? 0;
  const pass = (/** @type {string} */ f, /** @type {Image} */ i) =>
    f === "used"
      ? usedBy(i) > 0
      : f === "unused"
        ? usedBy(i) === 0
        : f === "dangling"
          ? i.dangling
          : true;

  const table = createTable({
    label: "Images",
    keyOf: (i) => i.id,
    sortKey: prefs.sort,
    sortDir: prefs.dir,
    onSort: (key, dir) => app.savePrefs("images", { ...prefs, sort: key, dir }),
    open: (i) => app.open({ kind: "image", id: i.id }),
    menu: (rows, at) => app.menus.image(rows, at),
    selected: () => drawBulk(),
    empty: () =>
      h(
        "div.table-empty",
        null,
        icon("image", 28),
        h("b", null, "No images match."),
        button({
          label: "Pull an image",
          icon: "download",
          kind: "desk-btn-primary",
          onClick: () => app.dialogs.pull(),
        }),
      ),
    columns: [
      {
        key: "name",
        title: "Image",
        sort: (a, b) => imageName(a).localeCompare(imageName(b)),
        cell: (i) => {
          const { repo, tag } = splitRef(i.refs[0] ?? "<none>:<none>");
          return h(
            "div.name-cell",
            null,
            h(`span.image-badge${i.dangling ? ".dangling" : ""}`, null, icon("layers", 15)),
            h(
              "div.name-text",
              null,
              h(
                "b",
                null,
                i.dangling ? "<none>" : repo,
                i.dangling ? null : h("span.tag", null, tag),
              ),
              h(
                "small.mono",
                null,
                short(i.id),
                i.refs.length > 1 ? h("span.more-tags", null, ` +${i.refs.length - 1} tags`) : null,
              ),
            ),
          );
        },
      },
      {
        key: "use",
        title: "Used by",
        width: "14%",
        sort: (a, b) => usedBy(a) - usedBy(b),
        cell: (i) =>
          usedBy(i)
            ? pill(`${usedBy(i)} container${usedBy(i) === 1 ? "" : "s"}`, "ok")
            : pill(i.dangling ? "Dangling" : "Unused", i.dangling ? "warn" : ""),
      },
      {
        key: "created",
        title: "Created",
        width: "14%",
        sort: (a, b) => b.created - a.created,
        cell: (i) => h("span.muted", null, ago(i.created)),
      },
      {
        key: "size",
        title: "Size",
        width: "18%",
        sort: (a, b) => b.size - a.size,
        cell: (i) =>
          h(
            "div.size-cell",
            null,
            h("span.num", null, bytes(i.size)),
            h(
              "span.size-bar",
              null,
              h("span", {
                style: { width: `${Math.max(2, (i.size / largest) * 100).toFixed(1)}%` },
              }),
            ),
          ),
      },
      {
        key: "actions",
        title: "",
        width: "132px",
        cls: "actions-cell",
        cell: (i) =>
          h(
            "div.row-actions",
            null,
            button({
              label: `Run ${imageName(i)}`,
              icon: "play",
              hideLabel: true,
              onClick: () => app.dialogs.run(i.refs[0] ?? i.id),
            }),
            i.refs[0] && !i.refs[0].endsWith(":dev")
              ? button({
                  label: `Pull ${i.refs[0]} again`,
                  icon: "download",
                  hideLabel: true,
                  onClick: () => app.dialogs.pullRef(i.refs[0] ?? ""),
                })
              : button({
                  label: "Tag",
                  icon: "tag",
                  hideLabel: true,
                  onClick: () => app.dialogs.tag(i),
                }),
            button({
              label: `More for ${imageName(i)}`,
              icon: "more",
              hideLabel: true,
              onClick: (e) => app.menus.image([i], /** @type {HTMLElement} */ (e.currentTarget)),
            }),
            button({
              label: `Remove ${imageName(i)}`,
              icon: "trash",
              hideLabel: true,
              kind: "danger-hover",
              onClick: () => app.act.removeImages([i]),
            }),
          ),
      },
    ],
  });

  const filters = h("div.desk-tabs.filters", { role: "tablist", "aria-label": "Show" });
  const summary = h("div.list-summary");
  const bulk = h("div.bulk", { hidden: true, role: "toolbar", "aria-label": "Marked images" });
  const element = h(
    "div.page.list-page",
    null,
    h("div.list-head", null, filters, h("span.grow"), summary),
    bulk,
    table.element,
  );

  const drawBulk = () => {
    const marked = table.selection();
    bulk.hidden = marked.length === 0;
    if (!marked.length) return;
    bulk.replaceChildren(
      h("b", null, `${marked.length} marked · ${bytes(marked.reduce((s, i) => s + i.size, 0))}`),
      button({
        label: "Remove",
        icon: "trash",
        kind: "desk-btn-quiet danger-text",
        onClick: () => void app.act.removeImages(marked).then((ok) => ok && table.clear()),
      }),
      h("span.grow"),
      button({ label: "Clear", kind: "desk-btn-quiet", onClick: () => table.clear() }),
    );
  };

  const draw = () => {
    const { images, containers } = app.store.state;
    use = imageUse(containers);
    largest = Math.max(1, ...images.map((i) => i.size));
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
              app.savePrefs("images", prefs);
              draw();
            },
          },
          label,
          h("span.tab-count", null, String(images.filter((i) => pass(id, i)).length)),
        ),
      ),
    );
    const unused = images.filter((i) => usedBy(i) === 0);
    const free = unused.reduce((s, i) => s + i.size, 0);
    summary.replaceChildren(
      h("span.muted", null, `${bytes(images.reduce((s, i) => s + i.size, 0))} in all`),
      free > 0
        ? button({
            label: `Remove unused · ${bytes(free)}`,
            icon: "broom",
            kind: "desk-btn-quiet",
            onClick: () => app.act.pruneImages(),
          })
        : null,
    );
    table.set([
      {
        key: "",
        title: "",
        rows: images.filter((i) => {
          if (!pass(prefs.filter, i)) return false;
          const text = [...i.refs, i.id.slice(7, 19), i.dangling ? "dangling" : ""].join(" ");
          return matches(query, text, (name) =>
            name === "tag"
              ? i.refs.map((r) => splitRef(r).tag)
              : name === "repo"
                ? i.refs.map((r) => splitRef(r).repo)
                : undefined,
          );
        }),
      },
    ]);
  };

  return {
    element,
    title: "Images",
    get subtitle() {
      const n = app.store.state.images.length;
      return `${n} image${n === 1 ? "" : "s"} on this engine`;
    },
    tools: () => [
      button({ label: "Build", icon: "build", onClick: () => app.dialogs.build() }),
      button({
        label: "Pull an image",
        icon: "download",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.pull(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("images") || changed.has("containers")) draw();
    },
    search(/** @type {string} */ text) {
      query = parseQuery(text);
      draw();
    },
  };
}
