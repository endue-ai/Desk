// One container's page: a header with its state, image, stack, ports and buttons, what is wrong with
// it (and a diagnosis by AI), then tabs: Logs, Stats, Files, Exec, Processes, Details, Inspect. A
// tab is made when it shows; a change of state remakes the tabs that depend on it.

import { button, dot, h, icon, pill } from "./dom.js";
import { short } from "./format.js";
import { createInspectView } from "./json-tree.js";
import { containerMenu } from "./menus.js";
import { dotState, portUrl, problemOf, since, stateLabel } from "./model.js";
import { createDetailsView, createTopView } from "./tab-details.js";
import { createExecView } from "./tab-exec.js";
import { createFilesView } from "./tab-files.js";
import { createLogView } from "./tab-logs.js";
import { createStatsView } from "./tab-stats.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./parse.js").Container} Container */

const TABS = /** @type {const} */ ([
  ["logs", "Logs", "logs"],
  ["stats", "Stats", "chart"],
  ["files", "Files", "folder"],
  ["exec", "Exec", "terminal"],
  ["top", "Processes", "pulse"],
  ["details", "Details", "info"],
  ["inspect", "Inspect", "eye"],
]);

/** @param {App} app @param {{ id: string, tab?: string }} target */
export function createContainerPage(app, target) {
  const find = () =>
    app.store.state.containers.find((c) => c.id === target.id || c.name === target.id);
  let c = find();
  const prefs = app.prefs("container", { tab: "logs" });
  let tab = target.tab ?? prefs.tab;
  /** @type {{ element: HTMLElement, dispose(): void } | null} */
  let view = null;
  let shownState = c?.state ?? "";

  const hero = h("section.hero");
  const problem = h("div.problem", { hidden: true, role: "alert" });
  const tabs = h("nav.desk-tabs.detail-tabs", { role: "tablist", "aria-label": "Container" });
  const host = h("div.tab-host");
  const element = h("div.page.detail-page", null, hero, problem, tabs, host);

  const drawHero = () => {
    if (!c) {
      hero.replaceChildren(
        h(
          "div.gone",
          null,
          icon("container", 28),
          h("b", null, "This container is gone."),
          button({ label: "Back to containers", icon: "arrowLeft", onClick: () => app.back() }),
        ),
      );
      return;
    }
    const x = c;
    const t = [{ id: x.id, name: x.name, state: x.state }];
    const running = x.state === "running";
    hero.replaceChildren(
      h(
        "div.hero-top",
        null,
        button({
          label: "Containers",
          icon: "arrowLeft",
          kind: "desk-btn-quiet back",
          onClick: () => app.back(),
        }),
        h("span.grow"),
        h(
          "div.hero-actions",
          null,
          running
            ? button({ label: "Stop", icon: "stop", onClick: () => app.act.container("stop", t) })
            : x.state === "paused"
              ? button({
                  label: "Resume",
                  icon: "play",
                  onClick: () => app.act.container("unpause", t),
                })
              : button({
                  label: "Start",
                  icon: "play",
                  kind: "desk-btn-primary",
                  onClick: () => app.act.container("start", t),
                }),
          button({
            label: "Restart",
            icon: "restart",
            onClick: () => app.act.container("restart", t),
          }),
          running
            ? button({
                label: "Pause",
                icon: "pause",
                onClick: () => app.act.container("pause", t),
              })
            : null,
          running
            ? button({ label: "Terminal", icon: "terminal", onClick: () => app.act.shell(x) })
            : null,
          running && x.ports[0]
            ? button({
                label: "Open",
                icon: "external",
                onClick: () => app.act.browse(portUrl(/** @type {any} */ (x.ports[0]))),
              })
            : null,
          button({
            label: "More",
            icon: "more",
            hideLabel: true,
            onClick: (e) => containerMenu(app, [x], /** @type {HTMLElement} */ (e.currentTarget)),
          }),
          button({
            label: "Remove",
            icon: "trash",
            hideLabel: true,
            kind: "danger-hover",
            onClick: () => void app.act.container("remove", t).then((ok) => ok && app.back()),
          }),
        ),
      ),
      h(
        "div.hero-main",
        null,
        h(`span.hero-icon.st-${dotState(x)}`, null, icon("container", 26)),
        h(
          "div.hero-text",
          null,
          h(
            "h2",
            null,
            x.name,
            " ",
            pill(
              stateLabel(x),
              problemOf(x)
                ? problemOf(x)?.level === "danger"
                  ? "bad"
                  : "warn"
                : running
                  ? "ok"
                  : "",
            ),
          ),
          h(
            "p.hero-meta",
            null,
            h(
              "button.desk-btn.desk-btn-quiet.cell-link.inline",
              { type: "button", onClick: () => app.open({ kind: "image", id: x.imageId }) },
              icon("image", 13),
              x.image,
            ),
            h("span.meta-sep", null, "·"),
            h(
              "button.desk-btn.desk-btn-quiet.cell-link.inline.mono",
              { type: "button", title: "Copy the id", onClick: () => app.act.copy(x.id, "the id") },
              short(x.id),
              icon("copy", 12),
            ),
            x.project
              ? [
                  h("span.meta-sep", null, "·"),
                  h(
                    "button.desk-btn.desk-btn-quiet.cell-link.inline",
                    { type: "button", onClick: () => app.open({ kind: "project", id: x.project }) },
                    icon("stack", 13),
                    `${x.project} / ${x.service}`,
                  ),
                ]
              : null,
            h("span.meta-sep", null, "·"),
            h("span.muted", null, dot(dotState(x)), " ", since(x)),
          ),
          x.ports.length
            ? h(
                "div.ports.hero-ports",
                null,
                x.ports.map((p) =>
                  running
                    ? h(
                        "button.desk-btn.desk-btn-quiet.port",
                        { type: "button", onClick: () => app.act.browse(portUrl(p)) },
                        `${p.host} → ${p.container}/${p.proto}`,
                        icon("external", 11),
                      )
                    : h("span.port.off", null, `${p.host} → ${p.container}/${p.proto}`),
                ),
              )
            : null,
        ),
      ),
    );
    const wrong = problemOf(x);
    problem.hidden = !wrong;
    problem.className = `problem ${wrong?.level ?? ""}`;
    if (wrong)
      problem.replaceChildren(
        icon("alert", 18),
        h(
          "div.problem-text",
          null,
          h("b", null, wrong.text),
          h(
            "small",
            null,
            x.state === "exited"
              ? `It stopped ${since(x).replace("Stopped ", "")}. The last lines of its log usually say why.`
              : "Its health check keeps failing.",
          ),
        ),
        button({
          label: "Diagnose with AI",
          icon: "sparkle",
          kind: "desk-btn-primary",
          onClick: () => app.ai.diagnose(x.id),
        }),
        button({
          label: "Logs",
          icon: "logs",
          kind: "desk-btn-quiet",
          onClick: () => show("logs"),
        }),
      );
  };

  const make = (/** @type {string} */ id) => {
    if (!c) return null;
    if (id === "logs")
      return createLogView(
        app,
        { kind: "container", id: c.id },
        { name: c.name, running: c.state === "running" },
      );
    if (id === "stats") return createStatsView(app, c);
    if (id === "files") return createFilesView(app, c);
    if (id === "exec") return createExecView(app, c);
    if (id === "top") return createTopView(app, c);
    if (id === "details") return createDetailsView(app, c);
    return createInspectView(app, c.raw, c.name);
  };

  const show = (/** @type {string} */ id) => {
    tab = id;
    prefs.tab = id;
    app.savePrefs("container", prefs);
    for (const b of tabs.querySelectorAll("button"))
      b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === id));
    view?.dispose();
    view = make(id);
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
      return c?.name ?? "Container";
    },
    get subtitle() {
      return c ? `${c.image} · ${short(c.id)}` : "";
    },
    stats: true,
    /** @param {any} _state @param {Set<string>} changed */
    update(_state, changed) {
      if (!changed.has("containers")) return;
      c = find();
      drawHero();
      if ((c?.state ?? "") !== shownState) {
        shownState = c?.state ?? "";
        if (["logs", "files", "exec", "top", "details", "inspect"].includes(tab)) show(tab);
      }
    },
    /** @param {KeyboardEvent} e */
    key(e) {
      if (/^(INPUT|TEXTAREA)$/.test(/** @type {HTMLElement} */ (e.target)?.tagName ?? ""))
        return false;
      const at = TABS.findIndex(([id]) => id === tab);
      if (e.key === "]" || e.key === "[") {
        const next = TABS[(at + (e.key === "]" ? 1 : TABS.length - 1)) % TABS.length];
        if (next) show(next[0]);
        return true;
      }
      return false;
    },
    dispose: () => view?.dispose(),
  };
}
