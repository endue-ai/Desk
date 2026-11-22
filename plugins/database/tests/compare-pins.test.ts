// Pinned result tabs (PG-26, ADR 0329) in the grid's model, on the SDK's test host with a scripted
// sqlite3: a pinned tab stays after the run's tabs through later runs, named after its statement and
// the time it ran; it is kept as it was (the grid's edits refuse it, Explain never reads it); pinned
// tabs count against a memory limit, the oldest let go first and said; unpin takes one away.
import { describe, expect, it } from "vitest";
import { sizeOf } from "../ui/compare/pins.js";
import type { Console } from "../ui/consoles.js";
import { compareFeature } from "../ui/features/compare/index.js";
import * as builtins from "../ui/features/index.js";
import type { Script } from "./clients";
import { STOCK_V1, STOCK_V2, stockScript } from "./compare-fixture";
import { type Mounted, mount, SAVED } from "./harness";

const TIME = /\d\d:\d\d:\d\d/u.source;
const t = (n: number) => [
  ["n", "label"],
  ...Array.from({ length: 3 }, (_, i) => [`${n}${i}`, "x"]),
];
const PLAN = [
  ["id", "parent", "notused", "detail"],
  ["2", "0", "0", "SCAN stock_v1"],
];
const base: Script = (sql) => {
  const table = /^select \* from t(\d)/u.exec(sql);
  if (table) return { rows: t(Number(table[1])) };
  if (/^select \* from big/u.test(sql))
    return { rows: [["v"], ...Array.from({ length: 50 }, () => ["y".repeat(40)])] };
  if (sql === "EXPLAIN QUERY PLAN select * from stock_v1") return { rows: PLAN };
  if (sql.startsWith("EXPLAIN")) return { error: "no such table: nothing" };
  return {};
};
const one = { columns: ["n", "label"], rows: t(1).slice(1), truncated: false };

async function pins(limit?: number) {
  const features = Object.values(builtins).filter((f) => f.id !== "compare");
  const m = await mount({
    store: { connections: SAVED },
    script: stockScript(base),
    features: [...features, compareFeature(limit ? { pinLimit: limit } : {})],
  });
  await m.host.command("endue.database.console", { connection: "Notes" });
  return m;
}
const run = async (m: Mounted, text: string) => {
  m.view.text = text;
  m.view.caret = text.length;
  m.app.edited(text);
  await m.host.command("endue.database.run");
  await m.settle();
};
const tabs = (m: Mounted) => (m.shown() as Console).shown?.tabs ?? [];
const kinds = (m: Mounted) => tabs(m).map((tab) => tab.kind);

