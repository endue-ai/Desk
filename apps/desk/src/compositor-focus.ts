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

/** The start of a window's own page's surface id (`web_host/window_pages.rs`, ADR 0201). */
export const WINDOW_PAGE = "window:";

/**
 * Where the focus rests in window `id`'s own page (ADR 0201): a surface's place there gives that
 * surface the keys, an element of the window's own gives them to the window's page, and nothing
 * of its own leaves them with the window in use.
 */
export function windowPageFocus(doc: Document, id: string): PageFocus {
  const surface = focusedSurface(doc);
  if (surface) return { surface, own: false };
  const own = pageFocus(doc).own;
  return { surface: own ? WINDOW_PAGE + id : null, own: false };
}

/** The reporter `startCompositorFocus` starts. */
export interface CompositorFocus {
  /** A key the desk ran (`done` settles when its command has): answer it once its command moved
   * the focus, or settled without moving it. */
  ran(done: Promise<unknown>): void;
  /** Report the focus of window `id`'s own page `page` as well, and answer presses there; the stop. */
  watch(page: Window, id: string): () => void;
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
  /** The document the focus moved in last: the page's, or a window's own page's (ADR 0201). */
  type From = { doc: Document; window?: string };
  const page: From = { doc: win.document };
  let current: From = page;
  const tell = (answer: boolean) => {
    // A window's own page has the engine's focus while it has the keys, the page then has not.
    if (stopped || (current.window === undefined && !win.document.hasFocus())) return;
    const now =
      current.window === undefined
        ? pageFocus(current.doc)
        : windowPageFocus(current.doc, current.window);
    if (!answer && now.surface === last?.surface && now.own === last.own) return;
    last = now;
    send(now, answer);
  };
  const moved = (event: Event, from: From = page) => {
    // On its way to another element: that one's focusin says where it landed.
    if (event.type === "focusout" && (event as FocusEvent).relatedTarget) return;
    // Where the focus lands says which page has it: another page's blur, as the focus leaves it
    // for this one (`window-pages.ts` keeps one focus), never does.
    if (event.type === "focusin") current = from;
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
  const pressed = (from: From = page) => {
    current = from;
    if (released !== undefined) return;
    released = setTimeout(() => {
      released = undefined;
      tell(true);
    }, 0);
  };
  /** Hear `target`'s focus moves and presses as coming from `from`; the stop. */
  const hear = (target: Window, from: From) => {
    const move = (event: Event) => moved(event, from);
    const press = () => pressed(from);
    target.addEventListener("focusin", move, true);
    target.addEventListener("focusout", move, true);
    target.addEventListener("blur", move);
    target.addEventListener("pointerup", press, true);
    target.addEventListener("pointercancel", press, true);
    return () => {
      target.removeEventListener("focusin", move, true);
      target.removeEventListener("focusout", move, true);
      target.removeEventListener("blur", move);
      target.removeEventListener("pointerup", press, true);
      target.removeEventListener("pointercancel", press, true);
    };
  };
  const offPage = hear(win, page);
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
    watch(own, id) {
      const from: From = { doc: own.document, window: id };
      const off = hear(own, from);
      return () => {
        off();
        if (current === from) current = page;
      };
    },
    stop() {
      stopped = true;
      if (released !== undefined) clearTimeout(released);
      offPage();
    },
  };
}
