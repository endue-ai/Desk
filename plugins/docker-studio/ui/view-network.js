// A network's page: a map of the containers on it around it, each with its address (a click opens
// it), the list to connect another running container or disconnect one, and the inspect tree.

import { button, h, icon, pill, svg } from "./dom.js";
import { select } from "./form.js";
import { ago } from "./format.js";
import { createInspectView } from "./json-tree.js";
import { dotState } from "./model.js";
import { page } from "./view-objects.js";

/** @typedef {import("./studio.js").App} App */

/** The network in the middle, its containers around it, a line to each. */
function networkMap(/** @type {App} */ app, /** @type {import("./parse.js").Network} */ n) {
  const W = 880;
  const H = 360;
  const map = svg("svg", {
    class: "net-map",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `${n.name} and its containers`,
  });
  const cx = W / 2;
  const cy = H / 2;
  const members = n.members;
  const byId = new Map(app.store.state.containers.map((c) => [c.id, c]));
  members.forEach((m, i) => {
    const a = (i / Math.max(1, members.length)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * 320;
    const y = cy + Math.sin(a) * 135;
    const c = byId.get(m.id);
    map.append(svg("line", { class: "net-edge", x1: cx, y1: cy, x2: x, y2: y }));
    const g = svg("g", {
      class: `net-node st-${c ? dotState(c) : "running"}`,
      transform: `translate(${x} ${y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${m.name} ${m.ip}`,
    });
    g.append(
      svg("rect", { x: -78, y: -22, width: 156, height: 44, rx: 10 }),
      svg("circle", { class: "net-dot", cx: -62, cy: 0, r: 5 }),
    );
    const name = svg("text", { x: -50, y: -3, class: "net-name" });
    name.textContent = m.name.length > 19 ? `${m.name.slice(0, 18)}…` : m.name;
    const ip = svg("text", { x: -50, y: 13, class: "net-ip" });
    ip.textContent = m.ip || "–";
    g.append(name, ip);
    g.addEventListener("click", () => app.open({ kind: "container", id: m.id }));
    map.append(g);
  });
  const hub = svg("g", { class: "net-hub", transform: `translate(${cx} ${cy})` });
  hub.append(svg("circle", { r: 58 }));
  const t1 = svg("text", { y: -2, class: "net-hub-name" });
  t1.textContent = n.name.length > 14 ? `${n.name.slice(0, 13)}…` : n.name;
  const t2 = svg("text", { y: 15, class: "net-hub-sub" });
  t2.textContent = n.subnet || n.driver;
  hub.append(t1, t2);
  map.append(hub);
  return map;
}

/** @param {App} app @param {{ id: string, tab?: string }} target */
export function createNetworkPage(app, target) {
  const find = () =>
    app.store.state.networks.find((n) => n.id === target.id || n.name === target.id);
  let n = find();
  const p = page(app, {
    back: "Networks",
    icon: "network",
    tab: target.tab ?? "map",
    tabs: [
      ["map", "Containers", "network"],
      ["inspect", "Inspect", "eye"],
    ],
  });
  const drawHero = () => {
    if (!n)
      return p.hero.replaceChildren(
        h("div.gone", null, icon("network", 28), h("b", null, "This network is gone.")),
      );
    const x = n;
    p.hero.replaceChildren(
      p.top([
        button({
          label: "Remove",
          icon: "trash",
          kind: "danger-hover",
          disabled: x.builtin,
          onClick: () => void app.objects.removeNetworks([x]).then((ok) => ok && app.back()),
        }),
      ]),
      h(
        "div.hero-main",
        null,
        h(`span.hero-icon${x.members.length ? ".st-running" : ""}`, null, icon("network", 26)),
        h(
          "div.hero-text",
          null,
          h(
            "h2",
            null,
            x.name,
            " ",
            x.builtin ? pill("built in") : null,
            x.internal ? pill("internal", "warn") : null,
          ),
          h(
            "p.hero-meta",
            null,
            x.driver,
            h("span.meta-sep", null, "·"),
            x.subnet || "no subnet",
            x.gateway ? [h("span.meta-sep", null, "·"), `gateway ${x.gateway}`] : null,
            h("span.meta-sep", null, "·"),
            `${x.members.length} connected`,
            h("span.meta-sep", null, "·"),
            `Created ${ago(x.created)}`,
          ),
        ),
      ),
    );
  };
  const make = (/** @type {string} */ id) => {
    if (!n) return null;
    const x = n;
    if (id === "inspect") return createInspectView(app, x.raw, x.name);
    const others = app.store.state.containers.filter(
      (c) => c.state === "running" && !x.members.some((m) => m.id === c.id),
    );
    let pick = others[0]?.name ?? "";
    return {
      element: h(
        "section.net-view",
        null,
        h(
          "article.card.net-card",
          null,
          x.members.length
            ? networkMap(app, x)
            : h("p.card-empty", null, icon("info"), "No container is connected."),
        ),
        h(
          "article.card",
          null,
          h(
            "header.card-head",
            null,
            h("h2", null, "Connected"),
            h("span.card-sub", null, String(x.members.length)),
            x.driver !== "host" && x.driver !== "null" && others.length
              ? h(
                  "div.connect",
                  null,
                  select(
                    others.map((c) => /** @type {[string, string]} */ ([c.name, c.name])),
                    pick,
                    (value) => {
                      pick = value;
                    },
                    "Container",
                  ),
                  button({
                    label: "Connect",
                    icon: "link",
                    onClick: () => void app.objects.connect("connect", x.name, pick),
                  }),
                )
              : null,
          ),
          h(
            "ul.rows",
            null,
            x.members.map((m) =>
              h(
                "li.row",
                null,
                h(
                  "button.desk-btn.desk-btn-quiet.row-main",
                  { type: "button", onClick: () => app.open({ kind: "container", id: m.id }) },
                  h("b", null, m.name),
                  h("small.mono", null, m.ip || "–"),
                ),
                x.builtin
                  ? null
                  : button({
                      label: "Disconnect",
                      icon: "x",
                      kind: "desk-btn-quiet",
                      title: `Disconnect ${m.name}`,
                      onClick: () => void app.objects.connect("disconnect", x.name, m.name),
                    }),
              ),
            ),
          ),
        ),
      ),
      dispose() {},
    };
  };
  drawHero();
  p.start(make);
  return {
    element: p.element,
    get title() {
      return n?.name ?? "Network";
    },
    subtitle: "Network",
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (!changed.has("networks")) return;
      n = find();
      drawHero();
      p.redraw();
    },
    dispose: p.dispose,
  };
}
