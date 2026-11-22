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
  none: "Not connected",
  idle: "Idle",
  running: "Running",
  open: "In a transaction",
  failed: "In a failed transaction",
  lost: "Session lost",
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
export const FAILED =
  "A statement failed in the transaction: the server ignores every statement until ROLLBACK.";
export const ROLLBACK_FIRST =
  "The transaction failed: run ROLLBACK first (or ROLLBACK TO a savepoint), then run this again.";

/** The rolled-back sentence for a transaction that was open when its session ended. */
const rolledBack = (/** @type {Transaction} */ transaction) =>
  transaction === "idle" ? "" : " Its open transaction was rolled back.";

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
      ? `${gone.why}: the next run opens a new session.`
      : "No session yet: the first run opens one, kept until the console closes.",
    idle: `${at} is idle; its ${KEPT} last until the console closes.`,
    running: `${at} runs a statement.`,
    open: `${at} is in a transaction: COMMIT or ROLLBACK ends it, and closing the console rolls it back.`,
    failed: `${at}: ${FAILED}`,
    lost: `${gone?.why ?? "The session ended"}.${rolledBack(gone?.transaction ?? "idle")} The next run opens a new session; its ${KEPT} are gone.`,
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
  if (data.reason === "encoding") return "The server's client_encoding stopped being UTF8";
  if (data.reason === "revoked") return "The grant to connect to this server was taken back";
  if (data.reason === "desk") return "The desk let the session go";
  if (data.reason === "unloaded") return "The plugin stopped";
  return "The session was closed: a statement ran past the timeout and did not stop";
}

/** Why the idle timer closed a session. */
export const idleWhy = (/** @type {number} */ ms) => {
  const minutes = Math.round(ms / 60_000);
  return `Closed after ${minutes} minute${minutes === 1 ? "" : "s"} idle`;
};

const lower = (/** @type {string} */ text) => text.charAt(0).toLowerCase() + text.slice(1);

/** The notice the first run on a new session carries, when the last one ended without the person. */
export function newSession(/** @type {Gone} */ gone) {
  const how = gone.lost ? `was lost (${lower(gone.why)})` : lower(gone.why);
  return `A new session: the last one ${how}; its ${KEPT} are gone.${rolledBack(gone.transaction)} Nothing of it was run again.`;
}

/**
 * The reasons a close asks about, one per session in a transaction.
 * @param {Array<{ label: string, transaction: Transaction }>} open
 */
export const reasonsOf = (open) =>
  open.map(({ label, transaction }) =>
    transaction === "failed"
      ? `${label}'s transaction failed: closing its session rolls it back.`
      : `${label} is in a transaction: closing its session rolls it back.`,
  );

/** The status line's words when the desk closed a buffer whose session was in a transaction. */
export const rolledBackOnClose = (/** @type {string} */ label) =>
  `${label} closed: its session closed with it, and its open transaction was rolled back.`;
