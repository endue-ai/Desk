// Asking the person through the desk's palette: a pick from items (or a free answer), and a Yes or
// No with the reasons under Yes. A cancelled pick is no answer; a palette that is off says so.
// No DOM.

import { codeOf } from "./answer.js";

/**
 * @typedef {{ id: string, label: string, detail?: string }} Item
 * @typedef {(title: string, items: Item[], free?: boolean, placeholder?: string) => Promise<string | undefined>} Pick
 */

/** @param {{ run(id: string, args?: unknown): Promise<unknown> }} commands */
export function createAsk(commands) {
  /** @type {Pick} */
  const pick = async (title, items, free = false, placeholder = "") => {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" && picked !== "" ? picked : undefined;
    } catch (error) {
      if (codeOf(error) === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  };
  const confirm = async (/** @type {string} */ title, /** @type {string[]} */ reasons) => {
    const [first, ...rest] = reasons;
    const items = [
      { id: "yes", label: "Yes", ...(first ? { detail: first } : {}) },
      ...rest.map((reason, i) => ({ id: `why-${i}`, label: reason })),
      { id: "no", label: "No" },
    ];
    return (await pick(title, items)) === "yes";
  };
  return { pick, confirm };
}
