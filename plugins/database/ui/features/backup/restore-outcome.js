// What a pg_restore that ended with errors came to (#647). pg_restore 17 and later set
// transaction_timeout at the start of every session it opens; a server before 17 refuses it, and
// pg_restore goes on, restores every entry and exits 1. Such an error is a setting skipped, not a
// failure, when it is the only kind in a run that went on to the end. It is matched by pg_restore's
// own `Command was:` line and the server's major, never by the server's message, which is in the
// server's language. A plain dump, which runs through run-file, leaves such a SET out before it
// runs. Pure.

import { majorOf } from "./args.js";

/** The settings pg_restore sets on every session, by the PostgreSQL major that added them. */
export const NEWER_SETTINGS = Object.freeze({ transaction_timeout: 17 });

const SET = /^Command was: SET (\w+) = [^;]*;$/u;

/** The major that added `name`, when it is one of NEWER_SETTINGS. */
const addedIn = (/** @type {string} */ name) =>
  Object.hasOwn(NEWER_SETTINGS, name)
    ? NEWER_SETTINGS[/** @type {keyof typeof NEWER_SETTINGS} */ (name)]
    : undefined;

/**
 * The errors pg_restore said, each with the command it names (empty when none follows before the
 * next error or the next `while …:` context line).
 * @param {string} stderr
 * @returns {Array<{ line: string, command: string }>}
 */
export function restoreErrors(stderr) {
  /** @type {Array<{ line: string, command: string }>} */
  const errors = [];
  /** @type {{ line: string, command: string } | undefined} */
  let open;
  for (const raw of stderr.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("pg_restore: error:")) {
      open = { line, command: "" };
      errors.push(open);
    } else if (line.startsWith("pg_restore: while ")) {
      open = undefined;
    } else if (open && !open.command && line.startsWith("Command was:")) {
      open.command = line;
    }
  }
  return errors;
}

/**
 * The settings skipped when every error of a run that went on to the end set one that a server of
 * `serverMajor` does not know; null when any error is something else, or the run stopped early.
 * @param {string} stderr
 * @param {number} serverMajor
 * @returns {string[] | null}
 */
export function skippedSettings(stderr, serverMajor) {
  if (!/errors ignored on restore: \d+/u.test(stderr)) return null;
  const errors = restoreErrors(stderr);
  if (errors.length === 0) return null;
  /** @type {Set<string>} */
  const names = new Set();
  for (const { command } of errors) {
    const name = SET.exec(command)?.[1] ?? "";
    const added = addedIn(name);
    if (added === undefined || serverMajor >= added) return null;
    names.add(name);
  }
  return [...names];
}

/**
 * The sentence a single transaction is refused with when pg_restore `version` sets a setting a
 * server of `serverMajor` does not know: that first error undoes everything. Undefined otherwise.
 * @param {string} version
 * @param {number} serverMajor
 */
export function oneTransactionRefusal(version, serverMajor) {
  const major = majorOf(version);
  const hit = Object.entries(NEWER_SETTINGS).find(
    ([, added]) => major >= added && serverMajor < added,
  );
  if (!hit) return undefined;
  const [name, added] = hit;
  const older = Array.from({ length: added - serverMajor }, (_, i) => serverMajor + i);
  const which = older.length > 1 ? `${older.slice(0, -1).join(", ")} or ${older.at(-1)}` : older[0];
  return `pg_restore ${version} sets ${name}, which PostgreSQL ${serverMajor} does not know, and in a single transaction that error undoes the whole restore: turn Single transaction off, or use pg_restore ${which} (the setting endue.database.pg-restore).`;
}

/** What the result adds when settings were skipped. */
export const skippedNote = (
  /** @type {string[]} */ names,
  /** @type {number} */ serverMajor,
  /** @type {string} */ version,
) =>
  `PostgreSQL ${serverMajor} does not know ${names.join(", ")}, which pg_restore ${version} sets: skipped.`;

const PLAIN_SET = /^SET\s+(\w+)\s*(?:=|TO)\s*[^;]*;?$/iu;

/**
 * For a plain dump run through run-file: its `SET <setting>` statements that a server of
 * `serverMajor` would refuse are left out before they run (each part replays the settings before
 * it, so one that fails would stop every part), and the result names them.
 * @param {number} serverMajor
 */
export function plainSkips(serverMajor) {
  return {
    skip(/** @type {string} */ text) {
      const bare = text.replace(/^(?:\s*--[^\n]*\n)*/u, "").trim();
      const name = PLAIN_SET.exec(bare)?.[1]?.toLowerCase() ?? "";
      const added = addedIn(name);
      return added !== undefined && serverMajor < added ? name : undefined;
    },
    note: (/** @type {string[]} */ names) =>
      `PostgreSQL ${serverMajor} does not know ${names.join(", ")}: skipped.`,
  };
}
