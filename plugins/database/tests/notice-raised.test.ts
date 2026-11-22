// A statement's notices as they are raised (PG-25, ADR 0358), on the scripted server: while it
// runs, the db.call.notice events of its call show in the run's Messages, in order; one whose call
// was already answered is late and dropped; at the end the run's Messages are the record, each
// notice once, on its statement (ADR 0334).
import { describe, expect, it } from "vitest";
import type { Script } from "./harness";
import { messages, sessionOf, shop, start } from "./session-helpers";

const SLOW = "call restock_all()";
const script: Script = (sql) => {
  if (sql === SLOW)
    return {
      waits: true,
      notices: ["NOTICE:  batch 1 of 3", "WARNING:  batch 2 is slow", "NOTICE:  batch 3 of 3"],
    };
  return {};
};
const drawn = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("notices while a statement runs", () => {
  it("show in Messages in order before it ends, and once, on their statement, after", async () => {
    const m = await shop({ script });
    const { done } = await start(m, SLOW);
    await drawn();
    expect(m.shown()?.running).toBe(true);
    const tabs = m.shown()?.shown?.tabs ?? [];
    expect(tabs.map((t) => t.label)).toEqual(["Messages"]);
    expect(messages(m)).toEqual([
      "NOTICE:  batch 1 of 3",
      "WARNING:  batch 2 is slow",
      "NOTICE:  batch 3 of 3",
    ]);
    await m.host.command("endue.database.cancel");
    await done;
    await m.settle();
    const lines = (m.shown()?.shown?.tabs ?? []).flatMap((t) => t.lines ?? []);
    const notices = lines.filter((l) => l.level === "notice").map((l) => [l.statement, l.text]);
    expect(notices.filter(([, text]) => /batch/u.test(String(text)))).toEqual([
      [0, "NOTICE:  batch 1 of 3"],
      [0, "WARNING:  batch 2 is slow"],
      [0, "NOTICE:  batch 3 of 3"],
    ]);
  });

  it("a notice of a call already answered is late, and does not show", async () => {
    const m = await shop({ script });
    m.view.text = "set search_path = public";
    m.app.edited("set search_path = public");
    await m.host.command("endue.database.run-all");
    await m.settle();
    const sessionId = sessionOf(m, "set search_path = public") ?? "";
    const { done } = await start(m, SLOW);
    const notice = { severity: "NOTICE", localSeverity: "NOTICE", code: "00000", message: "late" };
    m.host.emit({ event: "db.call.notice", data: { sessionId, call: 1, notice } });
    await drawn();
    expect(messages(m)).not.toContain("NOTICE:  late");
    expect(messages(m)).toContain("NOTICE:  batch 1 of 3");
    await m.host.command("endue.database.cancel");
    await done;
  });
});
