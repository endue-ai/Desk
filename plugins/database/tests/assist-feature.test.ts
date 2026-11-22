// Eris in a console (PG-90), through the plugin on the SDK's test host with a scripted brain
// (assist-brain.ts): write from a sentence, explain a statement, fix an error and explain a plan,
// each a command and an editor key whose answer is a proposed edit the person accepts, changes or
// rejects, never a run. What is sent is shown before a connection's first ask and can be read
// again; a connection closed to the brain sends nothing; without a brain the commands say so.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { actionFor } from "../ui/keys.js";
import { type Asked, scriptedBrain } from "./assist-brain";
import { FIXTURE_CONNECTION, fixtureScript } from "./fixtures";
import { FIXTURE_PG_CONNECTION } from "./fixtures-pg";
import { mount } from "./harness";

type Answer = Record<string, unknown> | undefined;
type Dialog = { type: string; model: Record<string, unknown> };
const SENTENCE = "the people with the most orders";
const READ =
  "select p.name, count(*) from people p join orders o on o.person = p.id group by p.name";

async function setup(
  options: {
    conn?: Connection;
    answer?: (asked: Asked) => Answer;
    dialog?: (type: string, model: Record<string, unknown>) => unknown;
  } = {},
) {
  const conn = options.conn ?? FIXTURE_PG_CONNECTION;
  const brain = scriptedBrain(
    options.answer ?? (() => ({ statement: READ, explanation: "Counts." })),
  );
  const m = await mount({
    store: { connections: [conn] },
    script: fixtureScript,
    handlers: brain.handlers,
    pick: ({ title }) => (/Eris/u.test(title) ? SENTENCE : "yes"),
    dialog: (type, model) =>
      options.dialog
        ? options.dialog(type, model as Record<string, unknown>)
        : type === "assist-proposal"
          ? { text: (model as { text: string }).text }
          : { sample: false, production: false },
  });
  brain.attach(m.host);
  await m.host.command("endue.database.console", { connection: conn.name });
  await m.settle();
  const dialogs = () => m.view.dialogs as Dialog[];
  /** Every statement a session ran that is not the schema cache's or the plugin's own reads. */
  const ran = () =>
    m
      .sessions()
      .flat()
      .filter((sql) => !/pg_catalog|information_schema|server_version|current_setting/iu.test(sql));
  return { m, brain, conn, dialogs, ran };
}

describe("Eris writes a statement from a sentence", () => {
  it("shows what is sent first, proposes, and Accept puts it in the console without running it", async () => {
    const { m, brain, dialogs, ran } = await setup();
    m.view.text = "";
    m.view.caret = 0;
    await m.host.command("endue.database.assist-write");
    await m.settle();
    expect(dialogs().map((d) => d.type)).toEqual(["assist-sent", "assist-proposal"]);
    const [sent, proposal] = dialogs();
    const prompt = brain.asked[0]?.prompt ?? "";
    expect(sent?.model.prompt).toBe(prompt);
    expect(sent?.model.mode).toBe("first");
    expect(brain.asked[0]?.tool.name).toBe("propose_sql");
    expect(brain.asked[0]?.scope).toEqual({ permission: "brain:ask" });
    expect(prompt).toContain(SENTENCE);
    // The tables the sentence names and their neighbours, by name, type and comment only.
    expect(prompt).toContain("public.people");
    expect(prompt).toContain("public.orders");
    expect(prompt).toContain("Who buys");
    expect(prompt).toContain("Full name");
    expect(prompt).not.toContain("nextval");
    expect(proposal?.model).toMatchObject({ text: READ, write: false });
    expect(proposal?.model.server).toMatchObject({ state: "ok" });
    expect(m.view.text).toBe(READ);
    // The server checked it with EXPLAIN; nothing else ran.
    expect(ran()).toEqual([`EXPLAIN ${READ}`]);
    // A second ask does not show what is sent again.
    m.view.text = "";
    await m.host.command("endue.database.assist-write", { sentence: "every person" });
    await m.settle();
    expect(dialogs().map((d) => d.type)).toEqual([
      "assist-sent",
      "assist-proposal",
      "assist-proposal",
    ]);
    expect(brain.asked[1]?.prompt).toContain("every person");
  });

  it("marks a write, says a read-only connection refuses it, and Reject leaves the console as it was", async () => {
    const conn = { ...FIXTURE_PG_CONNECTION, readOnly: true };
    const { m, dialogs, ran } = await setup({
      conn,
      answer: () => ({ statement: "delete from orders where id = 1", explanation: "Deletes one." }),
      dialog: (type) => (type === "assist-sent" ? { sample: false, production: false } : undefined),
    });
    m.view.text = "select 1";
    m.view.caret = 8;
    await m.host.command("endue.database.assist-write");
    await m.settle();
    const proposal = dialogs().at(-1)?.model;
    expect(proposal?.write).toBe(true);
    expect((proposal?.marks as string[]).join(" ")).toMatch(/DELETE/u);
    expect((proposal?.marks as string[]).join(" ")).toMatch(/read-only/u);
    expect(m.view.text).toBe("select 1");
    expect(m.view.said.at(-1)).toMatch(/put aside/u);
    expect(ran().some((sql) => /^delete/iu.test(sql))).toBe(false);
  });
});

