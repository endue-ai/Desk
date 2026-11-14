/**
 * A window that fills the app, or its top half or a top quarter (ADR 0132), has its title bar under
 * the profile switcher and the desktops, which float above every window. These insets keep its title
 * and tools clear of them: CSS variables on the windows' layer (`--chrome-left`, `--chrome-right`,
 * read by surface.css), measured whenever the switcher or the desktops change size and when the app
 * does. While a window fills the whole app the switcher and the desktops are away (ADR 0221,
 * `shell/away.ts`): there is nothing to keep clear of, and the title bar takes its whole width.
 */

const GAP = 12;

export function trackTopChrome(layer: HTMLElement, shell: ParentNode): () => void {
  const left = shell.querySelector<HTMLElement>(".modes-row");
  const right = shell.querySelector<HTMLElement>(".desktops");
  const win = layer.ownerDocument.defaultView ?? window;
  const root = shell instanceof Element ? shell : null;
  const measure = () => {
    if (root?.classList.contains("is-away")) {
      layer.style.setProperty("--chrome-left", "0px");
      layer.style.setProperty("--chrome-right", "0px");
      return;
    }
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
  // The shell says its chrome is away, or back, in its class.
  const away =
    root && typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : undefined;
  if (root) away?.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => {
    away?.disconnect();
    observer?.disconnect();
    win.removeEventListener("resize", measure);
  };
}
