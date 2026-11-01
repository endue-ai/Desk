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

  it("oversized images remain details and image URLs are released on replacement and close", async () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const d = await mount({
      handlers: {
        ...disk({
          [DOCS]: [file("large.png", 9 * 1024 * 1024), file("one.png", 3), file("two.jpg", 3)],
        }),
        "fs.read": () => text("img"),
      },
    });
    const shown = watch(d.view);
    d.app.select(`${DOCS}/large.png`);
    await d.app.key(" ");
    expect(d.params("fs.read")).toEqual([]);
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "details", reason: expect.stringMatching(/8 MiB/) }),
    );
    d.app.select(`${DOCS}/one.png`);
    await d.settle();
    expect(shown).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "image", url: "blob:first" }),
    );
    d.app.select(`${DOCS}/two.jpg`);
    await d.settle();
    expect(revoke).toHaveBeenCalledWith("blob:first");
    await d.app.key("Escape");
    expect(revoke).toHaveBeenCalledWith("blob:second");
    expect(create).toHaveBeenCalledTimes(2);
    expect(d.params("fs.read")).toEqual(
      expect.arrayContaining([expect.objectContaining({ length: 8 * 1024 * 1024 })]),
    );
  });
});
