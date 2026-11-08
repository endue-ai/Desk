// RAR 4's two halves for the reader: listing and a decoder.
import { Decoder4 } from "./lz.js";

export { list4 } from "./headers.js";

/** @param {number} size */
export const decodeRar4 = (size) => new Decoder4(size);
