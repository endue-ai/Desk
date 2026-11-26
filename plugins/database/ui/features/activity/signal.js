// Cancel a session's statement (pg_cancel_backend) or end the session (pg_terminate_backend). The
// classifier reads both as writes (ADR 0328); this module asks its own question with the session's
// statement, so deps.execute is told it was asked. A read-only connection refuses, a session that
// runs no statement has nothing to cancel, and every cancel and end is asked first, whoever asks
// (the panel, the palette, an agent), with a production connection named first and the session's
// statement shown. A refusal of the server (a role without pg_signal_backend) is said in its own
// words. No DOM.

import { oneLine } from "../../execute.js";
import { t } from "../../strings/index.js";
import { durationOf } from "./model.js";
import { wordsOf } from "./read.js";
import { signalSql } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Session} Session
 * @typedef {"cancel" | "end"} How
 */

/** Why a connection's sessions are not signalled from here, or "". */
export const refusal = (/** @type {Pick<Connection, "name" | "readOnly">} */ conn) =>
  conn.readOnly
    ? t("features.activity.signal.isReadOnlyItsSessionsAre", { name: String(conn.name) })
    : "";

/** Why a session has no statement to cancel, or "" (a hidden state may have one). */
export function nothingToCancel(/** @type {Session} */ s) {
  if (s.state === null || s.state === "active" || s.state === "fastpath function call") return "";
  const rest = s.state.startsWith("idle in transaction")
    ? "; ending it rolls its transaction back"
    : "";
  return t("features.activity.signal.sessionRunsNoStatementNowThere", {
    pid: String(s.pid),
    state: String(s.state),
    rest: String(rest),
  });
}

/**
 * The question asked first: what will happen to which session, production first.
 * @param {How} how
 * @param {Pick<Connection, "name" | "tag">} conn
 * @param {Session} s
 */
export function questionOf(how, conn, s) {
  const title =
    how === "cancel"
      ? t("features.activity.signal.cancelTheStatementOfSessionOn", {
          pid: String(s.pid),
          name: String(conn.name),
        })
      : t("features.activity.signal.endSessionOn", { pid: String(s.pid), name: String(conn.name) });
  const statement = s.hidden
    ? "Its statement is hidden: the pg_read_all_stats role shows it."
    : s.query
      ? `Statement: ${oneLine(s.query)}`
      : "It has run no statement.";
  const state = s.state
    ? `${s.state}${s.stateMs !== null ? ` for ${durationOf(s.stateMs)}` : ""}`
    : "state hidden";
  const where = [
    `${s.user ?? "another role"} on ${s.database ?? "no database"}`,
    s.application || "no application name",
    state,
  ].join(" · ");
  const effect =
    how === "cancel"
      ? t("features.activity.signal.theStatementStopsWithAnError")
      : t("features.activity.signal.itsConnectionClosesAndItsOpen");
  const production =
    conn.tag === "production"
      ? [t("features.activity.signal.isTaggedProduction", { name: String(conn.name) })]
      : [];
  return { title, reasons: [...production, statement, where, effect] };
}

/**
 * Ask, then signal; resolves with the sentence to say.
 * @param {Pick<import("../../feature-host.js").Deps, "confirm" | "execute" | "cancelled">} deps
 * @param {How} how
 * @param {Connection} conn
 * @param {Session} s
 * @param {number} version server_version_num
 */
export async function stop(deps, how, conn, s, version, approved = false) {
  const refused = refusal(conn) || (how === "cancel" ? nothingToCancel(s) : "");
  if (refused) throw new Error(refused);
  const { title, reasons } = questionOf(how, conn, s);
  if (!(approved || (await deps.confirm(title, reasons))))
    throw deps.cancelled(
      how === "cancel"
        ? t("features.activity.signal.notCancelled")
        : t("features.activity.signal.notEnded"),
    );
  const { result } = await deps.execute(conn, signalSql(how, s.pid, version), { asked: true });
  const outcome = result.statements[0];
  const not = how === "cancel" ? "Not cancelled" : "Not ended";
  const error = result.error ?? outcome?.error;
  if (error) throw new Error(`${not}: ${wordsOf(error)}`);
  if (outcome?.sets[0]?.rows[0]?.[0] !== "t") {
    const notice = [...(outcome?.notices ?? []), ...result.notices][0];
    const why = notice
      ? notice.replace(/^[A-Z]+:\s*/u, "")
      : t("features.activity.signal.sessionIsGone", { pid: String(s.pid) });
    throw new Error(`${not}: ${why}.`);
  }
  return how === "cancel"
    ? t("features.activity.signal.cancelledTheStatementOfSession", { pid: String(s.pid) })
    : t("features.activity.signal.endedSession", { pid: String(s.pid) });
}
