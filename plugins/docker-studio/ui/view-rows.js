// The parts of the Containers list that act: the buttons at the end of a container's row, and a
// stack's group row with its own buttons.

import { button, h, icon, pill } from "./dom.js";
import { containerMenu, stackMenu } from "./menus.js";
import { stackState } from "./model.js";

/** @typedef {import("./parse.js").Container} Container @typedef {import("./studio.js").App} App */

/** The buttons at the end of a row: what it most needs, restart, the menu, remove. */
export function rowActions(/** @type {App} */ app, /** @type {Container} */ c) {
  const t = [{ id: c.id, name: c.name, state: c.state }];
  const running = c.state === "running";
  const main = running
    ? button({
        label: `Stop ${c.name}`,
        icon: "stop",
        hideLabel: true,
        onClick: () => app.act.container("stop", t),
      })
    : c.state === "paused"
      ? button({
          label: `Resume ${c.name}`,
          icon: "play",
          hideLabel: true,
          onClick: () => app.act.container("unpause", t),
        })
      : button({
          label: `Start ${c.name}`,
          icon: "play",
          hideLabel: true,
          onClick: () => app.act.container("start", t),
        });
  return h(
    "div.row-actions",
    null,
    main,
    running
      ? button({
          label: `Open a terminal in ${c.name}`,
          icon: "terminal",
          hideLabel: true,
          onClick: () => app.act.shell(c),
        })
      : button({
          label: `Logs of ${c.name}`,
          icon: "logs",
          hideLabel: true,
          onClick: () => app.open({ kind: "container", id: c.id, tab: "logs" }),
        }),
    button({
      label: `More for ${c.name}`,
      icon: "more",
      hideLabel: true,
      onClick: (e) => containerMenu(app, [c], /** @type {HTMLElement} */ (e.currentTarget)),
    }),
    button({
      label: `Remove ${c.name}`,
      icon: "trash",
      hideLabel: true,
      kind: "danger-hover",
      onClick: () => app.act.container("remove", t),
    }),
  );
}

/** A stack's group row: its name, how many run, its own buttons. */
export function stackHead(
  /** @type {App} */ app,
  /** @type {ReturnType<App["stacks"]>[number]} */ s,
) {
  const up = s.containers.filter((c) => c.state === "running").length;
  const state = stackState(s);
  const pending = app.pending.has(s.name);
  return [
    h("span.stack-icon", null, icon("stack", 15)),
    h(
      "button.desk-btn.desk-btn-quiet.group-name",
      { type: "button", onClick: () => app.open({ kind: "project", id: s.name }) },
      s.name,
    ),
    pill(
      `${up}/${s.containers.length} running`,
      state === "running" ? "ok" : state === "partial" ? "warn" : "",
    ),
    s.dir ? h("small.muted.mono.group-dir", null, s.dir) : null,
    h("span.grow"),
    pending ? h("span.spinner") : null,
    h(
      "div.row-actions",
      null,
      up > 0
        ? button({
            label: `Stop ${s.name}`,
            icon: "stop",
            hideLabel: true,
            onClick: () => app.act.compose("stop", s.name),
          })
        : button({
            label: `Start ${s.name}`,
            icon: "play",
            hideLabel: true,
            onClick: () => app.act.compose("start", s.name),
          }),
      button({
        label: `Restart ${s.name}`,
        icon: "restart",
        hideLabel: true,
        onClick: () => app.act.compose("restart", s.name),
      }),
      button({
        label: `More for ${s.name}`,
        icon: "more",
        hideLabel: true,
        onClick: (e) => stackMenu(app, s, /** @type {HTMLElement} */ (e.currentTarget)),
      }),
      button({
        label: `Take ${s.name} down`,
        icon: "trash",
        hideLabel: true,
        kind: "danger-hover",
        onClick: () => app.act.compose("down", s.name),
      }),
    ),
  ];
}
