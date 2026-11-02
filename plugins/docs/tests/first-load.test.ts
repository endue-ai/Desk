import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { disk, file, mount } from "./harness";
import { utf8 } from "./zip";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../ui");
/** `import … from "./x.js"`, `export … from "./x.js"` and `import "./x.js"`: not import() calls. */
const STATIC =
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.[^"']+)["']|^\s*import\s*["'](\.[^"']+)["']/gm;

/** The modules a page loads before `entry` runs: its static imports, all the way down. */
function firstLoad(entry: string): string[] {
  const seen = new Set<string>();
  const todo = [join(UI, entry)];
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    for (const found of readFileSync(next, "utf8").matchAll(STATIC)) {
      todo.push(join(dirname(next), found[1] ?? found[2] ?? ""));
    }
  }
  // Named with "/" on every platform: relative() separates with backslashes on Windows.
  return [...seen].map((path) => relative(UI, path).split(sep).join("/")).sort();
}

const READERS = /^(open\.js|abw|doc|hwp|hwpx|odf|ooxml|rtf|text)(\/|$)/;

describe("the docs plugin's first load", () => {
  it("leaves the document readers out: the plugin says hello without them", () => {
    const load = firstLoad("main.js");
    expect(load).toContain("docs.js");
    expect(load).toContain("view/view.js");
    expect(load.filter((module) => READERS.test(module))).toEqual([]);
    // They are still the readers a document opens with.
    expect(firstLoad("open.js").filter((module) => READERS.test(module)).length).toBeGreaterThan(9);
  });

  it("opens a document the moment it is mounted, loading the readers for it", async () => {
    const a = file("~/Documents/a.rtf");
    const { host, view } = await mount({
      handlers: disk({ [a.path]: utf8("{\\rtf1\\ansi Alpha\\par}") }),
    });
    await expect(host.command("desk.files.visit", a)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ doc: { kind: "document", format: "rtf" } });
  });
});
