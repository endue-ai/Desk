// LZMA2: LZMA in chunks of at most 64 KiB packed and 2 MiB unpacked, each with its own header saying
// whether the dictionary, the state or the properties start over; uncompressed chunks in between.
import { damaged, endsEarly } from "../input.js";
import { END, LzmaDecoder, properties, Window } from "./decoder.js";
import { RangeDecoder } from "./range.js";

/** @typedef {import("../input.js").Input} Input */

/** The dictionary size LZMA2's one property byte names. @param {number} prop @param {string} codec */
export function dictionarySize(prop, codec) {
  if (prop > 40) throw damaged(codec, "the dictionary size is not valid");
  if (prop === 40) return 0xffffffff;
  return (2 | (prop & 1)) * 2 ** ((prop >>> 1) + 11);
}

/**
 * @param {Input} input
 * @param {{ dictProp: number, size?: number, codec?: string }} options `size`: the decoded size when known
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* lzma2Raw(input, { dictProp, size, codec = "LZMA2" }) {
  const dictSize = dictionarySize(dictProp, codec);
  const window = new Window(dictSize, size);
  const decoder = new LzmaDecoder(window, Math.max(4096, dictSize), codec);
  const rc = new RangeDecoder(input);
  let started = false;
  let haveProps = false;
  const byte = () => input.u8();
  const word = () => (input.u8() << 8) | input.u8();
  for (;;) {
    if (!(await input.need(1))) throw endsEarly(codec);
    const control = byte();
    if (control === 0) return;
    if (control === 1 || control === 2) {
      if (control === 1) {
        window.reset();
        started = true;
      } else if (!started) throw damaged(codec, "the first chunk does not reset the dictionary");
      if (!(await input.need(2))) throw endsEarly(codec);
      const length = word() + 1;
      if (!(await input.need(length))) throw endsEarly(codec);
      const data = input.take(length);
      for (let at = 0; at < length; ) {
        const step = Math.min(length - at, window.room());
        window.putAll(data.subarray(at, at + step));
        at += step;
        const chunk = window.flush();
        if (chunk) yield chunk;
      }
      continue;
    }
    if (control < 0x80) throw damaged(codec, "a chunk header is not valid");
    if (!(await input.need(4))) throw endsEarly(codec);
    const unpacked = (control & 0x1f) * 65536 + word() + 1;
    const packed = word() + 1;
    const reset = (control >>> 5) & 3;
    if (reset === 3) {
      window.reset();
      started = true;
    } else if (!started) throw damaged(codec, "the first chunk does not reset the dictionary");
    if (reset >= 2) {
      if (!(await input.need(1))) throw endsEarly(codec);
      const props = properties(byte(), codec);
      if (props.lc + props.lp > 4) throw damaged(codec, "the properties are not valid");
      decoder.setProps(props);
      haveProps = true;
    } else if (!haveProps) throw damaged(codec, "a chunk comes before any properties");
    if (reset >= 1) decoder.resetState();
    if (!(await input.need(packed))) throw endsEarly(codec);
    const start = input.offset;
    rc.init(codec);
    const end = window.total + unpacked;
    while (window.total < end) {
      const status = decoder.decode(rc, Math.min(end, window.total + window.room()), 0);
      if (status === END) throw damaged(codec, "a chunk holds an end marker");
      const chunk = window.flush();
      if (chunk) yield chunk;
      if (input.offset - start > packed) throw damaged(codec, "a chunk runs past its packed size");
    }
    if (decoder.rem) throw damaged(codec, "a match runs past its chunk");
    const used = input.offset - start;
    if (used > packed) throw damaged(codec, "a chunk runs past its packed size");
    if (used < packed) await input.skip(packed - used);
  }
}
