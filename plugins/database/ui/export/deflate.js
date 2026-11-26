import { t } from "../strings/index.js";
// Compression as a stream (PG-64): gzip for a compressed export and raw deflate for a streamed
// .xlsx's sheet, through the platform's CompressionStream (no library). Each push answers what the
// compressor gave so far, so nothing holds more than a chunk or two. No DOM.

/**
 * @typedef {{ push(bytes: Uint8Array): Promise<Uint8Array[]>, end(): Promise<Uint8Array[]> }} Deflater
 */

/** Whether the platform compresses. */
export const canCompress = () => typeof CompressionStream !== "undefined";

/**
 * @param {"gzip" | "deflate-raw"} kind
 * @returns {Deflater}
 */
export function deflater(kind) {
  if (!canCompress()) throw new Error(t("export.deflate.exportThisDeskCannotCompress"));
  const stream = new CompressionStream(kind);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  /** @type {Uint8Array[]} */
  const got = [];
  const reading = (async () => {
    for (let next = await reader.read(); !next.done; next = await reader.read())
      got.push(next.value);
  })();
  return {
    async push(bytes) {
      if (bytes.length) await writer.write(bytes);
      return got.splice(0);
    },
    async end() {
      await writer.close();
      await reading;
      return got.splice(0);
    },
  };
}
