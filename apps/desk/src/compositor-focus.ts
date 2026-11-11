// The compositor owns the keyboard focus (#56), and a press on a plugin surface gives it that
// surface. The runtime moves the focus too (opening a window, Ctrl+Tab, the which-key overlay taking
// it for a prefix and giving it back), by focusing a surface's place here (ADR 0160), where the
// compositor draws the surface's own browser. So this page tells the CEF shell, whenever its focus
// settles, which surface's place has it, or whether an element of its own does (a field, a button):
// the keys go there. When neither does, the focus rests on nothing of the page's own (its body, a
// window's section) and the keys follow the window in use (ADR XXXX).

/** The surface host whose place has the page's focus; null when the page itself has it. */
export function focusedSurface(doc: Document): string | null {
  const place = doc.activeElement?.closest<HTMLElement>("[data-surface-host]");
  return place?.dataset.surfaceHost || null;
}

/** Where the page's focus rests, as the compositor hears it. */
export interface PageFocus {
  /** The surface host whose place has it. */
  surface: string | null;
  /** An element of the page's own has it: the keys stay on the page. */
  own: boolean;
}

/** Where the page's focus rests now: a place, an element of its own, or nothing of its own. */
export function pageFocus(doc: Document): PageFocus {
  const surface = focusedSurface(doc);
  const active = doc.activeElement;
  const rest =
    !active ||
    active === doc.body ||
    active === doc.documentElement ||
    active.matches("[data-surface]");
  return { surface, own: surface === null && !rest };
}

/**
 * Report the page's focus when it changes, after a focus move settles (the focus leaves one
 * element before it reaches the next); returns the function that stops. Nothing is said while the
 * window is in the background: its focus did not move, the app's did.
 */
export function startCompositorFocus(win: Window, send: (focus: PageFocus) => void): () => void {
  let last: PageFocus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tell = () => {
    timer = undefined;
    if (!win.document.hasFocus()) return;
    const now = pageFocus(win.document);
    if (now.surface === last?.surface && now.own === last.own) return;
    last = now;
    send(now);
  };
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(tell, 0);
  };
  win.addEventListener("focusin", schedule, true);
  win.addEventListener("focusout", schedule, true);
  win.addEventListener("blur", schedule);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    win.removeEventListener("focusin", schedule, true);
    win.removeEventListener("focusout", schedule, true);
    win.removeEventListener("blur", schedule);
  };
}
