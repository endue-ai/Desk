import type { Page } from "@playwright/test";

/**
 * Serialise the shell (or one part of it) as a render tree (ADR 0011). Boxes are recorded only for
 * elements whose size CSS fixes, never for text-sized ones, so the tree is the same on every OS.
 * The Eris canvas contributes its frame digest and ring profile (data-mesh, data-rings).
 */
export async function shellTree(page: Page, selector = "#desk"): Promise<string> {
  const tree = await page.evaluate((sel) => {
    const boxed = [
      ".float-bar",
      ".desktop-button",
      ".add-button",
      ".icon-button",
      ".avatar",
      ".space",
      ".eris",
      ".soul",
      ".surface",
      ".rail-popover",
      ".drawer-panel",
      ".composer-field",
      ".scrim",
    ].join(",");
    const attributes = [
      "role",
      "aria-label",
      "aria-pressed",
      "aria-expanded",
      "aria-live",
      "hidden",
      "disabled",
      "data-state",
      "data-mode",
      "data-desktop",
      "data-rail",
      "data-surface",
      "data-popover",
      "data-mesh",
      "data-rings",
      "data-voice",
    ];
    const walk = (el: Element): Record<string, unknown> => {
      const node: Record<string, unknown> = { tag: el.tagName.toLowerCase() };
      const className = el.getAttribute("class");
      if (className) node.class = className;
      for (const name of attributes) {
        const value = el.getAttribute(name);
        if (value !== null) node[name] = value;
      }
      if (el.tagName.toLowerCase() === "svg") {
        node.icon = el.getAttribute("data-icon");
        return node;
      }
      if (el.matches(boxed)) {
        const r = el.getBoundingClientRect();
        node.box = [r.x, r.y, r.width, r.height].map(Math.round);
      }
      const c = getComputedStyle(el);
      const style: Record<string, string> = {};
      if (c.display === "none") style.display = "none";
      if (c.backgroundColor !== "rgba(0, 0, 0, 0)") style.background = c.backgroundColor;
      if (el.children.length === 0 || el.childNodes.length !== el.children.length)
        style.color = c.color;
      if (Number.parseFloat(c.borderTopWidth) > 0)
        style.border = `${c.borderTopStyle} ${c.borderTopColor}`;
      if (c.opacity !== "1") style.opacity = c.opacity;
      if (c.transform !== "none") style.transform = c.transform;
      if (c.filter !== "none") style.filter = c.filter;
      if (el.classList.contains("soul-line")) style.letterSpacing = c.letterSpacing;
      if (el.classList.contains("modes-more")) style.maxWidth = c.maxWidth;
      if (el.classList.contains("composer-field")) style.height = c.height;
      if (Object.keys(style).length) node.style = style;
      const text = [...el.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) node.text = text;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        node.value = el.value;
      const children = [...el.children].map(walk);
      if (children.length) node.children = children;
      return node;
    };
    const root = document.querySelector(sel);
    if (!root) throw new Error(`no ${sel}`);
    return walk(root);
  }, selector);
  return `${JSON.stringify(tree, null, 1)}\n`;
}
