// One Compose stack's page: its state, folder and files with Up, Start or Stop, Restart, Pull, the
// file and Down; tabs for its services (the map of what depends on what, and a row per service to
// restart, stop or read), every service's logs together, and the resolved config.

import { configArgs, configFromContainers, parseConfig, serviceArgs } from "./compose.js";
import { button, dot, h, icon, pill } from "./dom.js";
import { memory, percent } from "./format.js";
import { createInspectView } from "./json-tree.js";
import { dotState, portUrl, since, stackState, stateLabel } from "./model.js";
import { stackMap } from "./stack-map.js";
import { createLogView } from "./tab-logs.js";
import { page } from "./view-objects.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app @param {{ id: string, tab?: string }} target */
export function createStackPage(app, target) {
  const find = () => app.stacks().find((s) => s.name === target.id);
  let s = find();
  /** @type {import("./compose.js").StackConfig | null} */
  let config = null;
  let rawConfig = /** @type {unknown} */ (null);
  const p = page(app, {
    back: "Compose",
    icon: "stack",
    tab: target.tab ?? "services",
    tabs: [
      ["services", "Services", "stack"],
      ["logs", "Logs", "logs"],
      ["config", "Config", "file"],
    ],
  });

  const drawHero = () => {
    if (!s)
      return p.hero.replaceChildren(
        h(
          "div.gone",
          null,
          icon("stack", 28),
          h("b", null, "This stack is gone: it was taken down."),
        ),
      );
    const x = s;
    const state = stackState(x);
    const up = x.containers.filter((c) => c.state === "running").length;
    p.hero.replaceChildren(
      p.top(
        [
          x.files.length
            ? button({
                label: "Up",
                icon: "play",
                kind: "desk-btn-primary",
                title: "Create what is missing and start everything",
                onClick: () => app.act.compose("up", x.name),
              })
            : null,
          state === "stopped"
            ? button({
                label: "Start",
                icon: "play",
                onClick: () => app.act.compose("start", x.name),
              })
            : button({
                label: "Stop",
                icon: "stop",
                onClick: () => app.act.compose("stop", x.name),
              }),
          button({
            label: "Restart",
            icon: "restart",
            onClick: () => app.act.compose("restart", x.name),
          }),
          x.files.length
            ? button({
                label: "Pull",
                icon: "download",
                onClick: () => app.act.compose("pull", x.name),
              })
            : null,
          button({
            label: "More",
            icon: "more",
            hideLabel: true,
            onClick: (e) => app.menus.stack(x, /** @type {HTMLElement} */ (e.currentTarget)),
          }),
          button({
            label: "Down",
            icon: "trash",
            hideLabel: true,
            kind: "danger-hover",
            onClick: () => void app.act.compose("down", x.name).then((ok) => ok && app.back()),
          }),
        ].filter((b) => b !== null),
      ),
      h(
        "div.hero-main",
        null,
        h(`span.hero-icon.st-${state}`, null, icon("stack", 26)),
        h(
          "div.hero-text",
          null,
          h(
            "h2",
            null,
            x.name,
            " ",
            pill(
              `${up}/${x.containers.length} running`,
              state === "running" ? "ok" : state === "partial" ? "warn" : "",
            ),
            app.pending.has(x.name) ? h("span.spinner") : null,
          ),
          h(
            "p.hero-meta",
            null,
            h("span.mono", null, x.dir || "folder unknown"),
            x.files.flatMap((f) => [
              h("span.meta-sep", null, "·"),
              h(
                "button.desk-btn.desk-btn-quiet.cell-link.inline",
                { type: "button", title: `Open ${f}`, onClick: () => app.act.openFile(f) },
                icon("file", 13),
                f.split("/").at(-1),
              ),
            ]),
          ),
        ),
      ),
    );
  };

  const services = () => {
    const x = /** @type {NonNullable<typeof s>} */ (s);
    const cfg = config ?? configFromContainers(x.name, x.containers);
    const rows = cfg.services.map((svc) => {
      const c = x.containers.find((cc) => cc.service === svc.name);
      const latest = c ? app.live.history.get(c.id)?.latest : undefined;
      const run = (/** @type {"start" | "stop" | "restart"} */ op) => async () => {
        try {
          await app.docker(serviceArgs(x.name, op, svc.name), {
            timeoutMs: 0,
            cwd: x.dir || undefined,
          });
          app.toast(
            `${op === "stop" ? "Stopped" : op === "start" ? "Started" : "Restarted"} ${svc.name}.`,
            "success",
          );
        } catch (error) {
          app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");
        }
        void app.engine.load("containers");
      };
      return h(
        "li.row.svc-row",
        null,
        c ? dot(dotState(c), stateLabel(c)) : dot("created", "not created"),
        h(
          "button.desk-btn.desk-btn-quiet.row-main",
          {
            type: "button",
            disabled: !c,
            onClick: () => c && app.open({ kind: "container", id: c.id }),
          },
          h("b", null, svc.name),
          h("small", null, c ? `${stateLabel(c)} · ${since(c)}` : "not created yet"),
        ),
        h(
          "span.svc-image.mono",
          null,
          svc.image || "built here",
          svc.build ? h("span.pill", null, "build") : null,
        ),
        h(
          "span.ports",
          null,
          c?.state === "running"
            ? c.ports
                .slice(0, 2)
                .map((pp) =>
                  h(
                    "button.desk-btn.desk-btn-quiet.port",
                    { type: "button", onClick: () => app.act.browse(portUrl(pp)) },
                    `${pp.host}`,
                    icon("external", 11),
                  ),
                )
            : null,
        ),
        h(
          "span.num.svc-use",
          null,
          latest ? `${percent(latest.cpu)} · ${memory(latest.mem)}` : "–",
        ),
        h(
          "span.row-actions",
          null,
          c?.state === "running"
            ? button({
                label: `Stop ${svc.name}`,
                icon: "stop",
                hideLabel: true,
                onClick: run("stop"),
              })
            : button({
                label: `Start ${svc.name}`,
                icon: "play",
                hideLabel: true,
                onClick: run("start"),
              }),
          button({
            label: `Restart ${svc.name}`,
            icon: "restart",
            hideLabel: true,
            onClick: run("restart"),
          }),
          c
            ? button({
                label: `Logs of ${svc.name}`,
                icon: "logs",
                hideLabel: true,
                onClick: () => app.open({ kind: "container", id: c.id, tab: "logs" }),
              })
            : null,
        ),
      );
    });
    return {
      element: h(
        "section.stack-view",
        null,
        h(
          "article.card",
          null,
          h(
            "header.card-head",
            null,
            h("h2", null, "How the services depend on each other"),
            config
              ? null
              : h("span.card-sub", null, "from the containers: the Compose file was not read"),
          ),
          stackMap(cfg, x.containers, (c) => app.open({ kind: "container", id: c.id })),
        ),
        h(
          "article.card",
          null,
          h(
            "header.card-head",
            null,
            h("h2", null, "Services"),
            h("span.card-sub", null, String(cfg.services.length)),
          ),
          h("ul.rows", null, rows),
        ),
      ),
      dispose() {},
    };
  };

  const make = (/** @type {string} */ id) => {
    if (!s) return null;
    if (id === "services") return services();
    if (id === "logs")
      return createLogView(
        app,
        { kind: "project", name: s.name, files: s.files },
        { name: s.name, running: stackState(s) !== "stopped" },
      );
    if (rawConfig) return createInspectView(app, rawConfig, `${s.name} config`);
    return {
      element: h(
        "p.muted.pad",
        null,
        s.files.length ? "Reading the config…" : "No Compose file is known for this stack.",
      ),
      dispose() {},
    };
  };

  const readConfig = async () => {
    if (!s?.files.length) return;
    try {
      const { stdout } = await app.docker(configArgs(s.name, s.files), {
        cwd: s.dir || undefined,
        timeoutMs: 30_000,
      });
      config = parseConfig(stdout);
      rawConfig = JSON.parse(stdout);
      p.redraw();
    } catch {
      // The file moved or does not parse: the map comes from the containers.
    }
  };

  drawHero();
  p.start(make);
  void readConfig();
  return {
    element: p.element,
    get title() {
      return s?.name ?? "Stack";
    },
    get subtitle() {
      return s ? `Compose stack · ${s.containers.length} services` : "";
    },
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (!changed.has("containers") && !changed.has("projects")) return;
      s = find();
      drawHero();
    },
    dispose: p.dispose,
  };
}
