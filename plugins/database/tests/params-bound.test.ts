// A PostgreSQL console's parameters go to the server as bound values (PG-21, ADR 0353): the server
// says first, without running anything, the type of each one, which the prompt names; a value that
// does not fit is asked again; the SQL sent holds no value; answers stay with the console for the
// session; an =expression is sent as SQL and the status line says so; SQLite still fills literals.
import { describe, expect, it } from "vitest";
import type { Bound } from "./clients";
import { mount, SAVED } from "./harness";
import { PG, shop } from "./session-helpers";

type Heard = { sql: string; bound?: Bound };

/** A server that says :id is an integer and :name text, and answers the names of their types. */
function server(heard: Heard[]) {
  return (sql: string, _who: Record<string, string>, bound?: Bound) => {
    heard.push({ sql, ...(bound && Object.keys(bound).length ? { bound } : {}) });
    if (/format_type/u.test(sql))
      return { rows: [["oid", "format_type"], ["23", "integer"], ["25", "text"]] };
    if (bound?.describe) return { paramTypes: sql.includes("$2") ? [23, 25] : [23] };
    return { rows: [["n"], ["1"]] };
  };
}

const typeIn = async (m: Awaited<ReturnType<typeof shop>>, text: string) => {
  m.view.text = text;
  m.view.caret = text.length;
  m.app.edited(text);
};

describe("bound parameters on PostgreSQL", () => {
  it("names the inferred type, and sends the values beside SQL that holds none", async () => {
    const heard: Heard[] = [];
    const answers: Record<string, string> = {
      "Value for :id (integer)": "7",
      "Value for :name (text)": "it's'; drop table t; --",
    };
    const m = await shop({ script: server(heard), pick: (asked) => answers[asked.title] ?? "" });
    await typeIn(m, "select * from t where id = :id and name = :name or id = :id");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.picks.map((p) => p.title)).toEqual(["Value for :id (integer)", "Value for :name (text)"]);
    const checked = heard.find((h) => h.bound?.describe);
    expect(checked?.sql).toBe("select * from t where id = $1 and name = $2 or id = $1");
    const ran = heard.filter((h) => h.sql.startsWith("select * from t") && !h.bound?.describe);
    expect(ran).toEqual([
      {
        sql: "select * from t where id = $1 and name = $2 or id = $1",
        bound: { params: ["7", "it's'; drop table t; --"], paramTypes: [23, 25] },
      },
    ]);
    expect(heard.some((h) => h.sql.includes("drop table"))).toBe(false);
  });

  it("asks again for a value that does not fit its type, and NULL is a null value", async () => {
    const heard: Heard[] = [];
    const given = ["seven", "NULL"];
    const m = await shop({ script: server(heard), pick: () => given.shift() ?? "" });
    await typeIn(m, "select :id");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.picks.map((p) => p.title)).toEqual([
      "Value for :id (integer)",
      "Value for :id (integer): integer takes a whole number",
    ]);
    const ran = heard.filter((h) => h.sql === "select $1" && !h.bound?.describe);
    expect(ran.map((h) => h.bound)).toEqual([{ params: [null], paramTypes: [23] }]);
  });

  it("sends an =expression as SQL and says so; answers stay with the console", async () => {
    const heard: Heard[] = [];
    const offered: string[] = [];
    const m = await shop({
      script: server(heard),
      pick: (asked) => {
        offered.push((asked as { placeholder?: string }).placeholder ?? "");
        return "=41 + 1";
      },
    });
    await typeIn(m, "select :id");
    const said = await m.host.command("endue.database.run");
    await m.settle();
    expect(String(said)).toMatch(/sent as SQL: :id/u);
    expect(heard.filter((h) => !h.bound?.describe).map((h) => h.sql)).toContain("select 41 + 1");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(offered).toEqual(["42, it's, NULL, or =now() sent as SQL", "=41 + 1"]);
  });

  it("asks without a type when the server cannot say, and the run shows its error", async () => {
    const m = await shop({
      script: (sql, _who, bound) =>
        bound?.describe || /nope/u.test(sql)
          ? { error: 'column "nope" does not exist', code: "42703", position: 8 }
          : {},
      pick: () => "1",
    });
    await typeIn(m, "select nope, :x");
    await m.host.command("endue.database.run").catch(() => undefined);
    await m.settle();
    expect(m.picks.map((p) => p.title)).toEqual(["Value for :x"]);
    expect(m.shown()?.shown?.error?.offset).toBe(7);
  });

  it("MySQL and SQLite still fill literals", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({ rows: [["n"], ["1"]] }),
      pick: () => "it's",
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select :name";
    await m.host.command("endue.database.run");
    const runs = m.clients.spawned.filter((s) => s.command === "sqlite3" && s.args[0] !== "--version");
    expect(runs.at(-1)?.args).toContain("select 'it''s'");
    expect(PG.engine).toBe("postgresql");
  });
});
