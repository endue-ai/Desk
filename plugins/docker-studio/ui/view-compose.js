// The Compose section: a card per stack with its state, folder, services (a dot each), published
// ports and live CPU and memory, and its buttons; Compose up a file in the top bar.

import { button, dot, h, icon, pill } from "./dom.js";
import { memory, percent } from "./format.js";
import { dotState, portUrl, stackState, stateLabel } from "./model.js";
import { matches, parseQuery } from "./query.js";

/** @typedef {import("./studio.js").App} App */

const STATE = /** @type {Record<string, [string, string]>} */ ({
  running: ["Running", "ok"],
  partial: ["Partly running", "warn"],
  stopped: ["Stopped", ""],
});

/** @param {App} app */
export function createCompose(app) {
  let query = parseQuery("");
  const grid = h("section.stack-grid");
  const element = h("div.page", null, grid);

  /** A stack's CPU and memory, summed over its running containers. @param {ReturnType<App["stacks"]>[number]} s */
  const use = (s) => {
    const up = s.containers.filter((c) => c.state === "running");
    let cpu = 0;
    let mem = 0;
    for (const c of up) {
      const latest = app.live.history.get(c.id)?.latest;
      cpu += latest?.cpu ?? 0;
      mem += latest?.mem ?? 0;
    }
    return [
      icon("cpu", 13),
      up.length ? percent(cpu) : "–",
      icon("memory", 13),
      up.length ? memory(mem) : "–",
    ];
  };

  /** @param {ReturnType<App["stacks"]>[number]} s */
  const card = (s) => {
    const state = stackState(s);
    const [label, kind] = STATE[state] ?? ["", ""];
    const ports = s.containers.flatMap((c) => (c.state === "running" ? c.ports : []));
    return h(
      `article.card.stack-card.st-${state}`,
      { dataset: { stack: s.name } },
      h(
        "header.stack-head",
        null,
        h("span.stack-icon.big", null, icon("stack", 18)),
        h(
          "button.desk-btn.desk-btn-quiet.stack-title",
          { type: "button", onClick: () => app.open({ kind: "project", id: s.name }) },
          h("b", null, s.name),
          h("small.mono", null, s.dir || s.files[0] || "no folder known"),
        ),
        pill(label, kind),
      ),
      h(
        "ul.service-list",
        null,
        s.containers.map((c) =>
          h(
            "li",
            null,
            h(
              "button.desk-btn.desk-btn-quiet.service",
              {
                type: "button",
                title: `${c.name}: ${stateLabel(c)}`,
                onClick: () => app.open({ kind: "container", id: c.id }),
              },
              dot(dotState(c)),
              h("span", null, c.service || c.name),
              h("small.muted", null, c.image.split("/").at(-1)),
            ),
          ),
        ),
      ),
      h(
        "div.stack-foot",
        null,
        h("span.stack-use", null, use(s)),
        h(
          "span.stack-ports",
          null,
          ports
            .slice(0, 3)
            .map((p) =>
              h(
                "button.desk-btn.desk-btn-quiet.port",
                { type: "button", onClick: () => app.act.browse(portUrl(p)) },
                String(p.host),
                icon("external", 11),
              ),
            ),
        ),
        h("span.grow"),
        app.pending.has(s.name) ? h("span.spinner") : null,
        state === "running"
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
              onClick: () =>
                app.act.compose(state === "stopped" && s.files.length ? "up" : "start", s.name),
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
          onClick: (e) => app.menus.stack(s, /** @type {HTMLElement} */ (e.currentTarget)),
        }),
      ),
    );
  };

  const draw = () => {
    const stacks = app
      .stacks()
      .filter((s) =>
        matches(
          query,
          [s.name, s.dir, ...s.containers.map((c) => `${c.service} ${c.image}`)].join(" "),
          () => undefined,
        ),
      );
    grid.replaceChildren(
      ...stacks.map(card),
      h(
        "button.desk-btn.desk-btn-quiet.stack-card.add-card",
        { type: "button", onClick: () => app.dialogs.composeUp() },
        icon("plus", 22),
        h("b", null, "Compose up a file"),
        h("small", null, "Start a stack from a compose.yaml"),
      ),
    );
  };
  const off = app.live.onStats(() => {
    for (const el of grid.querySelectorAll(".stack-card[data-stack]")) {
      const s = app.stacks().find((x) => x.name === /** @type {HTMLElement} */ (el).dataset.stack);
      const slot = el.querySelector(".stack-use");
      if (s && slot)
        slot.replaceChildren(
          ...use(s).map((n) => (typeof n === "string" ? document.createTextNode(n) : n)),
        );
    }
  });

  return {
    element,
    title: "Compose",
    get subtitle() {
      const stacks = app.stacks();
      return `${stacks.length} stack${stacks.length === 1 ? "" : "s"} · ${stacks.filter((s) => stackState(s) !== "stopped").length} running`;
    },
    tools: () => [
      button({
        label: "Compose up",
        icon: "play",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.composeUp(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("containers") || changed.has("projects")) draw();
    },
    search(/** @type {string} */ text) {
      query = parseQuery(text);
      draw();
    },
    dispose: () => off(),
  };
}
