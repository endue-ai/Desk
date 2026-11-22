// Comparing two results (PG-26, ADR 0329): Compare takes the result on screen and one picked among
// the others (every console's results and pinned ones), and the key (the primary key first, when
// both carry it); Run again and compare runs a console's last run (or a table view's page) again
// and compares it with what it showed before, by the primary key when both carry it, else by row
// position. The comparison runs in its worker past a few thousand cells (compare/client.js) and opens
// in a panel; the difference copies and exports in the plugin's formats. No DOM.

import { differenceSet } from "../../compare/diff.js";
import { pinLabel } from "../../compare/pins.js";
import { labelOf } from "../../console-list.js";
import { engineOf } from "../../engines/index.js";
import { exportResult } from "../../export.js";
import { columnKeys } from "../../grid/columns.js";
import { FORMATS, formatRows } from "../../results.js";
import { chooseKey, primaryKey, sameKey } from "./keys.js";
import { stateOf } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../tabs.js").Tab} Tab
 * @typedef {import("./panel.js").CompareState} CompareState
 * @typedef {{ compare(before: import("../../compare/diff.js").Side, after: import("../../compare/diff.js").Side, key: string[] | null): Promise<import("../../compare/diff.js").Difference> }} Comparer
 * @typedef {{ id: string, owner: Console, tab: Tab }} Result
 */

const LABELS = {
  tsv: "TSV",
  csv: "CSV",
  json: "JSON",
  markdown: "Markdown",
  insert: "INSERT statements",
  update: "UPDATE statements",
};

/** The last comparison of a mount of the plugin, for copy and export from elsewhere. */
/** @type {WeakMap<Deps, CompareState>} */
const lasts = new WeakMap();

/** Every result a comparison can take: each console's result tabs, then its pinned ones. */
function resultsOf(/** @type {Deps} */ deps) {
  return deps.consoles
    .list()
    .flatMap((owner) =>
      (owner.shown?.tabs ?? []).flatMap((tab, i) =>
        tab.set && (tab.kind === "rows" || tab.kind === "pinned")
          ? [{ id: tab.pin?.id ?? `run:${owner.id}:${i}`, owner, tab }]
          : [],
      ),
    );
}

const nameOf = (/** @type {Deps} */ deps, /** @type {Console} */ owner) =>
  owner.kind === "console"
    ? labelOf(owner, deps.manager.get(owner.connection))
    : owner.name.replace(/^[\w-]+: /u, "");

/** What the panel says of one result. */
const sideOf = (/** @type {Deps} */ deps, /** @type {Result} */ r, label = r.tab.label) => ({
  label,
  console: nameOf(deps, r.owner),
  sql: r.tab.pin?.sql ?? r.owner.execution?.statements[r.tab.statement]?.text ?? "",
  truncated: Boolean(r.tab.set?.truncated),
});

/** Compare two results and open the panel; answers what is said. */
async function finish(
  /** @type {Deps} */ deps,
  /** @type {Comparer} */ comparer,
  /** @type {{ before: Result, after: Result, labels?: [string, string] }} */ two,
  /** @type {{ key: string[], why: import("./keys.js").Why }} */ chosen,
) {
  const { before, after } = two;
  const d = await comparer.compare(
    /** @type {import("../../engines/common.js").ResultSet} */ (before.tab.set),
    /** @type {import("../../engines/common.js").ResultSet} */ (after.tab.set),
    chosen.key.length ? chosen.key : null,
  );
  const conn = deps.manager.get(after.owner.connection) ?? null;
  const state = stateOf(
    {
      before: sideOf(deps, before, two.labels?.[0]),
      after: sideOf(deps, after, two.labels?.[1]),
    },
    d,
    chosen.why,
  );
  if (conn) state.dialect = engineOf(conn.engine).dialect;
  lasts.set(deps, state);
  await deps.consoles.openPanel(
    conn,
    "compare",
    `compare: ${conn?.name ?? "results"} · results`,
    state,
  );
  const repeats = d.repeated
    ? ` ${d.repeated.toLocaleString("en-US")} row${d.repeated === 1 ? " repeats" : "s repeat"} a key: paired in order.`
    : "";
  const said = `${state.summary}${repeats}`;
  deps.say(said);
  return said;
}

/** Database: compare two results. */
export async function compareResults(
  /** @type {Deps} */ deps,
  /** @type {Comparer} */ comparer,
  /** @type {Record<string, unknown>} */ args,
) {
  const all = resultsOf(deps);
  const shown = deps.consoles.current();
  const onScreen = all.find((r) => r.owner === shown && r.tab === shown?.shown?.tabs[shown.tab]);
  const after = typeof args.after === "string" ? all.find((r) => r.id === args.after) : onScreen;
  if (!after) throw new Error("No result on screen: show a console's result to compare it.");
  const others = all.filter((r) => r !== after).reverse();
  if (others.length === 0)
    throw new Error(
      "One result so far: pin it (Database: pin the result tab), run again, then compare the two.",
    );
  const beforeId =
    typeof args.before === "string"
      ? args.before
      : others.length === 1
        ? others[0]?.id
        : await deps.pick(
            "Database: compare this result with which?",
            others.map((r) => ({ id: r.id, label: r.tab.label, detail: nameOf(deps, r.owner) })),
          );
  if (!beforeId) throw deps.cancelled("Not compared.");
  const before = others.find((r) => r.id === beforeId);
  if (!before) throw new Error("That result is no longer here: run or pin it again.");
  const keys = await Promise.all([before, after].map((r) => primaryKey(deps, r.owner, r.tab)));
  const primary = sameKey(keys[0] ?? [], keys[1] ?? []) ? (keys[1] ?? []) : [];
  const was = columnKeys(before.tab.set?.columns ?? []);
  const common = columnKeys(after.tab.set?.columns ?? []).filter((k) => was.includes(k));
  const chosen = await chooseKey(deps, args.key, primary, common);
  return finish(deps, comparer, { before, after }, chosen);
}

