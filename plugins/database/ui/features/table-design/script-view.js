// The table form's script (PG-51): each step a block with its marks set apart and the one a run
// stopped at marked, how it runs, the problems that hold it back, Run, Dry run and Open in console
// (a read-only connection gets no Run), and the run's result. The text is the script as it runs.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
import { refusalOf } from "./runs.js";
import { scriptOf, stepText } from "./script.js";

/**
 * @typedef {import("./controller.js").DesignState} DesignState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** The script, a step a block (its marks set apart), the one that failed marked. */
function scriptBlock(
  /** @type {Document} */ doc,
  /** @type {ReturnType<typeof scriptOf>} */ script,
  /** @type {number} */ failed,
) {
  const pre = el(doc, "pre", {
    class: "td-script",
    "data-part": "script",
    tabindex: "0",
    "aria-label": t("tableDesign.script"),
  });
  const blocks = /** @type {(string | { text: string, step: number })[]} */ ([]);
  if (script.inside.length)
    blocks.push(
      "BEGIN;",
      ...script.inside.map((s, i) => ({ text: stepText(s), step: i })),
      "COMMIT;",
    );
  blocks.push(
    ...script.after.map((s, i) => ({ text: stepText(s), step: script.inside.length + i })),
  );
  blocks.forEach((block, i) => {
    if (i) pre.append("\n\n");
    if (typeof block === "string") {
      pre.append(block);
      return;
    }
    const span = el(doc, "span", {
      class: `td-step${block.step === failed ? " td-failed" : ""}`,
      "data-step": String(block.step + 1),
    });
    block.text.split("\n").forEach((line, j) => {
      if (j) span.append("\n");
      span.append(line.startsWith("-- ") ? el(doc, "span", { class: "td-mark" }, line) : line);
    });
    pre.append(span);
  });
  if (blocks.length) pre.append("\n");
  else pre.append(el(doc, "span", { class: "td-empty" }, t("tableDesign.nothing")));
  return pre;
}

/**
 * What goes under the form: the script, the problems, the buttons and the run's result.
 * @param {Document} doc
 * @param {DesignState} s
 * @param {Act} act
 * @param {string} id
 */
export function scriptParts(doc, s, act, id) {
  if (!s.read || !s.design) return [];
  const script = scriptOf(s.read.original, s.design, s.read.facts);
  const running = s.run?.status === "running";
  const refused = refusalOf(s);
  const how = t(script.after.length ? "tableDesign.runsAfter" : "tableDesign.runsOne");
  const parts = [
    el(
      doc,
      "div",
      { class: "td-script-head" },
      el(doc, "h3", {}, t("tableDesign.script")),
      el(doc, "p", { class: "td-hint" }, how),
    ),
    scriptBlock(doc, script, s.run?.status === "failed" ? s.run.step : -1),
  ];
  if (script.problems.length)
    parts.push(
      el(
        doc,
        "ul",
        { class: "td-problems", role: "alert", "data-part": "problems" },
        ...script.problems.map((p) => el(doc, "li", {}, p)),
      ),
    );
  const button = (
    /** @type {string} */ ctl,
    /** @type {string} */ label,
    /** @type {string} */ cls,
    off = false,
  ) => {
    const b = el(
      doc,
      "button",
      {
        type: "button",
        class: `desk-btn ${cls}`,
        "data-key": `ctl:${ctl}`,
        ...(off ? { disabled: true } : {}),
      },
      label,
    );
    b.addEventListener("click", () => act(ctl, id));
    return b;
  };
  const can = !refused && !running;
  const actions = s.conn.readOnly
    ? [
        el(
          doc,
          "p",
          { class: "td-hint", "data-part": "read-only" },
          t("tableDesign.readOnly", { name: s.conn.name }),
        ),
      ]
    : [
        button(
          "tableDesignRun",
          t(running && !s.run?.dry ? "tableDesign.running" : "tableDesign.run"),
          "desk-btn-primary",
          !can,
        ),
        button(
          "tableDesignDryRun",
          t(running && s.run?.dry ? "tableDesign.running" : "tableDesign.dryRun"),
          "",
          !can || script.inside.length === 0,
        ),
      ];
  actions.push(
    button("tableDesignConsole", t("tableDesign.openConsole"), "desk-btn-quiet", !script.text),
  );
  if (!s.conn.readOnly && refused && !script.problems.length)
    actions.push(el(doc, "span", { class: "td-hint" }, refused));
  parts.push(el(doc, "div", { class: "td-actions" }, ...actions));
  if (s.run && s.run.status !== "running")
    parts.push(
      el(
        doc,
        "div",
        {
          class: s.run.status === "failed" ? "desk-error td-result" : "desk-callout td-result",
          role: "status",
          "data-part": "result",
          ...(s.run.status === "failed" ? {} : { "data-tone": "info" }),
        },
        el(doc, "p", {}, s.run.message),
      ),
    );
  return parts;
}