describe("Eris explains and fixes", () => {
  it("fixes the statement that failed in the last run, with the error's SQLSTATE and message", async () => {
    const { m, brain } = await setup({
      answer: () => ({ statement: "select 1/1", explanation: "Dividing by zero fails." }),
    });
    m.view.text = "select 2;\nselect 1/0;";
    await m.host.command("endue.database.run-all");
    await m.settle();
    await m.host.command("endue.database.assist-fix");
    await m.settle();
    const prompt = brain.asked[0]?.prompt ?? "";
    expect(brain.asked[0]?.tool.name).toBe("fix_sql_error");
    expect(prompt).toContain("division by zero");
    expect(prompt).toContain("22012");
    expect(prompt).toContain("select 1/0");
    expect(m.view.text).toBe("select 2;\nselect 1/1;");
  });

  it("explains the statement at the caret as comments above it, which the person may change", async () => {
    const { m, brain } = await setup({
      answer: () => ({ explanation: "Reads every person." }),
      dialog: (type, model) =>
        type === "assist-proposal"
          ? { text: `${String(model.text)}-- checked\n` }
          : { sample: false, production: false },
    });
    m.view.text = "select 1;\nselect * from people;";
    m.view.caret = 15;
    await m.host.command("endue.database.assist-explain");
    await m.settle();
    expect(brain.asked[0]?.tool.name).toBe("explain_sql");
    expect(brain.asked[0]?.prompt).toContain("select * from people");
    expect(m.view.text).toBe(
      "select 1;\n-- Eris: Reads every person.\n-- checked\nselect * from people;",
    );
  });

  it("explains the console's last plan, with a suggestion after the explanation", async () => {
    const { m, brain } = await setup({
      answer: () => ({
        explanation: "The join reads every order.",
        suggestion: "create index on orders (person)",
      }),
    });
    m.view.text = "select * from orders o join people p on p.id = o.person";
    await m.host.command("endue.database.explain");
    await m.settle();
    await m.host.command("endue.database.assist-plan");
    await m.settle();
    expect(brain.asked[0]?.tool.name).toBe("explain_sql_plan");
    expect(brain.asked[0]?.prompt).toMatch(/"node":/u);
    const proposal = m.view.dialogs.at(-1)?.model as { write: boolean };
    expect(proposal.write).toBe(true);
    expect(m.view.text).toBe(
      [
        "-- Eris: The join reads every order.",
        "create index on orders (person);",
        "select * from orders o join people p on p.id = o.person",
      ].join("\n"),
    );
  });
});

