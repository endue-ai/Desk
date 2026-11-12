// The compositor owns the keyboard focus (#56), and a press on a plugin surface gives it that
// surface. The runtime moves the focus too (opening a window, Ctrl+Tab, the which-key overlay taking
// it for a prefix and giving it back), by focusing a surface's place here (ADR 0160), where the
// compositor draws the surface's own browser. So this page tells the CEF shell, whenever its focus
// settles, which surface's place has it, or whether an element of its own does (a field, a button):
// the keys go there. When neither does, the focus rests on nothing of the page's own (its body, a
// window's section) and the keys follow the window in use (ADR 0192).
//
// What is typed after a press on the page, or after a key the desk ran, waits in the compositor
// until this page answers it (`crates/desk-compositor/src/input/hold.rs`): the talk pill opens its
// line, ⌘K opens the palette, and only then do the keys know where to go.

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

/** The reporter `startCompositorFocus` starts. */
export interface CompositorFocus {
  /** A key the desk ran (`done` settles when its command has): answer it once its command moved
   * the focus, or settled without moving it. */
  ran(done: Promise<unknown>): void;
  stop(): void;
}

/**
 * Report the page's focus when it changes, at the end of the task that moved it (the focus leaves
 * one element before it reaches the next), and answer each press on the page once its release is
 * handled (the talk pill's click opens and focuses its line) and each key the desk ran. Nothing is
 * said while the window is in the background: its focus did not move, the app's did. `answer`
 * marks an answer, said even when nothing moved.
 */
export function startCompositorFocus(
  win: Window,
  send: (focus: PageFocus, answer: boolean) => void,
): CompositorFocus {
  let last: PageFocus | undefined;
  let stopped = false;
  let queued = false;
  let released: ReturnType<typeof setTimeout> | undefined;
  /** Keys the desk ran whose answer is still to come. */
  let keys = 0;
  const tell = (answer: boolean) => {
    if (stopped || !win.document.hasFocus()) return;
    const now = pageFocus(win.document);
    if (!answer && now.surface === last?.surface && now.own === last.own) return;
    last = now;
    send(now, answer);
  };
  const moved = (event: Event) => {
    // On its way to another element: that one's focusin says where it landed.
    if (event.type === "focusout" && (event as FocusEvent).relatedTarget) return;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      // A key the desk ran that moved the focus (⌘K and the palette's place) is answered by it.
      const answer = keys > 0;
      keys = 0;
      tell(answer);
    });
  };
  // After the whole release (pointerup, then the click it makes), so what the click did counts.
  const pressed = () => {
    if (released !== undefined) return;
    released = setTimeout(() => {
      released = undefined;
      tell(true);
    }, 0);
  };
  win.addEventListener("focusin", moved, true);
  win.addEventListener("focusout", moved, true);
  win.addEventListener("blur", moved);
  win.addEventListener("pointerup", pressed, true);
  win.addEventListener("pointercancel", pressed, true);
  return {
    ran(done) {
      keys += 1;
      const settled = () => {
        if (keys === 0) return;
        keys = 0;
        queueMicrotask(() => tell(true));
      };
      void done.then(settled, settled);
    },
    stop() {
      stopped = true;
      if (released !== undefined) clearTimeout(released);
      win.removeEventListener("focusin", moved, true);
      win.removeEventListener("focusout", moved, true);
      win.removeEventListener("blur", moved);
      win.removeEventListener("pointerup", pressed, true);
      win.removeEventListener("pointercancel", pressed, true);
    },
  };
}
