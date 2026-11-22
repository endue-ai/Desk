// A console's read with bound values (PG-21, ADR 0353) scrolls through its cursor too (PG-22, ADR
// 0352): DECLARE takes the read's `$n` with the values beside it, the rows come by FETCH without
// them, and an error's position is in the person's text, placeholders and all.
import { describe, expect, it } from "vitest";
import type { Bound } from "./clients";
import { script as base, shop } from "./session-helpers";

type Sent = { sql: string; params?: unknown[] };
type Mounted = Awaited<ReturnType<typeof shop>>;

const READ = "select n from big where n > $1";
const script = (sql: string, who: Record<string, string>, bound?: Bound) => {
  if (bound?.describe) return { paramTypes: [23] };
  if (/format_type/u.test(sql))
    return {
      rows: [
        ["oid", "format_type"],
        ["23", "integer"],
      ],
    };
  if (sql === READ)
    return { rows: [["n"], ...Array.from({ length: 1200 }, (_, i) => [String(i + 1)])] };
  if (sql === "select $1, nope from t")
    return { error: 'column "nope" does not exist', code: "42703", position: 12 };
  return base(sql, who);
};
/** Every statement the sessions were sent, with its bound values. */
const sent = (m: Mounted): Sent[] =>
  m.host.calls.flatMap((c) => {
    const p = c.params as { sql?: string; params?: unknown[]; statements?: Sent[] };
    if (c.method === "db.run")
      return [{ sql: p.sql ?? "", ...(p.params ? { params: p.params } : {}) }];
    if (c.method === "db.script") return p.statements ?? [];
    return [];
  });
const type = async (m: Mounted, text: string) => {
  m.view.text = text;
  m.view.caret = text.length;
  m.app.edited(text);
  await m.host.command("endue.database.run");
  await m.settle();
};
const set = (m: Mounted) => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set;

describe("a bound read through a cursor", () => {
  it("declares the read with its values, and scrolls by FETCH", async () => {
    const m = await shop({ script, pick: () => "7" });
    await type(m, "select n from big where n > :low");
    const declared = sent(m).find((s) => s.sql.startsWith("DECLARE"));
    expect(declared).toMatchObject({
      sql: `DECLARE endue_desk_rows SCROLL CURSOR FOR\n${READ}`,
      params: ["7"],
    });
    expect(set(m)?.window).toMatchObject({ known: 500, done: false });
    await m.app.page({ rows: "next" });
    expect(set(m)?.rows.at(-1)).toEqual(["1000"]);
    const fetched = sent(m).filter((s) => s.sql.startsWith("FETCH"));
    expect(fetched.length).toBe(2);
    expect(fetched.every((s) => s.params === undefined)).toBe(true);
  });

  it("an error's position is in the person's text, past the placeholder", async () => {
    const m = await shop({ script, pick: () => "7" });
    await type(m, "select :id, nope from t");
    // "nope" at offset 12 as typed (11 in the text sent, where $1 is one character shorter).
    expect(m.shown()?.shown?.error?.offset).toBe(12);
  });
});
