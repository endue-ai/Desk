// Navigation's feature (PG-32) mounted beside the others, on the shop's scripted server and its
// schema cache, with the parse worker's service in this thread: go to definition opens a table's
// DDL and moves the caret to a CTE; the card answers what the cache holds; find usages opens the
// usages panel with the catalog's rows and the console's places, and a place shows its console
// with the name selected; a SQLite console is told what navigation reads.
import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { type Mounted, mount, SAVED } from "./harness";
import { threadWorker } from "./navigate-fixture";
import { catalogScript, shop } from "./pg-catalog";

beforeAll(async () => {
  provideSqlParser(await threadWorker());
});

const row = (m: Mounted, label: string) => m.view.trees.at(-1)?.find((r) => r.label === label);
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}

const asked: string[] = [];
/** The usages statements, answered with a view and a foreign key of the catalog's. */
const usages = (sql: string) => {
  if (sql.includes("FROM pg_depend d JOIN target t")) {
    asked.push("catalog");
    return {
      rows: [
        ["kind", "schema", "name", "on_table", "detail"],
        ["view", "public", "big_orders", "", ""],
        [
          "foreign key",
          "public",
          "orders_person_fkey",
          "orders",
          "FOREIGN KEY (person) REFERENCES people(id)",
        ],
      ],
    };
  }
  if (sql.includes("strpos(lower(p.prosrc)"))
    return { rows: [["nspname", "proname", "args", "kind", "lanname", "prosrc"]] };
  return {};
};

async function shopConsole(text: string) {
  const m = await mount({
    store: { connections: SAVED },
    script: catalogScript(() => shop(), usages),
  });
  await m.host.command("endue.database.console", { connection: "Shop" });
  await until(m, () => row(m, "Shop"));
  m.app.toggle(row(m, "Shop") as Node, true);
  await until(m, () => row(m, "public"));
  m.app.toggle(row(m, "public") as Node, true);
  await m.settle();
  const caret = text.indexOf("|");
  m.app.edited(text.replace("|", ""));
  m.view.text = text.replace("|", "");
  m.view.caret = caret;
  const selected: Array<[number, number]> = [];
  m.view.select = (start: number, end: number) => void selected.push([start, end]);
  return { m, selected };
}

describe("navigation's feature", () => {
  it("go to definition opens a table's DDL, and moves the caret to a CTE", async () => {
    const { m, selected } = await shopConsole("with t as (select 1 as x) select * from t, peo|ple");
    await m.host.command("endue.database.go-to-definition");
    await until(m, () => m.shown()?.kind === "ddl");
    expect(m.shown()?.name).toContain("people");
    const again = await shopConsole("with t as (select 1 as x) select * from t|, people");
    await again.m.host.command("endue.database.go-to-definition");
    expect(again.selected).toEqual([[5, 6]]);
    expect(selected).toEqual([]);
  });

  it("the card says what the schema cache holds of the name", async () => {
    const { m } = await shopConsole("select na|me from people");
    const answer = (await m.host.command("endue.database.show-card")) as { card?: unknown };
    expect(answer?.card).toMatchObject({
      title: "public.people.name",
      type: "text",
      comment: "Full name",
    });
  });

  it("find usages lists the catalog's and the console's, and a place opens its console", async () => {
    const text = "select p.name from people p;\nselect * from peo|ple";
    const { m, selected } = await shopConsole(text);
    const console = m.shown();
    asked.length = 0;
    await m.host.command("endue.database.find-usages");
    await until(m, () => m.shown()?.usages?.status === "done");
    expect(asked).toEqual(["catalog"]);
    const state = m.shown()?.usages;
    expect(state.of).toBe("public.people");
    expect(
      state.items.map((u: { source: string; kind: string }) => `${u.source} ${u.kind}`),
    ).toEqual(["catalog view", "catalog foreign key", "parsed console", "parsed console"]);
    const plain = text.replace("|", "");
    const place = state.items[3];
    await m.app.navigateOpen?.(state.connection, place);
    expect(m.shown()?.id).toBe(console?.id);
    expect(selected).toEqual([[plain.lastIndexOf("people"), plain.length]]);
    await m.app.navigateOpen?.(state.connection, state.items[0]);
    await until(m, () => m.shown()?.kind === "ddl");
  });

  it("a SQLite console is told what navigation reads", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await m.host.command("endue.database.go-to-definition");
    await m.host.command("endue.database.find-usages");
    expect(m.view.said.slice(-2)).toEqual([
      "Go to definition, the card and usages read PostgreSQL consoles.",
      "Go to definition, the card and usages read PostgreSQL consoles.",
    ]);
  });
});