describe("what leaves the desk", () => {
  const lite = { ...FIXTURE_CONNECTION, id: "c-lite", name: "lite" };
  const ticked = (production: boolean) => (type: string, model: Record<string, unknown>) =>
    type === "assist-proposal" ? { text: model.text } : { sample: true, production };

  it("sends rows only when a sample is ticked", async () => {
    const plain = await setup({ conn: lite, answer: () => ({ explanation: "Reads." }) });
    plain.m.view.text = "select * from people";
    await plain.m.host.command("endue.database.run");
    await plain.m.host.command("endue.database.assist-explain");
    await plain.m.settle();
    expect(plain.brain.asked[0]?.prompt).not.toContain("Ada");
    const sampled = await setup({
      conn: lite,
      answer: () => ({ explanation: "Reads." }),
      dialog: ticked(false),
    });
    sampled.m.view.text = "select * from people";
    await sampled.m.host.command("endue.database.run");
    await sampled.m.host.command("endue.database.assist-explain");
    await sampled.m.settle();
    expect(sampled.brain.asked[0]?.prompt).toContain("Ada");
  });

  it("never sends a sample from a production connection unless that is turned on for it", async () => {
    const prod = { ...lite, tag: "production" as const };
    const off = await setup({
      conn: prod,
      answer: () => ({ explanation: "Reads." }),
      dialog: ticked(false),
    });
    off.m.view.text = "select * from people";
    await off.m.host.command("endue.database.run");
    await off.m.host.command("endue.database.assist-explain");
    await off.m.settle();
    expect(off.dialogs()[0]?.model).toMatchObject({ production: true, productionOn: false });
    expect(off.brain.asked[0]?.prompt).not.toContain("Ada");
    const on = await setup({
      conn: prod,
      answer: () => ({ explanation: "Reads." }),
      dialog: ticked(true),
    });
    on.m.view.text = "select * from people";
    await on.m.host.command("endue.database.run");
    await on.m.host.command("endue.database.assist-explain");
    await on.m.settle();
    expect(on.brain.asked[0]?.prompt).toContain("Ada");
  });

  it("shows what was sent at any time, and a connection closed to the brain sends nothing", async () => {
    const { m, brain, dialogs } = await setup();
    m.view.text = "select * from people";
    await m.host.command("endue.database.assist-explain");
    await m.settle();
    await m.host.command("endue.database.assist-sent");
    expect(dialogs().at(-1)).toMatchObject({
      type: "assist-sent",
      model: { mode: "read", prompt: brain.asked[0]?.prompt },
    });
    await m.host.command("endue.database.assist-close");
    await expect(m.host.command("endue.database.assist-explain")).rejects.toThrow(
      /closed to Eris/u,
    );
    expect(brain.asked).toHaveLength(1);
    expect(m.store.assist).toMatchObject({ closed: [FIXTURE_PG_CONNECTION.id] });
    await m.host.command("endue.database.assist-open");
    await m.host.command("endue.database.assist-explain");
    await m.settle();
    expect(brain.asked).toHaveLength(2);
  });

  it("says so without a brain, and the console runs as before", async () => {
    const { m, brain } = await setup();
    brain.unplug();
    m.view.text = "select * from people";
    await expect(m.host.command("endue.database.assist-explain")).rejects.toThrow(/No brain/u);
    expect(m.view.said.at(-1)).toMatch(/No brain/u);
    m.view.text = "select 2";
    await m.host.command("endue.database.run");
    expect(m.view.said.at(-1) ?? "").not.toMatch(/Eris|brain/u);
    expect(m.view.text).toBe("select 2");
  });
});

describe("the keys", () => {
  it("are the editor's, and each runs its command's action", async () => {
    const press = (key: string, shift = false) => ({ key, mod: true, shift, alt: false });
    expect(actionFor("editor", press("i"))).toBe("assistWrite");
    expect(actionFor("editor", press("e"))).toBe("assistExplain");
    expect(actionFor("editor", press("j"))).toBe("assistFix");
    expect(actionFor("editor", press("H", true))).toBe("assistPlan");
    const { m, brain } = await setup({ answer: () => ({ explanation: "Reads." }) });
    m.view.text = "select * from people";
    const app = m.app as unknown as Record<string, () => Promise<unknown>>;
    for (const name of ["assistWrite", "assistExplain", "assistFix", "assistPlan"])
      expect(typeof app[name]).toBe("function");
    await app.assistExplain?.();
    await m.settle();
    expect(brain.asked).toHaveLength(1);
  });
});
