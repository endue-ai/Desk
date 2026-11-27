import { t } from "../strings/index.js";
// The words and statements of a console's transaction (PG-20): the isolation levels and the BEGIN
// that Manual mode sends with them, how a savepoint's name is written and read back, what the
// header shows beside the session's state (the statements, the time it has been open, flagged when
// it sits idle past the person's minutes) and the sentence under it. Pure.

/**
 * @typedef {"default" | "read-committed" | "repeatable-read" | "serializable"} Isolation
 * @typedef {{ mode: "auto" | "manual", isolation: Isolation, readOnly: boolean }} Chosen
 *   A console's choice: Auto or Manual commit, and what the transactions Manual begins take.
 * @typedef {import("./words.js").SessionModel & {
 *   mode?: Chosen["mode"], next?: string, flagMs?: number,
 *   since?: number, at?: number, statements?: number, savepoints?: string[],
 * }} TransactionModel
 *   The header's model of a console's session: its mode and next transaction's options, and, while
 *   a transaction is open, when it began (`since`), when its last run ended (`at`), the statements
 *   it holds and its savepoints, oldest first. `flagMs` is the idle time it is flagged after.
 */

/** The isolation levels a transaction can take, in the order the question lists them. */
export const ISOLATIONS = /** @type {const} */ ({
  default: { sql: "", label: t("session.transactionWords.serverDefault") },
  "read-committed": { sql: "READ COMMITTED", label: t("session.transactionWords.readCommitted") },
  "repeatable-read": {
    sql: "REPEATABLE READ",
    label: t("session.transactionWords.repeatableRead"),
  },
  serializable: { sql: "SERIALIZABLE", label: t("session.transactionWords.serializable") },
});

/** A console's choice before the person makes one. @type {Readonly<Chosen>} */
export const AUTO = Object.freeze({ mode: "auto", isolation: "default", readOnly: false });

/** The BEGIN Manual mode sends for a console's choice. */
export function beginSql(/** @type {Chosen} */ chosen) {
  const level = ISOLATIONS[chosen.isolation]?.sql ?? "";
  return `BEGIN${level ? ` ISOLATION LEVEL ${level}` : ""}${chosen.readOnly ? " READ ONLY" : ""}`;
}

/** What the next transaction takes, in words: "Serializable, read only". */
export const nextLabel = (/** @type {Chosen} */ chosen) =>
  `${ISOLATIONS[chosen.isolation]?.label ?? "Server default"}, ${chosen.readOnly ? "read only" : "read write"}`;

const RESERVED = new Set(
  "all and any array as asc between both case cast check collate column constraint create current_date current_time current_user default deferrable desc distinct do else end except false fetch for foreign from grant group having in initially intersect into lateral leading limit localtime not null offset on only or order placing primary references returning select session_user some symmetric table then to trailing true union unique user using variadic when where window with".split(
    " ",
  ),
);

/** A savepoint's name as SQL: bare when PostgreSQL reads it back the same, else quoted. */
export function nameSql(/** @type {string} */ name) {
  if (/^[a-z_][a-z0-9_]*$/u.test(name) && !RESERVED.has(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

/** The name at the start of `text`, as the server keeps it: a quoted one as written, else lower. */
function nameAt(/** @type {string} */ text) {
  const quoted = /^"((?:[^"]|"")+)"/u.exec(text);
  if (quoted?.[1]) return quoted[1].replaceAll('""', '"');
  return /^[\p{L}_][\p{L}\p{N}_$]*/u.exec(text)?.[0].toLowerCase();
}

/**
 * What a statement does to a transaction: begins it, ends it, sets, rolls back to or releases a
 * savepoint (with its name), or nothing (`none`), from its words.
 * @param {string} sql
 * @returns {{ does: "begin" | "end" | "savepoint" | "rollback-to" | "release" | "none", name?: string }}
 */
export function controlOf(sql) {
  const text = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/u, "");
  const words = text.split(/\s+/u, 3).map((w) => w.toUpperCase().replace(/;$/u, ""));
  const [first = "", second = ""] = words;
  if (first === "BEGIN" || (first === "START" && second === "TRANSACTION"))
    return { does: "begin" };
  const to = /^(?:ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION))?\s+TO\s+(?:SAVEPOINT\s+)?/iu.exec(
    text,
  );
  if (to) return named("rollback-to", text.slice(to[0].length));
  if (["COMMIT", "END", "ROLLBACK", "ABORT"].includes(first)) return { does: "end" };
  if (first === "SAVEPOINT") return named("savepoint", text.slice(first.length).trimStart());
  const release = /^RELEASE\s+(?:SAVEPOINT\s+)?/iu.exec(text);
  if (release) return named("release", text.slice(release[0].length));
  return { does: "none" };
}

const named = (
  /** @type {"savepoint" | "rollback-to" | "release"} */ does,
  /** @type {string} */ rest,
) => {
  const name = nameAt(rest);
  return name ? { does, name } : { does };
};

/** A time as the header counts it: 1:05, 12:00, 1:02:03. */
export function clock(/** @type {number} */ ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "1 statement", "3 statements". */
export const statementsLine = (/** @type {number} */ n) => `${n} statement${n === 1 ? "" : "s"}`;

const KEYS = "Commit (Mod+Shift+Y) or Rollback (Mod+Shift+S) ends it";
const ASKS = t("session.transactionWords.closingTheConsoleOrDisconnectAsks");

/**
 * What the header shows beside a console's session at `now`: the open transaction's statements and
 * time (empty outside one), whether it sat idle past the flag, the dot's tone and the sentence.
 * @param {TransactionModel | undefined} model
 * @param {number} now
 */
export function transactionLine(model, now) {
  const held =
    model && (model.state === "open" || model.state === "failed" || model.state === "running");
  if (!model || !held || model.since === undefined)
    return { text: "", flagged: false, tone: model?.tone ?? "", detail: "" };
  const count = statementsLine(model.statements ?? 0);
  const open = clock(now - model.since);
  const idle = model.at ? now - model.at : 0;
  const flagged = model.state === "open" && (model.flagMs ?? 0) > 0 && idle >= (model.flagMs ?? 0);
  const minutes = Math.floor(idle / 60_000);
  const text = `${count} · ${open}${flagged ? ` · idle ${minutes} min` : ""}`;
  const points = model.savepoints?.length ? `; savepoints ${model.savepoints.join(", ")}` : "";
  const detail =
    model.state === "failed"
      ? t("session.transactionWords.aStatementFailedInThisTransaction", { ASKS: String(ASKS) })
      : t("session.transactionWords.openForWith", {
          value: String(
            flagged
              ? t("session.transactionWords.idleForMinWithTheTransaction", {
                  minutes: String(minutes),
                })
              : "",
          ),
          open: String(open),
          count: String(count),
          points: String(points),
          KEYS: String(KEYS),
          ASKS: String(ASKS),
        });
  return { text, flagged, tone: flagged ? "danger" : model.tone, detail };
}
