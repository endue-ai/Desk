// The Activity view: every run this session, newest first, from whichever view asked; one opens to
// its prompt, the command that ran (the prompt left out), the answer and what the agent used.

import { badge, button, el, markdown, toolList } from "./dom.js";

/**
 * @typedef {import("./dom.js").Act} Act
 * @typedef {import("./model.js").ViewModel} ViewModel
 * @typedef {import("./model.js").RunModel} RunModel
 */

const ORIGINS = { chat: "Chat", compare: "Compare", board: "Board", command: "Command" };

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createActivityView(doc, act) {
  const list = /** @type {HTMLElement} */ (doc.getElementById("activity-list"));
  const detail = /** @type {HTMLElement} */ (doc.getElementById("run-detail"));
  let cursor = 0;
  /** @type {RunModel[]} */
  let runs = [];

  /** @param {RunModel} run */
  const row = (run, /** @type {number} */ index) => {
    const node = el(
      doc,
      "div",
      {
        class: `run ${run.status}`,
        role: "option",
        "aria-selected": String(index === cursor),
        tabindex: index === cursor ? "0" : "-1",
      },
      badge(doc, run.status),
      el(doc, "strong", {}, run.name),
      el(
        doc,
        "span",
        { class: "origin" },
        /** @type {Record<string, string>} */ (ORIGINS)[run.origin] ?? run.origin,
      ),
      el(doc, "span", { class: "prompt" }, run.prompt.split("\n")[0] ?? ""),
      el(doc, "span", { class: "meta" }, run.meta),
      run.status === "running" ? button(doc, "Stop", act, "stopRun", [run.id]) : undefined,
    );
    node.addEventListener("click", () => {
      cursor = index;
      void act("selectRun", run.id);
    });
    return node;
  };

  /** @param {RunModel | undefined} run */
  const drawDetail = (run) => {
    detail.hidden = !run;
    if (!run) return detail.replaceChildren();
    detail.replaceChildren(
      el(doc, "h2", {}, `${run.name}: `, badge(doc, run.status)),
      el(doc, "p", { class: "meta" }, run.meta),
      el(doc, "h3", {}, "Prompt"),
      el(doc, "pre", { class: "plain" }, run.prompt),
      el(doc, "h3", {}, "Command"),
      el(doc, "pre", { class: "plain command" }, run.line),
      el(doc, "h3", {}, "Answer"),
      run.answer ? markdown(doc, run.answer) : el(doc, "p", { class: "note" }, "No answer yet."),
      toolList(doc, run.tools),
      run.error ? el(doc, "p", { class: "problem" }, run.error) : undefined,
    );
  };

  /** @param {ViewModel} model */
  const render = (model) => {
    runs = model.activity.runs;
    cursor = Math.min(cursor, Math.max(0, runs.length - 1));
    const focused = list.contains(doc.activeElement);
    const rows = runs.map(row);
    list.replaceChildren(
      ...(rows.length
        ? rows
        : [el(doc, "p", { class: "note" }, "Nothing asked yet: chat, compare or run a card.")]),
    );
    if (focused) /** @type {HTMLElement | undefined} */ (rows[cursor])?.focus();
    drawDetail(model.activity.open);
  };

  return {
    render,
    focus: () => list.focus(),
    /** @param {string} action @param {unknown[]} args */
    key(action, args) {
      const run = runs[cursor];
      if (action === "move") {
        const by = { next: 1, previous: -1, first: -runs.length, last: runs.length }[
          /** @type {string} */ (args[0])
        ];
        if (by === undefined) return true;
        cursor = Math.max(0, Math.min(runs.length - 1, cursor + by));
        for (const [i, node] of [...list.children].entries()) {
          node.setAttribute("aria-selected", String(i === cursor));
          node.setAttribute("tabindex", i === cursor ? "0" : "-1");
        }
        /** @type {HTMLElement | undefined} */ (list.children[cursor])?.focus();
        return true;
      }
      if (action === "openSelected") {
        if (run) void act("selectRun", run.id);
        return true;
      }
      if (action === "stopSelected") {
        if (run) void act("stopRun", run.id);
        return true;
      }
      return false;
    },
  };
}
