// tar archives (CBT): ustar and old-style headers, GNU long names and pax path records.
import { Unreadable } from "./errors.js";

/** @typedef {{ names: string[], has(name: string): boolean, read(name: string): Uint8Array }} Tar */

const field = (
  /** @type {Uint8Array} */ block,
  /** @type {number} */ at,
  /** @type {number} */ length,
) => {
  const raw = block.subarray(at, at + length);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end));
};

const octal = (/** @type {string} */ text) => Number.parseInt(text.trim() || "0", 8);

/** Whether a 512-byte block is a tar header: its checksum adds up. */
export function isTar(/** @type {Uint8Array} */ bytes) {
  if (bytes.length < 512) return false;
  const stored = octal(field(bytes, 148, 8));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (bytes[i] ?? 0);
  return stored === sum && sum !== 0x20 * 8;
}

/** @param {Uint8Array} bytes @returns {Tar} */
export function readTar(bytes) {
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  let longName = "";
  for (let at = 0; at + 512 <= bytes.length; ) {
    const block = bytes.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    if (!isTar(block))
      throw new Unreadable("The archive is damaged: a tar header does not add up.");
    const size = octal(field(block, 124, 12));
    const type = String.fromCharCode(block[156] ?? 0);
    const prefix = field(block, 257, 6).startsWith("ustar") ? field(block, 345, 155) : "";
    const body = bytes.subarray(at + 512, at + 512 + size);
    let name = longName || (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100));
    longName = "";
    if (type === "L") longName = field(body, 0, body.length);
    else if (type === "x") {
      const path = /\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body));
      if (path?.[1]) longName = path[1];
    } else if (type === "0" || type === "\0" || type === "7") {
      name = name.replace(/^\.\//, "");
      files.set(name, body);
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return {
    names: [...files.keys()],
    has: (name) => files.has(name),
    read: (name) => {
      const found = files.get(name);
      if (!found) throw new Unreadable(`The archive has no ${name}.`);
      return found;
    },
  };
}
