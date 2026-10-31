// Deflate, zlib and gzip through the platform's DecompressionStream: the compressed bytes go in as
// they are pulled, the decoded bytes come out as the stream gives them.
import { damaged, endsEarly } from "./input.js";

/** @typedef {import("./input.js").Input} Input */

/**
 * @param {"deflate-raw" | "deflate" | "gzip"} format
 * @param {string} codec the name errors carry
 * @param {Input} input
 */
async function* platform(format, codec, input) {
  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let stop = false;
  // Fed alongside the reads below; its own failures surface as the reader's error.
  const feeding = (async () => {
    while (!stop && (await input.need(1))) await writer.write(input.take(input.available).slice());
    if (!stop) await writer.close();
  })().catch(() => {});
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length) yield value;
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw /unexpected end|truncat|incomplete|premature/i.test(why)
      ? endsEarly(codec)
      : damaged(codec, "the compressed data does not decode");
  } finally {
    stop = true;
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    await feeding;
  }
}

/** Raw deflate (ZIP's method 8, MSZIP blocks). @param {Input} input */
export const inflateRaw = (input) => platform("deflate-raw", "Deflate", input);
/** zlib (deflate with its two-byte header and Adler-32), as xar uses it. @param {Input} input */
export const inflateZlib = (input) => platform("deflate", "zlib", input);
/** A gzip file, its CRC-32 and size checked by the platform. @param {Input} input */
export const gunzip = (input) => platform("gzip", "gzip", input);
