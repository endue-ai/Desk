import { afterEach, expect, it, vi } from "vitest";
import { disk, mount, note } from "./harness";

afterEach(() => vi.useRealTimers());

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
  await new Promise((resolve) => setTimeout(resolve, 500));
  await m.settle();
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "부산 여행" }] });
  await m.host.command("endue.notes.search-open", { path });
  expect(m.ran("desk.buffers.switch")).toEqual([{ id: note(path).buffer }]);
  await m.host.command("desk.buffers.closed", note(path));
  await m.settle();
  expect(m.params("search.replace").at(-1)).toEqual({ documents: [] });
});

it("publishes ten edits once, 500 ms after the last edit", async () => {
  const path = "~/Notes/a.md";
  const m = await mount({
    handlers: { ...disk({ [path]: "start" }), "search.replace": () => ({}) },
  });
  await m.host.command("desk.files.visit", note(path));
  await m.settle();
  const before = m.params("search.replace").length;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (let i = 0; i < 10; i++) {
    m.app.edit(`edit ${i}`);
    await vi.advanceTimersByTimeAsync(40);
  }
  await vi.advanceTimersByTimeAsync(459);
  expect(m.params("search.replace")).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(m.params("search.replace")).toHaveLength(before + 1);
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "edit 9" }] });
});

it("visits, reverts, and closes immediately and subsumes pending edits", async () => {
  const a = note("~/Notes/a.md");
  const b = note("~/Notes/b.md");
  const m = await mount({
    handlers: { ...disk({ [a.path]: "A", [b.path]: "B" }), "search.replace": () => ({}) },
  });
  await m.host.command("desk.files.visit", a);
  await m.settle();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  m.app.edit("edited A");
  await m.host.command("desk.files.visit", b);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.params("search.replace").at(-1)).toMatchObject({
    documents: [{ text: "edited A" }, { text: "B" }],
  });
  m.app.edit("edited B");
  await m.host.command("desk.files.revert", b);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.params("search.replace").at(-1)).toMatchObject({
    documents: [{ text: "edited A" }, { text: "B" }],
  });
  m.app.edit("edited again");
  await m.host.command("desk.buffers.closed", b);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "edited A" }] });
  const afterClose = m.params("search.replace").length;
  await vi.advanceTimersByTimeAsync(500);
  expect(m.params("search.replace")).toHaveLength(afterClose);
});

it("merges updates behind a slow search call into one latest replacement", async () => {
  const path = "~/Notes/a.md";
  let release: (() => void) | undefined;
  let slow = false;
  const m = await mount({
    handlers: {
      ...disk({ [path]: "start" }),
      "search.replace": () =>
        slow
          ? new Promise((resolve) => {
              release = () => resolve({});
            })
          : {},
    },
  });
  await m.host.command("desk.files.visit", note(path));
  await m.settle();
  const before = m.params("search.replace").length;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  slow = true;
  m.app.edit("first");
  await vi.advanceTimersByTimeAsync(500);
  expect(m.params("search.replace")).toHaveLength(before + 1);
  for (let i = 0; i < 5; i++) {
    m.app.edit(`latest ${i}`);
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(m.params("search.replace")).toHaveLength(before + 1);
  slow = false;
  expect(release).toBeDefined();
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(m.params("search.replace")).toHaveLength(before + 2);
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "latest 4" }] });
});

it("waits for the latest edit's pause when a slow search finishes", async () => {
  const path = "~/Notes/a.md";
  let release: (() => void) | undefined;
  let slow = false;
  const m = await mount({
    handlers: {
      ...disk({ [path]: "start" }),
      "search.replace": () =>
        slow
          ? new Promise((resolve) => {
              release = () => resolve({});
            })
          : {},
    },
  });
  await m.host.command("desk.files.visit", note(path));
  await m.settle();
  const before = m.params("search.replace").length;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  slow = true;
  m.app.edit("first");
  await vi.advanceTimersByTimeAsync(500);
  m.app.edit("second");
  await vi.advanceTimersByTimeAsync(500);
  m.app.edit("latest");
  await vi.advanceTimersByTimeAsync(50);
  slow = false;
  expect(release).toBeDefined();
  release?.();
  await vi.advanceTimersByTimeAsync(449);
  expect(m.params("search.replace")).toHaveLength(before + 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(m.params("search.replace")).toHaveLength(before + 2);
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "latest" }] });
});

it("sends an immediate close waiting behind a slow search without waiting for later typing", async () => {
  const a = note("~/Notes/a.md");
  const b = note("~/Notes/b.md");
  let release: (() => void) | undefined;
  let slow = false;
  const m = await mount({
    handlers: {
      ...disk({ [a.path]: "A", [b.path]: "B" }),
      "search.replace": () =>
        slow
          ? new Promise((resolve) => {
              release = () => resolve({});
            })
          : {},
    },
  });
  await m.host.command("desk.files.visit", a);
  await m.host.command("desk.files.visit", b);
  await m.settle();
  const before = m.params("search.replace").length;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  slow = true;
  m.app.edit("first");
  await vi.advanceTimersByTimeAsync(500);
  await m.host.command("desk.buffers.closed", a);
  m.app.edit("latest");
  slow = false;
  expect(release).toBeDefined();
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(m.params("search.replace")).toHaveLength(before + 2);
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ text: "latest" }] });
  await vi.advanceTimersByTimeAsync(500);
  expect(m.params("search.replace")).toHaveLength(before + 2);
});
