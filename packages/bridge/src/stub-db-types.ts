/** What a scripted database server is made of, for the stub's db.* (stub-db.ts, ADR 0281). */
import type { DbColumn, DbServerError, DbTls, DbValue } from "./generated";

/** One statement a scripted server answers. */
export interface StubStatement {
  /** The statement it answers: the same text, or the text the pattern matches. */
  sql: string | RegExp;
  columns?: DbColumn[];
  rows?: DbValue[][];
  /** The type OIDs db.describe answers for its `$n` (ADR 0353); none by default. */
  paramTypes?: number[];
  /** The command tag; `SELECT <rows>` when there are columns, else the first word. */
  tag?: string;
  /** The server's error, which ends the statement. */
  error?: DbServerError;
  /** Notices it raises while it runs: they come with its first page (ADR 0334). */
  notices?: DbServerError[];
  /** Notices the session sends after its answer, outside any call: db.notice events a turn later. */
  afterwards?: DbServerError[];
  /** It runs until db.cancel, then answers 57014. */
  waits?: boolean;
  /** A COPY: `in` waits for db.copy; `out` answers `data`. */
  copy?: { direction: "in"; columns: number } | { direction: "out"; data: string };
}

/** What a call bound to a statement: its parameters as text or null, their type OIDs. */
export interface StubBound {
  params?: DbValue[];
  paramTypes?: number[];
  describe?: true;
}

/** Who a session signed in as, and how: what its db.open asked for. */
export interface StubSession {
  host: string;
  port: number;
  database: string;
  user: string;
  readOnly: boolean;
  settings: Record<string, string>;
  tls?: DbTls;
}

/** A scripted database server. */
export interface StubDatabase {
  /** The password the sign-in needs: a wrong one is refused (28P01), none answers needsPassword.
   * Without it every sign-in is let in. */
  password?: string;
  /** The passphrase of every encrypted client key (a key whose PEM says ENCRYPTED): none given
   * answers keyPassword "needed", another "wrong" (ADR 0331). */
  keyPassword?: string;
  /** What the server reports at the sign-in; server_version and client_encoding by default. */
  parameters?: Record<string, string>;
  statements: StubStatement[];
  /** Answers a statement none of `statements` matches, on the session it runs on, with the values
   * db.run or db.script bound to it (`describe` for db.describe); undefined leaves it unanswered
   * (0A000). */
  answer?: (sql: string, session: StubSession, bound?: StubBound) => StubStatement | undefined;
}

export interface StubDbOptions {
  /** A scripted database server; with it the stub's db.open signs in (stub-db.ts). */
  db?: StubDatabase;
}