describe("pinned result tabs", () => {
  it("a pinned tab stays through later runs, named after its statement and time", async () => {
    const m = await pins();
    await run(m, "select * from stock_v1;");
    expect(await m.host.command("endue.database.pin-result")).toMatch(
      new RegExp(`^Pinned select \\* from stock_v1 · ${TIME}\\.`, "u"),
    );
    await m.settle();
    expect(kinds(m)).toEqual(["rows", "messages", "pinned"]);
    await run(m, "select * from stock_v2;");
    expect(kinds(m)).toEqual(["rows", "messages", "pinned"]);
    expect(tabs(m)[0]?.set?.rows).toEqual(STOCK_V2.slice(1));
    expect(tabs(m)[2]?.set?.rows).toEqual(STOCK_V1.slice(1));
    expect(tabs(m)[2]?.label).toMatch(new RegExp(`^select \\* from stock_v1 · ${TIME}$`, "u"));
    expect(m.shown()?.tab).toBe(0);
    // A long statement is cut in the label and kept whole with the pin.
    await run(m, "select * from t1 where label = 'a rather long condition'");
    await m.host.command("endue.database.pin-result");
    await m.settle();
    expect(tabs(m)[3]?.label).toMatch(new RegExp(`^select \\* from t1 where… · ${TIME}$`, "u"));
    expect(tabs(m)[3]?.pin?.sql).toBe("select * from t1 where label = 'a rather long condition'");
    m.app.tab(3);
    await expect(m.host.command("endue.database.pin-result")).rejects.toThrow(
      "This result is pinned already.",
    );
    m.app.tab(1);
    await expect(m.host.command("endue.database.pin-result")).rejects.toThrow(
      "Pin a result with rows: Messages is not one.",
    );
  });

  it("a pinned tab is kept as it was: edits are refused and Explain never reads it", async () => {
    const m = await pins();
    await run(m, "select * from stock;");
    await m.host.command("endue.database.pin-result");
    m.app.tab(2);
    await m.app.canEdit();
    await m.settle();
    expect(m.shown()?.edit).toMatchObject({
      status: "refused",
      reason: "A pinned result is kept as it was: run its query again to change its rows.",
    });
    // An EXPLAIN whose plan comes back pinned, then one that brings no rows: no plan from the pin.
    m.view.text = "select * from stock_v1";
    await m.host.command("endue.database.explain");
    await m.settle();
    m.app.tab(tabs(m).findIndex((tab) => tab.kind === "rows"));
    await m.host.command("endue.database.pin-result");
    m.view.text = "select * from nothing";
    await m.host.command("endue.database.explain");
    await m.settle();
    expect(kinds(m)).toEqual(["messages", "pinned", "pinned"]);
  });

  it("pinned tabs count against a memory limit: the oldest are let go and the status line says so", async () => {
    const m = await pins(sizeOf(one) * 2 + 8);
    await run(m, "select * from t1");
    await m.host.command("endue.database.pin-result");
    await run(m, "select * from t2");
    await m.host.command("endue.database.pin-result");
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    await run(m, "select * from t3");
    expect(await m.host.command("endue.database.pin-result")).toMatch(
      new RegExp(
        `^Pinned select \\* from t3 · ${TIME}\\. Let go of select \\* from t1 · ${TIME} \\(Notes\\): pinned results keep at most \\d+ B\\.$`,
        "u",
      ),
    );
    await m.settle();
    await m.host.command("endue.database.consoles", { console: "Notes" });
    await m.settle();
    expect(
      tabs(m)
        .filter((tab) => tab.kind === "pinned")
        .map((tab) => tab.pin?.sql),
    ).toEqual(["select * from t2"]);
    await run(m, "select * from big");
    await expect(m.host.command("endue.database.pin-result")).rejects.toThrow(
      /Not pinned: this result holds about \d+(\.\d)? KiB, and pinned results keep at most \d+ B\. Load fewer rows and pin again\.$/u,
    );
    expect(tabs(m).filter((tab) => tab.kind === "pinned")).toHaveLength(1);
  });

  it("unpin takes a pinned tab away", async () => {
    const m = await pins();
    await run(m, "select * from t1");
    await m.host.command("endue.database.pin-result");
    await run(m, "select * from t2");
    await m.host.command("endue.database.pin-result");
    m.app.tab(3);
    expect(await m.host.command("endue.database.unpin-result")).toMatch(
      new RegExp(`^Unpinned select \\* from t2 · ${TIME}\\.$`, "u"),
    );
    await m.settle();
    expect(kinds(m)).toEqual(["rows", "messages", "pinned"]);
    expect(m.shown()?.tab).toBe(2);
    // From another tab, the palette asks which.
    m.app.tab(0);
    const picked: string[] = [];
    const lite = await mount({
      store: { connections: SAVED },
      script: stockScript(base),
      pick: ({ items }) => {
        picked.push(...items.map((i) => i.label));
        return items[0]?.id ?? "";
      },
    });
    await lite.host.command("endue.database.console", { connection: "Notes" });
    await run(lite, "select * from t1");
    await lite.host.command("endue.database.pin-result");
    lite.app.tab(0);
    await lite.host.command("endue.database.unpin-result");
    await lite.settle();
    expect(picked).toEqual([
      expect.stringMatching(new RegExp(`^select \\* from t1 · ${TIME}$`, "u")),
    ]);
    expect(kinds(lite)).toEqual(["rows", "messages"]);
    await expect(lite.host.command("endue.database.unpin-result")).rejects.toThrow(
      "No result is pinned in this console.",
    );
  });
});
