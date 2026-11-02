// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { disk, file, loadPage, mount } from "./harness";

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
  return [...seen].map((path) => relative(UI, path)).sort();
}

/** The readers, the worker's client and the page's preparation: none needed before a file. */
const LATER = ["formats.js", "remote.js", "worker.js", "archive.js", "warc.js", "feeds.js"];
const PAGE_PREP = ["page.js", "sanitize.js", "resources.js", "css.js"];

beforeEach(() => {
  loadPage(document);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the web plugin's first load", () => {
  it("leaves the readers and the page's preparation out: the plugin says hello without them", () => {
    const load = firstLoad("main.js");
    expect(load).toContain("web.js");
    expect(load).toContain("view.js");
    expect(load.filter((module) => [...LATER, ...PAGE_PREP].includes(module))).toEqual([]);
  });

  it("opens and draws a page the moment it is mounted, loading what it needs for it", async () => {
    const page = file("~/Sites/index.html");
    const { host } = await mount({
      handlers: disk({ [page.path]: "<!doctype html><title>Home</title><p>Hello there</p>" }),
      view: (actions) => createView(document, actions),
    });
    await expect(host.command("desk.files.visit", page)).resolves.toBeUndefined();
    const shadow = document.getElementById("page")?.shadowRoot;
    expect(shadow?.textContent).toContain("Hello there");
  });
});
