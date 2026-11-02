/**
 * The desk as a render tree (ADR 0011): structure, rounded layout boxes, a few computed styles and
 * text. The e2e snapshots (`e2e/render-tree.ts`) and the inspector (`desk.inspect.open`) read this
 * one serializer. It is self-contained, so `page.evaluate` hands it to a page as it is.
 */
export interface RenderNode {
  tag: string;
  box: number[];
  style: Record<string, string>;
  text?: string;
  children?: RenderNode[];
  /** id, class, role, aria-live, data-surface, sandbox, title and tabindex, when the element has them. */
  [attribute: string]: unknown;
}

/** The tree under `target`: an element, or the first that a selector matches (`#desk` by default). */
export function renderTree(target: Element | string = "#desk"): RenderNode {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`no ${String(target)} element`);
  const view = root.ownerDocument.defaultView ?? window;
  const styles = ["display", "background-color", "color", "border-top-color", "opacity"];
  const attributes = ["role", "aria-live", "data-surface", "sandbox", "title", "tabindex"];
  const walk = (el: Element): RenderNode => {
    const rect = el.getBoundingClientRect();
    const computed = view.getComputedStyle(el);
    const node: Record<string, unknown> = { tag: el.tagName.toLowerCase() };
    if (el.id) node.id = el.id;
    const className = el.getAttribute("class");
    if (className) node.class = className;
    for (const name of attributes) {
      const value = el.getAttribute(name);
      if (value !== null) node[name] = value;
    }
    node.box = [rect.x, rect.y, rect.width, rect.height].map(Math.round);
    node.style = Object.fromEntries(styles.map((name) => [name, computed.getPropertyValue(name)]));
    const text = [...el.childNodes]
      .filter((child) => child.nodeType === child.TEXT_NODE)
      .map((child) => child.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) node.text = text;
    const children = [...el.children].map(walk);
    if (children.length > 0) node.children = children;
    return node as RenderNode;
  };
  return walk(root);
}
