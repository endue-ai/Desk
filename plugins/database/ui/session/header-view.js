// A PostgreSQL console's transaction in the header (PG-20): the Auto or Manual commit button, and
// while a transaction is open its statements and the time it has been open, counted every second
// and flagged when it sits idle past the person's minutes (the status dot then turns to danger),
// with Commit, and Rollback (a failed transaction offers only Rollback); and Reconnect beside a lost
// session (PG-105). The words are transaction-words.js's.

import { transactionLine } from "./transaction-words.js";

/** @typedef {import("./transaction-words.js").TransactionModel} TransactionModel */

/** @param {Document} doc @param {() => number} [now] */
export function createTransactionHeader(doc, now = () => Date.now()) {
  const byId = (/** @type {string} */ id) =>
    /** @type {HTMLElement | null} */ (doc.getElementById(id));
  /** @type {TransactionModel | undefined} */
  let shown;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;

  /** The line beside the session's state, again at each second while a transaction is open. */
  const tick = () => {
    const line = transactionLine(shown, now());
    const text = byId("transaction");
    if (text) {
      text.hidden = line.text === "";
      text.textContent = line.text;
      text.title = line.detail;
      text.dataset.flagged = String(line.flagged);
    }
    const dot = /** @type {HTMLElement | null} */ (doc.querySelector("#session .desk-dot"));
    if (dot && shown && line.text) {
      if (line.tone) dot.dataset.tone = line.tone;
      else delete dot.dataset.tone;
    }
    return line;
  };

  return (/** @type {TransactionModel | undefined} */ model) => {
    shown = model;
    const again = byId("session-reconnect");
    if (again) again.hidden = model?.state !== "lost";
    const bar = byId("transaction-bar");
    if (!bar) return;
    bar.hidden = !model?.mode;
    const mode = byId("tx-mode");
    if (mode) {
      mode.textContent = model?.mode === "manual" ? "Manual commit" : "Auto commit";
      mode.setAttribute("aria-pressed", String(model?.mode === "manual"));
    }
    const line = tick();
    const open = line.text !== "";
    const commit = byId("tx-commit");
    const rollback = byId("tx-rollback");
    if (commit) commit.hidden = !open || model?.state === "failed";
    if (rollback) rollback.hidden = !open;
    if (open && timer === undefined) timer = setInterval(tick, 1000);
    if (!open && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
