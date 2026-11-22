// The stream between a copy's two sessions (PG-63): the source's COPY ... TO STDOUT writes into the
// pipe's sink (copy/stream.js) and the target's COPY ... FROM STDIN reads from its source. It holds
// one chunk: a write waits until the reader took the one before, so neither side holds more than
// that whatever the table's size. The end of the source ends the reader; a failure on either side,
// or the run's cancel, fails the other's next wait. A page of the COPY out may pass 1 MiB a little
// (it ends after a row), and db.copy takes 1 MiB at most: such a chunk goes on in pieces, cut on a
// character's edge. No DOM.

import { COPY_CHUNK } from "../copy/index.js";

/**
 * @typedef {import("../copy/stream.js").Chunk} Chunk
 * @typedef {import("../copy/stream.js").Sink} Sink
 * @typedef {import("../copy/stream.js").Source} Source
 */

/**
 * A chunk as pieces of COPY_CHUNK bytes at most (`most` in tests).
 * @param {Chunk} chunk
 * @returns {Chunk[]}
 */
export function piecesOf(chunk, most = COPY_CHUNK) {
  if (chunk.bytes <= most) return [chunk];
  if (chunk.encoding === "base64") {
    const step = Math.floor(most / 3) * 4;
    const parts = [];
    for (let at = 0; at < chunk.data.length; at += step) {
      const data = chunk.data.slice(at, at + step);
      const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
      parts.push({ data, encoding: chunk.encoding, bytes: (data.length / 4) * 3 - padding });
    }
    return parts;
  }
  const bytes = new TextEncoder().encode(chunk.data);
  const decoder = new TextDecoder();
  const parts = [];
  for (let at = 0; at < bytes.length; ) {
    let end = Math.min(at + most, bytes.length);
    // Back off to the first byte of a character.
    while (end < bytes.length && end > at && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    parts.push({
      data: decoder.decode(bytes.subarray(at, end)),
      encoding: chunk.encoding,
      bytes: end - at,
    });
    at = end;
  }
  return parts;
}

/**
 * A pipe of one chunk.
 * @param {AbortSignal} [signal] fails both sides once it aborts
 * @returns {{ sink: Sink, source: Source, fail(error: Error): void }}
 */
export function createPipe(signal) {
  /** @type {Chunk | undefined} */
  let held;
  let ended = false;
  /** @type {Error | undefined} */
  let failed;
  /** Whoever waits for the other side. @type {(() => void) | undefined} */
  let wake;
  const nudge = () => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };
  const wait = () =>
    new Promise((resolve) => {
      wake = () => resolve(undefined);
    });
  const fail = (/** @type {Error} */ error) => {
    failed ??= error;
    nudge();
  };
  const cancelled = () => fail(new Error("Cancelled."));
  if (signal?.aborted) cancelled();
  else signal?.addEventListener("abort", cancelled, { once: true });

  return {
    fail,
    sink: {
      async write(chunk) {
        for (const piece of piecesOf(chunk)) {
          while (held && !failed) await wait();
          if (failed) throw failed;
          held = piece;
          nudge();
        }
      },
      async close() {
        while (held && !failed) await wait();
        if (failed) throw failed;
        ended = true;
        nudge();
      },
    },
    source: {
      async read() {
        while (!held && !ended && !failed) await wait();
        if (failed) throw failed;
        const chunk = held;
        held = undefined;
        nudge();
        return chunk;
      },
    },
  };
}
