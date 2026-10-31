// The window both decoders keep as a ring: blocks unwrapped for filters, and the decoded bytes
// sent to the sink as they become final.

/** @typedef {import("./sink.js").Sink} Sink */

/** A block of the ring from stream position `start`, unwrapped. @param {Uint8Array} win @param {number} start @param {number} length */
export function unwrap(win, start, length) {
  const size = win.length;
  const at = start % size;
  const out = new Uint8Array(length);
  if (at + length <= size) out.set(win.subarray(at, at + length));
  else {
    out.set(win.subarray(at));
    out.set(win.subarray(0, length - (size - at)), size - at);
  }
  return out;
}

/** Sends the ring's bytes from stream position `from` to `to`. @param {Uint8Array} win @param {number} from @param {number} to @param {Sink} sink */
export function emit(win, from, to, sink) {
  const size = win.length;
  let at = from % size;
  for (let n = to - from; n > 0; ) {
    const take = Math.min(n, size - at);
    sink.write(win.subarray(at, at + take));
    n -= take;
    at = 0;
  }
}
