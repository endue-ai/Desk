import { describe, expect, it } from "vitest";
import { fixture, mount } from "./harness";

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("the memory inspector", () => {
  it("lists what Eris remembers, newest first, facts and conversations together", async () => {
    const { last, methods } = await mount();
    expect(ids(last().rows)).toEqual(["fact_0003", "ep_0002", "fact_0001"]);
    expect(last().rows[1]).toMatchObject({
      kind: "episode",
      text: "check my latest mail",
      answer: expect.stringContaining("Mina"),
    });
    expect(last().rows[1]?.meta).toContain("1 errand");
    expect(last().rows[2]).toMatchObject({ tags: ["work"] });
    expect(last().rows[2]?.meta).toMatch(/^Kept by you · /);
    expect(last().rows[0]?.meta).toMatch(/^Kept by Eris · /);
    expect(last().rows.map((row) => row.long)).toEqual([false, false, false]);
    expect(methods()).toEqual(["memory.list"]);
  });

  it("shows one kind at a time", async () => {
    const { app, last, host } = await mount();
    await app.filter("fact");
    expect(ids(last().rows)).toEqual(["fact_0003", "fact_0001"]);
    expect(host.calls.at(-1)?.params).toMatchObject({ kind: "fact" });
    await app.filter("episode");
    expect(ids(last().rows)).toEqual(["ep_0002"]);
    await app.filter("all");
    expect(last().rows).toHaveLength(3);
  });

  it("searches her memory and shows the words that matched", async () => {
    const { app, last, methods } = await mount();
    await app.search("  pnpm ");
    expect(methods().at(-1)).toBe("memory.search");
    expect(last()).toMatchObject({ query: "pnpm" });
    expect(last().rows).toEqual([expect.objectContaining({ id: "fact_0003", snippet: "[pnpm]" })]);
    await app.search("tea");
    expect(last().rows).toEqual([]);
    expect(last().empty).toContain("tea");
    await app.search("");
    expect(methods().at(-1)).toBe("memory.list");
  });

  it("edits a fact in place, and keeps a new one in the person's words", async () => {
    const entries = fixture();
    const { app, last, host, statuses } = await mount(entries);
    app.edit("fact_0001");
    expect(last().editing).toBe("fact_0001");
    await app.save("fact_0001", "  Reviews pull requests after lunch ");
    expect(host.calls.find((c) => c.method === "memory.remember")?.params).toEqual({
      id: "fact_0001",
      text: "Reviews pull requests after lunch",
      scope: { permission: "memory:write" },
    });
    expect(last().editing).toBeNull();
    expect(last().rows.find((r) => r.id === "fact_0001")?.meta).toContain("edited");
    expect(statuses.at(-1)).toBe("Saved.");

    await app.add("Standup is at ten");
    expect(last().rows[0]).toMatchObject({ text: "Standup is at ten" });
    // The core records this page as the writer; the person typed it.
    expect(last().rows[0]?.meta).toMatch(/^Kept by you · /);
    expect(statuses.at(-1)).toBe("Eris will remember that.");
    await app.save("fact_0003", "   ");
    expect(statuses.at(-1)).toBe("A fact needs words.");
  });

  it("forgets one entry", async () => {
    const { app, last, host } = await mount();
    await app.forget("ep_0002");
    expect(host.calls.find((c) => c.method === "memory.forget")?.params).toEqual({
      id: "ep_0002",
      scope: { permission: "memory:write" },
    });
    expect(ids(last().rows)).toEqual(["fact_0003", "fact_0001"]);
  });

  it("forgets everything only once the person says yes", async () => {
    const no = await mount(fixture(), false);
    await no.app.forgetAll();
    expect(no.asked).toEqual([
      {
        title: "Forget everything?",
        text: "Eris will no longer know the 3 entries she remembers, facts and conversations alike. This cannot be undone.",
        yes: "Forget everything",
      },
    ]);
    expect(no.methods()).not.toContain("memory.forget");
    expect(no.last().rows).toHaveLength(3);

    const yes = await mount(fixture(), true);
    await yes.app.filter("episode");
    await yes.app.forgetAll();
    expect(yes.asked[0]).toMatchObject({ title: "Forget every conversation?" });
    expect(yes.host.calls.find((c) => c.method === "memory.forget")?.params).toEqual({
      all: true,
      kind: "episode",
      scope: { permission: "memory:write" },
    });
    expect(yes.statuses.at(-1)).toBe("Forgot 1 conversation.");
    await yes.app.filter("all");
    expect(ids(yes.last().rows)).toEqual(["fact_0003", "fact_0001"]);
  });

  it("forgets everything of the kind and the search the question named", async () => {
    const { app, asked, host, statuses } = await mount();
    await app.filter("fact");
    await app.search("pnpm");
    await app.forgetAll();
    expect(asked[0]?.text).toContain("not only those that match “pnpm”");
    expect(host.calls.find((c) => c.method === "memory.forget")?.params).toMatchObject({
      all: true,
      kind: "fact",
    });
    expect(statuses.at(-1)).toBe("Forgot 2 facts.");
  });

  it("reads her memory again when it changes elsewhere", async () => {
    const entries = fixture();
    const { host, last } = await mount(entries);
    entries.push({
      kind: "fact",
      id: "fact_0009",
      text: "Likes tea",
      by: "eris",
      at: "2026-11-05T13:00:00.000Z",
    });
    host.emit({
      event: "memory.changed",
      data: { change: "remembered", ids: ["fact_0009"], kind: "fact" },
    });
    await host.settle();
    expect(last().rows[0]?.id).toBe("fact_0009");
  });

  it("says when memory cannot be read", async () => {
    const { statuses, shown } = await mount(fixture(), true, {
      "memory.list": "permission_denied",
    });
    expect(shown).toEqual([]);
    expect(statuses[0]).toMatch(/^Memory could not be read: /);
  });
});
