// The opening's progress in the page's <desk-progress> (@endue-ai/ui): a labelled bar with the bytes
// read, then the reader's phase, and Cancel. The element itself waits 300 ms before it shows, so a
// quick opening shows nothing.

/**
 * @typedef {import("../docs.js").Progress} Progress
 * @param {Document} doc
 * @returns {(value: Progress | null) => void}
 */
export function createProgress(doc) {
  const bar = /** @type {(HTMLElement & Record<string, unknown>) | null} */ (
    doc.querySelector("desk-progress")
  );
  let cancel = () => {};
  bar?.addEventListener("desk-cancel", () => cancel());
  return (value) => {
    if (!bar) return;
    bar.hidden = value === null;
    if (!value) {
      cancel = () => {};
      return;
    }
    bar.label = value.label;
    bar.value = value.value;
    bar.max = value.max;
    bar.detail = value.detail;
    bar.cancelable = true;
    cancel = value.cancel;
  };
}
