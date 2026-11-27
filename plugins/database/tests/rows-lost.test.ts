// A read its cursor keeps, whose session is lost (PG-22 with PG-105, ADR 0352): the result says at
// once that the rows past those held are gone, the rows held stay, and neither the automatic
// reconnect nor a scroll sends a FETCH to the session that replaces it; running again is the
// person's act, and it reads through a new cursor.
import { describe, expect, it } from "vitest";
import { formatCount } from "../ui/format.js";
import { rowsLine } from "../ui/rows/window.js";
import type { Script } from "./harness";
import { rawRunsOf } from "./runs-of";
import { script as base, run, shop, state } from "./session-helpers";

const script: Script = (sql, who) => {
  if (sql === "select n from big")
    return { rows: [["n"], ...Array.from({ length: 1200 }, (_, i) => [String(i + 1)])] };
  return base(sql, who);
};
type Mounted = Awaited<ReturnType<typeof shop>>;
const runs = (m: Mounted) =>
  rawRunsOf(m.host.calls)
    .filter((c) => c.method === "db.run")
    .map((c) => c.params as { sql: string; sessionId: string });
const set = (m: Mounted) => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set;
const until = async (test: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
// The plugin holds the server's grant, so the lost session is opened again on its own.
const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };

describe("a kept cursor whose session is lost", () => {
  it("says at once that the rest is gone; the reconnect and a scroll fetch nothing on the new session", async () => {
    const m = await shop({ script, handlers: granted });
    await run(m, "select n from big");
    expect(set(m)?.window).toMatchObject({ known: 500, done: false });
    const first = runs(m).find((r) => r.sql.startsWith("DECLARE"))?.sessionId ?? "";
    m.host.emit({
      event: "db.closed",
      data: { sessionId: first, reason: "io", message: "connection reset by peer" },
    });
    await m.settle();
    expect(state(m)).toBe("lost");
    const shown = set(m);
    expect(shown?.window?.gone).toMatch(/went with its session/u);
    expect(shown?.rows).toHaveLength(500);
    expect(rowsLine(shown as never, formatCount)).toMatch(
      /^Rows 1–500 of at least 500 \(the rows past these went with its session\)$/u,
    );

    await until(() => state(m) === "idle");
    const before = runs(m).length;
    await m.app.page({ rows: "next" });
    await m.settle();
    // Nothing went to the new session: no FETCH, no MOVE, no new DECLARE.
    expect(runs(m).slice(before)).toEqual([]);
    expect(runs(m).some((r) => r.sessionId !== first && /FETCH|MOVE/u.test(r.sql))).toBe(false);
    expect(set(m)?.rows).toHaveLength(500);

    // Running again is the person's act: a new cursor on the new session.
    await run(m, "select n from big");
    const again = runs(m).filter((r) => r.sql.startsWith("DECLARE"));
    expect(again).toHaveLength(2);
    expect(again[1]?.sessionId).not.toBe(first);
    expect(set(m)?.window).toMatchObject({ known: 500, done: false });
    expect(set(m)?.window?.gone).toBeUndefined();
  });
});
