import type { Frame } from "@playwright/test";

/**
 * Serialise a plugin frame's `#root` as a render tree without layout boxes: glyph positions depend on
 * fonts, but their opacity, transform, filter and visibility depend only on the clock, so this tree
 * is the same on every OS (ADR 0011).
 */
export async function frameTree(frame: Frame): Promise<string> {
  const tree = await frame.evaluate(() => {
    const styles = ["display", "visibility", "opacity", "transform", "filter", "color"];
    const attributes = ["role", "aria-live", "aria-hidden", "data-scene", "data-state", "hidden"];
    const walk = (el: Element): Record<string, unknown> => {
      const computed = getComputedStyle(el);
      const node: Record<string, unknown> = { tag: el.tagName.toLowerCase() };
      if (el.id) node.id = el.id;
      const className = el.getAttribute("class");
      if (className) node.class = className;
      for (const name of attributes) {
        const value = el.getAttribute(name);
        if (value !== null) node[name] = value;
      }
      node.style = Object.fromEntries(
        styles.map((name) => [name, computed.getPropertyValue(name)]),
      );
      const text = [...el.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? "")
        .join("");
      if (text.trim()) node.text = text;
      const children = [...el.children].filter((c) => c.tagName !== "SCRIPT").map(walk);
      if (children.length > 0) node.children = children;
      return node;
    };
    const root = document.querySelector("#root");
    if (!root) throw new Error("no #root in the plugin frame");
    return walk(root);
  });
  return `${JSON.stringify(tree, null, 2)}\n`;
}
