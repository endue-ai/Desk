// A PostgreSQL console can hold a transaction open (PG-20): Auto or Manual commit, Commit and
// Rollback (commands, the editor's keys and the header's buttons), the isolation level and read-only
// of the transactions Manual begins, and savepoints set, rolled back to and released. Manual mode's
// BEGIN and what the header counts live with the sessions (session/transactions.js); the question
// before a close is settle.js's. No DOM.

import { clock, ISOLATIONS, nameSql, statementsLine } from "../../session/transaction-words.js";
import { chosenOf } from "../../session/transactions.js";
import { consoleOf, control, idleNow } from "./control.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./control.js").Held} Held
 * @typedef {import("../../session/transaction-words.js").Chosen} Chosen
 * @typedef {import("../../session/transaction-words.js").Isolation} Isolation
 */

const host = (/** @type {Deps} */ deps) => ({
  consoles: deps.consoles,
  connection: (/** @type {string} */ id) => deps.manager.get(id),
  execute: deps.execute,
});
const held = (/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) =>
  consoleOf(host(deps), args.console);

/** Set a console's choice and say it. */
function choose(
  /** @type {Deps} */ deps,
  /** @type {Held} */ h,
  /** @type {Partial<Chosen>} */ change,
) {
  const next = { ...chosenOf(h.target), ...change };
  h.target.transactions = next;
  deps.consoles.render();
  return next;
}

async function mode(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const h = held(deps, args);
  const was = chosenOf(h.target).mode;
  const asked = args.mode;
  if (asked !== undefined && asked !== "auto" && asked !== "manual")
    throw new Error("A console's mode is auto or manual.");
  const next = choose(deps, h, { mode: asked ?? (was === "manual" ? "auto" : "manual") }).mode;
  const stays =
    h.transaction !== "idle" ? " Its open transaction stays open until Commit or Rollback." : "";
  deps.say(
    next === "manual"
      ? `${h.label}: manual commit. The first statement begins a transaction, kept until Commit (Mod+Shift+Y) or Rollback (Mod+Shift+S).${stays}`
      : `${h.label}: auto commit. Each statement commits by itself.${stays}`,
  );
  return next;
}

async function options(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const h = held(deps, args);
  let isolation = args.isolation;
  if (isolation === undefined) {
    const items = Object.entries(ISOLATIONS).map(([id, { label }]) => ({ id, label }));
    isolation = await deps.pick("Database: isolation level of the next transaction", items);
    if (isolation === undefined) throw deps.cancelled("The isolation level stays.");
  }
  if (typeof isolation !== "string" || !Object.hasOwn(ISOLATIONS, isolation))
    throw new Error(`An isolation level is one of ${Object.keys(ISOLATIONS).join(", ")}.`);
  let readOnly = args.readOnly;
  if (readOnly === undefined) {
    const access = await deps.pick("Database: read-only or read-write?", [
      { id: "read-write", label: "Read write" },
      { id: "read-only", label: "Read only", detail: "The server refuses every write in it." },
    ]);
    if (access === undefined) throw deps.cancelled("The isolation level stays.");
    readOnly = access === "read-only";
  }
  const chosen = { isolation: /** @type {Isolation} */ (isolation), readOnly: readOnly === true };
  choose(deps, h, { ...chosen, mode: "manual" });
  const when = h.transaction === "idle" ? "The next transaction" : "The transaction after this one";
  deps.say(
    `${h.label}: ${when} is ${ISOLATIONS[chosen.isolation].label.toLowerCase()}, ${chosen.readOnly ? "read only" : "read write"} (manual commit).`,
  );
  return chosen;
}

