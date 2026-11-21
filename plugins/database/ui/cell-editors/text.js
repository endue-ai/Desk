// Text (PG-40): any value, as typed. The grid edits it in its own field over the cell (view-cell.js);
// this is its check, for the value viewer and an array's text elements.

export const text = {
  check: (/** @type {string} */ value) => ({ value }),
};
