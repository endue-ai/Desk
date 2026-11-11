// The parts of the desk's system surface (ADR 0160): what of this page the compositor draws whole in
// its system layer, above every window, each under a stable id (`desk_web::sender::PARTS`, which
// lists the same ids in the order the compositor draws them). The page measures each part's box
// where it shows; one not on the page, hidden or of no size is not reported. The page's overlays
// (its popovers, menus, hover titles and dialog boxes) are one part with a box for each one open, so
// a window's title or a window over another never cuts through them. Every control the page draws
// outside its windows is in a part: one that is not lets the press through to the dock or the
// window under it (#158, #159).

/** A part's id and the element that holds it, found by its root's class; `every` reports each
 * element the selector finds, each with a box of its own. */
export const PARTS: ReadonlyArray<readonly [id: string, selector: string, every?: "every"]> = [
  ["desk.profiles", '[data-layer="system"] .modes'],
  ["desk.desktops", '[data-layer="system"] .desktops'],
  ["desk.agents", '[data-layer="system"] .sidebar'],
  ["desk.account", '[data-layer="system"] .account-bar'],
  ["desk.rail", ".rail"],
  ["desk.arrange", ".arrange-strip"],
  // The bottom edge has no box of its own: each of its controls is placed on its own.
  ["desk.bottom", "footer.bottom > *", "every"],
  ["desk.canvas", ".canvas-reset"],
  ["desk.safe", '[data-layer="system"] .safe-badge'],
  ["desk.eris", ".eris"],
  ["desk.notices", ".desk-status"],
  ["desk.settings", "dialog.desk-settings[open]"],
  ["desk.studios", ".theme-studio"],
  ["desk.overlays", '.popover, .tooltip, [role="menu"], .dialog', "every"],
];

/** One part where the page shows it, in CSS pixels. */
export interface PartReport {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether `el` is rendered: on the page, not hidden, not of no size. */
function shown(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest("[hidden]")) return false;
  return el.checkVisibility?.({ visibilityProperty: true }) ?? true;
}

/** The parts the page shows now, in `PARTS`' order. */
export function systemParts(doc: Document): PartReport[] {
  const parts: PartReport[] = [];
  for (const [id, selector, every] of PARTS) {
    const found = every
      ? [...doc.querySelectorAll<HTMLElement>(selector)]
      : [doc.querySelector<HTMLElement>(selector)];
    for (const el of found) {
      if (!el || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // Whole pixels, outward: a part's box never cuts its own edge, and a fraction's jitter is no
      // change.
      const [x, y] = [Math.floor(r.x), Math.floor(r.y)];
      const width = Math.ceil(r.x + r.width) - x;
      const height = Math.ceil(r.y + r.height) - y;
      parts.push({ id, x, y, width, height });
    }
  }
  return parts;
}
