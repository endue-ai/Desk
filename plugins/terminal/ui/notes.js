// The lines over the bottom of a terminal's pane (view.js): a question (a paste of several lines,
// paste.js) or a state (the program ended), with its buttons.

/** @typedef {{ pane: HTMLElement, note: HTMLElement | null, term: { focus(): void } }} Item */

/** @param {Document} doc */
export function createNotes(doc) {
  /** A line of question or state over the bottom of a pane, with its buttons. */
  const note = (
    /** @type {Item} */ item,
    /** @type {string} */ text,
    /** @type {Array<[string, boolean, () => void]>} */ buttons,
  ) => {
    item.note?.remove();
    const bar = doc.createElement("div");
    bar.className = "pane-note";
    bar.setAttribute("role", "status");
    const words = doc.createElement("span");
    words.textContent = text;
    bar.append(words);
    for (const [label, primary, run] of buttons) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "desk-btn";
      if (primary) button.classList.add("desk-btn-primary");
      button.textContent = label;
      button.addEventListener("click", run);
      bar.append(button);
    }
    item.pane.append(bar);
    item.note = bar;
    return bar;
  };
  const unnote = (/** @type {Item} */ item) => {
    item.note?.remove();
    item.note = null;
  };

  /** Several lines into a program that does not bracket pastes: paste them, or not. */
  const ask = (/** @type {Item} */ item, /** @type {number} */ lines) =>
    new Promise((resolve) => {
      const answer = (/** @type {boolean} */ yes) => {
        unnote(item);
        item.term.focus();
        resolve(yes);
      };
      const bar = note(item, `Paste ${lines} lines? Each one runs as it arrives.`, [
        ["Paste", true, () => answer(true)],
        ["Cancel", false, () => answer(false)],
      ]);
      bar.addEventListener("keydown", (event) => {
        if (event.key === "Escape") answer(false);
      });
      bar.querySelector("button")?.focus();
    });

  return { note, unnote, ask };
}
