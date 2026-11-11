import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearch, FOLDER, folderOf, openSearchHit, searchEntry } from "../ui/search.js";

const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());
describe("global search", () => {
  it("debounces and ignores old replies, including after closing", async () => {
    vi.useFakeTimers();
    const old = deferred();
    const current = deferred();
    const call = vi.fn((method, { query }) =>
      method === "search.system"
        ? Promise.resolve({ hits: [] })
        : query === "old"
          ? old.promise
          : current.promise,
    );
    const update = vi.fn();
    const search = createSearch({ call }, update, vi.fn());
    search.query("o");
    search.query("old");
    await vi.advanceTimersByTimeAsync(120);
    search.query("new");
    await vi.advanceTimersByTimeAsync(120);
    current.resolve({ hits: [{ id: "new" }] });
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith("plugins", [{ id: "new" }]);
    old.resolve({ hits: [{ id: "old" }] });
    await Promise.resolve();
    expect(update).not.toHaveBeenCalledWith("plugins", [{ id: "old" }]);
    search.query("closed");
    search.cancel();
    await vi.advanceTimersByTimeAsync(120);
    expect(call.mock.calls.filter(([, p]) => p.query === "closed")).toHaveLength(0);
  });

  it("keeps only the latest queued OS search while the index is busy", async () => {
    vi.useFakeTimers();
    const slow = deferred();
    const call = vi.fn((method, { query }) =>
      method === "search.system" && query === "first"
        ? slow.promise
        : Promise.resolve({ hits: [] }),
    );
    const search = createSearch({ call }, vi.fn(), vi.fn());
    for (const q of ["first", "second", "third"]) {
      search.query(q);
      await vi.advanceTimersByTimeAsync(120);
    }
    slow.resolve({ hits: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(call.mock.calls.filter(([m]) => m === "search.system").map(([, p]) => p.query)).toEqual([
      "first",
      "third",
    ]);
  });

  it("launches the owner then opens its document, and refuses another provider's command", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue([{ id: "notes.open", provider: "notes" }]);
    const ctx = { commands: { run, list }, bridge: { call: vi.fn() } };
    const hit = { kind: "document", plugin: "notes", command: "notes.open", args: { note: "7" } };
    await openSearchHit(ctx, hit);
    expect(run.mock.calls).toEqual([
      ["desk.plugins.open", { plugin: "notes", waitForReady: true }],
      ["notes.open", { note: "7" }],
    ]);
    list.mockResolvedValue([{ id: "notes.open", provider: "impostor" }]);
    await expect(openSearchHit(ctx, hit)).rejects.toThrow("no longer available");
    expect(run.mock.calls.filter(([id]) => id === "notes.open")).toHaveLength(1);
    await openSearchHit(ctx, { kind: "file", id: "os:1" });
    expect(ctx.bridge.call).toHaveBeenCalledWith("search.open", {
      id: "os:1",
      scope: { permission: "search:system" },
    });
  });
});

describe("an OS result's row", () => {
  it("shows the folder, home as ~, and a long one by its end, so files of one name differ", () => {
    const root = "/Users/someone/Project/endue/check-desk/Desk";
    const details = [`${root}/docs/i18n/ko/README.md`, `${root}/docs/i18n/ja/README.md`].map(
      (path) => searchEntry({ id: path, kind: "file", title: "README.md", detail: path }).detail,
    );
    expect(details).toEqual([
      "File · …/endue/check-desk/Desk/docs/i18n/ko",
      "File · …/endue/check-desk/Desk/docs/i18n/ja",
    ]);
    expect(details.every((detail) => detail.length <= "File · ".length + FOLDER)).toBe(true);
    expect(folderOf("/Users/someone/notes/a.md")).toBe("~/notes");
    expect(folderOf("/home/someone/a.md")).toBe("~");
    expect(folderOf(String.raw`C:\Users\someone\Desktop\a.txt`)).toBe(String.raw`~\Desktop`);
    expect(folderOf("/a.txt")).toBe("/");
    expect(folderOf("/System/Applications/Utilities/Terminal.app")).toBe(
      "/System/Applications/Utilities",
    );
  });
});
