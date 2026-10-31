import { describe, expect, it } from "vitest";
import { opener } from "./files";

const rule = (pattern: string, plugin: string) => ({ pattern, plugin, owner: plugin });

describe("opener folds case when no rule matches as written", () => {
  const rules = [
    rule("*.z", "example.pack"),
    rule("*.Z", "example.compress"),
    rule("*.jpg", "endue.images"),
    rule("**/Makefile", "example.make"),
  ];

  it("picks the *.jpg rule for IMG_0001.JPG", () => {
    expect(opener(rules, "~/Pictures/IMG_0001.JPG")).toBe("endue.images");
    expect(opener(rules, "~/Pictures/img.Jpg")).toBe("endue.images");
    expect(opener(rules, "~/src/MAKEFILE")).toBe("example.make");
  });

  it("keeps the exact-case rule first when one matches as written", () => {
    expect(opener(rules, "~/x.Z")).toBe("example.compress");
    expect(opener(rules, "~/x.z")).toBe("example.pack");
    expect(opener(rules, "~/a.jpg")).toBe("endue.images");
  });

  it("still returns undefined for a name no rule matches in any case", () => {
    expect(opener(rules, "~/notes.md")).toBeUndefined();
    expect(opener(rules, "~/IMG_0001.JPEG")).toBeUndefined();
    expect(opener([], "~/IMG_0001.JPG")).toBeUndefined();
  });
});
