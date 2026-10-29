import { describe, expect, it } from "vitest";
// Before the bundle: it installs the DOM the elements extend.
import "./elements/test-dom";
import * as ui from "./bundle";

describe("the bundle entry", () => {
  it("defines the six elements on import", () => {
    for (const [name, element] of Object.entries(ui.elements)) {
      expect(customElements.get(name)).toBe(element);
    }
  });

  it("exports the elements and the tokens", () => {
    expect(ui.DeskButton).toBe(ui.elements["desk-button"]);
    expect(typeof ui.defineElements).toBe("function");
    expect(ui.tokens).toBeDefined();
    expect(ui.tokensCss()).toContain("--desk-accent");
  });
});
