// The Agents view: every program the plugin knows, whether it is installed and which version, how
// it is kept read-only, and how to install it when it is not there. ↵ or Chat opens a conversation.

import { badge, button, el } from "./dom.js";

/**
 * @typedef {import("./dom.js").Act} Act
 * @typedef {import("./model.js").ViewModel} ViewModel
 */

const GUARDS = {
  flag: "Kept read-only by a flag",
  default: "Read-only by its own default",
  none: "Not held read-only",
};

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createAgentsView(doc, act) {
  const bar = /** @type {HTMLElement} */ (doc.getElementById("agents-bar"));
  const list = /** @type {HTMLElement} */ (doc.getElementById("agents-list"));
  bar.append(
    el(
      doc,
      "p",
      { class: "note" },
      "Agent programs installed on this computer. Each answers in the folder endue.local-agents.folder names (your home folder by default).",
    ),
    button(doc, "Look again", act, "detect"),
  );
  let cursor = 0;
  /** @type {ViewModel["agents"]} */
  let agents = [];

  /** @param {ViewModel} model */
  const render = (model) => {
    agents = model.agents;
    cursor = Math.min(cursor, Math.max(0, agents.length - 1));
    const focused = list.contains(doc.activeElement);
    const rows = agents.map((a, index) => {
      const facts = [
        el(doc, "span", { class: "vendor" }, a.vendor),
        el(doc, "code", {}, a.command),
        a.version ? el(doc, "span", { class: "version" }, a.version) : undefined,
      ];
      const row = el(
        doc,
        "div",
        {
          class: `agent ${a.state}`,
          role: "option",
          id: `agent-${a.id}`,
          "aria-selected": String(index === cursor),
          tabindex: index === cursor ? "0" : "-1",
        },
        el(doc, "div", { class: "agent-head" }, el(doc, "strong", {}, a.name), badge(doc, a.state)),
        el(doc, "p", { class: "facts" }, ...facts),
        a.state === "ready"
          ? el(
              doc,
              "p",
              { class: `guard ${model.access === "read-only" ? a.guard : "agent"}` },
              model.access === "read-only"
                ? `${GUARDS[a.guard]}. ${a.guardNote}`
                : "Runs with its own permission settings (endue.local-agents.access is agent).",
            )
          : undefined,
        a.state === "missing"
          ? el(doc, "p", { class: "install" }, "Install: ", el(doc, "code", {}, a.install))
          : undefined,
        a.state !== "missing" && a.problem
          ? el(doc, "p", { class: "problem" }, a.problem)
          : undefined,
        a.state === "ready"
          ? el(
              doc,
              "p",
              { class: "actions" },
              button(doc, "Chat", act, "useAgent", [a.id]),
              a.resumes ? el(doc, "span", { class: "note" }, "Resumes its sessions") : undefined,
            )
          : undefined,
      );
      row.addEventListener("click", () => {
        cursor = index;
        render(model);
      });
      return row;
    });
    list.replaceChildren(...rows);
    if (focused) rows[cursor]?.focus();
  };

  return {
    render,
    focus: () => list.focus(),
    /** @param {string} action @param {unknown[]} args */
    key(action, args) {
      if (action === "move") {
        const by = { next: 1, previous: -1, first: -agents.length, last: agents.length }[
          /** @type {string} */ (args[0])
        ];
        if (by === undefined) return true;
        cursor = Math.max(0, Math.min(agents.length - 1, cursor + by));
        for (const [i, node] of [...list.children].entries()) {
          node.setAttribute("aria-selected", String(i === cursor));
          node.setAttribute("tabindex", i === cursor ? "0" : "-1");
        }
        /** @type {HTMLElement | undefined} */ (list.children[cursor])?.focus();
        return true;
      }
      if (action === "useSelected") {
        const agent = agents[cursor];
        if (agent?.state === "ready") void act("useAgent", agent.id);
        return true;
      }
      return false;
    },
  };
}
