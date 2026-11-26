import { t } from "../strings/index.js";
// The words of a kept PostgreSQL session (PG-02, ADR 0320): its state in the header (not connected,
// idle, running, in a transaction, in a failed transaction, lost) with the sentence under it, why a
// session ended (db.closed's reason, the idle timer, a failure in the run), what the first run on a
// new session says when the last one ended without the person, and the reasons a close asks about
// while a transaction is open. Pure.

/**
 * @typedef {import("@endue-ai/bridge").DbTransaction} Transaction
 * @typedef {"none" | "idle" | "running" | "open" | "failed" | "lost"} State
 * @typedef {{ state: State, label: string, tone: string, detail: string, pid?: number }} SessionModel
 *   What the header draws: `tone` is the status dot's (`data-tone`), `detail` its title.
 * @typedef {{ why: string, transaction: Transaction, lost: boolean, reason?: string }} Gone
 *   How the last session of an owner ended without the person: lost, or closed while idle;
 *   `reason` is db.closed's, "run" for one a run found gone, "slept" for one the wake check found.
 */

/** @type {Record<State, string>} */
export const LABELS = {
  none: t("session.words.notConnected"),
  idle: t("session.words.idle"),
  running: t("session.words.running"),
  open: t("session.words.inATransaction"),
  failed: t("session.words.inAFailedTransaction"),
  lost: t("session.words.sessionLost"),
};

/** @type {Record<State, string>} */
const TONES = {
  none: "",
  idle: "success",
  running: "info",
  open: "warning",
  failed: "danger",
  lost: "danger",
};

const KEPT = "SET, temporary tables and prepared statements";
/** What a failed transaction refuses, and what a run inside one is told. */
export const FAILED = t("session.words.aStatementFailedInTheTransaction");
export const ROLLBACK_FIRST = t("session.words.theTransactionFailedRunRollbackFirst");

/** The rolled-back sentence for a transaction that was open when its session ended. */
const rolledBack = (/** @type {Transaction} */ transaction) =>
  transaction === "idle" ? "" : t("session.words.itsOpenTransactionWasRolledBack");

/**
 * What the header shows for an owner: its session's state, else how the last one ended.
 * @param {{ running: boolean, transaction: Transaction, pid: number } | undefined} entry
 * @param {Gone | undefined} gone
 * @returns {SessionModel}
 */
export function modelOf(entry, gone) {
  /** @type {State} */
  const state = entry
    ? entry.running
      ? "running"
      : entry.transaction === "open"
        ? "open"
        : entry.transaction === "failed"
          ? "failed"
          : "idle"
    : gone?.lost
      ? "lost"
      : "none";
  const at = entry ? `Session ${entry.pid}` : "";
  const detail = {
    none: gone
      ? t("session.words.theNextRunOpensANew", { why: String(gone.why) })
      : t("session.words.noSessionYetTheFirstRun"),
    idle: t("session.words.isIdleItsLastUntilThe", { at: String(at), KEPT: String(KEPT) }),
    running: t("session.words.runsAStatement", { at: String(at) }),
    open: t("session.words.isInATransactionCommitOr", { at: String(at) }),
    failed: `${at}: ${FAILED}`,
    lost: t("session.words.theNextRunOpensANew2", {
      value: String(gone?.why ?? t("session.words.theSessionEnded")),
      value2: String(rolledBack(gone?.transaction ?? "idle")),
      KEPT: String(KEPT),
    }),
  }[state];
  return {
    state,
    label: LABELS[state],
    tone: TONES[state],
    detail,
    ...(entry ? { pid: entry.pid } : {}),
  };
}

/**
 * Why the core ended a session, from db.closed.
 * @param {import("@endue-ai/bridge").DbClosedData} data
 */
export function closedWhy(data) {
  const said = data.error?.message ?? data.message;
  const with_ = (/** @type {string} */ text) => (said ? `${text}: ${said}` : text);
  if (data.reason === "server") return with_("The server ended the session");
  if (data.reason === "io") return with_("The network to the server failed");
  if (data.reason === "encoding") return t("session.words.theServerSClientEncodingStopped");
  if (data.reason === "revoked") return t("session.words.theGrantToConnectToThis");
  if (data.reason === "desk") return t("session.words.theDeskLetTheSessionGo");
  if (data.reason === "unloaded") return t("session.words.thePluginStopped");
  return t("session.words.theSessionWasClosedAStatement");
}

/** Why the idle timer closed a session. */
export const idleWhy = (/** @type {number} */ ms) => {
  const minutes = Math.round(ms / 60_000);
  return t("session.words.closedAfterMinuteIdle", {
    minutes: String(minutes),
    value: String(minutes === 1 ? "" : t("session.words.s")),
  });
};

const lower = (/** @type {string} */ text) => text.charAt(0).toLowerCase() + text.slice(1);

/** The notice the first run on a new session carries, when the last one ended without the person. */
export function newSession(/** @type {Gone} */ gone) {
  const how = gone.lost ? `was lost (${lower(gone.why)})` : lower(gone.why);
  return t("session.words.aNewSessionTheLastOne", {
    how: String(how),
    KEPT: String(KEPT),
    value: String(rolledBack(gone.transaction)),
  });
}

/**
 * The reasons a close asks about, one per session in a transaction.
 * @param {Array<{ label: string, transaction: Transaction }>} open
 */
export const reasonsOf = (open) =>
  open.map(({ label, transaction }) =>
    transaction === "failed"
      ? t("session.words.sTransactionFailedClosingItsSession", { label: String(label) })
      : t("session.words.isInATransactionClosingIts", { label: String(label) }),
  );

/** The status line's words when the desk closed a buffer whose session was in a transaction. */
export const rolledBackOnClose = (/** @type {string} */ label) =>
  t("session.words.closedItsSessionClosedWithIt", { label: String(label) });
