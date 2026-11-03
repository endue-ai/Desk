import { expect, it } from "vitest";
import { keyFor } from "../ui/marks.js";
import type { ShownModel } from "../ui/reader.js";
import { cbz } from "./build/comics";
import { disk, file, mount, recordingView } from "./harness";

it("keeps existing notes and rolls back a note that exceeds the file limit", async () => {
  const comic = file("~/Comics/issue.cbz");
  const key = keyFor(comic.path);
  const added = "2026-01-01T00:00:00.000Z";
  const notes = Array.from({ length: 15 }, (_, i) => ({
    unit: 0,
    offset: 0,
    text: String(i).padStart(2, "0") + "a".repeat(3998),
    added,
  }));
  const value = {
    path: comic.path,
    unit: 0,
    offset: 0,
    zoom: null,
    bookmarks: [{ unit: 0, offset: 0, label: "Page 1", added }],
    notes,
  };
  const store: Record<string, unknown> = { [key]: value };
  const view = recordingView();
  let shown: ShownModel | undefined;
  view.marks = (model) => {
    shown = model;
  };
  const { app, host, params, settle } = await mount({
    handlers: disk({ [comic.path]: cbz() }, store),
    view: () => view,
  });
  await host.command("desk.files.visit", comic);
  await settle();
  const before = JSON.stringify(store[key]);
  const writes = params("store.set").length;
  expect(new TextEncoder().encode(before).length).toBeLessThan(60 * 1024);

  await app.note({ unit: 0, offset: 0 }, `new${"x".repeat(3997)}`);
  await settle();

  expect.soft(params("store.set").length).toBe(writes);
  expect.soft(JSON.stringify(store[key]) === before).toBe(true);
  expect
    .soft(shown?.notes.map((note) => note.text.slice(0, 3)))
    .toEqual(notes.map((note) => note.text.slice(0, 3)));
  expect
    .soft(view.statuses.at(-1))
    .toBe("This file's notes are full; remove a note or a bookmark first.");
});
