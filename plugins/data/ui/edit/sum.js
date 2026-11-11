// A fingerprint of a file's bytes, so edits kept across a sleep go back only on the file they were
// made on (keep.js, ADR 0176). The page computes it for the files it holds, the worker for the ones
// above 1 MiB, whose bytes move to it.

/** Two 32-bit hashes of the bytes (FNV-1a and djb2), as 16 hex digits. */
export function bytesSum(/** @type {Uint8Array} */ bytes) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    fnv = Math.imul(fnv ^ byte, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ byte) >>> 0;
  }
  return fnv.toString(16).padStart(8, "0") + djb.toString(16).padStart(8, "0");
}
