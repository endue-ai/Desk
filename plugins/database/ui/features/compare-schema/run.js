// The comparison's script run (PG-53, ADR 0338): never by itself, only on Run or Dry run. Refused when
// the target is not a connection's schema, is read-only, when something is held or nothing is chosen;
// otherwise its steps go as one run in one transaction (a dry run rolls back) through deps.execute,
// so the plugin's guards apply: production asked with its tag, a DROP asked as dangerous, the schema
// cache told. A failure says the server's words and the step; after a run both sides are compared
// again. Open in console hands the script over instead. No DOM.

import { split } from "../../sql/split.js";
import { t } from "../../strings/index.js";
import { wordsOf } from "../table-design/runs.js";
import { insideText } from "../table-design/script.js";
import { migrationOf } from "./migrate.js";
import { connectionOf } from "./sides.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./controller.js").SchemaState} SchemaState
 * @typedef {{ status: "running" | "done" | "failed", dry: boolean, message: string }} Run
 */

const plural = (/** @type {number} */ n, /** @type {string} */ one) =>
  `${n} ${one}${n === 1 ? "" : "s"}`;

/** Why the script does not run, or "". */
export function refusalOf(/** @type {Pick<Deps, "manager">} */ deps, /** @type {SchemaState} */ s) {
  if (s.status !== "done") return t("features.compareSchema.run.compareFirstTheScriptIsWritten");
  const target = s.target === "right" ? s.right : s.left;
  if (target.kind !== "schema")
    return t("features.compareSchema.run.isNotAConnectionSSchema", { label: String(target.label) });
  const conn = connectionOf(deps, target);
  if (conn.readOnly)
    return t("features.compareSchema.run.isReadOnlyThePanelShows", { name: String(conn.name) });
  if (!s.script || s.script.steps === 0)
    return t("features.compareSchema.run.nothingIsChosenThatTheScript");
  if (s.script.held.length) return s.script.held[0] ?? "";
  return "";
}

/**
 * @param {{
 *   deps: Deps, stateOf(id: string): SchemaState | undefined,
 *   update(id: string, patch: Partial<SchemaState>): void,
 *   held: Map<string, any>,
 *   compare(id: string): Promise<unknown>,
 * }} inner
 */
export function createRun({ deps, stateOf, update, held, compare }) {
  const stateNow = (/** @type {string} */ id) => {
    const s = stateOf(id);
    if (!s) throw new Error(t("features.compareSchema.run.thisComparisonWasClosed"));
    return s;
  };
  /** The script's steps as one run sends them, and its connection. */
  const stepsOf = (/** @type {string} */ id) => {
    const s = stateNow(id);
    const got = held.get(id);
    const [source, target] = s.target === "right" ? [got.left, got.right] : [got.right, got.left];
    return { s, source, target, conn: connectionOf(deps, s.target === "right" ? s.right : s.left) };
  };

  /** Run (or dry-run) the script on the target. */
  const run = async (/** @type {string} */ id, dry = false) => {
    const s = stateNow(id);
    if (s.run?.status === "running")
      throw new Error(t("features.compareSchema.run.theScriptIsRunning"));
    const refused = refusalOf(deps, s);
    if (refused) throw new Error(refused);
    const { source, target, conn } = stepsOf(id);
    const m = migrationOf(source.model, target.model, s.chosen, target.facts);
    const sql = insideText(m.steps);
    update(id, { run: { status: "running", dry, message: "" } });
    let done;
    try {
      done = await deps.execute(conn, sql, {
        statements: split(sql, "postgresql"),
        mode: dry ? "dry-run" : "transaction",
      });
    } catch (error) {
      // Asked and not run (production, a dangerous step): the panel is as it was.
      update(id, { run: null });
      throw error;
    }
    const at = done.result.statements.findIndex((x) => x.error);
    const error = done.result.error ?? done.result.statements[at]?.error;
    const message = error
      ? t("features.compareSchema.run.stepFailedNothingWasChangedThe", {
          value: String(Math.max(at, 0) + 1),
          value2: String(wordsOf(error)),
        })
      : dry
        ? t("features.compareSchema.run.theDryRunWentThroughAnd", {
            value: String(plural(m.steps.length, "step")),
          })
        : t("features.compareSchema.run.doneRan", {
            value: String(plural(m.steps.length, "step")),
          });
    update(id, { run: { status: error ? "failed" : "done", dry, message } });
    if (!error && !dry) {
      await compare(id);
      const left = stateNow(id).items.length;
      const said = left
        ? t("features.compareSchema.run.left", { value: String(plural(left, "difference")) })
        : t("features.compareSchema.run.noDifferenceIsLeft");
      update(id, { run: { status: "done", dry, message: `${message}${said}` } });
      deps.say(`${message}${said}`);
      return { ok: true, message: `${message}${said}`, script: m.text };
    }
    deps.say(message);
    return { ok: !error, message, script: m.text };
  };

  /** Open the script in a console of its own, on the target (or the other side's connection). */
  const toConsole = async (/** @type {string} */ id) => {
    const s = stateNow(id);
    const text = s.script?.text ?? "";
    if (!text) throw new Error(t("features.compareSchema.run.theScriptIsEmptyChooseWhat"));
    const target = s.target === "right" ? s.right : s.left;
    const other = s.target === "right" ? s.left : s.right;
    const side = target.kind === "schema" ? target : other.kind === "schema" ? other : null;
    if (!side) throw new Error(t("features.compareSchema.run.aConsoleNeedsAConnectionOne"));
    await deps.consoles.openNew(connectionOf(deps, side));
    await deps.consoles.rename(`migration · ${target.label}`);
    const now = deps.view.editor().text;
    deps.view.replace(0, now.length, text);
    deps.consoles.edited(text);
    deps.view.select(0, 0);
    deps.say(t("features.compareSchema.run.theScriptIsInAConsole"));
    return text;
  };

  return { run, toConsole };
}
