// The words of a lost PostgreSQL session (PG-105, ADR 0355): the status line when one is lost (an
// open transaction the server rolled back, with how many statements it held), the statements
// themselves in the header and in the next run's Messages, what the header adds while the plugin
// tries to connect again or waits for the person, what a try that connects says, and a run refused
// because its transaction went while the computer slept. Pure.

/**
 * @typedef {import("./words.js").Gone} Gone
 * @typedef {{ statements: number, texts: string[] }} Lost
 *   A transaction lost with its session: the statements it held, and their text (the first fifty).
 * @typedef {{ automatic: boolean, tries: number, max: number, waiting: boolean, gaveUp?: string }} Retry
 *   How the plugin connects again: on its own (`automatic`, `tries` made of `max`, `waiting` for the
 *   next), or only on the person's act; `gaveUp` says why it stopped trying on its own.
 */

const KEPT = "SET, temporary tables and prepared statements";

/** "1 statement", "3 statements". */
const statements = (/** @type {number} */ n) => `${n} statement${n === 1 ? "" : "s"}`;

/** What the server did with a transaction that was open when its session ended. */
const rolledBack = (/** @type {Gone} */ gone, /** @type {Lost | undefined} */ lost) => {
  if (gone.transaction === "idle") return "";
  const held = lost?.statements ? ` with its ${statements(lost.statements)}` : "";
  return ` The server rolled back its open transaction${held}; none was run again.`;
};

/** The status line's words when an owner's session is lost. */
export function lostLine(
  /** @type {string} */ label,
  /** @type {Gone} */ gone,
  /** @type {Lost | undefined} */ lost = undefined,
) {
  const next = gone.transaction === "idle" ? "The next run" : "Reconnect or the next run";
  return `${label}: the session was lost (${gone.why}).${rolledBack(gone, lost)} ${next} opens a new one.`;
}

/** The statements a lost transaction held, numbered, one a line. */
const listed = (/** @type {Lost} */ lost) => {
  const more = lost.statements - lost.texts.length;
  return [
    ...lost.texts.map((text, i) => `${i + 1}. ${text}`),
    ...(more > 0 ? [`… and ${statements(more)} more.`] : []),
  ].join("\n");
};

/** The header's sentence about a lost transaction's statements. */
export const lostDetail = (/** @type {Lost} */ lost) =>
  ` The transaction held ${statements(lost.statements)}, rolled back by the server and not run again:\n${listed(lost)}`;

/** The notice the next run carries about the transaction lost with the last session. */
export const lostNotice = (/** @type {Lost} */ lost) =>
  `The transaction lost with the last session held ${statements(lost.statements)}, rolled back by the server and not run again:\n${listed(lost)}`;

/** What the header adds to a lost session: the tries on its own, or what the person can do. */
export function retryDetail(/** @type {Retry} */ retry) {
  if (!retry.automatic) return " Reconnect or the next run opens a new one; nothing is run again.";
  if (retry.gaveUp)
    return ` Not connecting again on its own: ${retry.gaveUp}. Reconnect or the next run tries again.`;
  return ` Connecting again on its own: try ${retry.tries + 1} of ${retry.max}; Reconnect tries now.`;
}

/** Why the tries on its own stopped. */
export const GAVE_UP = {
  tries: (/** @type {number} */ n) => `${n} tries did not reach the server`,
  ask: "connecting would ask for the grant again",
};

/** The status line's words when a session opens again. */
export const connectedLine = (
  /** @type {string} */ label,
  /** @type {number | undefined} */ tries,
) =>
  `${label}: connected ${tries ? `again on a new session (try ${tries})` : "on a new session"}; its ${KEPT} are gone, and nothing was run again.`;

/** Why a session is lost when it did not answer after the computer slept. */
export const SLEPT = "The session did not answer after the computer slept";

/** A run refused because its open transaction went while the computer slept. */
export const SLEPT_REFUSED =
  "The session was lost while the computer slept (it did not answer), and the server rolled back its open transaction, so nothing of this run ran. Run again to run it on a new session, outside that transaction.";
