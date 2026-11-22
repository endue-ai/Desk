import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli";
import { KINDS, type TemplateKind } from "./kinds";
import { renderPlugin } from "./template";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("portable endue scaffolds", () => {
  it("writes the same theme in different layouts and across checkout drives", async () => {
    const root = mkdtempSync(join(tmpdir(), "endue-scaffold-"));
    roots.push(root);
    const options = { id: "endue.sample", name: "Sample", kind: "theme" } as const;
    const baseline = renderPlugin(options);
    expect(renderPlugin({ ...options, desk: "Z:/endue-checkout" })).toEqual(baseline);
    for (const [parent, hint] of [
      ["endue-layout-a", "endue-checkout-a"],
      ["endue-layout-b/nested", "endue-checkout-b"],
    ] as const) {
      const folder = join(root, parent, "sample theme");
      const output: string[] = [];
      const write = (line: string) => output.push(line);
      expect(
        await main([folder, "--kind", "theme", "--name", "Sample", "--id", "endue.sample"], {
          cwd: root,
          desk: join(root, hint),
          out: write,
          err: write,
        }),
      ).toBe(0);
      expect(readdirSync(folder).sort()).toEqual(["README.md", "plugin.json", "tests"]);
      expect(readdirSync(join(folder, "tests"))).toEqual(["theme.test.ts"]);
      for (const [path, contents] of Object.entries(baseline)) {
        expect(readFileSync(join(folder, path), "utf8") === contents, path).toBe(true);
      }
      expect(output.join("\n").includes(root)).toBe(false);
    }
  });

  it.each(Object.keys(KINDS) as TemplateKind[])("uses endue in the %s scaffold", (kind) => {
    const files = renderPlugin({ id: "endue.sample", name: "Sample", kind });
    expect(files["README.md"]).toContain("endue plugin validate");
    expect(files["README.md"]).toContain("endue plugin test");
    for (const [name, contents] of Object.entries(files)) {
      expect(/\bDesk\b/.test(contents), name).toBe(false);
    }
  });
});
