// What the six elements share: the base class, the shadow root, ids, focus and arrow keys.

/**
 * `HTMLElement`, or a stand-in where there is none (Node), so importing the elements never throws.
 * They are only defined where `customElements` exists.
 */
export const Base: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/** What `desk-select` carries, from `desk-list` and `desk-menu`. */
export type DeskSelectDetail = { index: number; item: HTMLElement };

/** Give `host` an open shadow root holding its styles, then `nodes`. */
export function shadow(
  host: HTMLElement,
  css: string,
  nodes: Node[],
  init: { delegatesFocus?: boolean } = {},
): ShadowRoot {
  const root = host.attachShadow({ mode: "open", ...init });
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style, ...nodes);
  return root;
}

/** A new element with attributes. */
export function element(tag: string, attributes: Record<string, string> = {}): HTMLElement {
  const created = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value);
  return created;
}

/** Set an attribute, or remove it for null. */
export function reflect(target: Element, name: string, value: string | null): void {
  if (value === null) target.removeAttribute(name);
  else target.setAttribute(name, value);
}

let last = 0;

/** An id no other element of this package has given out. */
export function uid(prefix: string): string {
  last += 1;
  return `${prefix}-${last}`;
}

/** What has focus in the tree `host` lives in, so a host inside another shadow root works too. */
export function activeIn(host: HTMLElement): HTMLElement | null {
  return (host.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
}

/** The child of `host` that holds `node`, or null. */
export function childOf(host: Element, node: EventTarget | null): HTMLElement | null {
  for (let at = node as Node | null; at; at = at.parentNode) {
    if (at.parentNode === host) return at as HTMLElement;
  }
  return null;
}

/** Descendants that Tab can reach, in tree order. Hosts that delegate focus count as one stop. */
export function focusables(root: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const child of root.children as Iterable<HTMLElement>) {
    if (child.hidden || child.hasAttribute("inert")) continue;
    const reachable = child.tabIndex >= 0 || child.shadowRoot?.delegatesFocus === true;
    if (reachable && !child.hasAttribute("disabled")) found.push(child);
    found.push(...focusables(child));
  }
  return found;
}

/** Where a navigation key moves an index among `count` items, or null for other keys. */
export function step(key: string, index: number, count: number, wrap: boolean): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      if (index < count - 1) return index + 1;
      return wrap ? 0 : count - 1;
    case "ArrowUp":
      if (index > 0) return index - 1;
      return wrap || index < 0 ? count - 1 : 0;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
