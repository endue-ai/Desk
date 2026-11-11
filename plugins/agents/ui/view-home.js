// The Home's DOM: the card grid with its source and status chips, and the activity board (Waiting ·
// Active · Failed · Done) with its agent chips. The search field is the page's own, so typing
// survives every redraw; the grid, chips and board are drawn again from the model.

import { ago } from "./cards.js";
import { arrows, avatar, button, el, presence, sourceBadge } from "./dom.js";

/**
 * @typedef {import("./app.js").Shown} Shown
 * @typedef {import("./app.js").HomeShown} HomeShown
 * @typedef {import("./cards.js").Card} Card
 * @typedef {import("./home.js").Row} Row
 * @typedef {object} HomeActions
 * @property {(change: Partial<import("./home.js").Filters>) => void} filter
 * @property {(key: string, facet?: string) => void} studio
 * @property {(key: string) => void} boardAgent
 * @property {(row: Row) => void} openRow
 * @property {(runId: string) => void} stopRun
 * @property {(id: string) => void} openWeb
 * @property {() => void} create
 */

/**
 * @param {Document} doc
 * @param {HomeActions} actions
 */
export function createHomeView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const grid = pick("grid");
  const board = pick("board");
  const search = /** @type {HTMLInputElement} */ (pick("search"));
  search.addEventListener("input", () => actions.filter({ query: search.value }));
  arrows(grid, ".card-open");

  /** A chip row: one pressed chip, or (for agents) several. */
  const chips = (
    /** @type {HTMLElement} */ row,
    /** @type {{ id: string, label: string, count: number }[]} */ list,
    /** @type {(id: string) => boolean} */ pressed,
    /** @type {(id: string) => void} */ press,
  ) =>
    row.replaceChildren(
      ...list.map((chip) =>
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-tab chip",
            "aria-pressed": String(pressed(chip.id)),
            "data-chip": chip.id,
            onclick: () => press(chip.id),
          },
          chip.label,
          el(doc, "span", { class: "count", text: chip.count }),
        ),
      ),
    );

  // The whole card opens its Studio; its name row is the button the keys reach, and its own
  // action button does its own thing.
  const card = (/** @type {Card} */ c, /** @type {number} */ now) =>
    el(
      doc,
      "li",
      {},
      el(
        doc,
        "desk-card",
        {
          class: "agent-card",
          "data-key": c.key,
          "data-source": c.source,
          onclick: (/** @type {MouseEvent} */ event) => {
            const target = /** @type {Element | null} */ (event.target);
            if (!target?.closest?.("button")) actions.studio(c.key);
          },
        },
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-row card-open",
            "aria-label": `${c.name}, ${c.badge}, ${c.status}: open in Studio`,
            onclick: () => actions.studio(c.key),
          },
          avatar(doc, c),
          el(
            doc,
            "span",
            { class: "who" },
            el(doc, "strong", { class: "name", text: c.name }),
            c.handle ? el(doc, "span", { class: "handle", text: c.handle }) : null,
          ),
          sourceBadge(doc, c),
        ),
        el(doc, "p", {
          class: "role",
          text: c.role || (c.source === "endue" ? "endue AI agent" : ""),
        }),
        el(
          doc,
          "p",
          { class: "meta" },
          presence(doc, c),
          c.lastActivity
            ? el(doc, "time", {
                class: "last",
                datetime: c.lastActivity,
                text: ago(c.lastActivity, now),
              })
            : null,
        ),
        el(
          doc,
          "div",
          { class: "card-actions" },
          c.source === "local"
            ? button(
                doc,
                c.runnable ? "Chat" : "Sessions",
                () => actions.studio(c.key, c.runnable ? "chat" : "sessions"),
                {
                  variant: "quiet",
                  attrs: {
                    "aria-label": `${c.runnable ? "Chat with" : "Read the sessions of"} ${c.name}`,
                  },
                },
              )
            : button(doc, "Open in endue.ai", () => actions.openWeb(c.id), {
                variant: "quiet",
                attrs: { "aria-label": `Open ${c.name} in endue.ai` },
              }),
        ),
      ),
    );

  const row = (
    /** @type {Row} */ r,
    /** @type {Card | undefined} */ owner,
    /** @type {number} */ now,
  ) =>
    el(
      doc,
      "li",
      { class: "board-row", "data-source": r.source },
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-row row-open",
          "aria-label": `${r.agentName}: ${r.title}`,
          onclick: () => actions.openRow(r),
        },
        owner ? avatar(doc, owner, "sm") : null,
        el(
          doc,
          "span",
          { class: "row-text" },
          el(
            doc,
            "span",
            { class: "row-top" },
            r.column === "waiting"
              ? el(doc, "span", { class: "dot waiting", "aria-hidden": "true" })
              : null,
            el(doc, "strong", { text: r.agentName }),
            el(doc, "span", { class: "row-title", text: r.title }),
          ),
          r.preview ? el(doc, "span", { class: "row-preview", text: r.preview }) : null,
        ),
        el(
          doc,
          "span",
          { class: "row-meta" },
          el(doc, "time", { datetime: r.at, text: ago(r.at, now) }),
          r.count ? el(doc, "span", { text: `${r.count} msg` }) : null,
        ),
      ),
      r.runId
        ? button(doc, "Stop", () => actions.stopRun(/** @type {string} */ (r.runId)), {
            variant: "danger",
            attrs: { "aria-label": `Stop ${r.agentName}: ${r.title}` },
          })
        : null,
    );

  const column = (
    /** @type {import("./home.js").BoardColumn} */ col,
    /** @type {Map<string, Card>} */ owners,
    /** @type {number} */ now,
  ) => {
    const rows = (/** @type {Row[]} */ list) =>
      el(doc, "ol", { class: "rows" }, ...list.map((r) => row(r, owners.get(r.agentKey), now)));
    const body = col.rows.length
      ? col.groups
        ? col.groups.map((g) =>
            el(
              doc,
              "div",
              { class: "group" },
              el(doc, "h4", { class: "group-label", text: g.label }),
              rows(g.rows),
            ),
          )
        : [rows(col.rows)]
      : [el(doc, "p", { class: "desk-muted column-empty", text: "No conversations" })];
    return el(
      doc,
      "section",
      { class: "column", "data-column": col.id, "aria-label": `${col.label}, ${col.count}` },
      el(
        doc,
        "h3",
        { class: "column-head" },
        col.attention ? el(doc, "span", { class: "dot waiting", "aria-hidden": "true" }) : null,
        el(doc, "span", { text: col.label }),
        el(doc, "span", { class: "count", text: col.count }),
      ),
      ...body,
    );
  };

  return {
    /** @param {Shown} shown @param {HomeShown} home */
    show(shown, home) {
      if (search.value !== home.filters.query) search.value = home.filters.query;
      chips(
        pick("source-chips"),
        home.sourceChips,
        (id) => id === home.filters.source,
        (id) => actions.filter({ source: /** @type {"all" | "endue" | "local"} */ (id) }),
      );
      chips(
        pick("status-chips"),
        home.statusChips,
        (id) => id === home.filters.status,
        (id) =>
          actions.filter({ status: /** @type {import("./home.js").Filters["status"]} */ (id) }),
      );
      const loading =
        shown.sides.endue.state === "loading" && shown.sides.local.state === "loading";
      grid.setAttribute("aria-busy", String(loading));
      grid.replaceChildren(...home.cards.map((c) => card(c, home.now)));
      const empty = pick("grid-empty");
      empty.hidden = loading || home.cards.length > 0;
      empty.querySelector("p")?.replaceChildren(home.empty);

      chips(
        pick("agent-chips"),
        home.agentChips.map((c) => ({ id: c.id, label: c.label, count: c.count ?? 0 })),
        (id) => home.boardAgents.includes(id),
        (id) => actions.boardAgent(id),
      );
      const owners = new Map(home.agentChips.map((c) => [c.id, c.card]));
      // No conversation at all: one line says so, not four empty columns over it.
      const none = home.rows === 0 && !loading;
      board.replaceChildren(
        ...(none ? [] : home.board.map((col) => column(col, owners, home.now))),
      );
      board.hidden = none;
      pick("board-empty").hidden = home.rows > 0 || loading;
    },
  };
}
