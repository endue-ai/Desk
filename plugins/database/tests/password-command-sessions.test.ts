// A connection's password command on a scripted server (PG-14, ADR 0354): the person's yes comes
// first, once per connection and command; the program runs without a shell for each new session and
// its first line signs it in; a password the server refuses runs it once more; a failing command
// says its standard error's first line; and the password is never kept, shown or logged.
import { describe, expect, it } from "vitest";
import { APPROVALS_KEY } from "../ui/auth/helper.js";
import type { Connection } from "../ui/engines/common.js";
import { ARGV, COMMAND, type Reply, scriptedHelper, TOKENS } from "./password-command-fixture";
import { messages, run, shop } from "./session-helpers";

type Opened = { password?: string; passwordRef?: string };
/** The password of each db.open the server answered (one the desk refused for want of db:connect,
 * and asked for, is left out). */
const passwords = (m: Awaited<ReturnType<typeof shop>>) => {
  const calls = m.host.calls.filter((c) => c.method === "db.open" || c.method === "perm.request");
  return calls
    .filter((c, i) => c.method === "db.open" && calls[i + 1]?.method !== "perm.request")
    .map((c) => (c.params as Opened).password);
};

async function mounted(replies: Reply[], options: { yes?: boolean; password?: string } = {}) {
  const helper = scriptedHelper(replies);
  const m = await shop(
    {
      handlers: helper.handlers,
      pick: ({ title }) => (options.yes === false && /password/u.test(title) ? "no" : "yes"),
      password: options.password ?? "tok-new",
    },
    [TOKENS.conn],
  );
  helper.attach(m.host);
  return { m, helper };
}

/** Every call but db.open, every store value and every line said, as one text. */
const elsewhere = (m: Awaited<ReturnType<typeof shop>>) =>
  JSON.stringify([
    m.host.calls.filter((c) => c.method !== "db.open"),
    m.store,
    m.view.said,
    m.view.consoles.map((c) => c.model),
  ]);

describe("a connection's password command", () => {
  it("asks once for the command, runs it for each new session and signs in with its first line", async () => {
    const { m, helper } = await mounted([{ stdout: "tok-new\nsecond line\n" }]);
    await run(m, "select 1");
    expect(messages(m).join("\n")).not.toMatch(/password/iu);
    expect(helper.spawned[0]).toMatchObject({
      command: "/opt/tokens/db-token",
      args: ARGV,
      scope: { permission: "proc:spawn", commands: ["/opt/tokens/db-token"] },
    });
    expect(passwords(m)).toEqual(["tok-new"]);
    const asked = m.picks.filter((p) => /password/u.test(p.title));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.title).toContain("Shop");
    expect(JSON.stringify(asked[0]?.items)).toContain(JSON.stringify(COMMAND).slice(1, -1));
    expect(m.store[APPROVALS_KEY]).toEqual({ "c-pg": COMMAND });

    // An agent's short run is a new session: the command runs again, nothing is asked.
    await m.host.invoke("endue.database.query", { connection: "Shop", sql: "select 2" });
    await m.settle();
    expect(helper.spawned).toHaveLength(2);
    expect(passwords(m)).toEqual(["tok-new", "tok-new"]);
    expect(m.picks.filter((p) => /password/u.test(p.title))).toHaveLength(1);
    expect(elsewhere(m)).not.toContain("tok-new");
  });

  it("runs the command once more when the server refuses its password, and signs in", async () => {
    const { m, helper } = await mounted([{ stdout: "tok-old\n" }, { stdout: "tok-new\n" }]);
    await run(m, "select 1");
    expect(helper.spawned).toHaveLength(2);
    expect(passwords(m)).toEqual(["tok-old", "tok-new"]);
    expect(messages(m).join("\n")).not.toMatch(/refused|password/iu);
    expect(m.view.passwords.filter(Boolean)).toEqual([]);
  });

  it("stops after one more try, in words, without asking the person to type a password", async () => {
    const { m, helper } = await mounted([{ stdout: "tok-old\n" }]);
    await run(m, "select 1");
    expect(helper.spawned).toHaveLength(2);
    expect(passwords(m)).toEqual(["tok-old", "tok-old"]);
    const said = messages(m).join("\n");
    expect(said).toContain("refused the password Shop's password command printed");
    expect(said).toContain("password authentication failed");
    expect(m.view.passwords.filter(Boolean)).toEqual([]);
    expect(elsewhere(m)).not.toContain("tok-old");
  });

  it("says a failing command's exit and the first line of its standard error", async () => {
    const stderr = "\nerror: the session expired, sign in again\nat line 2\n";
    const { m } = await mounted([{ stderr, code: 3 }]);
    await run(m, "select 1");
    expect(messages(m).join("\n")).toContain(
      "Shop's password command exited with 3: error: the session expired, sign in again",
    );
    expect(passwords(m)).toEqual([]);
  });

  it("an empty first line is no password", async () => {
    const { m } = await mounted([{ stdout: "\n" }]);
    await run(m, "select 1");
    expect(messages(m).join("\n")).toContain("printed no password on its first line");
    expect(passwords(m)).toEqual([]);
  });

  it("a command the person said no to never runs, and a changed command asks again", async () => {
    const { m, helper } = await mounted([{ stdout: "tok-new\n" }], { yes: false });
    await run(m, "select 1");
    expect(helper.spawned).toEqual([]);
    expect(messages(m).join("\n")).toContain("Shop's password command was not run");
    expect(m.store[APPROVALS_KEY]).toBeUndefined();

    const approved = {
      connections: [TOKENS.conn],
      [APPROVALS_KEY]: { "c-pg": `${COMMAND} --old` },
    };
    const again = scriptedHelper([{ stdout: "tok-new\n" }]);
    const n = await shop(
      { handlers: again.handlers, pick: () => "yes", password: "tok-new", store: approved },
      [TOKENS.conn],
    );
    again.attach(n.host);
    await run(n, "select 1");
    expect(n.picks.filter((p) => /password/u.test(p.title))).toHaveLength(1);
    expect(again.spawned).toHaveLength(1);
  });

  it("a command already said yes to runs without asking", async () => {
    const helper = scriptedHelper([{ stdout: "tok-new\n" }]);
    const store = { connections: [TOKENS.conn], [APPROVALS_KEY]: { "c-pg": COMMAND } };
    const m = await shop({ handlers: helper.handlers, password: "tok-new", store }, [TOKENS.conn]);
    helper.attach(m.host);
    await run(m, "select 1");
    expect(m.picks.filter((p) => /password/u.test(p.title))).toEqual([]);
    expect(passwords(m)).toEqual(["tok-new"]);
  });

  it("a connection without a command signs in as before and runs nothing", async () => {
    const helper = scriptedHelper([{ stdout: "tok-new\n" }]);
    const plain = { ...TOKENS.conn, passwordCommand: undefined } as unknown as Connection;
    const m = await shop({ handlers: helper.handlers }, [plain]);
    helper.attach(m.host);
    await run(m, "select 1");
    expect(helper.spawned).toEqual([]);
    expect(passwords(m)).toEqual([undefined]);
  });
});
