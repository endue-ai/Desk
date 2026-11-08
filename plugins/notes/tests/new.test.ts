import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  denied,
  disk,
  type Handlers,
  type Mounted,
  mount,
  NOTES_READ,
  NOTES_WRITE,
  note,
} from "./harness";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 8, 9, 30));
});
afterEach(() => vi.useRealTimers());

/** Notes over a disk, with desk.files.open answered as the desk does: it visits the file in Notes. */
async function notes(files: Record<string, string>, handlers: Handlers = {}) {
  let m: Mounted | undefined;
  m = await mount({
    handlers: { ...disk(files), ...handlers },
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

const written = (path: string) => ({
  path,
  content: "",
  encoding: "utf8",
  createDirs: true,
  scope: NOTES_WRITE,
});

it("makes ~/Notes/<today>.md, empty, and opens it in Notes", async () => {
  const files: Record<string, string> = {};
  const m = await notes(files);
  const path = "~/Notes/2026-11-08.md";

  await expect(m.host.command("endue.notes.new")).resolves.toBeUndefined();
  expect(m.params("fs.list")).toEqual([{ path: "~/Notes", scope: NOTES_READ }]);
  expect(m.params("fs.write")).toEqual([written(path)]);
  expect(files).toEqual({ [path]: "" });
  expect(m.ran("desk.files.open")).toEqual([{ path }]);
  expect(m.view.notes.at(-1)).toEqual({
    ...note(path),
    name: "2026-11-08.md",
    text: "",
    modified: false,
  });
  expect(m.view.statuses).toEqual([]);
});

it("takes the next free name when today's note exists, and leaves that note as it was", async () => {
  const before = {
    "~/Notes/2026-11-08.MD": "morning\n",
    "~/Notes/2026-11-08-2.md": "noon\n",
    "~/Notes/2026-11-07.md": "yesterday\n",
    "~/Notes/work/2026-11-08-3.md": "in a folder, so not taken\n",
  };
  const files: Record<string, string> = { ...before };
  const m = await notes(files);
  const path = "~/Notes/2026-11-08-3.md";

  await m.host.command("endue.notes.new");
  expect(m.params("fs.write")).toEqual([written(path)]);
  expect(files).toEqual({ ...before, [path]: "" });
  expect(m.ran("desk.files.open")).toEqual([{ path }]);
  expect(m.view.notes.at(-1)).toMatchObject({ path, text: "" });
});

it("a refused write asks once for ~/Notes and, refused, says so and opens nothing", async () => {
  const m = await notes(
    {},
    {
      "fs.write": () => {
        throw denied("fs:write over ~/Notes");
      },
      "perm.request": () => ({ granted: false }),
    },
  );
  const path = "~/Notes/2026-11-08.md";

  await expect(m.host.command("endue.notes.new")).rejects.toThrow(`Not allowed to write ${path}.`);
  expect(m.params("perm.request")).toEqual([
    { permission: NOTES_WRITE, reason: `To make the new note ${path}` },
  ]);
  expect(m.params("fs.write")).toHaveLength(1);
  expect(m.ran("desk.files.open")).toEqual([]);
  expect(m.view.statuses.at(-1)).toBe(`Not allowed to write ${path}.`);
  expect(m.view.notes.at(-1)).toBeNull();
});
