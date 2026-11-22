/**
 * The stub's LISTEN and NOTIFY, and a call's notices as they arrive (ADR 0358): LISTEN, UNLISTEN
 * (a channel, or `*`) and DISCARD ALL change the channels a session listens to; NOTIFY and
 * pg_notify send `db.notification` to every session of the same database that listens, with the
 * sender's pid, a turn later, as the server does at the end of the sender's statement (the stub
 * keeps no transaction's queue). Each call a session answers has a number; the notices its
 * statement raises come as `db.call.notice` with it before the answer, which carries it too, and
 * those it sends after (`afterwards`) as db.notice events a turn later.
 */
import type { BridgeEvent, DbServerError } from "./generated";

/** What a session holds for these. */
export interface Listening {
  info: { sessionId: string; pid: number };
  signed: { database: string };
  channels?: Set<string>;
  calls?: number;
}

/** A channel as the server names it: an unquoted one in lower case. */
const nameOf = (raw: string) =>
  raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw.toLowerCase();
const NAME = String.raw`("(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const LISTEN = new RegExp(String.raw`^\s*(LISTEN|UNLISTEN)\s+(\*|${NAME})\s*;?\s*$`, "iu");
const NOTIFY = new RegExp(
  String.raw`^\s*NOTIFY\s+${NAME}\s*(?:,\s*'((?:[^']|'')*)')?\s*;?\s*$`,
  "iu",
);
const PG_NOTIFY =
  /^\s*SELECT\s+pg_notify\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)\s*;?\s*$/iu;
const text = (raw = "") => raw.replaceAll("''", "'");

export function stubDbListen<S extends Listening>(
  sessions: () => Iterable<S>,
  later: (event: BridgeEvent) => void,
) {
  const notify = (from: S, channel: string, payload: string) => {
    for (const other of sessions())
      if (other.signed.database === from.signed.database && other.channels?.has(channel))
        later({
          event: "db.notification",
          data: { sessionId: other.info.sessionId, pid: from.info.pid, channel, payload },
        });
  };
  return {
    /** The tag of a LISTEN, UNLISTEN, DISCARD ALL or NOTIFY `sql` is, its effect done; else "". */
    answer(session: S, sql: string): string {
      const listen = LISTEN.exec(sql);
      if (listen) {
        const [, verb = "", target = ""] = listen;
        const channels = (session.channels ??= new Set());
        if (verb.toUpperCase() === "LISTEN") channels.add(nameOf(target));
        else if (target === "*") channels.clear();
        else channels.delete(nameOf(target));
        return verb.toUpperCase();
      }
      if (/^\s*DISCARD\s+ALL\s*;?\s*$/iu.test(sql)) {
        session.channels?.clear();
        return "DISCARD ALL";
      }
      const notified = NOTIFY.exec(sql);
      if (notified) {
        notify(session, nameOf(notified[1] ?? ""), text(notified[2]));
        return "NOTIFY";
      }
      const called = PG_NOTIFY.exec(sql);
      if (called) {
        notify(session, text(called[1]), text(called[2]));
        return "SELECT 1";
      }
      return "";
    },
    /** A new call on the session: its statement's notices go out now, those it sends after a turn
     * later; its answer carries the number this answers. */
    call(
      session: S,
      statement?: { notices?: DbServerError[]; afterwards?: DbServerError[] },
    ): number {
      const call = (session.calls ?? 0) + 1;
      const sessionId = session.info.sessionId;
      session.calls = call;
      for (const notice of statement?.notices ?? [])
        later({ event: "db.call.notice", data: { sessionId, call, notice } });
      for (const notice of statement?.afterwards ?? [])
        setTimeout(() => later({ event: "db.notice", data: { sessionId, notice } }), 0);
      return call;
    },
  };
}
