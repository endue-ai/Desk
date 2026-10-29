/** A tiny element builder for the shell chrome (the runtime has no UI framework, ADR 0010). */

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  style?: Record<string, string | number>;
  [attribute: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "style") {
      for (const [name, v] of Object.entries(value as Record<string, string | number>)) {
        el.style.setProperty(name, String(v));
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const child of children.flat(8 as 1)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Replace `container`'s children with `build()`, keeping keyboard focus on the element with the same
 * `data-key` so re-rendering never throws a keyboard user back to the start.
 */
export function render(container: Element, build: () => Child[]): void {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.getAttribute("data-key") : null;
  container.replaceChildren();
  append(container, build());
  if (key)
    (container.querySelector(`[data-key="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
}

/** Subscribe to `target` and return the matching unsubscribe, for cleanup lists. */
export function listen<K extends keyof WindowEventMap>(
  target: Window | Document | HTMLElement,
  type: K | string,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}
