// The grid's side of following foreign keys (PG-41, ADR 0322): which columns of the result on
// screen are a key's, asked of the controller (`linksLoad`, features/links/) once per result, right
// after it is drawn, and drawn again when the answer comes; a later result's question wins over an
// earlier one's answer. No DOM.

/**
 * @typedef {{ columns: { col: number, title: string }[], referenced: boolean }} Links
 *   `col` is a result column, `title` what its link cells say; `referenced` whether keys point at
 *   the table.
 */

/**
 * @param {(action: string) => unknown} act
 * @param {() => void} changed The links of the result on screen arrived: draw again.
 */
export function createGridLinks(act, changed) {
  let key = "";
  let asked = 0;
  /** @type {Map<number, string>} */
  let titles = new Map();
  let referenced = false;

  return {
    /** A result is drawn under `next` (its grid key, "" for none): ask for its links once. */
    shown(/** @type {string} */ next) {
      if (next === key) return;
      key = next;
      titles = new Map();
      referenced = false;
      const id = ++asked;
      if (!next) return;
      // Asked once the drawing is done, and only if no other result was drawn meanwhile.
      queueMicrotask(() => {
        if (id !== asked) return;
        void Promise.resolve(act("linksLoad")).then(
          (got) => {
            const links = /** @type {Links | undefined} */ (got);
            if (id !== asked || !links) return;
            titles = new Map(links.columns.map((c) => [c.col, c.title]));
            referenced = links.referenced;
            if (titles.size) changed();
          },
          () => {},
        );
      });
    },
    /** The title of a result column's link cells, or undefined when it links nowhere. */
    title: (/** @type {number} */ col) => titles.get(col),
    /** Whether keys point at the result's table. */
    referenced: () => referenced,
  };
}
