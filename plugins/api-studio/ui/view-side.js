// The left side: a rail of sections (Collections, Environments, History, Runner, AI) and the panel
// of the one chosen, which can be hidden (Mod+B) and resized. Features add their sections; this
// file only switches between them, and draws History.

import { button, h, icon, methodBadge } from "./dom.js";
import { ago, bytes, clock, dayOf, duration, statusClass } from "./format.js";
import { confirm, showMenu } from "./menu.js";
import { methodClass } from "./model.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {{ id: string, label: string, icon: import("./dom.js").IconName, order: number,
 *   draw(S: Studio): { el: HTMLElement, redraw?(): void, topics?: import("./app.js").Topic[] } }} RailItem
 */

/** @type {RailItem[]} */
export const RAIL = [];

/** @param {RailItem} item */
export function addRail(item) {
  const at = RAIL.findIndex((r) => r.id === item.id);
  if (at >= 0) RAIL[at] = item;
  else RAIL.push(item);
  RAIL.sort((a, b) => a.order - b.order);
}

/** @param {Studio} S */
export function sideBar(S) {
  const rail = h("nav.as-rail", { "aria-label": "Sections" });
  const panel = h("aside.as-side", { "aria-label": "Side panel" });
  const grip = h("div.as-side-grip", {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize the side panel",
  });
  /** @type {ReturnType<RailItem["draw"]> | undefined} */
  let shown;
  /** @type {(() => void)[]} */
  let offs = [];

  const drawRail = () => {
    const { rail: chosen, side } = S.app.state.layout;
    rail.replaceChildren(
      h("div.as-rail-mark", { title: "API Studio" }, icon("mark", 20)),
      ...RAIL.map((item) =>
        h(
          `button.desk-icon-btn.as-rail-btn${item.id === chosen && side ? ".is-active" : ""}`,
          {
            type: "button",
            "aria-label": item.label,
            title: item.label,
            "aria-pressed": String(item.id === chosen && side),
            onClick: () => {
              if (item.id === chosen) S.app.layout({ side: !side });
              else S.app.layout({ rail: item.id, side: true });
            },
          },
          icon(item.icon, 19),
          h("span.as-rail-label", null, item.label),
        ),
      ),
      h("span.as-grow"),
      h(
        "button.desk-icon-btn.as-rail-btn",
        {
          type: "button",
          "aria-label": "Settings",
          title: "Settings",
          onClick: () => S.openSettings(),
        },
        icon("settings", 19),
      ),
    );
  };
  const drawPanel = () => {
    for (const off of offs) off();
    offs = [];
    const { rail: chosen, side, sideWidth } = S.app.state.layout;
    panel.hidden = !side;
    grip.hidden = !side;
    panel.style.width = `${sideWidth}px`;
    const item = RAIL.find((r) => r.id === chosen) ?? RAIL[0];
    if (!item || !side) return;
    shown = item.draw(S);
    panel.replaceChildren(shown.el);
    for (const topic of shown.topics ?? []) offs.push(S.app.on(topic, () => shown?.redraw?.()));
  };
  let last = "";
  S.app.on("layout", () => {
    const { rail: r, side, sideWidth } = S.app.state.layout;
    const key = `${r}|${side}`;
    panel.style.width = `${sideWidth}px`;
    if (key === last) return;
    last = key;
    drawRail();
    drawPanel();
  });
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const start = event.clientX;
    const from = S.app.state.layout.sideWidth;
    const move = (/** @type {PointerEvent} */ e) =>
      S.app.layout({ sideWidth: Math.max(200, Math.min(520, from + e.clientX - start)) });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
  last = `${S.app.state.layout.rail}|${S.app.state.layout.side}`;
  drawRail();
  drawPanel();
  return { rail, panel, grip, redraw: drawPanel };
}

/** A side panel's header: its title and a few buttons. @param {string} title @param {...Node} tools */
export function panelHead(title, ...tools) {
  return h("div.as-side-head", null, h("h2", null, title), h("div.as-side-tools", null, ...tools));
}

/** A search field for a side panel. @param {string} label @param {(q: string) => void} onInput */
export function panelSearch(label, onInput) {
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-side-search", {
      type: "search",
      placeholder: label,
      "aria-label": label,
    })
  );
  input.addEventListener("input", () => onInput(input.value.trim().toLowerCase()));
  return h("div.as-side-searchbox", null, icon("search", 14), input);
}

/** @param {Studio} S */
function historyPanel(S) {
  let query = "";
  const list = h("div.as-side-list", { role: "list" });
  const draw = () => {
    const items = S.app.state.history.filter(
      (e) => !query || `${e.method} ${e.url} ${e.name}`.toLowerCase().includes(query),
    );
    if (!items.length) {
      list.replaceChildren(
        h(
          "div.as-side-empty",
          null,
          icon("history", 22),
          h(
            "p",
            null,
            query ? "Nothing in the history matches." : "Requests you send show up here.",
          ),
          h("p.as-hint", null, "The last 150 are kept."),
        ),
      );
      return;
    }
    /** @type {Node[]} */
    const out = [];
    let day = "";
    for (const e of items) {
      const d = dayOf(e.at);
      if (d !== day) {
        day = d;
        out.push(h("div.as-side-group", null, d));
      }
      out.push(
        h(
          "div.as-hist.desk-row",
          {
            role: "listitem",
            tabindex: "0",
            title: `${e.method} ${e.url}\n${clock(e.at, true)}`,
            onClick: () => S.openHistory(e),
            onKeydown: (/** @type {KeyboardEvent} */ k) => k.key === "Enter" && S.openHistory(e),
            onContextmenu: (/** @type {MouseEvent} */ ev) => {
              ev.preventDefault();
              showMenu(
                [
                  { label: "Open in a new tab", icon: "plus", run: () => S.openHistory(e) },
                  {
                    label: "Save to a collection…",
                    icon: "download",
                    run: () => S.saveHistory?.(e),
                  },
                  "-",
                  {
                    label: "Remove from history",
                    icon: "trash",
                    danger: true,
                    run: () => S.app.setHistory(S.app.state.history.filter((x) => x.id !== e.id)),
                  },
                ],
                { x: ev.clientX, y: ev.clientY },
              );
            },
          },
          methodBadge(e.method, methodClass(e.method)),
          h(
            "span.as-hist-main",
            null,
            h("span.as-hist-url", null, e.url.replace(/^https?:\/\//, "") || e.name),
            h(
              "span.as-hist-meta",
              null,
              ago(e.at),
              e.time ? ` · ${duration(e.time)}` : "",
              e.size ? ` · ${bytes(e.size)}` : "",
            ),
          ),
          h(
            `span.status-dot.s-${e.error && !e.status ? "server" : statusClass(e.status)}`,
            { title: e.error ?? String(e.status) },
            e.status ? String(e.status) : "ERR",
          ),
        ),
      );
    }
    list.replaceChildren(...out);
  };
  draw();
  const el = h(
    "div.as-panel",
    null,
    panelHead(
      "History",
      button({
        label: "Clear the history",
        icon: "trash",
        hideLabel: true,
        onClick: async () => {
          if (
            await confirm(
              "Clear the history",
              "Every request in the history goes. Saved requests stay.",
              "Clear",
              true,
            )
          )
            S.app.setHistory([]);
        },
      }),
    ),
    panelSearch("Filter the history", (q) => {
      query = q;
      draw();
    }),
    list,
  );
  return { el, redraw: draw, topics: /** @type {import("./app.js").Topic[]} */ (["history"]) };
}

addRail({ id: "history", label: "History", icon: "history", order: 30, draw: historyPanel });
