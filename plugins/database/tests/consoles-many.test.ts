// A connection has as many consoles as the person opens (PG-24, ADR 0286): each its own desk
// buffer with its own id, name, text, results, parameters and history entries, renamed and closed
// by command, listed in the palette, and back after a restart; the one console an older version
// kept comes back with its text.
import { describe, expect, it } from "vitest";
import type { Console } from "../ui/consoles.js";
import { type Mounted, mount, SAVED } from "./harness";

const notes = { rows: [["n"], ["1"]] };
const opened = (m: Mounted) =>
  m.host.ran
    .filter((r) => r.name === "desk.buffers.open")
    .map((r) => (r.args as { name: string }).name);
/** The consoles the plugin holds, by name, as the palette lists them. */
const listed = async (m: Mounted) => {
  await m.host.command("endue.database.consoles").catch(() => undefined);
  return m.picks.at(-1)?.items.map((i) => i.label) ?? [];
};
const type = async (m: Mounted, text: string) => {
  m.view.text = text;
  m.view.caret = text.length;
  m.app.edited(text);
  await m.settle();
};

describe("many consoles on one connection", () => {
  it("a connection holds as many consoles as are opened, each with its own text, results and parameters", async () => {
    const answers: string[] = [];
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) => (sql.includes("from notes") ? notes : { rows: [["v"], [sql]] }),
      pick: (asked) => {
        const placeholder = (asked as { placeholder?: string }).placeholder ?? "";
        answers.push(placeholder);
        return asked.title.startsWith("Value for") ? "7" : "";
      },
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    const first = m.shown() as Console;
    expect(first).toMatchObject({ kind: "console", name: "db: Notes", consoleId: "c-lite" });
    await type(m, "select * from notes;");
    await m.host.command("endue.database.run");
    await m.settle();

    await m.host.command("endue.database.new-console", { connection: "Notes" });
    const second = m.shown() as Console;
    expect(second).toMatchObject({ kind: "console", name: "db: Notes 2", text: "" });
    expect(second.id).not.toBe(first.id);
    expect(second.consoleId).toMatch(/^k-[0-9a-z]{10}$/u);
    expect(second.shown).toBeNull();
    await type(m, "select :id;");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["select 7"]]);

    // Open a console shows the one used last; the first keeps its own text and result.
    await m.host.command("endue.database.consoles", { console: "Notes" });
    await m.settle();
    expect(m.shown()).toMatchObject({ id: first.id, text: "select * from notes;" });
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1"]]);
    await m.host.command("endue.database.console", { connection: "Notes" });
    expect(m.shown()?.id).toBe(first.id);

    // A parameter typed in one console is not offered in another.
    await type(m, "select :id;");
    await m.host.command("endue.database.run");
    await m.settle();
    await m.host.command("endue.database.consoles", { console: "Notes 2" });
    await m.host.command("endue.database.run");
    await m.settle();
    expect(answers.slice(-2)).toEqual(["42, it's, NULL or =now()", "7"]);
  });

  it("names consoles after their connection, numbered, and renames and closes them by command", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await type(m, "select 'kept';");
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    expect(opened(m)).toEqual(["db: Notes", "db: Notes 2", "db: Notes 3"]);
    await type(m, "select 'gone';");
    const third = m.shown() as Console;

    await m.host.command("endue.database.rename-console", { name: "Reports" });
    expect(m.shown()?.name).toBe("db: Notes · Reports");
    const update = m.host.ran.filter((r) => r.name === "desk.buffers.update").at(-1);
    expect(update?.args).toEqual({ id: third.id, name: "db: Notes · Reports" });

    // A closed console's buffer goes; its text with it, but the first console's stays.
    await m.host.command("endue.database.close-console");
    await m.settle();
    const closes = m.host.ran.filter((r) => r.name === "desk.buffers.close");
    expect(closes.at(-1)?.args).toEqual({ id: third.id });
    expect(m.store[`console:${third.consoleId}`]).toBeNull();
    expect(await listed(m)).toEqual(["Notes", "Notes 2"]);
    await m.host.command("endue.database.consoles", { console: "Notes" });
    await m.host.command("endue.database.close-console");
    await m.settle();
    expect(m.store["console:c-lite"]).toBe("select 'kept';");
    // The next new console takes the smallest number free.
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    expect(m.shown()?.name).toBe("db: Notes 3");
    // With no console of the connection open, Open a console brings the first one back.
    await m.host.command("endue.database.close-console");
    await m.host.command("endue.database.consoles", { console: "Notes 2" });
    await m.host.command("endue.database.close-console");
    await m.settle();
    await m.host.command("endue.database.console", { connection: "Notes" });
    expect(m.shown()).toMatchObject({ name: "db: Notes", text: "select 'kept';" });
  });

  it("brings every console back after a restart with its text, and the one console an older version kept", async () => {
    const before = await mount({ store: { connections: SAVED } });
    await before.host.command("endue.database.console", { connection: "Shop" });
    await type(before, "select 1;");
    await before.host.command("endue.database.new-console", { connection: "Shop" });
    await type(before, "select 2;");
    await before.host.command("endue.database.rename-console", { name: "Audit" });
    await before.host.command("endue.database.new-console", { connection: "Notes" });
    await type(before, "select 3;");
    await before.host.command("endue.database.consoles", { console: "Shop · Audit" });
    await before.settle();
    await new Promise((resolve) => setTimeout(resolve, 450));

    const after = await mount({ store: before.store, state: before.host.state });
    expect(after.shown()).toMatchObject({ name: "db: Shop · Audit", text: "select 2;" });
    expect(await listed(after)).toEqual(["Shop", "Shop · Audit", "Notes 2"]);
    await after.host.command("endue.database.consoles", { console: "Notes 2" });
    expect(after.shown()?.text).toBe("select 3;");
    await after.host.command("endue.database.consoles", { console: "Shop" });
    expect(after.shown()?.text).toBe("select 1;");

    // A state of before many consoles: the console of `current`, with the text kept for it.
    const old = await mount({
      store: { connections: SAVED, "console:c-prod": "select 'from before';" },
      state: { current: "c-prod", expanded: [] },
    });
    expect(old.shown()).toMatchObject({
      kind: "console",
      name: "db: Shop",
      consoleId: "c-prod",
      text: "select 'from before';",
    });
  });

  it("lists the consoles in the palette and shows the one picked", async () => {
    let chosen = "";
    const m = await mount({
      store: { connections: SAVED },
      pick: (asked) => (asked.title === "Database: show which console?" ? chosen : ""),
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    const first = m.shown() as Console;
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    await m.host.command("endue.database.console", { connection: "Shop" });
    chosen = first.id;
    await m.host.command("endue.database.consoles");
    const asked = m.picks.at(-1);
    expect(asked?.title).toBe("Database: show which console?");
    expect(asked?.items.map((i) => i.label)).toEqual(["Notes", "Notes 2", "Shop"]);
    expect(m.shown()?.id).toBe(first.id);
  });

  it("keeps each console's history entries apart", async () => {
    const m = await mount({ store: { connections: SAVED }, script: () => notes });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await type(m, "select 1;");
    await m.host.command("endue.database.run");
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    const second = m.shown() as Console;
    await type(m, "select 2;");
    await m.host.command("endue.database.run");
    await m.settle();
    const history = m.store["history:c-lite"] as Array<{ sql: string; console?: string }>;
    expect(history.map((e) => [e.sql, e.console])).toEqual([
      ["select 2", second.consoleId],
      ["select 1", "c-lite"],
    ]);
  });
});
