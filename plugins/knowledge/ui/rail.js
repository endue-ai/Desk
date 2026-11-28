// The filters: which agents' sessions, which kinds of things, subagents, sessions sharing nothing,
// how many sessions a thing needs to be drawn, and one repository. Design system controls only.

import { dot, el, fill } from "./dom.js";
import { AGENT_NAMES, AGENT_TOKENS, AGENTS, KINDS } from "./kinds.js";

/** @typedef {{ filter(name: string, value: any): void }} RailActions */

/** One checkbox row: its label and how many there are. */
function check(
  /** @type {RailActions} */ actions,
  /** @type {string} */ name,
  /** @type {Node | string} */ label,
  /** @type {boolean} */ on,
  /** @type {string | number} */ n,
  disabled = false,
) {
  return el(
    "label",
    { class: `check${disabled ? " off" : ""}` },
    el("input", {
      type: "checkbox",
      class: "desk-check",
      checked: on,
      disabled,
      onchange: (/** @type {Event} */ e) =>
        actions.filter(name, /** @type {HTMLInputElement} */ (e.target).checked),
    }),
    label,
    el("span", { class: "n" }, String(n)),
  );
}

/** Draw the filters of screen `s` into `rail`. */
export function drawRail(
  /** @type {HTMLElement} */ rail,
  /** @type {any} */ s,
  /** @type {RailActions} */ actions,
) {
  const f = s.filters;
  const agents = AGENTS.map((a) =>
    check(
      actions,
      `agent:${a}`,
      el("span", { class: "lbl" }, dot(AGENT_TOKENS[a]), AGENT_NAMES[a]),
      f.agents[a] !== false,
      s.counts.agents[a] || "none",
      !s.counts.agents[a],
    ),
  );
  const kinds = Object.entries(KINDS)
    .filter(([, k]) => k.node)
    .map(([kind, k]) =>
      check(
        actions,
        `kind:${kind}`,
        el("span", { class: "lbl" }, dot(k.token), k.label),
        f.kinds[kind] !== false,
        s.counts.kinds[kind] ?? 0,
      ),
    );
  const repo = (/** @type {string} */ key, /** @type {string} */ label, /** @type {number} */ n) =>
    el(
      "button",
      {
        type: "button",
        class: `desk-row facet${f.repo === key ? " is-selected" : ""}`,
        "aria-pressed": String(f.repo === key),
        title: key || "Every repository",
        onclick: () => actions.filter("repo", f.repo === key ? "" : key),
      },
      el("span", { class: "lbl" }, label),
      el("span", { class: "n" }, String(n)),
    );
  const shared = el("input", {
    type: "number",
    class: "desk-field shared",
    min: 1,
    max: 50,
    value: f.shared,
    id: "kb-shared",
    onchange: (/** @type {Event} */ e) =>
      actions.filter("shared", /** @type {HTMLInputElement} */ (e.target).value),
  });
  const total = Object.values(s.counts.agents).reduce(
    (/** @type {number} */ a, b) => a + Number(b),
    0,
  );
  fill(rail, [
    el("section", {}, el("h2", {}, "Agents"), ...agents),
    el("section", {}, el("h2", {}, "Things"), ...kinds),
    el(
      "section",
      {},
      el("h2", {}, "Show"),
      check(actions, "subagents", "Subagents", f.subagents, ""),
      check(actions, "orphans", "Sessions sharing nothing", f.orphans, ""),
      el(
        "label",
        { class: "check", for: "kb-shared" },
        el("span", { class: "lbl" }, "Shared by"),
        shared,
      ),
    ),
    el(
      "section",
      {},
      el("h2", {}, "Repositories"),
      repo("", "All", total),
      ...s.repos.slice(0, 12).map((/** @type {any} */ r) => repo(r.key, r.label, r.sessions)),
    ),
  ]);
}
