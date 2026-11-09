// psql's output as it is read in the result worker (#38): CSV as psql writes it (RFC 4180, a quoted
// field may hold newlines), and the text between the marker lines that end each statement. Pure
// functions, so each is tested on captured output.

/**
 * The records of CSV text. A record cut off at the end (an open quote, no final newline after a
 * stop) is dropped when `partial`.
 * @param {string} text
 * @param {boolean} [partial]
 * @returns {string[][]}
 */
export function readCsv(text, partial = false) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let record = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i++;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (c === "\r") i++;
    } else field += c;
    i++;
  }
  const open = quoted || field !== "" || record.length > 0;
  if (open && !partial) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * The text between marker lines: `markers` are the lines' regular expression with one capture for
 * the statement index (and more for what follows it). Returns the text before each marker, keyed by
 * index, its captures, and what came after the last one.
 * @param {string} text
 * @param {RegExp} marker A global, multiline expression matching a whole marker line.
 */
export function segments(text, marker) {
  /** @type {Map<number, { text: string, fields: string[] }>} */
  const before = new Map();
  let from = 0;
  for (const match of text.matchAll(marker)) {
    const index = Number(match[1]);
    before.set(index, { text: text.slice(from, match.index), fields: match.slice(2) });
    from = (match.index ?? 0) + match[0].length;
    if (text[from] === "\n") from++;
  }
  return { before, rest: text.slice(from) };
}
