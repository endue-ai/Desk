import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCS, denied, disk, file, mount, READ, sample } from "./harness";

const text = (content: string, size = Buffer.byteLength(content)) => ({
  content: Buffer.from(content).toString("base64"),
  encoding: "base64" as const,
  size,
});
const watch = (view: object) => {
  const preview = vi.fn();
  Object.assign(view, { preview });
  return preview;
};
afterEach(() => vi.restoreAllMocks());

describe("quick preview follows the Explorer selection", () => {
  it("the preview action toggles a folder preview without expanding it; Space still expands", async () => {
    const d = await mount({ handlers: disk(sample()) });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/Work`);
    const toggle = () =>
      (d.app as typeof d.app & { togglePreview(): Promise<void> }).togglePreview();
    await toggle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: `${DOCS}/Work`,
        reason: "Select a file to preview its contents.",
      }),
    );
    expect(d.view.shown()).toContain("1:dir:Work");
    expect(d.view.shown()).not.toContain("1:dir:Work+");
    await toggle();
    expect(shown).toHaveBeenLastCalledWith(null);
    expect(d.view.shown()).toContain("1:dir:Work");
    await d.app.key(" ");
    expect(d.view.shown()).toContain("1:dir:Work+");
  });

  it("Space previews without opening, arrows replace it, Enter opens once and Escape closes", async () => {
    const d = await mount({ handlers: { ...disk(sample()), "fs.read": ({ path }) => text(path) } });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/a2.md`);
    await d.app.key(" ");
    expect(d.ran("desk.files.open")).toEqual([]);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: `${DOCS}/a2.md`, kind: "text" }),
    );
    await d.app.key("ArrowDown");
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: `${DOCS}/a10.md`, kind: "text" }),
    );
    await d.app.key("Enter");
    expect(d.ran("desk.files.open")).toEqual([{ path: `${DOCS}/a10.md` }]);
    expect(shown).toHaveBeenLastCalledWith(null);
    await d.app.key(" ");
    expect(await d.app.key("Escape")).toBe(true);
    expect(shown).toHaveBeenLastCalledWith(null);
    expect(d.view.focused.at(-1)).toBe(`${DOCS}/a10.md`);
    expect(await d.app.key("Escape")).toBe(false);
  });

  it("late reads cannot replace a newer selection or reopen a closed preview", async () => {
    let finish: ((value: ReturnType<typeof text>) => void) | undefined;
    const d = await mount({
      handlers: {
        ...disk(sample()),
        "fs.read": ({ path }) =>
          path.endsWith("a2.md")
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : text("new selection"),
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/a2.md`);
    const old = d.app.key(" ");
    await vi.waitFor(() => expect(finish).toBeDefined());
    d.app.select(`${DOCS}/a10.md`);
    await vi.waitFor(() =>
      expect(shown).toHaveBeenLastCalledWith(expect.objectContaining({ text: "new selection" })),
    );
    await d.app.key("Escape");
    finish?.(text("stale content"));
    await old;
    expect(shown).toHaveBeenLastCalledWith(null);
  });

  it("reads only a bounded text range under the existing folder grant and marks truncation", async () => {
    const d = await mount({
      handlers: { ...disk(sample()), "fs.read": () => text("excerpt", 1_000_000) },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/a2.md`);
    await d.app.key(" ");
    expect(d.params("fs.read")).toEqual([
      { path: `${DOCS}/a2.md`, offset: 0, length: 65536, encoding: "base64", scope: READ },
    ]);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "excerpt", truncated: true }),
    );
    expect(d.params("fs.write")).toEqual([]);
  });

  it("binary text and unsupported types show metadata without executing or opening anything", async () => {
    const d = await mount({
      handlers: {
        ...disk({ [DOCS]: [file("binary.txt"), file("slides.pptx", 123)] }),
        "fs.read": () => text("hello\u0000binary"),
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/binary.txt`);
    await d.app.key(" ");
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "details", reason: expect.stringMatching(/binary/i) }),
    );
    d.app.select(`${DOCS}/slides.pptx`);
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "details", size: 123 }));
    expect(d.params("fs.read")).toHaveLength(1);
    expect(d.ran("desk.files.open")).toEqual([]);
  });

  it("a declined read asks once for the same folder and displays the error", async () => {
    const d = await mount({
      handlers: {
        ...disk(sample()),
        "fs.read": () => {
          throw denied("read");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/a2.md`);
    await d.app.key(" ");
    expect(d.params("perm.request")).toEqual([
      { permission: READ, reason: `To preview ${DOCS}/a2.md in the explorer` },
    ]);
    expect(d.params("fs.read")).toHaveLength(1);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "error",
        reason: expect.stringContaining("Not allowed to read"),
      }),
    );
  });

  it("an image previews from its fs.url URL: its bytes are never read or decoded in the frame", async () => {
    const atob = vi.spyOn(globalThis, "atob");
    const create = vi.spyOn(URL, "createObjectURL");
    const sizes: Record<string, number> = { "one.png": 3, "two.jpg": 7_000_000 };
    const d = await mount({
      handlers: {
        ...disk({ [DOCS]: [file("large.png", 9 * 1024 * 1024), file("one.png"), file("two.jpg")] }),
        "fs.read": () => text("img"),
        "fs.url": ({ path }) => {
          const name = path.slice(path.lastIndexOf("/") + 1);
          return {
            url: `/_desk/file/t-${name}/${name}`,
            type: "image/png",
            size: sizes[name] ?? 0,
          };
        },
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/large.png`);
    await d.app.key(" ");
    expect(d.params("fs.url")).toEqual([]);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "details", reason: expect.stringMatching(/8 MiB/) }),
    );
    d.app.select(`${DOCS}/one.png`);
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "image", url: "/_desk/file/t-one.png/one.png", size: 3 }),
    );
    d.app.select(`${DOCS}/two.jpg`);
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "image", url: "/_desk/file/t-two.jpg/two.jpg", size: 7e6 }),
    );
    expect(d.params("fs.url")).toEqual([
      { path: `${DOCS}/one.png`, scope: READ },
      { path: `${DOCS}/two.jpg`, scope: READ },
    ]);
    expect(d.params("fs.read")).toEqual([]);
    expect(atob).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("an image the listing did not size is still refused over 8 MiB, by the size fs.url gives", async () => {
    const d = await mount({
      handlers: {
        ...disk({ [DOCS]: [file("huge.webp")] }),
        "fs.url": () => ({ url: "/_desk/file/t/huge.webp", type: "image/webp", size: 9e6 }),
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/huge.webp`);
    await d.app.key(" ");
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "details", reason: expect.stringMatching(/8 MiB/) }),
    );
  });
});
