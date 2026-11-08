// A tokenizer for the three dialects, deep enough to find where a statement ends and which words it
// is made of. Strings, quoted names, comments and dollar quotes are skipped the way each client skips
// them: psql's lexer (psqlscan.l) for PostgreSQL, the mysql client's line reader for MySQL and
// MariaDB (backslash escapes, `#` and `-- ` comments, DELIMITER), and SQLite's tokenizer. No DOM, no
// SDK.

/**
 * @typedef {"postgresql" | "mysql" | "sqlite"} Dialect
 * @typedef {"space" | "comment" | "string" | "name" | "word" | "number" | "param" | "op" | "end" | "delimiter"} TokenType
 * @typedef {{ type: TokenType, text: string, start: number, end: number }} Token
 *   `end` is a statement's terminator; `delimiter` a MySQL `DELIMITER x` line, whose `text` is `x`.
 */

const WORD_START = /[A-Za-z_\u0080-￿]/u;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/u;
const DIGIT = /[0-9]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/u;
const MYSQL_DELIMITER = /^[ \t]*delimiter[ \t]+(\S+)[^\n]*(?:\n|$)/iu;

/**
 * Every token of `sql`, in order; concatenated, their texts give `sql` back.
 * @param {string} sql
 * @param {Dialect} dialect
 * @returns {Token[]}
 */
export function tokenize(sql, dialect) {
  /** @type {Token[]} */
  const tokens = [];
  const n = sql.length;
  let delimiter = ";";
  /** Whether nothing but space and comments came since the last statement ended (MySQL). */
  let fresh = true;
  let i = 0;
  const push = (
    /** @type {TokenType} */ type,
    /** @type {number} */ end,
    text = sql.slice(i, end),
  ) => {
    tokens.push({ type, text, start: i, end });
    if (type !== "space" && type !== "comment") fresh = type === "end" || type === "delimiter";
    i = end;
  };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1] ?? "";
    if (dialect === "mysql" && fresh && atLineStart(sql, i)) {
      const match = MYSQL_DELIMITER.exec(sql.slice(i));
      if (match) {
        push("delimiter", i + match[0].length, match[1]);
        delimiter = match[1] ?? ";";
        continue;
      }
    }
    if (dialect === "mysql" ? sql.startsWith(delimiter, i) : c === ";") {
      push("end", i + (dialect === "mysql" ? delimiter.length : 1));
      continue;
    }
    if (/\s/u.test(c))
      push(
        "space",
        spanWhile(sql, i, (ch) => /\s/u.test(ch)),
      );
    else if (c === "-" && next === "-" && (dialect !== "mysql" || mysqlDashComment(sql, i)))
      push("comment", lineEnd(sql, i));
    else if (c === "#" && dialect === "mysql") push("comment", lineEnd(sql, i));
    else if (c === "/" && next === "*") push("comment", blockEnd(sql, i, dialect === "postgresql"));
    else if (c === "'") push("string", quoteEnd(sql, i, "'", dialect === "mysql"));
    else if (c === '"')
      push(dialect === "mysql" ? "string" : "name", quoteEnd(sql, i, '"', dialect === "mysql"));
    else if (c === "`" && dialect !== "postgresql") push("name", quoteEnd(sql, i, "`", false));
    else if (c === "[" && dialect === "sqlite") push("name", closeAt(sql, i + 1, "]"));
    else if (c === "$" && dialect === "postgresql" && DOLLAR_TAG.test(sql.slice(i, i + 64))) {
      const tag = /** @type {RegExpExecArray} */ (DOLLAR_TAG.exec(sql.slice(i)))[0];
      const close = sql.indexOf(tag, i + tag.length);
      push("string", close < 0 ? n : close + tag.length);
    } else if (WORD_START.test(c)) {
      const end = wordEnd(sql, i, dialect === "mysql" ? delimiter : null);
      const word = sql.slice(i, end);
      const quote = sql[end];
      if (quote === "'" && /^(?:e|b|x|n|_\w+)$/iu.test(word)) {
        // A prefixed string: E'..' (backslash escapes), B'..', X'..', N'..', MySQL's _charset'..'.
        const escapes = dialect === "mysql" || word.toLowerCase() === "e";
        push("string", quoteEnd(sql, end, "'", escapes));
      } else if (word.toUpperCase() === "U" && sql.startsWith('&"', end)) {
        push("name", quoteEnd(sql, end + 1, '"', false));
      } else if (word.toUpperCase() === "U" && sql.startsWith("&'", end)) {
        push("string", quoteEnd(sql, end + 1, "'", false));
      } else push("word", end);
    } else if (DIGIT.test(c) || (c === "." && DIGIT.test(next)))
      push(
        "number",
        spanWhile(sql, i, (ch) => /[0-9A-Za-z_.]/u.test(ch)),
      );
    else if ((c === "$" && DIGIT.test(next)) || c === "?" || (c === ":" && WORD_START.test(next)))
      push("param", c === "?" ? i + 1 : spanWhile(sql, i + 1, (ch) => WORD_PART.test(ch)));
    else push("op", i + 1);
  }
  return tokens;
}

