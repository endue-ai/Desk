// A PostgreSQL console can hold a transaction open (PG-20): Auto or Manual commit, Commit and
// Rollback (commands, the editor's keys and the header's buttons), the isolation level and read-only
// of the transactions Manual begins, and savepoints set, rolled back to and released. Manual mode's
// BEGIN and what the header counts live with the sessions (session/transactions.js); the question
// before a close is settle.js's. No DOM.

import { clock, ISOLATIONS, nameSql, statementsLine } from "../../session/transaction-words.js";
import { chosenOf } from "../../session/transactions.js";
import { t } from "../../strings/index.js";
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
    throw new Error(t("features.transactions.index.aConsoleSModeIsAuto"));
  const next = choose(deps, h, { mode: asked ?? (was === "manual" ? "auto" : "manual") }).mode;
  const stays =
    h.transaction !== "idle"
      ? t("features.transactions.index.itsOpenTransactionStaysOpenUntil")
      : "";
  deps.say(
    next === "manual"
      ? t("features.transactions.index.manualCommitTheFirstStatementBegins", {
          label: String(h.label),
          stays: String(stays),
        })
      : t("features.transactions.index.autoCommitEachStatementCommitsBy", {
          label: String(h.label),
          stays: String(stays),
        }),
  );
  return next;
}

async function options(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const h = held(deps, args);
  let isolation = args.isolation;
  if (isolation === undefined) {
    const items = Object.entries(ISOLATIONS).map(([id, { label }]) => ({ id, label }));
    isolation = await deps.pick(
      t("features.transactions.index.databaseIsolationLevelOfTheNext"),
      items,
    );
    if (isolation === undefined)
      throw deps.cancelled(t("features.transactions.index.theIsolationLevelStays"));
  }
  if (typeof isolation !== "string" || !Object.hasOwn(ISOLATIONS, isolation))
    throw new Error(
      t("features.transactions.index.anIsolationLevelIsOneOf", {
        value: String(Object.keys(ISOLATIONS).join(", ")),
      }),
    );
  let readOnly = args.readOnly;
  if (readOnly === undefined) {
    const access = await deps.pick(t("features.transactions.index.databaseReadOnlyOrReadWrite"), [
      { id: "read-write", label: t("features.transactions.index.readWrite") },
      {
        id: "read-only",
        label: t("features.transactions.index.readOnly"),
        detail: t("features.transactions.index.theServerRefusesEveryWriteIn"),
      },
    ]);
    if (access === undefined)
      throw deps.cancelled(t("features.transactions.index.theIsolationLevelStays"));
    readOnly = access === "read-only";
  }
  const chosen = { isolation: /** @type {Isolation} */ (isolation), readOnly: readOnly === true };
  choose(deps, h, { ...chosen, mode: "manual" });
  const when = h.transaction === "idle" ? "The next transaction" : "The transaction after this one";
  deps.say(
    t("features.transactions.index.isManualCommit", {
      label: String(h.label),
      when: String(when),
      value: String(ISOLATIONS[chosen.isolation].label.toLowerCase()),
      value2: String(
        chosen.readOnly
          ? t("features.transactions.index.readOnly2")
          : t("features.transactions.index.readWrite2"),
      ),
    }),
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
  if (h.transaction === "idle")
    throw new Error(
      t("features.transactions.index.hasNoOpenTransaction", { label: String(h.label) }),
    );
  if (sql === "COMMIT" && h.transaction === "failed")
    throw new Error(
      t("features.transactions.index.sTransactionFailedOnlyRollbackEnds", {
        label: String(h.label),
      }),
    );
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
    throw deps.cancelled(t("features.transactions.index.noSavepointSet"));
  }
  if (known.length === 0)
    throw new Error(
      t("features.transactions.index.sTransactionHasNoSavepointDatabase", {
        label: String(h.label),
      }),
    );
  const picked = await deps.pick(
    title,
    known.map((name) => ({ id: name, label: name })),
  );
  if (!picked) throw deps.cancelled(t("features.transactions.index.noSavepointPicked"));
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
    throw new Error(
      t("features.transactions.index.hasNoOpenTransactionASavepoint", { label: String(h.label) }),
    );
  if (h.transaction === "failed" && verb !== "ROLLBACK TO SAVEPOINT")
    throw new Error(
      t("features.transactions.index.sTransactionFailedRollbackOrRoll", { label: String(h.label) }),
    );
  const title = {
    SAVEPOINT: "Database: set a savepoint named",
    "ROLLBACK TO SAVEPOINT": t("features.transactions.index.databaseRollBackToWhichSavepoint"),
    "RELEASE SAVEPOINT": t("features.transactions.index.databaseReleaseWhichSavepoint"),
  }[verb];
  const name = await nameFor(deps, h, args, title, verb === "SAVEPOINT");
  if (name.length > 63)
    throw new Error(t("features.transactions.index.aSavepointSNameIsCharacters"));
  await control(host(deps), h, `${verb} ${nameSql(name)}`);
  deps.say(
    {
      SAVEPOINT: t("features.transactions.index.savepointSet", { name: String(name) }),
      "ROLLBACK TO SAVEPOINT": t("features.transactions.index.rolledBackToSavepointTheWork", {
        name: String(name),
      }),
      "RELEASE SAVEPOINT": t("features.transactions.index.savepointReleasedItsWorkStaysIn", {
        name: String(name),
      }),
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
