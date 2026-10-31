import { beforeEach, describe, expect, it } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { queryAll, reset } from "./test-dom";

defineElements();

describe("desk-card", () => {
  beforeEach(reset);

  it("is a region named by its heading, holding its children", () => {
    const element = document.createElement("desk-card");
    element.setAttribute("heading", "New");
    const line = document.createElement("p");
    line.textContent = "Posts from the feeds you follow.";
    element.append(line);
    document.body.append(element);
    const root = element.shadowRoot as unknown as Element;
    const [region] = queryAll(root, (el) => el.getAttribute("role") === "region");
    const [heading] = queryAll(root, (el) => el.localName === "h2");
    expect(heading?.textContent).toBe("New");
    expect(heading?.id).not.toBe("");
    expect(region?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(queryAll(region as Element, (el) => el.localName === "slot")).toHaveLength(1);
    expect(line.parentNode).toBe(element);

    element.setAttribute("heading", "Newest");
    expect(heading?.textContent).toBe("Newest");
    // A card without a heading has no name, so it is not a region.
    element.removeAttribute("heading");
    expect(region?.hasAttribute("role")).toBe(false);
    expect(heading?.hidden).toBe(true);
  });
});
