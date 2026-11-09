// What a run's plan and its reading share, and the counters that see rows arrive before the client
// ends: the newline counter that knows when a newline sits inside a quote, the mysql client's row
// counter, the random marker. Reading the output itself is the result worker's (ui/output/, #38).
// Pure functions, so each is tested on captured output.

/**
 * Counts the lines a stream has ended so far, skipping newlines inside the quote character's runs.
 * `feed` takes the next chunk of text and answers the count so far.
 * @param {string} quote `"` for CSV, `'` for SQLite's quote mode.
 */
export function lineCounter(quote) {
  let inside = false;
  let lines = 0;
  return {
    feed(/** @type {string} */ chunk) {
      for (const c of chunk) {
        if (c === quote) inside = !inside;
        else if (c === "\n" && !inside) lines++;
      }
      return lines;
    },
  };
}

/** Counts `<row>` elements, which the mysql client's XML never prints inside a value. */
export function rowCounter() {
  let carry = "";
  let rows = 0;
  return {
    feed(/** @type {string} */ chunk) {
      const text = carry + chunk;
      // `<row>` is five characters, so the four kept for the next chunk never hold a whole one.
      rows += text.split("<row>").length - 1;
      carry = text.slice(-4);
      return rows;
    },
  };
}

/** A random marker no data can hold by chance: twelve characters from a-z0-9. */
export function nonce(/** @type {() => number} */ random = Math.random) {
  let out = "";
  while (out.length < 12) out += Math.floor(random() * 36).toString(36);
  return out;
}

/** The marker that ends each statement's output, in every engine's plan and its reading. */
export const markOf = (/** @type {string} */ nonce) => `@@endue:${nonce}:`;
/** psql's text for NULL, so NULL stays apart from ''. */
export const nullOf = (/** @type {string} */ nonce) => `@@null:${nonce}`;

/** Escape a string for use inside a regular expression. */
export const escapeRegExp = (/** @type {string} */ text) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
