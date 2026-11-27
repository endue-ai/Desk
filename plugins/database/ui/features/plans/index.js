// Query plans made easier to read (PG-70): EXPLAIN with PostgreSQL's options asked in a dialog and
// remembered per connection; the plan tab drawn as a tree, a flame or a table; the plan copied as
// text or JSON; and two plans a console (or two) explained compared side by side in a panel of
// their own, node by node. Explain runs through the console (console-run.js), so ANALYZE of a write
// is a dry run rolled back, under the read-only, production and agent guards. No DOM here.

import { comparePlans } from "../../explain/compare.js";
import { optionsFor, readOptions, saveOptions } from "../../explain/options.js";
import { planJson, planText } from "../../explain/text.js";
import { t as messageText } from "../../strings/index.js";
import { compareView } from "./compare-panel.js";
import { optionsDialog } from "./options-dialog.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../console-run.js").Kept} Kept
 * @typedef {import("./compare-panel.js").CompareState} CompareState
 */

const VIEWS = ["tree", "flame", "table"];
const ENGINES = { postgresql: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };

/** The console on screen and the plan tab it shows (or its first one). */
function planOnScreen(/** @type {Deps} */ deps) {
  const shown = deps.consoles.current();
  const tabs = shown?.shown?.tabs ?? [];
  const on = tabs[shown?.tab ?? 0];
  const tab = on?.kind === "plan" ? on : tabs.find((t) => t.kind === "plan");
  if (!shown || !tab?.plan)
    throw new Error(messageText("features.plans.index.noPlanOnScreenExplainA"));
  return { shown, tab, plan: tab.plan };
}

/** Explain the statement at the caret with the options the dialog (or `on`) turns on. */
async function explainWith(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console")
    throw new Error(messageText("features.plans.index.explainRunsFromAConsole"));
  const conn = deps.manager.get(shown.connection);
  if (!conn) throw new Error(messageText("features.plans.index.thisConsoleSConnectionWasRemoved"));
  if (conn.engine !== "postgresql")
    throw new Error(
      messageText("features.plans.index.explainOptionsArePostgresqlSOn", {
        value: String(ENGINES[conn.engine]),
      }),
    );
  const version = await deps.consoles.serverVersion(conn);
  const given = Array.isArray(args.on) ? args.on.map(String) : undefined;
  const on =
    given ??
    /** @type {string[] | undefined} */ (
      await deps.dialog("explain-options", {
        connection: conn.name,
        version,
        options: optionsFor(version).map(({ name, hint, needs, not }) => ({
          name,
          hint,
          ...(needs ? { needs } : {}),
          ...(not ? { not } : {}),
        })),
        on: await readOptions(deps.bridge, conn.id),
      })
    );
  if (!on) throw deps.cancelled(messageText("features.plans.index.notExplained"));
  await saveOptions(deps.bridge, conn.id, on);
  return deps.consoles.explain(on.includes("ANALYZE"), on);
}

const when = (/** @type {number} */ at) => new Date(at).toTimeString().slice(0, 8);
const oneLine = (/** @type {string} */ sql, max = 80) =>
  sql.replace(/\s+/gu, " ").trim().slice(0, max);

/** What the compare panel shows of a kept plan. */
const sideOf = (/** @type {Kept & { console: string }} */ k) => ({
  label: k.label,
  console: k.console,
  sql: oneLine(k.sql, 500),
  at: when(k.at),
  time: k.plan.time,
  cost: k.plan.cost,
  planning: k.plan.summary?.planning ?? null,
  execution: k.plan.summary?.execution ?? null,
});

