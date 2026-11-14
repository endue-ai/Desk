// The Browser's DOM: the toolbar, and #page, the box the desk draws the web page over. The page
// itself is never in this document.

/**
 * @param {Document} doc
 * @param {{ go(typed: string): void, back(): void, forward(): void, reload(): void, stop(): void,
 *   resized(): void }} on
 */
export function createView(doc, on) {
  const el = (id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const back = /** @type {HTMLButtonElement} */ (el("back"));
  const forward = /** @type {HTMLButtonElement} */ (el("forward"));
  const reload = /** @type {HTMLButtonElement} */ (el("reload"));
  const address = /** @type {HTMLInputElement} */ (el("address"));
  const page = el("page");
  const note = el("note");
  let loading = false;
  /** What the page shows, put back when the person leaves the field without entering. */
  let shown = "";

  back.addEventListener("click", () => on.back());
  forward.addEventListener("click", () => on.forward());
  reload.addEventListener("click", () => (loading ? on.stop() : on.reload()));
  address.addEventListener("focus", () => address.select());
  // No form: a plugin's frame is sandboxed without allow-forms, so nothing would be submitted.
  address.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      // The page takes over: the field shows what the page loads, not what was typed.
      const typed = address.value;
      address.blur();
      on.go(typed);
    }
    if (event.key !== "Escape") return;
    address.value = shown;
    address.select();
  });
  const view = doc.defaultView;
  if (view && "ResizeObserver" in view) new view.ResizeObserver(() => on.resized()).observe(page);
  view?.addEventListener("resize", () => on.resized());

  return {
    /** @param {{ url: string, loading: boolean, canGoBack: boolean, canGoForward: boolean }} state */
    shows(state) {
      loading = state.loading;
      back.disabled = !state.canGoBack;
      forward.disabled = !state.canGoForward;
      reload.textContent = loading ? "×" : "↻";
      const label = loading ? "Stop" : "Load again";
      reload.title = label;
      reload.setAttribute("aria-label", label);
      // What the person is typing stays theirs until they enter or leave it.
      const typing = doc.activeElement === address && address.value !== shown;
      shown = state.url;
      if (!typing) address.value = state.url;
    },
    note(text) {
      note.textContent = text;
    },
    /** Where the page lies in this document, in whole CSS pixels. */
    box() {
      const r = page.getBoundingClientRect();
      const [x, y] = [Math.round(r.left), Math.round(r.top)];
      return { x, y, width: Math.round(r.right) - x, height: Math.round(r.bottom) - y };
    },
    focusAddress() {
      address.focus();
    },
  };
}
