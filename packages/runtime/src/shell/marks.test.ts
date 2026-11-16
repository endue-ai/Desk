// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { localMark } from "./marks";

describe("the marks of the agent programs on this computer (ADR 0232)", () => {
  it("draws each program's own mark on a 24 viewBox, in the text's colour", () => {
    const claude = localMark("claude");
    const codex = localMark("codex", 24);
    for (const mark of [claude, codex]) {
      expect(mark.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(mark.getAttribute("fill")).toBe("currentColor");
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(mark.querySelectorAll("path")).toHaveLength(1);
    }
    expect([claude.getAttribute("width"), codex.getAttribute("width")]).toEqual(["18", "24"]);
    expect(claude.getAttribute("data-mark")).toBe("claude");
    expect(codex.getAttribute("data-mark")).toBe("codex");
    const paths = [claude, codex].map((m) => m.querySelector("path")?.getAttribute("d") ?? "");
    expect(paths[0]).not.toBe(paths[1]);
    // A whole path each: it starts with a move and ends closed.
    for (const d of paths) expect(d).toMatch(/^[mM][\d.\s-]+.*[zZ]$/);
  });
});
