import { describe, expect, it } from "vitest";
import { disk, mount, note } from "./harness";

const ROADMAP = note("~/Notes/roadmap.md");
const TODO = note("~/Notes/todo.txt");
const paths = (...list: Array<{ path: string; kind?: "file" | "folder" }>) => [
  { type: "desk/paths" as const, paths: list },
];

/** Notes with roadmap.md and todo.txt in ~/Notes, and `open` on screen. */
async function notes(open?: { buffer: string; path: string }) {
  const mounted = await mount({
    handlers: disk({ "~/Notes/roadmap.md": "# Roadmap\n", "~/Notes/todo.txt": "milk\n" }),
    commands: { "desk.files.open": (args) => `file:${(args as { path: string }).path}` },
  });
  if (open) await mounted.host.command("desk.files.visit", open);
  await mounted.settle();
  return mounted;
}

describe("dropping on notes", () => {
  it("takes paths, text and URIs, and answers link for paths and copy for text", async () => {
    const { host, view } = await notes(ROADMAP);
    expect(host.dnd.accepts).toEqual(["desk/paths", "desk/text", "desk/uri", "text/plain"]);
    const over = view.spot;
    expect(await host.dnd.hover({ items: paths({ path: "~/Notes/a.md" }), over })).toBe("link");
    expect(await host.dnd.hover({ items: [{ type: "desk/text", text: "hi" }], over })).toBe("copy");
    const rows = [{ type: "desk/json" as const, kind: "db/rows", value: [{ id: 1 }] }];
    expect(await host.dnd.hover({ items: rows, over })).toBe("copy");
  });

  it("makes dropped paths links: relative inside the note's folder, images as images", async () => {
    const { host, view } = await notes(ROADMAP);
    const done = await host.dnd.drop({
      items: paths(
        { path: "~/Notes/plans/q1.md", kind: "file" },
        { path: "~/Pictures/my chart.png", kind: "file" },
        { path: "~/Notes/archive", kind: "folder" },
      ),
      over: view.spot,
      from: "endue.explorer",
    });
    expect(done).toBe("link");
    expect(view.inserted).toEqual([
      "[q1.md](plans/q1.md)\n![my chart.png](<~/Pictures/my chart.png>)\n[archive/](archive)",
    ]);
  });

  it("puts paths in a text note as they are, and inserts dropped text as text", async () => {
    const { host, view } = await notes(TODO);
    await host.dnd.drop({ items: paths({ path: "~/Notes/a.md" }), over: view.spot });
    const text = await host.dnd.drop({
      items: [{ type: "desk/text", text: "eggs\n" }],
      over: view.spot,
    });
    expect(text).toBe("copy");
    // Data of another kind arrives through its text/plain fallback.
    const rows = [{ type: "desk/json" as const, kind: "db/rows", value: [{ id: 1 }] }];
    await host.dnd.drop({ items: rows, over: view.spot });
    expect(view.inserted).toEqual(["~/Notes/a.md", "eggs\n", '[\n  {\n    "id": 1\n  }\n]']);
  });

  it("opens dropped files when no note is open, and refuses text there", async () => {
    const { host, view, ran } = await notes();
    const over = view.spot;
    expect(await host.dnd.hover({ items: [{ type: "desk/text", text: "hi" }], over })).toBe("none");
    expect(await host.dnd.drop({ items: paths({ path: "~/Notes/todo.txt" }), over })).toBe("link");
    expect(ran("desk.files.open")).toEqual([{ path: "~/Notes/todo.txt" }]);
    expect(view.inserted).toEqual([]);
  });
});
