// The table of contents every reader returns: a title, the unit it goes to (a page or a chapter),
// optionally an anchor in that chapter, and the entries under it.

/** @typedef {{ title: string, unit: number, anchor?: string, children: Toc[] }} Toc */

/**
 * Nest a flat list of entries by their depth (0 for the top level).
 * @param {Array<{ title: string, unit: number, anchor?: string, depth: number }>} flat
 * @returns {Toc[]}
 */
export function nest(flat) {
  /** @type {Toc[]} */
  const top = [];
  /** @type {Array<{ depth: number, children: Toc[] }>} */
  const stack = [{ depth: -1, children: top }];
  for (const { depth, ...entry } of flat) {
    while ((stack.at(-1)?.depth ?? -1) >= depth) stack.pop();
    /** @type {Toc} */
    const node = { ...entry, children: [] };
    (stack.at(-1)?.children ?? top).push(node);
    stack.push({ depth, children: node.children });
  }
  return top;
}