/** Whether only spaces or tabs stand between the line's start and `at`. */
function atLineStart(/** @type {string} */ sql, /** @type {number} */ at) {
  for (let j = at - 1; j >= 0; j--) {
    if (sql[j] === "\n") return true;
    if (sql[j] !== " " && sql[j] !== "\t") return false;
  }
  return true;
}

/** MySQL's `--` starts a comment only when a space, a control character or the end follows. */
function mysqlDashComment(/** @type {string} */ sql, /** @type {number} */ at) {
  const after = sql[at + 2];
  return after === undefined || after <= " ";
}

/** @param {string} sql @param {number} from @param {(ch: string) => boolean} test */
function spanWhile(sql, from, test) {
  let j = from;
  while (j < sql.length && test(/** @type {string} */ (sql[j]))) j++;
  return j;
}

function lineEnd(/** @type {string} */ sql, /** @type {number} */ from) {
  const nl = sql.indexOf("\n", from);
  return nl < 0 ? sql.length : nl;
}

/** The end of a block comment; PostgreSQL nests them, an unclosed one runs to the end. */
function blockEnd(
  /** @type {string} */ sql,
  /** @type {number} */ from,
  /** @type {boolean} */ nests,
) {
  let depth = 0;
  let j = from;
  while (j < sql.length) {
    if (sql.startsWith("/*", j)) {
      depth = nests ? depth + 1 : 1;
      j += 2;
    } else if (sql.startsWith("*/", j)) {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else j++;
  }
  return sql.length;
}

/**
 * The end of a quoted run starting at `from`: a doubled quote stays inside, and with `escapes` a
 * backslash takes the next character along. An unclosed run goes to the end.
 * @param {string} sql
 * @param {number} from
 * @param {string} quote
 * @param {boolean} escapes
 */
function quoteEnd(sql, from, quote, escapes) {
  let j = from + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (escapes && ch === "\\") j += 2;
    else if (ch === quote && sql[j + 1] === quote) j += 2;
    else if (ch === quote) return j + 1;
    else j++;
  }
  return sql.length;
}

function closeAt(/** @type {string} */ sql, /** @type {number} */ from, /** @type {string} */ ch) {
  const at = sql.indexOf(ch, from);
  return at < 0 ? sql.length : at + 1;
}

/** A word ends where its characters do, or (MySQL) where the delimiter starts: `END//`, `END$$`. */
function wordEnd(
  /** @type {string} */ sql,
  /** @type {number} */ from,
  /** @type {string | null} */ delimiter,
) {
  let j = from + 1;
  while (j < sql.length && WORD_PART.test(/** @type {string} */ (sql[j]))) {
    if (delimiter && sql.startsWith(delimiter, j)) break;
    j++;
  }
  return j;
}

/** The words and quoted names of `tokens`, outside parentheses when `topLevel`, upper-cased. */
export function wordsOf(/** @type {Token[]} */ tokens, topLevel = false) {
  /** @type {string[]} */
  const words = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "op" && token.text === "(") depth++;
    else if (token.type === "op" && token.text === ")") depth = Math.max(0, depth - 1);
    else if (token.type === "word" && (!topLevel || depth === 0))
      words.push(token.text.toUpperCase());
  }
  return words;
}
