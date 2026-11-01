import type { Frame } from "@playwright/test";

/**
 * Serialise a view frame's `#root` as a render tree: its elements and their open shadow roots, the
 * attributes that carry structure and state, and text. No boxes and no computed styles: text and
 * fonts differ between machines, structure and state do not (ADR 0011). Generated ids, and the ARIA
 * attributes that point at them, are left out: they count elements, not meaning.
 */
export async function viewTree(frame: Frame): Promise<string> {
  const tree = await frame.evaluate(() => {
    const attributes = [
      "role",
      "aria-label",
      "aria-sort",
      "aria-selected",
      "aria-hidden",
      "aria-live",
      "aria-orientation",
      "tabindex",
      "hidden",
      "class",
      "data-component",
      "data-state",
      "data-density",
      "data-direction",
      "data-past",
      "data-all-day",
      "density",
      "label",
      "heading",
      "value",
      "unit",
      "time-zone",
      "now",
      "variant",
    ];
    type Tree = Record<string, unknown>;
    const walk = (el: Element): Tree => {
      const node: Tree = { tag: el.tagName.toLowerCase() };
      for (const name of attributes) {
        const value = el.getAttribute(name);
        if (value !== null) node[name] = value;
      }
      const text = [...el.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) node.text = text;
      const kept = (list: HTMLCollection) =>
        [...list].filter((c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE").map(walk);
      if (el.shadowRoot) node.shadow = kept(el.shadowRoot.children);
      const children = kept(el.children);
      if (children.length > 0) node.children = children;
      return node;
    };
    const root = document.querySelector("#root");
    if (!root) throw new Error("no #root in the view frame");
    return walk(root);
  });
  return `${JSON.stringify(tree, null, 2)}\n`;
}
