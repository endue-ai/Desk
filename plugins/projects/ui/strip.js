// The views' tabs as one strip that scrolls sideways when the toolbar is narrower than they are, as
// in a window at its first size: the chosen tab is kept in sight, a wheel turned over the strip
// scrolls it, and `data-more` names the ends that hide tabs (start, end or both) so the page can
// fade them.

/** @param {HTMLElement} strip */
export function createStrip(strip) {
  const more = () => {
    const hidden = strip.scrollWidth - strip.clientWidth;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft < hidden - 1;
    const where = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (where) strip.dataset.more = where;
    else delete strip.dataset.more;
  };

  /** Scroll the strip, and only the strip, until the chosen tab is whole in sight. */
  const show = () => {
    const tab = strip.querySelector('[aria-selected="true"]');
    if (tab instanceof HTMLElement) {
      const box = strip.getBoundingClientRect();
      const at = tab.getBoundingClientRect();
      if (at.left < box.left) strip.scrollLeft -= box.left - at.left;
      else if (at.right > box.right) strip.scrollLeft += at.right - box.right;
    }
    more();
  };

  strip.addEventListener("scroll", more, { passive: true });
  strip.addEventListener(
    "wheel",
    (event) => {
      const sideways = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
      if (sideways || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  strip.ownerDocument.defaultView?.addEventListener("resize", show);
  return { show };
}
