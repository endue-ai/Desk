// Compositor mode (#56): the compositor owns the keyboard focus, and a press on a plugin surface
// gives it that surface. The runtime moves the focus too (opening a window, Ctrl+Tab, the
// which-key overlay taking it for a prefix and giving it back), by focusing a frame here, which is
// the surface's stand-in. So this page tells the CEF shell, whenever its focus settles, which
// surface's stand-in has it, or none (the page's own element has it); the keys go there.
import { surfaceHostOf } from "./compositor-desk";

/** The surface host whose stand-in frame has the page's focus; null when the page itself has it. */
export function focusedSurface(doc: Document): string | null {
  const active = doc.activeElement;
  if (active?.tagName !== "IFRAME") return null;
  return surfaceHostOf((active as HTMLIFrameElement).src) ?? null;
}

/**
 * Report the page's focus when it changes, after a focus move settles (the focus leaves one
 * element before it reaches the next); returns the function that stops. Nothing is said while the
 * window is in the background: its focus did not move, the app's did. A stand-in is a frame of
 * another process: Tab into it (#123) takes the focus from the page's element first and gives it
 * to the frame later, which the page hears only as its window's blur.
 */
export function startCompositorFocus(
  win: Window,
  send: (surface: string | null) => void,
): () => void {
  let last: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tell = () => {
    timer = undefined;
    if (!win.document.hasFocus()) return;
    const now = focusedSurface(win.document);
    if (now === last) return;
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
