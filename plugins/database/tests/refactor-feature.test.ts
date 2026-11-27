// The refactorings' feature (PG-33) mounted beside the others, on the shop's scripted server and its
// schema cache, with the parse worker's service in this thread: rename at the caret changes a CTE
// in the console in one edit and asks the new name with the palette; on a column it reads the
// server, opens the script in a new console and runs no ALTER; extract, inline and qualify change
// the statement at the caret and leave the others; a SQLite console is told what they read.
import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { type Mounted, mount, SAVED } from "./harness";
import { threadWorker } from "./navigate-fixture";
import { catalogScript, shop } from "./pg-catalog";
import { renameAnswer } from "./refactor-fixture";

beforeAll(async () => {
  provideSqlParser(await threadWorker());
});

const row = (m: Mounted, label: string) => m.view.trees.at(-1)?.find((r) => r.label === label);
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}

const asked: string[] = [];
/** The rename's read answered by its fixture, every statement recorded. */
const rename = (sql: string) => {
  asked.push(sql);
  return renameAnswer(sql) ?? {};
};

async function shopConsole(text: string, pick = "") {
  const m = await mount({
    store: { connections: SAVED },
    script: catalogScript(() => shop(), rename),
    pick: () => pick,
  });
  await m.host.command("endue.database.console", { connection: "Shop" });
  await until(m, () => row(m, "Shop"));
  m.app.toggle(row(m, "Shop") as Node, true);
  await until(m, () => row(m, "public"));
  m.app.toggle(row(m, "public") as Node, true);
  await m.settle();
  m.app.edited(text.replace("|", ""));
  m.view.text = text.replace("|", "");
  m.view.caret = text.indexOf("|");
  return m;
}

describe("the refactorings' feature", () => {
  it("rename at the caret renames a CTE in the console with the palette's answer", async () => {
    const m = await shopConsole(
      "select 1;\nwith t as (select id from people) select t.id from t|",
      "picked",
    );
    await m.host.command("endue.database.rename-at-caret");
    expect(m.picks.at(-1)?.title).toBe("Database: rename t to?");
    expect(m.view.text).toBe(
      "select 1;\nwith picked as (select id from people) select picked.id from picked",
    );
    expect(m.view.said.at(-1)).toBe("Renamed t to picked in 3 places.");
  });

  it("on a column it opens the script in a console of its own and runs no ALTER", async () => {
    const m = await shopConsole("select na|me from people");
    const first = m.shown()?.id;
    asked.length = 0;
    const done = (await m.host.command("endue.database.rename-at-caret", { to: "full_name" })) as {
      script: string;
    };
    expect(m.shown()?.id).not.toBe(first);
    expect(m.shown()?.title).toBe("rename · public.people.name");
    expect(m.view.text).toBe(done.script);
    expect(done.script).toContain("ALTER TABLE public.people RENAME COLUMN name TO full_name;");
    expect(done.script).toContain("UPDATE people SET full_name = upper(full_name);");
    expect(done.script).toContain("--   view public.named");
    expect(asked.some((sql) => /ALTER|CREATE OR REPLACE/u.test(sql.split("\n")[0] ?? ""))).toBe(
      false,
    );
    expect(
      m
        .sessions()
        .flat()
        .some((sql) => sql.startsWith("ALTER")),
    ).toBe(false);
    expect(m.view.said.at(-1)).toBe(
      "The rename's script is in a console, not run: 1 rewritten, 1 follow by themselves, 0 to check by hand.",
    );
  });

  it("rename with dependents takes the object from its arguments", async () => {
    const m = await shopConsole("select 1");
    const done = (await m.host.command("endue.database.rename-with-dependents", {
      connection: "Shop",
      kind: "column",
      schema: "public",
      table: "people",
      name: "name",
      to: "full_name",
    })) as { rewritten: number };
    expect(done.rewritten).toBe(1);
  });

  it("extract, inline and qualify change the statement at the caret", async () => {
    const m = await shopConsole("select 1;\nselect s.id from (select id from peo|ple) s");
    await m.host.command("endue.database.extract-cte");
    expect(m.view.text).toBe("select 1;\nWITH s AS (select id from people)\nselect s.id from s");
    m.view.caret = m.view.text.indexOf("s AS");
    await m.host.command("endue.database.inline-cte");
    expect(m.view.text).toBe("select 1;\nselect s.id from (select id from people) AS s");
    m.view.caret = m.view.text.length;
    await m.host.command("endue.database.qualify-names");
    expect(m.view.text).toBe(
      "select 1;\nselect s.id from (select people.id from public.people) AS s",
    );
    expect(m.view.said.at(-1)).toBe("2 names qualified.");
  });

  it("a SQLite console is told what the refactorings read", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await expect(m.host.command("endue.database.rename-at-caret")).rejects.toThrow(
      "Rename, extract, inline and qualify read PostgreSQL consoles.",
    );
  });
});
