// Skip mode's reject file (PG-60): a CSV whose header is `row`, `reason` and the COPY's columns, and
// one line per row the server refused: the file's row number (the header line not counted), the
// server's reason, and the row's values as they were sent (NULL as an empty unquoted field). Lines
// wait in memory until the segment ends, then go to the file (fs.write `append`, ADR 0356). No DOM.

/**
 * @typedef {import("../copy/stream.js").Sink} Sink
 */

const UNESCAPE = /** @type {Record<string, string>} */ ({ t: "\t", n: "\n", r: "\r", "\\": "\\" });

/** A value as one CSV field: quoted when it holds a comma, a quote or a line break. */
const field = (/** @type {string} */ v) =>
  /[",\r\n]/u.test(v) ? `"${v.replaceAll('"', '""')}"` : v;

/** A COPY text line's values, NULL as null. */
export function valuesOf(/** @type {string} */ line) {
  return line
    .replace(/\n$/u, "")
    .split("\t")
    .map((v) => (v === "\\N" ? null : v.replace(/\\(.)/gu, (_, c) => UNESCAPE[c] ?? c)));
}

/**
 * @param {Sink} sink
 * @param {string[]} columns
 */
export function createRejects(sink, columns) {
  let text = `${["row", "reason", ...columns].map(field).join(",")}\n`;
  let count = 0;
  return {
    count: () => count,
    write(/** @type {number} */ row, /** @type {string} */ reason, /** @type {string} */ line) {
      count++;
      const values = valuesOf(line).map((v) => (v === null ? "" : field(v)));
      text += `${[String(row), field(reason), ...values].join(",")}\n`;
    },
    async flush() {
      if (text === "") return;
      const data = text;
      text = "";
      await sink.write({ data, encoding: "utf8", bytes: new TextEncoder().encode(data).length });
    },
  };
}
