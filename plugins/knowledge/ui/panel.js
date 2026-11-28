// The selection's details (what it is, its numbers, what came up with it, its sessions, sessions
// alike) and the sessions by day under the graph. Design system controls only.

import { dot, el, fill } from "./dom.js";
import { AGENT_NAMES, AGENT_TOKENS, AGENTS } from "./kinds.js";

/**
 * @typedef {{ select(id: string | null): void, mode(m: string): void,
 *   openNote(id: string): Promise<void> }} PanelActions
 */

/** Draw the details of screen `s` into `panel`. */
export function drawPanel(
  /** @type {HTMLElement} */ panel,
  /** @type {any} */ s,
  /** @type {PanelActions} */ actions,
) {
  const p = s.panel;
  if (!p) {
    fill(panel, [
      el(
        "p",
        { class: "muted" },
        "Pick a node to see the sessions behind it and what came up with it.",
      ),
    ]);
    return;
  }
  const total =
    Object.values(p.agents).reduce((/** @type {number} */ a, b) => a + Number(b), 0) || 1;
  const rows = (/** @type {string} */ title, /** @type {any[]} */ list) =>
    list.length > 0 &&
    el(
      "section",
      {},
      el("h2", {}, title),
      ...list.map((r) =>
        el(
          "button",
          {
            type: "button",
            class: "desk-row row",
            title: r.label,
            onclick: () => actions.select(r.id),
          },
          dot(r.token),
          el("span", { class: "lbl" }, r.label),
          el("span", { class: "n" }, r.note),
        ),
      ),
    );
  fill(panel, [
    el(
      "div",
      { class: "panel-head" },
      el("span", { class: "desk-badge" }, p.kind),
      el(
        "button",
        {
          type: "button",
          class: "desk-icon-btn close",
          "aria-label": "Close the details",
          title: "Close",
          onclick: () => actions.select(null),
        },
        "✕",
      ),
    ),
    el("div", { class: "title" }, p.title),
    p.subtitle && el("div", { class: "muted" }, p.subtitle),
    el(
      "div",
      { class: "stats" },
      ...p.stats.map(([k, v]) => el("div", { class: "stat" }, el("b", {}, v), el("span", {}, k))),
    ),
    el(
      "div",
      {
        class: "split",
        "aria-label": AGENTS.map((a) => `${AGENT_NAMES[a]} ${p.agents[a] ?? 0}`).join(", "),
      },
      ...AGENTS.filter((a) => p.agents[a]).map((a) =>
        el("i", {
          style: {
            width: `${(100 * p.agents[a]) / total}%`,
            background: `var(${AGENT_TOKENS[a]})`,
          },
        }),
      ),
    ),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-primary",
          onclick: () => actions.mode("local"),
        },
        "Around",
      ),
      el(
        "button",
        { type: "button", class: "desk-btn", onclick: () => actions.mode("note") },
        "Note",
      ),
      p.noted &&
        el(
          "button",
          { type: "button", class: "desk-btn", onclick: () => void actions.openNote(s.selectedId) },
          "Open the note",
        ),
    ),
    p.parent && rows("Started by", [p.parent]),
    rows("Came up with", p.together),
    rows(p.kind.includes("session") ? "Subagents" : "Sessions", p.sessions),
    rows("Alike", p.alike),
  ]);
}

/** Draw the sessions by day: one bar a day, stacked by agent, the selection's days lit. */
export function drawDays(/** @type {HTMLElement} */ days, /** @type {any[]} */ list) {
  const max = Math.max(1, ...list.map((d) => AGENTS.reduce((n, a) => n + (d.counts[a] ?? 0), 0)));
  fill(days, [
    el(
      "div",
      { class: "bars" },
      ...list.map((d) =>
        el(
          "div",
          {
            class: `bar${d.hot ? "" : " dim"}`,
            title: `${d.label}: ${AGENTS.map((a) => `${AGENT_NAMES[a]} ${d.counts[a]}`).join(", ")}`,
          },
          ...AGENTS.map((a) =>
            el("i", {
              style: {
                height: `${(100 * (d.counts[a] ?? 0)) / max}%`,
                background: `var(${AGENT_TOKENS[a]})`,
              },
            }),
          ),
        ),
      ),
    ),
    list.length > 0 &&
      el(
        "div",
        { class: "axis" },
        el("span", {}, list[0].label),
        el("span", {}, list.at(-1).label),
      ),
  ]);
}
