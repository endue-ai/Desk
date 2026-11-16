// One image's page: its names, size, age, platform and digest, Run, Pull, Tag and Remove; tabs for
// its layers (each instruction with its size as a bar, the heaviest marked, and AI that suggests how
// to slim it), how it runs (command, ports, variables, labels), the containers that use it, and
// the inspect tree.

import { button, h, icon, pill } from "./dom.js";
import { ago, bytes, short } from "./format.js";
import { historyArgs, parseHistory, verbOf } from "./images.js";
import { createInspectView } from "./json-tree.js";
import { dotState, imageName, stateLabel } from "./model.js";
import { facts } from "./tab-details.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./parse.js").Image} Image */

const TABS = /** @type {const} */ ([
  ["layers", "Layers", "layers"],
  ["config", "How it runs", "info"],
  ["containers", "Containers", "container"],
  ["inspect", "Inspect", "eye"],
]);

/** @param {App} app @param {{ id: string, tab?: string }} target */
export function createImagePage(app, target) {
  const find = () =>
    app.store.state.images.find((i) => i.id === target.id || i.refs.includes(target.id));
  let image = find();
  let tab = target.tab ?? "layers";
  const hero = h("section.hero");
  const tabs = h("nav.desk-tabs.detail-tabs", { role: "tablist", "aria-label": "Image" });
  const host = h("div.tab-host");
  const element = h("div.page.detail-page", null, hero, tabs, host);
  /** @type {import("./images.js").Layer[] | null} */
  let layers = null;

  const users = () => app.store.state.containers.filter((c) => c.imageId === image?.id);

  const drawHero = () => {
    if (!image) {
      hero.replaceChildren(
        h(
          "div.gone",
          null,
          icon("image", 28),
          h("b", null, "This image is gone."),
          button({ label: "Back to images", icon: "arrowLeft", onClick: () => app.back() }),
        ),
      );
      return;
    }
    const i = image;
    const n = users().length;
    hero.replaceChildren(
      h(
        "div.hero-top",
        null,
        button({
          label: "Images",
          icon: "arrowLeft",
          kind: "desk-btn-quiet back",
          onClick: () => app.back(),
        }),
        h("span.grow"),
        h(
          "div.hero-actions",
          null,
          button({
            label: "Run",
            icon: "play",
            kind: "desk-btn-primary",
            onClick: () => app.dialogs.run(i.refs[0] ?? i.id),
          }),
          i.refs[0]
            ? button({
                label: "Pull",
                icon: "download",
                onClick: () => app.dialogs.pullRef(i.refs[0] ?? ""),
              })
            : null,
          button({ label: "Tag or push", icon: "tag", onClick: () => app.dialogs.tag(i) }),
          button({
            label: "More",
            icon: "more",
            hideLabel: true,
            onClick: (e) => app.menus.image([i], /** @type {HTMLElement} */ (e.currentTarget)),
          }),
          button({
            label: "Remove",
            icon: "trash",
            hideLabel: true,
            kind: "danger-hover",
            onClick: () => void app.act.removeImages([i]).then((ok) => ok && app.back()),
          }),
        ),
      ),
      h(
        "div.hero-main",
        null,
        h(`span.hero-icon${n ? ".st-running" : ""}`, null, icon("layers", 26)),
        h(
          "div.hero-text",
          null,
          h(
            "h2",
            null,
            imageName(i),
            " ",
            n
              ? pill(`Used by ${n}`, "ok")
              : pill(i.dangling ? "Dangling" : "Unused", i.dangling ? "warn" : ""),
          ),
          h(
            "p.hero-meta",
            null,
            h("b", null, bytes(i.size)),
            h("span.meta-sep", null, "·"),
            `Created ${ago(i.created)}`,
            h("span.meta-sep", null, "·"),
            `${i.os}/${i.arch}`,
            h("span.meta-sep", null, "·"),
            h(
              "button.desk-btn.desk-btn-quiet.cell-link.inline.mono",
              { type: "button", title: "Copy the id", onClick: () => app.act.copy(i.id, "the id") },
              short(i.id),
              icon("copy", 12),
            ),
            i.digests[0]
              ? [
                  h("span.meta-sep", null, "·"),
                  h("span.mono.muted", null, i.digests[0].replace(/^.*@/, "").slice(0, 19)),
                ]
              : null,
          ),
          i.refs.length > 1
            ? h(
                "div.tags",
                null,
                i.refs.map((r) => h("span.pill.accent", null, icon("tag", 11), r)),
              )
            : null,
        ),
      ),
    );
  };

  const layersView = () => {
    const list = h("div.layers");
    const summary = h("span.muted");
    const draw = () => {
      if (!layers) return list.replaceChildren(h("p.muted.pad", null, "Reading the layers…"));
      const total = layers.reduce((s, l) => s + l.size, 0);
      summary.textContent = `${layers.length} steps · ${layers.filter((l) => !l.empty).length} with files · ${bytes(total)}`;
      const top = Math.max(1, ...layers.map((l) => l.size));
      const heavy = [...layers]
        .sort((a, b) => b.size - a.size)
        .slice(0, 3)
        .filter((l) => l.size > 0);
      list.replaceChildren(
        ...layers.map((l, n) =>
          h(
            `div.step${l.empty ? ".empty" : ""}${heavy.includes(l) ? ".heavy" : ""}`,
            null,
            h("span.layer-n", null, String(n + 1)),
            h("span.layer-verb", null, verbOf(l.by) || "—"),
            h("code.layer-by", { title: l.by }, l.by.replace(/^[A-Z]+\s+/, "")),
            h(
              "span.layer-bar",
              null,
              l.size
                ? h("span", {
                    style: { width: `${Math.max(1.5, (l.size / top) * 100).toFixed(1)}%` },
                  })
                : null,
            ),
            h("span.layer-size.num", null, l.size ? bytes(l.size) : "0 B"),
          ),
        ),
      );
    };
    draw();
    if (!layers && image)
      void app
        .docker(historyArgs(image.refs[0] ?? image.id))
        .then(({ stdout }) => {
          layers = parseHistory(stdout);
          draw();
        })
        .catch((error) =>
          list.replaceChildren(h("p.error-text.pad", null, String(error?.message ?? error))),
        );
    return {
      element: h(
        "section.layers-view",
        null,
        h(
          "div.files-bar",
          null,
          summary,
          h("span.grow"),
          button({
            label: "How to make it smaller",
            icon: "sparkle",
            kind: "desk-btn-quiet ai",
            onClick: () => image && app.ai.optimizeImage(image, layers ?? []),
          }),
        ),
        list,
      ),
      dispose() {},
    };
  };

  const configView = () => {
    const i = /** @type {Image} */ (image);
    return {
      element: h(
        "section.details-view",
        null,
        h(
          "div.details-col",
          null,
          h(
            "article.card",
            null,
            h("header.card-head", null, h("h2", null, "How it runs")),
            facts([
              ["Command", i.cmd.length ? h("code", null, i.cmd.join(" ")) : "–"],
              ["Entrypoint", i.entrypoint.length ? h("code", null, i.entrypoint.join(" ")) : ""],
              ["Folder", i.workdir],
              ["User", i.user || "root"],
              ["Ports", i.exposed.length ? i.exposed.join(", ") : "none exposed"],
              ["Layers", String(i.layers)],
              ["Platform", `${i.os}/${i.arch}`],
            ]),
          ),
          h(
            "article.card",
            null,
            h("header.card-head", null, h("h2", null, "Labels")),
            h(
              "div.kv-list",
              null,
              Object.entries(i.labels).map(([k, v]) =>
                h("div.kv", null, h("span.kv-key.mono", null, k), h("span.kv-value.mono", null, v)),
              ),
            ),
          ),
        ),
        h(
          "div.details-col",
          null,
          h(
            "article.card",
            null,
            h(
              "header.card-head",
              null,
              h("h2", null, "Environment"),
              h("span.card-sub", null, String(i.env.length)),
            ),
            h(
              "div.kv-list",
              null,
              i.env.map((e) =>
                h(
                  "div.kv",
                  null,
                  h("span.kv-key.mono", null, e.split("=")[0]),
                  h("span.kv-value.mono", null, e.slice(e.indexOf("=") + 1)),
                ),
              ),
            ),
          ),
        ),
      ),
      dispose() {},
    };
  };

  const containersView = () => {
    const list = users();
    return {
      element: h(
        "section.details-view.one",
        null,
        h(
          "article.card",
          null,
          h(
            "header.card-head",
            null,
            h("h2", null, "Containers made from it"),
            h("span.card-sub", null, String(list.length)),
          ),
          list.length
            ? h(
                "ul.rows",
                null,
                list.map((c) =>
                  h(
                    "li.row",
                    null,
                    h(`span.dot.st-${dotState(c)}`),
                    h(
                      "button.desk-btn.desk-btn-quiet.row-main",
                      { type: "button", onClick: () => app.open({ kind: "container", id: c.id }) },
                      h("b", null, c.name),
                      h("small", null, stateLabel(c)),
                    ),
                  ),
                ),
              )
            : h("p.card-empty", null, icon("info"), "No container uses it."),
        ),
      ),
      dispose() {},
    };
  };

  /** @type {{ element: HTMLElement, dispose(): void } | null} */
  let view = null;
  const show = (/** @type {string} */ id) => {
    tab = id;
    for (const b of tabs.querySelectorAll("button"))
      b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === id));
    view?.dispose();
    view = !image
      ? null
      : id === "layers"
        ? layersView()
        : id === "config"
          ? configView()
          : id === "containers"
            ? containersView()
            : createInspectView(app, image.raw, imageName(image));
    host.replaceChildren(...(view ? [view.element] : []));
  };
  tabs.append(
    ...TABS.map(([id, label, name]) =>
      h(
        "button.desk-tab",
        { type: "button", role: "tab", dataset: { tab: id }, onClick: () => show(id) },
        icon(name, 14),
        label,
      ),
    ),
  );
  drawHero();
  show(tab);

  return {
    element,
    get title() {
      return image ? imageName(image) : "Image";
    },
    get subtitle() {
      return image ? `${bytes(image.size)} · ${short(image.id)}` : "";
    },
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (!changed.has("images") && !changed.has("containers")) return;
      image = find();
      drawHero();
    },
    dispose: () => view?.dispose(),
  };
}