/** Database: run again and compare with before. */
export async function runAgain(/** @type {Deps} */ deps, /** @type {Comparer} */ comparer) {
  const target = deps.consoles.current();
  if (target?.kind !== "console" && target?.kind !== "table")
    throw new Error("Run again and compare works on a console's or a table view's result.");
  const conn = deps.manager.get(target.connection);
  const execution = target.execution;
  if (!conn) throw new Error("This result's connection was removed.");
  if (!execution) throw new Error("Nothing ran here yet: run a query first.");
  const rowsOf = () => (target.shown?.tabs ?? []).filter((t) => t.kind === "rows" && t.set);
  const on = target.shown?.tabs[target.tab];
  const first = on?.kind === "rows" && on.set ? on : rowsOf()[0];
  if (!first)
    throw new Error("This run brought no rows to compare: run a query that returns rows.");
  const nth = rowsOf().indexOf(first);
  const sql = execution.statements[first.statement]?.text ?? execution.sql;
  const before = { id: "before", owner: target, tab: first };
  const beforeKey = await primaryKey(deps, target, first);
  const beforeLabel = pinLabel(sql, execution.at);
  if (target.kind === "table") await deps.consoles.page({});
  else
    await deps.consoles.runIn(target, conn, execution.sql, {
      statements: execution.statements,
      mode: execution.mode,
      maxRows: target.maxRows,
    });
  const next = rowsOf()[nth];
  if (!next) throw new Error("The run again brought no rows to compare: see its Messages.");
  const after = { id: "after", owner: target, tab: next };
  const afterKey = await primaryKey(deps, target, next);
  const both = sameKey(beforeKey, afterKey);
  const afterLabel = pinLabel(sql, target.execution?.at ?? Date.now());
  return finish(
    deps,
    comparer,
    { before, after, labels: [beforeLabel, afterLabel] },
    { key: both ? afterKey : [], why: both ? "primary" : "default" },
  );
}

/** The comparison on screen, else the last one. */
function comparisonOf(/** @type {Deps} */ deps) {
  const shown = deps.consoles.current();
  const state = shown?.kind === "compare" ? shown.compare : lasts.get(deps);
  if (!state) throw new Error("Nothing is compared yet: Database: compare two results first.");
  return /** @type {CompareState} */ (state);
}

/** A format named or picked. */
async function formatOf(
  /** @type {Deps} */ deps,
  /** @type {unknown} */ given,
  /** @type {string} */ title,
) {
  const chosen =
    typeof given === "string"
      ? given
      : await deps.pick(
          title,
          FORMATS.map((id) => ({ id, label: LABELS[id] })),
        );
  if (!chosen) throw deps.cancelled("Nothing written.");
  if (!FORMATS.includes(/** @type {never} */ (chosen)))
    throw new Error(`${title}: pick ${FORMATS.join(", ")}.`);
  return /** @type {import("../../results.js").Format} */ (chosen);
}

const optionsOf = (/** @type {CompareState} */ state) => ({
  ...(state.dialect ? { dialect: state.dialect } : {}),
  table: "difference",
});

/** Database: copy the difference of two results. */
export async function copyDifference(/** @type {Deps} */ deps, /** @type {unknown} */ format) {
  const state = comparisonOf(deps);
  const chosen = await formatOf(deps, format, "Database: copy the difference as");
  const text = formatRows(differenceSet(state), chosen, optionsOf(state));
  deps.say(
    (await deps.view.copy(text))
      ? `Copied the difference as ${LABELS[chosen]}.`
      : "The clipboard refused: try again from the panel's Copy.",
  );
  return text;
}

/** Database: export the difference of two results to a file where the person chooses. */
export async function exportDifference(/** @type {Deps} */ deps, /** @type {unknown} */ format) {
  const state = comparisonOf(deps);
  const chosen = await formatOf(deps, format, "Database: export the difference as");
  const set = differenceSet(state);
  const done = await exportResult(deps.bridge, {
    set,
    format: chosen,
    name: "difference",
    options: optionsOf(state),
  });
  if (!done) throw deps.cancelled("Not exported.");
  const kept = set.truncated
    ? ` (the first ${state.rows.length.toLocaleString("en-US")} of ${state.total.toLocaleString("en-US")} differences)`
    : "";
  deps.say(`Exported ${done.rows} rows of the difference to ${done.path}${kept}.`);
  void deps.commands.run("desk.files.reveal", { path: done.path }).catch(() => {});
  return done.path;
}
