// The page of a volume: its size, driver, stack and mount point, its files (read where it is
// mounted, or by a helper container), the containers that mount it, the inspect tree. page() is
// the frame both it and a network's page (view-network.js) use.

import { button, h, icon, pill } from "./dom.js";
import { helperImage, volumeTarget } from "./files.js";
import { ago, bytes } from "./format.js";
import { createInspectView } from "./json-tree.js";
import { dotState, volumeUse } from "./model.js";
import { createFilesView } from "./tab-files.js";

/** @typedef {import("./studio.js").App} App */

/** The frame both pages share: back, title, actions, tabs. */
export function page(
  /** @type {App} */ app,
  /** @type {{ back: string, icon: import("./dom.js").IconName, tabs: Array<[string, string, import("./dom.js").IconName]>, tab: string }} */ o,
) {
  const hero = h("section.hero");
  const tabs = h("nav.desk-tabs.detail-tabs", { role: "tablist" });
  const host = h("div.tab-host");
  /** @type {{ element: HTMLElement, dispose(): void } | null} */
  let view = null;
  let tab = o.tab;
  /** @type {(id: string) => { element: HTMLElement, dispose(): void } | null} */
  let make = () => null;
  const show = (/** @type {string} */ id) => {
    tab = id;
    for (const b of tabs.querySelectorAll("button"))
      b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === id));
    view?.dispose();
    view = make(id);
    host.replaceChildren(...(view ? [view.element] : []));
  };
  tabs.append(
    ...o.tabs.map(([id, label, name]) =>
      h(
        "button.desk-tab",
        { type: "button", role: "tab", dataset: { tab: id }, onClick: () => show(id) },
        icon(name, 14),
        label,
      ),
    ),
  );
  return {
    element: h("div.page.detail-page", null, hero, tabs, host),
    hero,
    /** @param {(id: string) => { element: HTMLElement, dispose(): void } | null} fn */
    start(fn) {
      make = fn;
      show(tab);
    },
    redraw: () => show(tab),
    dispose: () => view?.dispose(),
    top: (/** @type {HTMLElement[]} */ actions) =>
      h(
        "div.hero-top",
        null,
        button({
          label: o.back,
          icon: "arrowLeft",
          kind: "desk-btn-quiet back",
          onClick: () => app.back(),
        }),
        h("span.grow"),
        h("div.hero-actions", null, actions),
      ),
  };
}

/** @param {App} app @param {{ id: string, tab?: string }} target */
export function createVolumePage(app, target) {
  const find = () => app.store.state.volumes.find((v) => v.name === target.id);
  let v = find();
  const p = page(app, {
    back: "Volumes",
    icon: "volume",
    tab: target.tab ?? "files",
    tabs: [
      ["files", "Files", "folder"],
      ["containers", "Containers", "container"],
      ["inspect", "Inspect", "eye"],
    ],
  });
  const users = () => volumeUse(app.store.state.containers).get(target.id) ?? [];
  const drawHero = () => {
    if (!v)
      return p.hero.replaceChildren(
        h("div.gone", null, icon("volume", 28), h("b", null, "This volume is gone.")),
      );
    const x = v;
    const size = app.store.state.volumeSizes.get(x.name);
    p.hero.replaceChildren(
      p.top([
        button({
          label: "Delete",
          icon: "trash",
          kind: "danger-hover",
          onClick: () => void app.objects.removeVolumes([x]).then((ok) => ok && app.back()),
        }),
      ]),
      h(
        "div.hero-main",
        null,
        h(`span.hero-icon${users().length ? ".st-running" : ""}`, null, icon("volume", 26)),
        h(
          "div.hero-text",
          null,
          h(
            "h2",
            null,
            x.anonymous ? `${x.name.slice(0, 16)}…` : x.name,
            " ",
            users().length ? pill(`Mounted by ${users().length}`, "ok") : pill("Unused"),
          ),
          h(
            "p.hero-meta",
            null,
            h("b", null, size === undefined ? "size unknown" : bytes(size)),
            h("span.meta-sep", null, "·"),
            x.driver,
            h("span.meta-sep", null, "·"),
            `Created ${ago(x.created)}`,
            x.project ? [h("span.meta-sep", null, "·"), `stack ${x.project}`] : null,
            h("span.meta-sep", null, "·"),
            h("span.mono", null, x.mountpoint),
          ),
        ),
      ),
    );
  };
  const make = (/** @type {string} */ id) => {
    if (!v) return null;
    const x = v;
    if (id === "files") {
      const running = users().find((c) => c.state === "running");
      const helper = helperImage(app.store.state.images);
      const where = volumeTarget(x.name, running, helper);
      const note = running
        ? `Read in ${running.name}, where it is mounted at ${where.root}.`
        : helper
          ? `Read by a short-lived ${helper} container that mounts it read-only.`
          : "";
      const files = createFilesView(app, {
        key: `volume:${x.name}`,
        start: where.root,
        root: where.root,
        ready: () =>
          running || helper
            ? ""
            : "No running container mounts it, and no small image (alpine, busybox) is here to read it with: pull alpine to browse it.",
        ls: where.ls,
        read: where.read,
      });
      return {
        element: h(
          "section.files-wrap",
          null,
          note ? h("p.muted.files-note", null, icon("info", 13), " ", note) : null,
          files.element,
        ),
        dispose: files.dispose,
      };
    }
    if (id === "containers")
      return {
        element: h(
          "section.details-view.one",
          null,
          h(
            "article.card",
            null,
            h("header.card-head", null, h("h2", null, "Containers that mount it")),
            users().length
              ? h(
                  "ul.rows",
                  null,
                  users().map((c) => {
                    const m = c.mounts.find((mm) => mm.name === x.name);
                    return h(
                      "li.row",
                      null,
                      h(`span.dot.st-${dotState(c)}`),
                      h(
                        "button.desk-btn.desk-btn-quiet.row-main",
                        {
                          type: "button",
                          onClick: () => app.open({ kind: "container", id: c.id }),
                        },
                        h("b", null, c.name),
                        h(
                          "small.mono",
                          null,
                          `${m?.destination ?? ""}${m?.rw === false ? " (read-only)" : ""}`,
                        ),
                      ),
                    );
                  }),
                )
              : h("p.card-empty", null, icon("info"), "No container mounts it."),
          ),
        ),
        dispose() {},
      };
    return createInspectView(app, x.raw, x.name);
  };
  drawHero();
  p.start(make);
  return {
    element: p.element,
    get title() {
      return v?.name ?? "Volume";
    },
    subtitle: "Volume",
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("volumes") || changed.has("volumeSizes") || changed.has("containers")) {
        v = find();
        drawHero();
      }
    },
    dispose: p.dispose,
  };
}
