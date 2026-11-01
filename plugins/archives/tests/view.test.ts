// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { noise, zipOf } from "./fixtures";
import { type App, file, mount, READ } from "./harness";

const PATH = "~/Downloads/mixed.zip";
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const MIXED = zipOf([
  { name: "b.txt", data: "bee\n" },
  { name: "a.txt", data: "a".repeat(50) },
  { name: "docs/c.md", data: "# C\n" },
  { name: "img.png", data: PNG },
  { name: "blob.bin", data: noise(5000) },
  { name: "secret.txt", data: "xxxx", encrypted: true },
  { name: "euc.txt", data: new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7, 0x0a]) },
]);

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const rows = () => [...document.querySelectorAll<HTMLElement>('#tree [role="treeitem"]')];
const names = () => rows().map((row) => row.dataset.name);
const key = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

async function opened(handlers = {}) {
  const mounted = await mount({
    files: { [PATH]: MIXED },
    grants: [READ("~/Downloads")],
    handlers,
    commands: { "desk.palette.pick": () => "~/Downloads/mixed" },
    view: (app: () => App | undefined) =>
      createView(document, {
        select: (id) => app()?.select(id),
        toggle: (id) => app()?.toggle(id),
        open: (id) => app()?.open(id),
        up: () => app()?.up(),
        sort: (by) => app()?.sort(by),
        filter: (text) => app()?.filter(text),
        mark: (id) => app()?.mark(id),
        extract: (which) => app()?.extract(which),
        stop: () => app()?.stop(),
      }),
  });
  await mounted.host.command("desk.files.visit", file(PATH));
  await mounted.settle();
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML =
    /<body>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
});

describe("the archive view", () => {
  it("shows the tree: folders first, then files by name, with a count and total size", async () => {
    await opened();
    expect($("#archive-name").textContent).toBe("mixed.zip");
    expect(names()).toEqual([
      "docs",
      "a.txt",
      "b.txt",
      "blob.bin",
      "euc.txt",
      "img.png",
      "secret.txt",
    ]);
    expect($("#summary").textContent).toMatch(/^7 files, 1 folder, \d/);
    const tree = $("#tree");
    expect(tree.getAttribute("role")).toBe("tree");
    expect(tree.getAttribute("aria-label")).toBeTruthy();
  });

  it("sorts by size and date and filters by name", async () => {
    const { settle } = await opened();
    $<HTMLButtonElement>('button[data-sort="size"]').click();
    await settle();
    expect(names()).toEqual([
      "docs",
      "b.txt",
      "secret.txt",
      "euc.txt",
      "a.txt",
      "img.png",
      "blob.bin",
    ]);
    expect($('button[data-sort="size"]').closest("[aria-sort]")?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    $<HTMLButtonElement>('button[data-sort="size"]').click();
    await settle();
    expect(names()).toEqual([
      "docs",
      "blob.bin",
      "img.png",
      "a.txt",
      "euc.txt",
      "secret.txt",
      "b.txt",
    ]);

    const filter = $<HTMLInputElement>("#filter");
    filter.value = "txt";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(names()).toEqual(["a.txt", "euc.txt", "secret.txt", "b.txt"]);
    expect($("#summary").textContent).toMatch(/^4 of 7 files/);
  });

  it("an encrypted entry carries a lock and says it is not extracted", async () => {
    const { settle } = await opened();
    const secret = rows().find((row) => row.dataset.name === "secret.txt");
    expect(secret?.querySelector("[data-lock]")?.getAttribute("title")).toBe(
      "Encrypted: not extracted",
    );
    secret?.click();
    await settle();
    expect($("#preview").textContent).toContain("Encrypted: not extracted.");
  });

  it("previews text, EUC-KR text, an image and a hex dump", async () => {
    const { settle } = await opened();
    const pick = async (name: string) => {
      rows()
        .find((row) => row.dataset.name === name)
        ?.click();
      await settle();
    };
    await pick("a.txt");
    expect($("#preview pre").textContent).toBe("a".repeat(50));
    await pick("euc.txt");
    expect($("#preview pre").textContent).toBe("안녕\n");
    expect($("#preview").textContent).toContain("EUC-KR");
    await pick("img.png");
    expect($<HTMLImageElement>("#preview img").src).toMatch(/^data:image\/png;base64,/);
    expect($<HTMLImageElement>("#preview img").alt).toBe("img.png");
    await pick("blob.bin");
    const hex = $("#preview pre.hex").textContent ?? "";
    expect(hex.startsWith("00000000  ")).toBe(true);
    expect(hex.trim().split("\n")).toHaveLength(256);
    expect($("#preview").textContent).toContain("5,000 bytes");
  });

  it("moves with the arrow keys, opens folders with Enter, and leaves chords to the desk", async () => {
    const { settle } = await opened();
    const tree = $("#tree");
    tree.focus();
    key(tree, { key: "ArrowDown" });
    await settle();
    expect(tree.getAttribute("aria-activedescendant")).toBe(rows()[1]?.id);
    key(tree, { key: "Home" });
    await settle();
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");
    key(tree, { key: "Enter" });
    await settle();
    expect(names()).toContain("c.md");
    expect(rows()[0]?.getAttribute("aria-expanded")).toBe("true");
    for (const chord of [
      { key: "s", metaKey: true },
      { key: "w", ctrlKey: true },
      { key: "k", metaKey: true },
    ])
      expect(key(tree, chord).defaultPrevented).toBe(false);
  });

  it("shows the progress element while extracting and stops on Escape", async () => {
    const seen: Array<{ hidden: boolean; detail: unknown }> = [];
    let writes = 0;
    const { app } = await opened({
      "fs.write": ({ content }: { content: string }) => {
        const progress = $("#progress") as HTMLElement & { detail?: unknown };
        seen.push({ hidden: progress.hidden === true, detail: progress.detail });
        if (++writes === 1) key(document.body, { key: "Escape" });
        return { bytesWritten: content.length };
      },
      "fs.list": () => ({ entries: [] }),
    });
    await app.extract("all");
    expect(seen[0]).toMatchObject({ hidden: false });
    expect(String(seen[0]?.detail)).toMatch(/^0 of 6 files, 0 bytes of /);
    expect(writes).toBe(1);
    expect($("#status").textContent).toContain("Stopped after 1 of 6 files.");
    expect($("#progress").hidden).toBe(true);
  });
});
