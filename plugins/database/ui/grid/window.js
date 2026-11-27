// The grid over a read its cursor keeps (PG-22, ADR 0352, rows/window.js): scrolled near the last
// row held, or the first, it asks for the next or previous page (the grid acts "page" with `rows`,
// once per window and way); when a page comes in and one is let go at the far end, the rows on
// screen and the cursor stay where they were. Not in the record view or under a typed filter.

import { askFor } from "../rows/window.js";
import { ROW } from "../view-grid-draw.js";

/** How many screens from an end of the rows held ask for the next page there. */
const NEAR = 2;

/**
 * @param {HTMLElement} scroller
 * @param {import("./screen.js").GridState} st
 * @param {(action: string, ...args: unknown[]) => unknown} act
 */
export function attachWindow(scroller, st, act) {
  let seen = { id: "", first: 0 };
  let asked = "";

  const look = () => {
    const set = st.tab?.set;
    const w = set?.window;
    if (!set || !w || st.record || st.text) return;
    const screen = Math.max(1, Math.ceil((scroller.clientHeight || 480) / ROW));
    const top = Math.floor(scroller.scrollTop / ROW);
    const near = screen * NEAR;
    const way =
      top + screen + near >= st.order.length && askFor(set, "next")
        ? "next"
        : top <= near && askFor(set, "back")
          ? "back"
          : undefined;
    if (!way) return;
    const key = `${w.id}:${w.first}:${set.rows.length}:${way}`;
    if (key === asked) return;
    asked = key;
    act("page", { rows: way });
  };
  scroller.addEventListener("scroll", look);

  return {
    /** Before the rows are drawn: a window that moved keeps the rows on screen in place. */
    follow() {
      const w = st.tab?.set?.window;
      if (!w) {
        seen = { id: "", first: 0 };
        return;
      }
      const by = w.id === seen.id ? w.first - seen.first : 0;
      if (by !== 0) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - by * ROW);
        st.cursor = { ...st.cursor, row: Math.max(0, st.cursor.row - by) };
        st.anchor = { ...st.anchor, row: Math.max(0, st.anchor.row - by) };
      }
      seen = { id: w.id, first: w.first };
      setTimeout(look, 0);
    },
  };
}
