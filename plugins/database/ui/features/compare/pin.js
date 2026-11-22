// Pin and unpin a console's result tab (PG-26, ADR 0329): a pin keeps the result on screen through
// the console's later runs (compare/pins.js); the pinned tabs of every console keep under one
// memory limit, and a pin past it lets go of the oldest and says which. No DOM.

import { pinnedTab, toLetGo, unpinFrom } from "../../compare/pins.js";
import { labelOf } from "../../console-list.js";
import { formatBytes } from "../../format.js";
import { primaryKey } from "./keys.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../tabs.js").Tab} Tab
 */

/** The console on screen, which pins belong to. */
function consoleOf(/** @type {Deps} */ deps) {
  const target = deps.consoles.current();
  if (target?.kind !== "console")
    throw new Error("Pin works on a console's result: run a query in a console first.");
  return target;
}

/** Every console's pinned tabs, with the console each is in. */
const everyPin = (/** @type {Deps} */ deps) =>
  deps.consoles
    .list()
    .flatMap((owner) => /** @type {Tab[]} */ (owner.pinned ?? []).map((tab) => ({ owner, tab })));

/** Pin the result tab on screen; says what it pinned and what it let go of. */
export async function pin(/** @type {Deps} */ deps, /** @type {number} */ limit) {
  const target = consoleOf(deps);
  const tab = target.shown?.tabs[target.tab];
  if (!tab) throw new Error("No result here: run a query first.");
  if (tab.kind === "pinned") throw new Error("This result is pinned already.");
  if (tab.kind !== "rows" || !tab.set)
    throw new Error(`Pin a result with rows: ${tab.label} is not one.`);
  const execution = target.execution;
  const sql = execution?.statements[tab.statement]?.text ?? execution?.sql ?? "";
  const key = await primaryKey(deps, target, tab);
  const made = pinnedTab(tab.set, { sql, at: execution?.at ?? Date.now(), key });
  const all = everyPin(deps);
  const gone = toLetGo(
    all.map((p) => p.tab),
    made.pin?.bytes ?? 0,
    limit,
  );
  if (!gone)
    throw new Error(
      `Not pinned: this result holds about ${formatBytes(made.pin?.bytes ?? 0)}, and pinned results keep at most ${formatBytes(limit)}. Load fewer rows and pin again.`,
    );
  const names = gone.map((old) => {
    const owner = all.find((p) => p.tab === old)?.owner;
    if (!owner) return old.label;
    unpinFrom(owner, old);
    return `${old.label} (${labelOf(owner, deps.manager.get(owner.connection))})`;
  });
  target.pinned = [...(target.pinned ?? []), made];
  target.shown?.tabs.push(made);
  deps.consoles.render();
  const let_ = names.length
    ? ` Let go of ${names.join(", ")}: pinned results keep at most ${formatBytes(limit)}.`
    : "";
  const said = `Pinned ${made.label}.${let_}`;
  deps.say(said);
  return said;
}

/** Unpin the pinned tab on screen, or one picked among the console's. */
export async function unpin(/** @type {Deps} */ deps, /** @type {unknown} */ id) {
  const target = consoleOf(deps);
  const pinned = /** @type {Tab[]} */ (target.pinned ?? []);
  if (pinned.length === 0) throw new Error("No result is pinned in this console.");
  const on = target.shown?.tabs[target.tab];
  const chosen =
    typeof id === "string"
      ? id
      : on?.kind === "pinned"
        ? on.pin?.id
        : await deps.pick(
            "Database: unpin which result?",
            pinned.map((tab) => ({ id: tab.pin?.id ?? "", label: tab.label })),
          );
  if (!chosen) throw deps.cancelled("Nothing unpinned.");
  const tab = pinned.find((t) => t.pin?.id === chosen);
  if (!tab) throw new Error("That result is not pinned here.");
  unpinFrom(target, tab);
  deps.consoles.render();
  const said = `Unpinned ${tab.label}.`;
  deps.say(said);
  return said;
}

/** The Pin button: pin the result on screen, or unpin it when it is pinned. */
export const togglePin = (/** @type {Deps} */ deps, /** @type {number} */ limit) => {
  const target = deps.consoles.current();
  const on = target?.shown?.tabs[target.tab];
  return on?.kind === "pinned" ? unpin(deps, undefined) : pin(deps, limit);
};
