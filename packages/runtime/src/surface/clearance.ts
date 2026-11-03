/**
 * A window that fills the app has its title bar under the profile switcher and the desktops, which
 * float above every window. These insets keep a filled window's title and tools clear of them: CSS
 * variables on the windows' layer (`--chrome-left`, `--chrome-right`, read by surface.css), measured
 * whenever the switcher or the desktops change size and when the app does.
 */

const GAP = 12;

export function trackTopChrome(layer: HTMLElement, shell: ParentNode): () => void {
  const left = shell.querySelector<HTMLElement>(".modes-row");
  const right = shell.querySelector<HTMLElement>(".desktops");
  const win = layer.ownerDocument.defaultView ?? window;
  const measure = () => {
    const width = layer.clientWidth || win.innerWidth;
    if (left) {
      const edge = Math.round(left.getBoundingClientRect().right) + GAP;
      layer.style.setProperty("--chrome-left", `${edge}px`);
    }
    if (right) {
      const edge = Math.round(width - right.getBoundingClientRect().left) + GAP;
      layer.style.setProperty("--chrome-right", `${edge}px`);
    }
  };
  measure();
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
  for (const el of [left, right]) if (el) observer?.observe(el);
  win.addEventListener("resize", measure);
  return () => {
    observer?.disconnect();
    win.removeEventListener("resize", measure);
  };
}
