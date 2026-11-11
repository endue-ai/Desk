// The way out of desk.universal's overlay, which covers the whole desk: a Close button at the top
// right that says Escape does the same, and a press on the empty margin beside a drawn view.

/**
 * @param {HTMLElement} root the page's root: the margin is its own area, outside every child
 * @param {{ close(): void, beside(): boolean }} hooks `beside`: whether a press beside closes now
 */
export function createLeave(root, hooks) {
  const doc = root.ownerDocument ?? document;
  const button = doc.createElement("button");
  button.className = "desk-btn leave";
  button.setAttribute("type", "button");
  button.setAttribute("aria-keyshortcuts", "Escape");
  button.setAttribute("aria-label", "Close (Escape)");
  const key = doc.createElement("kbd");
  key.textContent = "Esc";
  button.append("Close", key);
  button.addEventListener("click", () => hooks.close());
  // Only a press that starts and ends on the margin: a selection dragged out of a view is not one.
  let onMargin = false;
  root.addEventListener("pointerdown", (event) => {
    onMargin = event.target === root;
  });
  root.addEventListener("click", (event) => {
    const beside = onMargin && event.target === root;
    onMargin = false;
    if (beside && hooks.beside()) hooks.close();
  });
  root.prepend(button);
  return button;
}
