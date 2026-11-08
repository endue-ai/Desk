import { describe, expect, it } from "vitest";
import {
  agentOf,
  chatOf,
  durationText,
  isMine,
  listOf,
  rowsOf,
  textOf,
  type UniversalEnv,
} from "./index";

const env: UniversalEnv = { zone: "UTC", locale: "en-US", now: Date.parse("2026-11-04T12:00:00Z") };

describe("chatOf", () => {
  const rows = rowsOf({
    entries: [
      { id: "3", author: "Mina", text: "Friday then", start: "2026-11-04T09:20:00Z" },
      { id: "1", author: "Mina", text: "Ship it?", start: "2026-11-03T18:00:00Z" },
      { id: "2", author: "Jun", role: "me", text: "Yes", start: "2026-11-04T09:00:00Z" },
      { id: "4", author: "Mina", text: "And the docs", start: "2026-11-04T09:21:00Z" },
    ],
  });

  it("orders timed messages, splits them by day and shows the author once per run", () => {
    const days = chatOf(rows, env);
    expect(days.map((day) => day.label)).toEqual(["Tue, Nov 3", "Wed, Nov 4"]);
    const today = days[1]?.messages ?? [];
    expect(today.map((m) => [m.row.id, m.mine, m.time, m.first])).toEqual([
      ["2", true, "09:00", true],
      ["3", false, "09:20", true],
      ["4", false, "09:21", false],
    ]);
  });

  it("names the person's own messages by me, else by the role or author me, user or self", () => {
    const [mina, jun] = rowsOf({ entries: [{ author: "Mina" }, { author: "Jun", role: "user" }] });
    expect([isMine(mina as never), isMine(jun as never)]).toEqual([false, true]);
    expect([isMine(mina as never, "mina"), isMine(jun as never, "Mina")]).toEqual([true, false]);
  });

  it("keeps messages as written when any has no time", () => {
    const loose = rowsOf({ entries: [{ id: "b", start: "2026-11-04T10:00:00Z" }, { id: "a" }] });
    const days = chatOf(loose, env);
    expect(days.flatMap((day) => day.messages.map((m) => m.row.id))).toEqual(["b", "a"]);
  });
});

describe("agentOf", () => {
  it("states each step and the run: failed, waiting or running wins, done when all are", () => {
    const run = rowsOf({
      entries: [
        {
          title: "Plan",
          status: "done",
          start: "2026-11-04T11:00:00Z",
          end: "2026-11-04T11:00:01.200Z",
        },
        { title: "Search mail", status: "running", start: "2026-11-04T11:57:00Z" },
        { title: "Draft the reply", status: "pending" },
      ],
    });
    const model = agentOf(run, env);
    expect(model.tone).toBe("running");
    expect(model.summary).toBe("Done 1 of 3");
    expect(model.steps.map((s) => [s.row.title, s.tone, s.time, s.duration])).toEqual([
      ["Plan", "done", "11:00", "1.2 s"],
      ["Search mail", "running", "11:57", "3 min"],
      ["Draft the reply", "pending", "", ""],
    ]);
    const tone = (statuses: string[]) =>
      agentOf(rowsOf({ entries: statuses.map((status) => ({ status })) }), env).tone;
    expect(tone(["done", "failed", "running"])).toBe("failed");
    expect(tone(["done", "approval"])).toBe("waiting");
    expect(tone(["done", "ok"])).toBe("done");
    expect(tone([])).toBe("pending");
  });

  it("writes durations from milliseconds to hours", () => {
    expect([850, 1200, 59_000, 180_000, 3_900_000, 7_200_000].map(durationText)).toEqual([
      "850 ms",
      "1.2 s",
      "59 s",
      "3 min",
      "1 h 5 min",
      "2 h",
    ]);
    expect(durationText(Number.NaN)).toBe("");
  });
});

describe("listOf and textOf", () => {
  const rows = rowsOf({
    entries: [
      { id: "b", title: "Second", start: "2026-11-05", text: "Body **two**" },
      { id: "a", title: "First", start: "2026-11-01", detail: "Only a detail" },
    ],
  });

  it("keeps the source order unless an order is asked for", () => {
    expect(listOf(rows).map((row) => row.id)).toEqual(["b", "a"]);
    expect(listOf(rows, "asc").map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("makes each entry a section with its title as the heading", () => {
    expect(textOf(rows).map((s) => [s.heading, s.markdown])).toEqual([
      ["Second", "Body **two**"],
      ["First", "Only a detail"],
    ]);
  });
});
