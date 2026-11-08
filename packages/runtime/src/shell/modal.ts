/** Keep a modal's keyboard focus inside it, and restore its caller when it closes. */
export function containModal(
  panel: HTMLElement,
  close: () => void,
  fallback: HTMLElement,
): () => void {
  const doc = panel.ownerDocument;
  const previous = doc.activeElement;
  const inert = new Map<HTMLElement, boolean>();
  // Disable siblings up to the shell root: the dialog lives inside the system layer.
  for (
    let branch: HTMLElement | null = panel;
    branch?.parentElement;
    branch = branch.parentElement
  ) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      inert.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    if (branch.parentElement.classList.contains("shell")) break;
  }
  const key = (event: KeyboardEvent) => {
    // Shell shortcuts must not act on windows behind the modal. Native editing still works.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const controls = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => !el.closest("[hidden], [inert]") && el.getClientRects().length > 0);
      event.preventDefault();
      if (!controls.length) return;
      const at = controls.indexOf(doc.activeElement as HTMLElement);
      const next = (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
    }
  };
  panel.addEventListener("keydown", key);
  return () => {
    panel.removeEventListener("keydown", key);
    for (const [el, wasInert] of inert) el.inert = wasInert;
    const target =
      previous instanceof HTMLElement && previous !== doc.body && previous.isConnected
        ? previous
        : fallback;
    if (target.isConnected) target.focus();
  };
}
