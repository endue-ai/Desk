// Eris in a console against a real PostgreSQL through the desk core (PG-90), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database (as in live.test.ts), with a scripted
// brain (assist-brain.ts): a proposed statement is checked by the server before it is offered, a
// wrong one is offered with the server's own message, and the prompt holds the schema the cache
// read from the server but none of the rows the console's last run returned or an error's DETAIL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { type Asked, scriptedBrain } from "./assist-brain";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

const SETUP = `drop table if exists assist_orders, assist_people cascade;
create table assist_people (id int primary key, name text not null, email text unique);
comment on table assist_people is 'People who buy';
comment on column assist_people.email is 'Where receipts go';
create table assist_orders (id int primary key, person int references assist_people (id), total numeric);
insert into assist_people values (1, 'Ada Lovelace', 'ada@example.test'), (2, 'Bob Byte', 'bob@example.test');
insert into assist_orders values (1, 1, 12), (2, 2, 30)`;

describe.skipIf(!uri)("Eris's proposals against a real PostgreSQL", () => {
  let m: Awaited<ReturnType<typeof mount>>;
  let next: Record<string, unknown> = {};
  const brain = scriptedBrain((_asked: Asked) => next);
  const proposals = () =>
    m.view.dialogs.filter((d) => d.type === "assist-proposal").map((d) => d.model) as Array<{
      text: string;
      server: { state: string; text: string };
    }>;

  beforeAll(async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-assist", name: "Assist" });
    const procs = realProcs(password ? { password } : {});
    m = await mount({
      store: { connections: [conn] },
      handlers: { ...procs.handlers, ...brain.handlers },
      pick: ({ title }) => (/Eris/u.test(title) ? "each person's orders" : "yes"),
      dialog: (type, model) =>
        type === "assist-proposal"
          ? { text: (model as { text: string }).text }
          : { sample: false, production: false },
    });
    procs.attach((event) => m.host.emit(event));
    brain.attach(m.host);
    await m.host.command("endue.database.console", { connection: "Assist" });
    m.view.text = SETUP;
    await m.host.command("endue.database.run-all");
    await m.host.command("endue.database.refresh", { connection: "c-assist" }).catch(() => {});
    await m.settle();
  }, 60_000);
  afterAll(async () => {
    if (!m) return;
    m.view.text = "drop table if exists assist_orders, assist_people cascade";
    await m.host.command("endue.database.run-all").catch(() => {});
  });

  it("checks a proposed statement with the server, and offers a wrong one with its message", async () => {
    next = {
      statement:
        "select p.name, sum(o.total) from assist_people p join assist_orders o on o.person = p.id group by p.name",
      explanation: "Each person's total.",
    };
    m.view.text = "";
    m.view.caret = 0;
    await m.host.command("endue.database.assist-write");
    await m.settle();
    expect(proposals().at(-1)?.server).toMatchObject({ state: "ok" });
    expect(m.view.text).toBe(next.statement);
    const prompt = brain.asked.at(-1)?.prompt ?? "";
    expect(prompt).toContain("public.assist_people");
    expect(prompt).toContain("People who buy");
    expect(prompt).toContain("Where receipts go");

    next = { statement: "select nickname from assist_people", explanation: "Nicknames." };
    m.view.text = "";
    await m.host.command("endue.database.assist-write");
    await m.settle();
    const refused = proposals().at(-1)?.server;
    expect(refused?.state).toBe("refused");
    expect(refused?.text).toMatch(/column "nickname" does not exist/u);
    // Offered all the same, for the person to change; the table is as it was.
    expect(m.view.text).toBe("select nickname from assist_people");
  });

  it("sends none of the rows the last run returned, nor an error's DETAIL", async () => {
    m.view.text = "select * from assist_people order by id";
    await m.host.command("endue.database.run");
    next = { explanation: "Reads every person." };
    await m.host.command("endue.database.assist-explain");
    await m.settle();
    const read = brain.asked.at(-1)?.prompt ?? "";
    expect(read).toContain("select * from assist_people");
    for (const value of ["Ada Lovelace", "ada@example.test", "Bob Byte"])
      expect(read).not.toContain(value);

    m.view.text = "insert into assist_people values (3, 'Cy', 'ada@example.test')";
    await m.host.command("endue.database.run");
    next = {
      statement: "insert into assist_people values (3, 'Cy', 'cy@example.test')",
      explanation: "The email was taken.",
    };
    await m.host.command("endue.database.assist-fix");
    await m.settle();
    const fix = brain.asked.at(-1)?.prompt ?? "";
    expect(fix).toContain("23505");
    expect(fix).toContain("assist_people_email_key");
    expect(fix).not.toContain("already exists");
    expect(proposals().at(-1)?.server).toMatchObject({ state: "ok" });
    expect(m.view.text).toBe("insert into assist_people values (3, 'Cy', 'cy@example.test')");
    // Nothing ran: the proposal is in the console, the table still has two people.
    m.view.text = "select count(*) from assist_people";
    await m.host.command("endue.database.run");
    expect(m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0]).toBe("2");
  });
});
