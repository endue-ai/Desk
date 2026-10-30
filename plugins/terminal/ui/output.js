// What a terminal shows of its process: output chunks decoded as the bridge encodes them, the tail a
// reload replays, and the line that says how the program ended. No DOM.

/**
 * @typedef {import("@endue-ai/bridge").ProcExitData} ProcExitData
 * @typedef {{ data: string, encoding: "utf8" | "base64" }} Chunk
 * @typedef {{ chunks: Chunk[], kept: number }} Tail
 */

/** How much output a session keeps for a reload to replay. */
export const TAIL_BYTES = 32 * 1024;

const bytesOf = (/** @type {string} */ base64) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** A chunk as xterm takes it: text as it is, base64 as the bytes it stands for. */
export function decode(/** @type {Chunk} */ chunk) {
  return chunk.encoding === "base64" ? bytesOf(chunk.data) : chunk.data;
}

/** @returns {Tail} */
export function tailOf(/** @type {Chunk[]} */ chunks = []) {
  return { chunks, kept: chunks.reduce((sum, chunk) => sum + chunk.data.length, 0) };
}

/** Keep `chunk`, letting the oldest go once the tail is over its size. */
export function keep(/** @type {Tail} */ tail, /** @type {Chunk} */ chunk) {
  tail.chunks.push(chunk);
  tail.kept += chunk.data.length;
  while (tail.kept > TAIL_BYTES && tail.chunks.length > 1) {
    tail.kept -= tail.chunks.shift()?.data.length ?? 0;
  }
}

/** The line a terminal shows when its program ends. */
export function exitLine(/** @type {string} */ title, /** @type {ProcExitData} */ exit) {
  const how =
    exit.signal !== undefined
      ? `was ended by signal ${exit.signal}`
      : exit.code !== undefined
        ? `exited with code ${exit.code}`
        : "ended";
  return `${title} ${how}. Press Enter to start it again.`;
}
