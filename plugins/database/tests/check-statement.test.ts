// Database: check the statement without running it (PG-21, ADR 0353): the server's Parse and
// Describe of the statement at the caret, on the console's session, never a run of it; what it takes
// and answers shown in the console; the server's error at its place in the editor; a read-only
// connection checks a write; an open transaction stays open (a savepoint); not on SQLite.
import { describe, expect, it } from "vitest";
import type { Bound } from "./clients";
import { SAVED } from "./harness";
import { PG, shop } from "./session-helpers";

type Heard = { sql: string; describe: boolean };

function server(heard: Heard[]) {
  return (sql: string, _who: Record<string, string>, bound?: Bound) => {
    heard.push({ sql, describe: bound?.describe === true });
    if (/format_type/u.test(sql))
      return { rows: [["oid", "format_type"], ["23", "integer"], ["25", "text"]] };
    if (bound?.describe && /nosuch/u.test(sql))
      return { error: 'column "nosuch" does not exist', code: "42703", position: sql.indexOf("nosuch") + 1 };
    if (bound?.describe && /^insert/u.test(sql)) return { paramTypes: [25] };
    if (bound?.describe) return { paramTypes: [23], rows: [["name", "id"]], types: [25, 23] };
    return {};
  };
}

const check = async (m: Awaited<ReturnType<typeof shop>>, text: string, caret = text.length) => {
  m.view.text = text;
  m.view.caret = caret;
  m.app.edited(text);
  const said = await m.host.command("endue.database.check");
  await m.settle();
  return String(said);
};

describe("check without running", () => {
  it("shows what the statement at the caret takes and answers, and runs nothing", async () => {
    const heard: Heard[] = [];
    const m = await shop({ script: server(heard) });
    const said = await check(m, "select 1;\nselect name, id from people where id = :id;", 15);
    expect(said).toBe("Checked, nothing ran: takes :id integer; answers 2 columns.");
    expect(heard.filter((h) => h.describe).map((h) => h.sql)).toEqual([
      "select name, id from people where id = $1",
    ]);
    expect(heard.filter((h) => !h.describe && !/format_type/u.test(h.sql))).toEqual([]);
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([
      ["parameter", ":id", "integer"],
      ["column", "name", "text"],
      ["column", "id", "integer"],
    ]);
  });

  it("puts the caret on the server's error, at the person's own text", async () => {
    const m = await shop({ script: server([]) });
    const text = "select :long_name, nosuch from people";
    const said = await check(m, text);
    expect(said).toBe('Checked, nothing ran: column "nosuch" does not exist.');
    expect(m.shown()?.shown?.error?.offset).toBe(text.indexOf("nosuch"));
  });

  it("checks a write on a read-only connection, and leaves an open transaction open", async () => {
    const heard: Heard[] = [];
    const m = await shop({ script: server(heard) }, [{ ...PG, readOnly: true }]);
    const said = await check(m, "insert into people (name) values ($1)");
    expect(said).toBe("Checked, nothing ran: takes $1 text; answers no rows.");
    expect(heard.some((h) => !h.describe && /^insert/u.test(h.sql))).toBe(false);

    const open = await shop({ script: server(heard) });
    open.view.text = "begin";
    open.app.edited("begin");
    await open.host.command("endue.database.run-all");
    await open.settle();
    heard.length = 0;
    await check(open, "select name, id from people where id = $1");
    expect(heard.map((h) => h.sql).filter((sql) => /SAVEPOINT/u.test(sql))).toEqual([
      "SAVEPOINT endue_desk_check",
      "ROLLBACK TO SAVEPOINT endue_desk_check",
      "RELEASE SAVEPOINT endue_desk_check",
    ]);
    expect(open.shown()?.session).toMatchObject({ state: "open" });
  });

  it("says SQLite does not check without running", async () => {
    const m = await shop({}, SAVED);
    await m.host.command("endue.database.console", { connection: "Notes" });
    await expect(m.host.command("endue.database.check")).rejects.toThrow(/Only PostgreSQL/u);
  });
});
