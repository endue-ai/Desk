// The question before consoles' open transactions close (PG-20): closing a console or disconnecting
// its connection asks once for them all, commit, roll back or stay. Commit runs COMMIT on each
// (offered only when none failed and none is running); roll back closes their sessions now, which
// rolls back, so the close that follows asks nothing more; stay ends the close. No DOM.

import { clock, statementsLine } from "../../session/transaction-words.js";
import { reasonsOf } from "../../session/words.js";
import { t } from "../../strings/index.js";
import { control, heldOf } from "./control.js";

/**
 * @typedef {import("./control.js").Host} Host
 * @typedef {import("./control.js").Held} Held
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {Host & {
 *   consoles: Host["consoles"] & { sessions?: { forget(owner: string): void } },
 *   pick: import("../../ask.js").Pick,
 *   say(text: string): void,
 *   cancelled(message: string): Error,
 * }} Deps
 */

/** What Commit commits: "Shop: 2 statements, open 1:05". */
const holds = (/** @type {Held} */ held, /** @type {number} */ now) => {
  const { model } = held;
  const count = model?.statements === undefined ? "" : `: ${statementsLine(model.statements)}`;
  const open = model?.since === undefined ? "" : `, open ${clock(now - model.since)}`;
  return `${held.label}${count}${open}`;
};

/**
 * Ask about the open transactions of `targets` before they close.
 * @param {Deps} deps
 * @param {Console[]} targets
 * @param {string} title the question: "Close Shop?"
 * @param {string} stay what a close that stays says: "Not closed."
 */
export async function settle(deps, targets, title, stay) {
  const open = targets
    .map((target) => heldOf(deps, target))
    .filter((held) => held !== undefined && held.transaction !== "idle")
    .map((held) => /** @type {Held} */ (held));
  if (open.length === 0) return;
  const now = Date.now();
  const committable = open.every(
    (held) =>
      held.transaction === "open" && held.model?.state !== "running" && !held.target.running,
  );
  const reasons = reasonsOf(open.map(({ label, transaction }) => ({ label, transaction })));
  const items = [
    ...(committable
      ? [
          {
            id: "commit",
            label: t("features.transactions.settle.commit"),
            detail: open.map((h) => holds(h, now)).join("; "),
          },
        ]
      : []),
    {
      id: "rollback",
      label: t("features.transactions.settle.rollBack"),
      detail: reasons.join(" "),
    },
    {
      id: "stay",
      label: t("features.transactions.settle.stay"),
      detail: t("features.transactions.settle.nothingClosesTheTransactionStaysOpen"),
    },
  ];
  const answer = await deps.pick(title, items);
  if (answer === "commit" && committable) {
    for (const held of open) await control(deps, held, "COMMIT");
    deps.say(
      t("features.transactions.settle.committed", {
        value: String(open.map((h) => holds(h, now)).join("; ")),
      }),
    );
    return;
  }
  if (answer !== "rollback") throw deps.cancelled(stay);
  for (const held of open) deps.consoles.sessions?.forget(held.owner);
  deps.consoles.render();
  const names = open.map((h) => h.label).join(", ");
  deps.say(
    t("features.transactions.settle.theOpenTransactionRolledBack", {
      names: String(names),
      value: String(
        open.length === 1
          ? t("features.transactions.settle.was")
          : t("features.transactions.settle.sWere"),
      ),
    }),
  );
}
