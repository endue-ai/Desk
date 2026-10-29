import { describe, expect, it } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements, elements } from "./index";

describe("defineElements", () => {
  it("defines the six elements once, however often it is called", () => {
    defineElements();
    defineElements();
    for (const [name, element] of Object.entries(elements)) {
      expect(customElements.get(name)).toBe(element);
      expect(document.createElement(name)).toBeInstanceOf(element);
    }
  });
});
