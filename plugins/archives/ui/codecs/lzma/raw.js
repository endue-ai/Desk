// Raw LZMA (as 7z and ZIP's method 14 store it), and the .lzma ("LZMA alone") file around it.
import { u32 } from "../../bytes.js";
import { damaged, endsEarly } from "../input.js";
import { END, LzmaDecoder, properties, Window } from "./decoder.js";
import { RangeDecoder } from "./range.js";

/** @typedef {import("../input.js").Input} Input */

/** Input kept buffered ahead of a batch, and the least a batch may run on (one symbol reads fewer). */
const AHEAD = 1 << 16;
const MARGIN = 64;

/**
 * @param {Input} input
 * @param {{ props: Uint8Array, size?: number, endMarker?: boolean, codec?: string }} options
 *   `props`: the properties byte and the dictionary size; `size`: the decoded size, when known
 *   (the end marker is then optional); without it the stream must end with the marker
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* lzmaRaw(input, { props, size, codec = "LZMA" }) {
  if (props.length < 5) throw damaged(codec, "the properties are missing");
  const dictSize = u32(props, 1);
  const known = size !== undefined && size >= 0;
  const window = new Window(dictSize, known ? size : undefined);
  const decoder = new LzmaDecoder(window, Math.max(dictSize, 4096), codec);
  decoder.setProps(properties(/** @type {number} */ (props[0]), codec));
  decoder.resetState();
  if (known && size === 0) return;
  const rc = new RangeDecoder(input);
  if (!(await input.need(5))) throw endsEarly(codec);
  rc.init(codec);
  for (;;) {
    await input.need(AHEAD);
    const room = window.total + window.room();
    const status = decoder.decode(
      rc,
      known ? Math.min(/** @type {number} */ (size), room) : room,
      MARGIN,
    );
    const chunk = window.flush();
    if (chunk) yield chunk;
    if (status === END) {
      if (known && window.total !== size) throw damaged(codec, "it ends before its stated size");
      return;
    }
    if (known && window.total >= /** @type {number} */ (size)) return;
  }
}

/**
 * A .lzma file: the properties, the dictionary size and the decoded size (all ones when unknown),
 * then raw LZMA.
 * @param {Input} input
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* unlzma(input) {
  if (!(await input.need(13))) throw endsEarly("LZMA");
  const head = input.take(13).slice();
  if ((head[0] ?? 0) >= 225) throw damaged("LZMA", "the properties are not valid");
  const low = u32(head, 5);
  const high = u32(head, 9);
  const unknown = low === 0xffffffff && high === 0xffffffff;
  if (!unknown && high >= 0x200000) throw damaged("LZMA", "the stated size is not valid");
  const size = unknown ? undefined : high * 0x100000000 + low;
  yield* lzmaRaw(input, { props: head.subarray(0, 5), size, codec: "LZMA" });
}
