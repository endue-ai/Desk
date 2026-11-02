import { expect, it } from "vitest";
import { disk, mount, note } from "./harness";

it("publishes note content, updates edits, opens the matching buffer and removes closed notes", async () => {
  const path = "~/Notes/trip.md";
  const m = await mount({
    handlers: { ...disk({ [path]: "서울 출장" }), "search.replace": () => ({}) },
    commands: { "desk.buffers.switch": () => ({}), "desk.files.open": () => ({}) },
  });
  await m.host.command("desk.files.visit", note(path));
  await m.settle();
  expect(m.params("search.replace").at(-1)).toEqual({
    documents: [
      {
        id: path,
        title: "trip.md",
        detail: path,
        text: "서울 출장",
        command: "endue.notes.search-open",
        args: { path },
      },
    ],
  });
  m.app.edit("부산 여행");
  await m.settle();
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "부산 여행" }] });
  await m.host.command("endue.notes.search-open", { path });
  expect(m.ran("desk.buffers.switch")).toEqual([{ id: note(path).buffer }]);
  await m.host.command("desk.buffers.closed", note(path));
  await m.settle();
  expect(m.params("search.replace").at(-1)).toEqual({ documents: [] });
});
