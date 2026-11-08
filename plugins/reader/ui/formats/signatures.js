// The first bytes that name the files the reader hands to endue.formats: RAR 4 and 5 and 7z
// archives (CBR and CB7 comics) and DjVu documents.
import { ascii } from "./bytes.js";

const isRar = (/** @type {Uint8Array} */ b) => ascii(b, 0, 6) === "Rar!\x1a\x07";
export const rarVersion = (/** @type {Uint8Array} */ b) => (isRar(b) ? (b[6] === 1 ? 5 : 4) : 0);
export const is7z = (/** @type {Uint8Array} */ b) => ascii(b, 0, 6) === "7z\xbc\xaf\x27\x1c";
export const isDjvu = (/** @type {Uint8Array} */ b) => ascii(b, 0, 8) === "AT&TFORM";
