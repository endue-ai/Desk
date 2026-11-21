// The SQL problems in the console editor (PG-30, ADR 0294), through the editor component's own lint
// extension: a pause after typing stops (and never while an IME composes) the text goes to the parse
// worker's check with what the controller says to check against (`problemsContext`), and what it
// finds is underlined, marked in the gutter and told on hover. F8 and Shift+F8 step to the next and
// previous problem and say it on the status line; Mod+. opens the list of them, a listbox a screen
// reader reads (Escape goes back to the text). Only PostgreSQL consoles are checked, never a
// read-only DDL view; typing sends nothing to the server. A run's answers win over the check.

import { textOf } from "../editor/facade.js";
import { dialectFacet } from "../editor/lexing.js";
import { sqlParser } from "../sql/parse/client.js";
import {
  EditorState,
  forEachDiagnostic,
  keymap,
  linter,
  lintGutter,
  nextDiagnostic,
  openLintPanel,
  Prec,
  previousDiagnostic,
  StateEffect,
} from "../vendor/editor/editor-component.mjs";
import { createChecks } from "./requests.js";
import { sentence } from "./text.js";

/**
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("../vendor/editor/editor-component.mjs").EditorView} View
 * @typedef {import("./requests.js").Context & { doc: string }} ProblemsContext
 * @typedef {"list" | "next" | "previous"} Step
 */

/** The pause after the last change before a check, in milliseconds. */
export const DELAY = 300;
/** Problems drawn at most; the list says the first ones. */
export const MAX_DRAWN = 1000;
const recheck = StateEffect.define();
/** Who found a problem, under its message. */
const SOURCES = { syntax: "PostgreSQL's parser", names: "the cached schema", server: "the server" };
const PHRASES = EditorState.phrases.of({
  Diagnostics: "Problems",
  "No diagnostics": "No problems",
  close: "Close the problems",
});

/** Resolves once an IME's composition ends. */
const composed = (/** @type {View} */ view) =>
  new Promise((resolve) => {
    const done = () => {
      view.contentDOM.removeEventListener("compositionend", done);
      resolve(undefined);
    };
    view.contentDOM.addEventListener("compositionend", done);
  });

const checked = (
  /** @type {import("../vendor/editor/editor-component.mjs").EditorState} */ state,
) => state.facet(dialectFacet) === "postgresql" && !state.readOnly;

/**
 * The problems extension and what the console's editor does with it.
 * @param {Act} act
 * @param {() => import("./requests.js").Checking | undefined} [parser]
 */
export function sqlProblems(act, parser = sqlParser) {
  const checks = createChecks(parser);
  const models = new WeakMap();
  let nextModel = 0;
  /** What the last check was made against, so a recheck only checks when it changed. */
  let against = "";
  const keyOf = (/** @type {ProblemsContext | undefined} */ c) => {
    if (!c) return "";
    if (c.model && !models.has(c.model)) models.set(c.model, ++nextModel);
    return `${c.doc}|${c.syntax}|${c.names}|${c.model ? models.get(c.model) : 0}`;
  };

  /** @param {View} view */
  const source = async (view) => {
    const state = view.state;
    if (!checked(state)) return [];
    if (view.compositionStarted) await composed(view);
    const context = /** @type {ProblemsContext | undefined} */ (await act("problemsContext"));
    against = keyOf(context);
    if (!context || (!context.syntax && !context.names)) return [];
    const sql = textOf(state.doc);
    const done = await checks.check(context.doc, sql, context);
    return (done?.problems ?? []).slice(0, MAX_DRAWN).map((p) => ({
      from: Math.min(p.from, sql.length),
      to: Math.min(Math.max(p.to, p.from), sql.length),
      severity: /** @type {const} */ ("error"),
      message: p.message,
      source: SOURCES[p.kind],
    }));
  };

  /** Move to a problem and say it, or open the list; false when this editor is not checked. */
  const step = (/** @type {View} */ view, /** @type {Step} */ what) => {
    if (!checked(view.state)) return false;
    if (what === "list") return openLintPanel(view);
    /** @type {Array<{ message: string, from: number, to: number }>} */
    const found = [];
    forEachDiagnostic(view.state, (/** @type {{ message: string }} */ d, from, to) =>
      found.push({ message: d.message, from, to }),
    );
    if (found.length === 0) {
      act("say", "No problems in this script.");
      return true;
    }
    (what === "next" ? nextDiagnostic : previousDiagnostic)(view);
    const { from, to } = view.state.selection.main;
    const at = Math.max(
      0,
      found.findIndex((p) => p.from === from && p.to === to),
    );
    const problem = /** @type {{ message: string }} */ (found[at]);
    act("say", `Problem ${at + 1} of ${found.length}: ${sentence(problem.message)}`);
    return true;
  };

  return {
    extension: [
      PHRASES,
      linter(source, {
        delay: DELAY,
        needsRefresh: (update) =>
          update.transactions.some((tr) => tr.effects.some((e) => e.is(recheck))),
      }),
      lintGutter(),
      Prec.high(
        keymap.of([
          {
            key: "F8",
            run: (view) => step(view, "next"),
            shift: (view) => step(view, "previous"),
            preventDefault: true,
          },
          { key: "Mod-.", run: (view) => step(view, "list"), preventDefault: true },
        ]),
      ),
    ],
    step,
    /** Check again when what the check is made against changed (the schema cache, a setting). */
    async recheck(/** @type {View} */ view) {
      if (!checked(view.state)) return;
      const next = keyOf(/** @type {ProblemsContext | undefined} */ (await act("problemsContext")));
      if (next !== against) view.dispatch({ effects: recheck.of(null) });
    },
    /** A run of the console `doc`: what the server said wins over the check. */
    ran(
      /** @type {View} */ view,
      /** @type {string} */ doc,
      /** @type {import("../execute.js").Execution} */ execution,
    ) {
      if (checks.remember(doc, execution) && checked(view.state))
        view.dispatch({ effects: recheck.of(null) });
    },
  };
}
