/**
 * A remote surface's place in the desk's page (ADR 0160): the box its section keeps where the
 * compositor draws the surface, which never paints and holds the surface's spot in the page's own
 * focus order. Its element (`data-surface-host`) having the page's focus gives the keys to the
 * surface (the compositor's router follows it, ADR 0150).
 *
 * Tab (#123): the page's focus navigation enters the place at its first edge (Tab) or its last
 * (Shift+Tab); the surface's page then focuses its first or last control, and the focus here rests
 * on the place itself, where its window coming back to the front leaves it. When the surface's page
 * tabs past its end, the shell says so (`desk:surface-leave`): the focus goes to that edge, and the
 * shell presses Tab in this page once more (`desk:surface-tab`), which leaves the place by the
 * page's own order.
 */

export interface Place {
  element: HTMLElement;
  /** The surface's page tabbed past its last control (`next`) or before its first. */
  leave(next: boolean): void;
}

export function makePlace(
  doc: Document,
  title: string,
  host: string,
  tell: (text: string) => void,
): Place {
  const element = doc.createElement("div");
  element.className = "desk-surface-frame";
  element.dataset.surfaceHost = host;
  element.tabIndex = -1;
  element.title = title;
  const edge = (name: "first" | "last") => {
    const span = doc.createElement("span");
    span.className = "desk-surface-edge";
    span.dataset.edge = name;
    span.tabIndex = 0;
    span.setAttribute("aria-hidden", "true");
    return span;
  };
  const first = edge("first");
  const last = edge("last");
  element.append(first, last);
  let moving = false;
  const rest = (on: HTMLElement) => {
    moving = true;
    on.focus({ preventScroll: true });
    moving = false;
  };
  for (const span of [first, last]) {
    span.addEventListener("focus", () => {
      if (moving) return;
      tell(JSON.stringify({ type: "desk:surface-enter", edge: span.dataset.edge }));
      rest(element);
    });
  }
  return {
    element,
    leave(next) {
      // Only while the place has the page's focus: the person may have moved on meanwhile.
      if (!doc.hasFocus() || !element.contains(doc.activeElement)) return;
      rest(next ? last : first);
      tell(JSON.stringify({ type: "desk:surface-tab", back: !next }));
    },
  };
}