/** Compare the console's last plan (or `after`) with an earlier one (`before`, else asked). */
async function compare(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const all = deps.consoles
    .list()
    .flatMap((b) =>
      /** @type {Kept[]} */ (b.explained ?? []).map((k) => ({
        ...k,
        console: b.name,
        connection: b.connection,
      })),
    )
    .sort((a, b) => a.at - b.at);
  const mine = /** @type {Kept[]} */ (deps.consoles.current()?.explained ?? []);
  const lastId = typeof args.after === "string" ? args.after : (mine.at(-1)?.id ?? all.at(-1)?.id);
  const after = all.find((k) => k.id === lastId);
  if (!after) throw new Error(messageText("features.plans.index.noPlanToCompareExplainA"));
  const earlier = all.filter((k) => k.id !== after.id).reverse();
  if (!earlier.length) throw new Error(messageText("features.plans.index.onePlanIsKeptSoFar"));
  const beforeId =
    typeof args.before === "string"
      ? args.before
      : earlier.length === 1
        ? earlier[0]?.id
        : await deps.pick(
            messageText("features.plans.index.databaseCompareTheLastPlanWith"),
            earlier.map((k) => ({
              id: k.id,
              label: `${when(k.at)} · ${k.label} · ${oneLine(k.sql)}`,
              detail: k.console,
            })),
          );
  if (!beforeId) throw deps.cancelled(messageText("features.plans.index.notCompared"));
  const before = all.find((k) => k.id === beforeId);
  if (!before) throw new Error(messageText("features.plans.index.thatPlanIsNoLongerKept"));
  const conn = deps.manager.get(after.connection) ?? null;
  const comparison = comparePlans(before.plan, after.plan);
  /** @type {CompareState} */
  const state = { before: sideOf(before), after: sideOf(after), comparison };
  await deps.consoles.openPanel(
    conn,
    "plans",
    `plans: ${conn?.name ?? after.console} · compare`,
    state,
  );
  deps.say(
    messageText("features.plans.index.ofNodesChanged", {
      changed: String(comparison.changed),
      length: String(comparison.rows.length),
    }),
  );
  return { changed: comparison.changed, nodes: comparison.rows.length };
}

/** Copy the plan on screen as text or as JSON (asked when not given). */
async function copy(/** @type {Deps} */ deps, /** @type {unknown} */ as) {
  const { plan } = planOnScreen(deps);
  const format =
    as === "text" || as === "json"
      ? as
      : await deps.pick(messageText("features.plans.index.databaseCopyThePlanAs"), [
          {
            id: "text",
            label: messageText("features.plans.index.text"),
            detail: messageText("features.plans.index.inPostgresqlSLayout"),
          },
          {
            id: "json",
            label: messageText("features.plans.index.json"),
            detail: messageText("features.plans.index.asTheServerGaveIt"),
          },
        ]);
  if (!format) throw deps.cancelled(messageText("features.plans.index.notCopied"));
  const text = format === "json" ? planJson(plan) : planText(plan);
  const name = format === "json" ? "JSON" : "text";
  deps.say(
    (await deps.view.copy(text))
      ? messageText("features.plans.index.copiedThePlanAs", { name: String(name) })
      : messageText("features.plans.index.couldNotCopyThePlanAs", { name: String(name) }),
  );
  return text;
}

/** Show the plan tab as a tree, a flame or a table (asked when not given). */
async function show(/** @type {Deps} */ deps, /** @type {unknown} */ view) {
  const { tab } = planOnScreen(deps);
  const picked =
    typeof view === "string" && VIEWS.includes(view)
      ? view
      : await deps.pick(messageText("features.plans.index.databaseShowThePlanAs"), [
          { id: "tree", label: messageText("features.plans.index.tree") },
          {
            id: "flame",
            label: messageText("features.plans.index.flame"),
            detail: messageText("features.plans.index.whereTheTimeGoes"),
          },
          {
            id: "table",
            label: messageText("features.plans.index.table"),
            detail: messageText("features.plans.index.aRowPerNodeTheHeaviest"),
          },
        ]);
  if (!picked) throw deps.cancelled(messageText("features.plans.index.thePlanStaysAsItIs"));
  tab.view = /** @type {"tree" | "flame" | "table"} */ (picked);
  deps.consoles.render();
  return picked;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "plans",
  commands: (deps) => ({
    "endue.database.explain-options": (args) => explainWith(deps, args),
    "endue.database.compare-plans": (args) => compare(deps, args),
    "endue.database.copy-plan": ({ as }) => copy(deps, as),
    "endue.database.plan-view": ({ view }) => show(deps, view),
  }),
  actions: (deps) => ({
    explainOptions: () => explainWith(deps, {}),
    comparePlans: () => compare(deps, {}),
    copyPlan: (/** @type {unknown} */ as) => copy(deps, as),
    planView: (/** @type {unknown} */ view) => show(deps, view),
  }),
  panels: {
    plans: {
      label: messageText("features.plans.index.twoPlansCompared"),
      render: (doc, /** @type {CompareState} */ state) => compareView(doc, state),
    },
  },
  dialogs: {
    "explain-options": {
      label: messageText("features.plans.index.explainWithOptions"),
      render: optionsDialog,
    },
  },
  styles: [new URL("./plans.css", import.meta.url).href],
};
