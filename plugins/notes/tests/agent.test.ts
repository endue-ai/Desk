// What Eris reads and writes through Notes (ADR 0088): the notes in ~/Notes, a note's text (the open
// copy when the person has it open), a new note with text, text added or put in place, never over the
// person's unsaved typing and never outside ~/Notes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { disk, type Mounted, mount, NOTES_WRITE, note } from "./harness";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 8, 9, 30));
});
afterEach(() => vi.useRealTimers());

async function notes(files: Record<string, string>) {
  let m: Mounted | undefined;
  m = await mount({
    handlers: disk(files),
    commands: {
      "desk.files.open": async (args) => {
        const { path } = args as { path: string };
        await m?.host.command("desk.files.visit", note(path));
        return note(path).buffer;
      },
    },
  });
  return m;
}

describe("an agent's notes commands", () => {
  it("lists the notes in ~/Notes, narrowed by words in the name or the text", async () => {
    const m = await notes({
      "~/Notes/groceries.md": "# Groceries\nmilk, eggs",
      "~/Notes/work/plan.md": "Ship the agent commands",
    });
    const all = (await m.host.command("endue.notes.list")) as {
      notes: Array<{ path: string; firstLine: string }>;
      total: number;
    };
    expect(all.notes.map((n) => n.path).sort()).toEqual([
      "~/Notes/groceries.md",
      "~/Notes/work/plan.md",
    ]);
    const found = (await m.host.command("endue.notes.list", { query: "eggs" })) as {
      notes: Array<{ path: string; firstLine: string }>;
    };
    expect(found.notes).toMatchObject([{ path: "~/Notes/groceries.md", firstLine: "# Groceries" }]);
  });

  it("reads a note from disk, or as the person has it open with unsaved edits", async () => {
    const m = await notes({ "~/Notes/a.md": "on disk" });
    await expect(m.host.command("endue.notes.read", { path: "a.md" })).resolves.toMatchObject({
      path: "~/Notes/a.md",
      text: "on disk",
      open: false,
      unsaved: false,
    });
    await m.host.command("desk.files.visit", note("~/Notes/a.md"));
    m.app.edit("typed, not saved");
    await expect(
      m.host.command("endue.notes.read", { path: "~/Notes/a.md" }),
    ).resolves.toMatchObject({ text: "typed, not saved", open: true, unsaved: true });
    await expect(m.host.command("endue.notes.append", { path: "a.md", text: "x" })).rejects.toThrow(
      /unsaved edits/,
    );
    await expect(m.host.command("endue.notes.read", { path: "~/Documents/x.md" })).rejects.toThrow(
      /not in ~\/Notes/,
    );
    await expect(m.host.command("endue.notes.read", { path: "../.ssh/id" })).rejects.toThrow(
      /not in ~\/Notes/,
    );
  });

  it("makes a new note with text, named or dated, without taking a name in use", async () => {
    const files: Record<string, string> = { "~/Notes/ideas.md": "old" };
    const m = await notes(files);
    await expect(
      m.host.command("endue.notes.new", { name: "ideas", text: "- one", open: false }),
    ).resolves.toEqual({ path: "~/Notes/ideas-2.md", length: 5 });
    await expect(m.host.command("endue.notes.new", { text: "today" })).resolves.toEqual({
      path: "~/Notes/2026-11-08.md",
      length: 5,
    });
    expect(files["~/Notes/ideas-2.md"]).toBe("- one");
    expect(files["~/Notes/ideas.md"]).toBe("old");
    expect(m.ran("desk.files.open")).toEqual([{ path: "~/Notes/2026-11-08.md" }]);
    for (const p of m.params("fs.write"))
      expect((p as { scope: unknown }).scope).toEqual(NOTES_WRITE);
  });

  it("appends on a line of its own, and replaces a note's text", async () => {
    const files: Record<string, string> = { "~/Notes/log.md": "first" };
    const m = await notes(files);
    await m.host.command("endue.notes.append", { path: "log.md", text: "second\n" });
    expect(files["~/Notes/log.md"]).toBe("first\nsecond\n");
    await m.host.command("endue.notes.append", { path: "log.md", text: "third" });
    expect(files["~/Notes/log.md"]).toBe("first\nsecond\nthird");
    await m.host.command("endue.notes.replace", { path: "log.md", text: "all new" });
    expect(files["~/Notes/log.md"]).toBe("all new");
  });
});

describe("the manifest offers them to agents", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
  ) as PluginManifest;
  const byId = (id: string) =>
    manifest.contributes?.commands?.find((c) => c.id === `endue.notes.${id}`);

  it("marks list and read read-only and every agent command's args strict", () => {
    for (const id of ["list", "read"])
      expect(byId(id), id).toMatchObject({ agent: true, readOnly: true });
    for (const id of ["new", "append", "replace"]) {
      expect(byId(id), id).toMatchObject({ agent: true, args: { additionalProperties: false } });
      expect(byId(id)?.readOnly, id).toBeUndefined();
    }
  });
});
