// When a copy asks first (#504): past 100,000 cells, or past 10,000,000 characters of text (about
// 10 MB), a copy to the clipboard says how much it holds and goes on only on Yes; a paste of that
// much stalls the app it lands in. A copy of cells is weighed before it is formatted, so a large
// one is not built only to be dropped; its text is weighed after. No DOM.

import { formatBytes, formatCount } from "./format.js";

export const COPY_LIMITS = Object.freeze({ cells: 100_000, characters: 10_000_000 });

/**
 * @typedef {{ cells?: number, characters?: number }} CopySize
 * @typedef {(title: string, reasons: string[]) => Promise<boolean>} Confirm
 */

/** Whether a copy of this size asks first. */
export const tooLarge = (/** @type {CopySize} */ size) =>
  (size.cells ?? 0) > COPY_LIMITS.cells || (size.characters ?? 0) > COPY_LIMITS.characters;

/** The question a large copy asks: its title and the line under Yes. */
export function copyQuestion(/** @type {CopySize} */ size) {
  const parts = [
    ...(size.cells !== undefined && size.cells > 1 ? [`${formatCount(size.cells)} cells`] : []),
    ...(size.characters !== undefined
      ? [`${formatCount(size.characters)} characters (about ${formatBytes(size.characters)})`]
      : []),
  ];
  const what = parts.join(", ") || "this much";
  return {
    title: `Copy ${what} to the clipboard?`,
    reasons: ["Pasting this much can stall the app it goes to."],
  };
}

/** Whether a copy of `size` may go on: at once when it is small, else the person's answer. */
export async function mayCopy(/** @type {Confirm} */ confirm, /** @type {CopySize} */ size) {
  if (!tooLarge(size)) return true;
  const { title, reasons } = copyQuestion(size);
  return confirm(title, reasons);
}
