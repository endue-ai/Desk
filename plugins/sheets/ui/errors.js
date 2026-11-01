import { detect, formatOf, withArticle } from "./detect.js";
/** @typedef {import("./book.js").Details} Details */
/** @typedef {(reason: string, cause?: string) => Details} Say */
export const ENCRYPTED = "This workbook is encrypted.";
export const NO_WORKBOOK = "This ZIP archive holds no workbook.";
export const OLD_NUMBERS =
  "This is a Numbers document from 2009 or earlier, which Sheets cannot read.";
/** @param {Uint8Array} bytes @param {string} name @returns {Say} */
export const sayer = (bytes, name) => (reason, cause) => ({
  kind: "details",
  format: formatOf(name),
  detected: detect(bytes),
  reason,
  ...(cause ? { cause } : {}),
});

/**
 * The details view for an error the parser threw.
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {unknown} error
 * @returns {Details}
 */
export function failure(bytes, name, error) {
  const say = sayer(bytes, name);
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypt/iu.test(message)) return say(ENCRYPTED);
  if (/NUMBERS 0[89]/u.test(message)) return say(OLD_NUMBERS);
  if (/Could not find workbook|Unsupported ZIP file/u.test(message)) return say(NO_WORKBOOK);
  return say(damaged(name), message);
}

export const damaged = (/** @type {string} */ name) =>
  `This file is damaged or is not ${withArticle(formatOf(name))}.`;
