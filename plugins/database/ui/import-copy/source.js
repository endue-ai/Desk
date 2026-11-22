// The COPY sources of an import (PG-60): the file read in 1 MiB ranges (copy/files.js), each range
// handed to the import's reader (client.js), and its COPY lines handed out as chunks of 1 MiB at most,
// so no more than a chunk or two of the file is ever held. A batch or a segment is a source of its
// own over the same file, ending after its rows; one that is held keeps its lines (a segment of
// skip mode, sent again without a refused row: `replay`). Progress is the file's bytes read and the
// rows sent. No DOM.

import { COPY_CHUNK } from "../copy/index.js";

/**
 * @typedef {import("../copy/stream.js").Source} Source
 * @typedef {import("../copy/stream.js").Chunk} Chunk
 * @typedef {import("./client.js").Reader} Reader
 * @typedef {{ rows: number, bytes: number, total?: number }} Progress
 */

/** A chunk of UTF-8 text, split when one line was larger than a chunk. */
function* piecesOf(/** @type {string} */ text, /** @type {number} */ bytes) {
  if (bytes <= COPY_CHUNK) {
    yield { data: text, encoding: /** @type {const} */ ("utf8"), bytes };
    return;
  }
  // At most three bytes per UTF-16 unit, never cutting a surrogate pair.
  const step = Math.floor(COPY_CHUNK / 3);
  const encoder = new TextEncoder();
  for (let at = 0; at < text.length; ) {
    let end = Math.min(text.length, at + step);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    const data = text.slice(at, end);
    yield { data, encoding: /** @type {const} */ ("utf8"), bytes: encoder.encode(data).length };
    at = end;
  }
}

/** A file's chunk as base64, the reader's input. */
function base64Of(/** @type {Chunk} */ chunk) {
  if (chunk.encoding === "base64") return chunk.data;
  const bytes = new TextEncoder().encode(chunk.data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The file's rows as COPY sources, one batch after another.
 * @param {{ file: Source, reader: Reader, progress?(p: Progress): void }} input
 */
export function createRows({ file, reader, progress }) {
  let read = 0;
  let rows = 0;
  let eof = false;
  let finished = false;
  let hungry = false;
  /** @type {Chunk[]} */
  let pending = [];

  /** The reader's next turn: fed the file's next range when it has nothing ready. */
  const turn = async (/** @type {number} */ maxRows) => {
    /** @type {string | null | undefined} */
    let feed;
    if (hungry && !eof) {
      const chunk = await file.read();
      if (chunk) {
        read += chunk.bytes;
        feed = base64Of(chunk);
      } else {
        eof = true;
        feed = null;
      }
    } else if (hungry && eof) feed = null;
    return reader.turn({ ...(feed === undefined ? {} : { feed }), maxBytes: COPY_CHUNK, maxRows });
  };

  return {
    /** Every row of the file was handed out. */
    done: () => finished,
    /** Forget the rest of a chunk cut in pieces: a segment sent again sends its lines whole. */
    clear() {
      pending = [];
    },
    progress: () => ({
      rows,
      bytes: read,
      ...(file.size === undefined ? {} : { total: file.size }),
    }),
    /**
     * The next batch: `maxRows` rows at most (Infinity for the rest of the file); `held` gets the
     * batch's lines as they go.
     * @param {number} maxRows
     * @param {{ lines: string[], rows: number[] }} [held] the lines and the file's row number of each
     * @returns {Source}
     */
    batch(maxRows, held) {
      let taken = 0;
      return {
        ...(file.size === undefined ? {} : { size: file.size }),
        async read() {
          const next = pending.shift();
          if (next) return next;
          while (taken < maxRows && !finished) {
            const got = await turn(maxRows - taken);
            hungry = !got.ready;
            if (got.rows > 0) {
              if (held)
                got.text.split("\n").forEach((line, i, all) => {
                  if (i === all.length - 1) return;
                  held.lines.push(`${line}\n`);
                  held.rows.push(rows + i + 1);
                });
              taken += got.rows;
              rows += got.rows;
              progress?.({
                rows,
                bytes: read,
                ...(file.size === undefined ? {} : { total: file.size }),
              });
              pending = [...piecesOf(got.text, got.bytes)];
              return pending.shift();
            }
            if (got.ended && !got.ready) finished = true;
          }
          return undefined;
        },
      };
    },
  };
}

/**
 * A segment's held lines as a source again, in chunks of 1 MiB at most.
 * @param {string[]} lines
 * @returns {Source}
 */
export function replay(lines) {
  let at = 0;
  const encoder = new TextEncoder();
  /** @type {Chunk[]} */
  let pending = [];
  return {
    async read() {
      const next = pending.shift();
      if (next) return next;
      if (at >= lines.length) return undefined;
      let text = "";
      let bytes = 0;
      while (at < lines.length) {
        const line = /** @type {string} */ (lines[at]);
        const size = encoder.encode(line).length;
        if (text !== "" && bytes + size > COPY_CHUNK) break;
        text += line;
        bytes += size;
        at++;
      }
      pending = [...piecesOf(text, bytes)];
      return pending.shift();
    },
  };
}
