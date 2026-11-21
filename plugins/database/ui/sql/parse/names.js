// Where each part of a dotted name is written. The parse tree gives a name's parts and where the
// whole name starts (`s.t.c` at the `s`); the resolver binds each part on its own, so it reads them
// off the script: plain words, quoted names with their doubled quotes, U&"..." names, and the space
// and comments PostgreSQL allows around each dot. Pure.

const WORD_START = /[A-Za-z_\u0080-￿]/u;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/u;

/** Past the space and comments at `at` (block comments nest, as in PostgreSQL). */
export function skipSpace(/** @type {string} */ sql, /** @type {number} */ at) {
  let i = at;
  while (i < sql.length) {
    if (/\s/u.test(sql[i] ?? "")) i++;
    else if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (sql.startsWith("/*", i)) {
      let depth = 0;
      while (i < sql.length) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
    } else break;
  }
  return i;
}

/** The end of the name written at `at`, or -1 when no name starts there. */
export function nameEnd(/** @type {string} */ sql, /** @type {number} */ at) {
  let i = at;
  if (/^u&"/iu.test(sql.slice(i, i + 3))) i += 2;
  if (sql[i] === '"') {
    i++;
    while (i < sql.length) {
      if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
      else if (sql[i] === '"') return i + 1;
      else i++;
    }
    return -1;
  }
  if (!WORD_START.test(sql[i] ?? "")) return -1;
  i++;
  while (i < sql.length && WORD_PART.test(sql[i] ?? "")) i++;
  return i;
}

/**
 * The spans of `count` dotted name parts written from offset `at`, or null when the script does
 * not hold them there.
 * @param {string} sql
 * @param {number} at
 * @param {number} count
 * @returns {Array<{ start: number, end: number }> | null}
 */
export function partsAt(sql, at, count) {
  /** @type {Array<{ start: number, end: number }>} */
  const parts = [];
  let i = at;
  for (let k = 0; k < count; k++) {
    if (k > 0) {
      i = skipSpace(sql, i);
      if (sql[i] !== ".") return null;
      i = skipSpace(sql, i + 1);
    }
    const end = nameEnd(sql, i);
    if (end < 0) return null;
    parts.push({ start: i, end });
    i = end;
  }
  return parts;
}
