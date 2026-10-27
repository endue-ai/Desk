import type { Page } from "@playwright/test";

/**
 * Serialise the desk as a render tree: structure, rounded layout boxes, a few computed styles and text.
 * Everything here is fixed by CSS and the injected clock, so the tree is identical on every OS.
 */
export async function renderTree(page: Page): Promise<string> {
  const tree = await page.evaluate(() => {
    const styles = ["display", "background-color", "color", "border-top-color", "opacity"];
    const attributes = ["role", "aria-live", "data-surface", "sandbox", "title", "tabindex"];
    const walk = (el: Element): Record<string, unknown> => {
      const rect = el.getBoundingClientRect();
      const computed = getComputedStyle(el);
      const node: Record<string, unknown> = { tag: el.tagName.toLowerCase() };
      if (el.id) node.id = el.id;
      const className = el.getAttribute("class");
      if (className) node.class = className;
      for (const name of attributes) {
        const value = el.getAttribute(name);
        if (value !== null) node[name] = value;
      }
      node.box = [rect.x, rect.y, rect.width, rect.height].map(Math.round);
      node.style = Object.fromEntries(
        styles.map((name) => [name, computed.getPropertyValue(name)]),
      );
      const text = [...el.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) node.text = text;
      const children = [...el.children].map(walk);
      if (children.length > 0) node.children = children;
      return node;
    };
    const desk = document.querySelector("#desk");
    if (!desk) throw new Error("no #desk element");
    return walk(desk);
  });
  return `${JSON.stringify(tree, null, 2)}\n`;
}