/** Commit or Rollback the console's transaction, and say what it held. */
async function end(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
  /** @type {"COMMIT" | "ROLLBACK"} */ sql,
) {
  const h = held(deps, args);
  idleNow(h);
  if (h.transaction === "idle") throw new Error(`${h.label} has no open transaction.`);
  if (sql === "COMMIT" && h.transaction === "failed")
    throw new Error(`${h.label}'s transaction failed: only Rollback ends it.`);
  const count = h.model?.statements;
  const since = h.model?.since;
  await control(host(deps), h, sql);
  const what = count === undefined ? "" : `: ${statementsLine(count)}`;
  const open = since === undefined ? "" : `, open ${clock(Date.now() - since)}`;
  deps.say(`${sql === "COMMIT" ? "Committed" : "Rolled back"}${what}${open}.`);
  return sql;
}

/** A savepoint's name: the one given, else typed or picked from the transaction's. */
async function nameFor(
  /** @type {Deps} */ deps,
  /** @type {Held} */ h,
  /** @type {Record<string, unknown>} */ args,
  /** @type {string} */ title,
  typed = false,
) {
  if (typeof args.name === "string" && args.name.trim()) return args.name.trim();
  const known = [...(h.model?.savepoints ?? [])].reverse();
  if (typed) {
    const name = await deps.pick(title, [], true, `sp${known.length + 1}`);
    if (name?.trim()) return name.trim();
    throw deps.cancelled("No savepoint set.");
  }
  if (known.length === 0)
    throw new Error(
      `${h.label}'s transaction has no savepoint: Database: set a savepoint sets one.`,
    );
  const picked = await deps.pick(
    title,
    known.map((name) => ({ id: name, label: name })),
  );
  if (!picked) throw deps.cancelled("No savepoint picked.");
  return picked;
}

/** @param {"SAVEPOINT" | "ROLLBACK TO SAVEPOINT" | "RELEASE SAVEPOINT"} verb */
async function savepoint(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
  verb,
) {
  const h = held(deps, args);
  idleNow(h);
  if (h.transaction === "idle")
    throw new Error(`${h.label} has no open transaction: a savepoint lives in one.`);
  if (h.transaction === "failed" && verb !== "ROLLBACK TO SAVEPOINT")
    throw new Error(`${h.label}'s transaction failed: Rollback, or roll back to a savepoint.`);
  const title = {
    SAVEPOINT: "Database: set a savepoint named",
    "ROLLBACK TO SAVEPOINT": "Database: roll back to which savepoint?",
    "RELEASE SAVEPOINT": "Database: release which savepoint?",
  }[verb];
  const name = await nameFor(deps, h, args, title, verb === "SAVEPOINT");
  if (name.length > 63) throw new Error("A savepoint's name is 63 characters at most.");
  await control(host(deps), h, `${verb} ${nameSql(name)}`);
  deps.say(
    {
      SAVEPOINT: `Savepoint ${name} set.`,
      "ROLLBACK TO SAVEPOINT": `Rolled back to savepoint ${name}: the work before it stays.`,
      "RELEASE SAVEPOINT": `Savepoint ${name} released: its work stays in the transaction.`,
    }[verb],
  );
  return name;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "transactions",
  commands: (deps) => ({
    "endue.database.commit": (args) => end(deps, args, "COMMIT"),
    "endue.database.rollback": (args) => end(deps, args, "ROLLBACK"),
    "endue.database.transaction-mode": (args) => mode(deps, args),
    "endue.database.transaction-options": (args) => options(deps, args),
    "endue.database.savepoint": (args) => savepoint(deps, args, "SAVEPOINT"),
    "endue.database.rollback-to-savepoint": (args) =>
      savepoint(deps, args, "ROLLBACK TO SAVEPOINT"),
    "endue.database.release-savepoint": (args) => savepoint(deps, args, "RELEASE SAVEPOINT"),
  }),
  // The editor's keys and the header's buttons.
  actions: (deps) => ({
    commitTransaction: () => end(deps, {}, "COMMIT"),
    rollbackTransaction: () => end(deps, {}, "ROLLBACK"),
    toggleTransactionMode: () => mode(deps, {}),
  }),
  styles: [new URL("./transactions.css", import.meta.url).href],
};
