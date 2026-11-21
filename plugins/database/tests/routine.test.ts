// A routine's form through the plugin's commands and actions on the SDK's test host, against the
// scripted PostgreSQL of routine-fixture.ts: opened from the explorer's row (x) and the palette with
// an overloaded name's signature picked, the call run in the connection's console with its result
// tabs, OUT columns and notices, the guards volatility decides, the arguments kept for the session,
// and what is refused.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import type { Entry } from "../ui/features/routines/call.js";
import { actionFor } from "../ui/keys.js";
import { ACTIVITY_CONNECTION } from "./activity-fixture";
import { type Mounted, mount, SAVED } from "./harness";
import { routineServer } from "./routine-fixture";

const conn = (fields: Partial<Connection>): Connection => ({ ...ACTIVITY_CONNECTION, ...fields });
const PROD = conn({ id: "c-prod-wh", name: "prod", tag: "production" });
const LOCKED = conn({ id: "c-ro-wh", name: "locked", readOnly: true });
const CONNECTIONS = [ACTIVITY_CONNECTION, SAVED[0] as Connection, PROD, LOCKED];

async function start(
  options: {
    pick?: (args: { title: string }) => string;
    state?: unknown;
    store?: Record<string, unknown>;
  } = {},
) {
  const server = routineServer();
  const m = await mount({
    script: server.script,
    store: options.store ?? { connections: CONNECTIONS },
    pick: options.pick ?? (() => "yes"),
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  return { m, server };
}
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const row = (name: string, ident: string, kind = "function", connection = "c-warehouse"): Node =>
  ({
    key: `k-${ident}`,
    kind: "object",
    label: name,
    detail: kind,
    level: 4,
    expandable: false,
    expanded: false,
    connection,
    schema: "public",
    object: { schema: "public", name, kind, detail: "", rows: null, ident },
  }) as Node;
const ADD_TAX = row("add_tax(amount numeric, rate numeric)", "9001");
const v = (value: string): Entry => ({ choice: "value", value });
/** What the sessions ran of routine calls and transaction statements, in order (db.run). */
const runs = (m: Mounted) =>
  m
    .sessions()
    .flat()
    .filter(
      (sql) =>
        /^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(sql) ||
        /^(?:SELECT \* FROM |SELECT |CALL )public\.\w+\(/u.test(sql),
    );
const form = (m: Mounted) => m.view.consoles.findLast((c) => c.model?.kind === "routine")?.model;
/** The reasons of the last question asked: Yes's detail, then the lines before No. */
const reasons = (m: Mounted) =>
  ((m.picks.at(-1)?.items ?? []) as Array<{ id: string; label: string; detail?: string }>)
    .filter((i) => i.id !== "no")
    .map((i) => i.detail ?? i.label);

describe("opening the form", () => {
  it("opens the form from the explorer's routine row (x) and from the palette, choosing the signature of an overloaded name first", async () => {
    const { m } = await start({
      pick: ({ title }) =>
        ({
          "Database: run a routine of which connection?": "c-warehouse",
          "Database: run which function or procedure?": "public\u0000area",
          "Database: which signature of public.area?": "9003",
        })[title] ?? (title.startsWith("Database: function ") ? "run" : ""),
    });
    expect(actionFor("explorer", { key: "x", mod: false, shift: false, alt: false })).toBe(
      "routine",
    );
    await acts(m).routine?.(ADD_TAX);
    expect(m.shown()).toMatchObject({
      kind: "routine",
      name: "routine: warehouse · public.add_tax(amount numeric, rate numeric)",
    });
    const state = m.shown()?.routine;
    expect(state.routine.args.map((a: { name: string }) => a.name)).toEqual(["amount", "rate"]);
    expect(state).toMatchObject({ oid: "9001", reading: false, error: "", running: false });
    await acts(m).routine?.({ ...ADD_TAX, object: { ...ADD_TAX.object, kind: "table" } } as Node);
    expect(m.view.said.at(-1)).toBe(
      "Pick a function or procedure in the explorer, under Routines.",
    );
    // The row's menu (o, a right click) offers the form first.
    await acts(m).objectMenu?.(row("area(w numeric, h numeric)", "9003"));
    expect(m.picks.at(-1)?.items[0]).toEqual({ id: "run", label: "Run with its arguments…" });
    expect(m.shown()?.name).toBe("routine: warehouse · public.area(w numeric, h numeric)");

    await m.host.command("endue.database.routine");
    const names = m.picks.find((p) => p.title === "Database: run which function or procedure?");
    expect(names?.items).toContainEqual({
      id: "public\u0000area",
      label: "public.area",
      detail: "2 signatures",
    });
    expect(m.picks.at(-1)?.items.map((i) => i.label)).toEqual([
      "public.area(r numeric)",
      "public.area(w numeric, h numeric)",
    ]);
    expect(m.shown()?.name).toBe("routine: warehouse · public.area(w numeric, h numeric)");

    // Named with its signature (spacing and case aside), nothing is picked.
    const picked = m.picks.length;
    await expect(
      m.host.command("endue.database.routine", {
        connection: "warehouse",
        name: "area",
        signature: "R  Numeric",
      }),
    ).resolves.toMatchObject({
      routine: "Function public.area(r numeric)",
      statement: expect.any(String),
    });
    expect(m.picks).toHaveLength(picked);
    await expect(
      m.host.command("endue.database.routine", {
        connection: "warehouse",
        name: "area",
        run: true,
      }),
    ).rejects.toThrow(
      "public.area has 2 signatures: name one with signature (public.area(r numeric); public.area(w numeric, h numeric)).",
    );
    await expect(
      m.host.command("endue.database.routine", { connection: "warehouse", name: "missing" }),
    ).rejects.toThrow("warehouse has no function or procedure missing.");
  });

  it("refuses another engine and a routine that cannot be called, in words", async () => {
    const { m, server } = await start();
    await expect(
      m.host.command("endue.database.routine", { connection: "Notes", name: "x" }),
    ).rejects.toThrow(
      "Notes is SQLite: functions and procedures run from a form on PostgreSQL connections.",
    );
    const answer = await m.host.command("endue.database.routine", {
      connection: "warehouse",
      name: "audit_trigger",
    });
    expect(answer).toMatchObject({
      refused: "public.audit_trigger is a trigger function: its trigger runs it, not a call.",
    });
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      "public.audit_trigger is a trigger function",
    );
    expect(server.ran).toEqual([]);
  });
});

describe("running", () => {
  it("runs the call in the connection's console: its result tabs, OUT columns and RAISE NOTICE lines in Messages, the call in the history", async () => {
    const { m, server } = await start();
    await expect(
      m.host.command("endue.database.routine", {
        connection: "warehouse",
        name: "add_tax",
        arguments: { amount: 100 },
      }),
    ).resolves.toMatchObject({
      routine: "Function public.add_tax(amount numeric, rate numeric)",
      runs: "IMMUTABLE: it only reads, so it runs as a read.",
      statement: "SELECT public.add_tax(amount => 100::numeric)",
      arguments: [
        { name: "amount", mode: "IN", type: "numeric" },
        { name: "rate", mode: "IN", type: "numeric", default: "0.2" },
      ],
    });
    await expect(m.host.command("endue.database.routine-run")).resolves.toMatchObject({
      statement: "SELECT public.add_tax(amount => 100::numeric)",
      console: "warehouse",
      status: "done",
      columns: ["add_tax"],
      rows: [["120.00"]],
      rolledBack: false,
    });
    expect(server.ran).toEqual(["SELECT public.add_tax(amount => 100::numeric)"]);
    expect(runs(m)).toEqual(["SELECT public.add_tax(amount => 100::numeric)"]);
    const console = m.shown();
    expect(console?.kind).toBe("console");
    expect(console?.shown?.tabs.map((t) => t.label)).toEqual(["Result", "Messages"]);
    expect(console?.shown?.tabs[0]?.set?.rows).toEqual([["120.00"]]);
    // Shown again, the form says how its last run ended and where.
    await acts(m).routine?.(ADD_TAX);
    expect(m.shown()?.routine.last).toMatchObject({
      status: "done",
      console: "warehouse",
      sql: "SELECT public.add_tax(amount => 100::numeric)",
      rolledBack: false,
    });
    const history = m.store["history:c-warehouse"] as Array<{ sql: string }>;
    expect(history[0]?.sql).toBe("SELECT public.add_tax(amount => 100::numeric)");

    // A procedure: INOUT and OUT come back as the result's columns, the notice in Messages.
    await m.host.command("endue.database.routine", {
      connection: "warehouse",
      name: "restock",
      arguments: { item: "bolt", qty: 1 },
    });
    const id = m.shown()?.id as string;
    await acts(m).routineRun?.(id);
    const call = "CALL public.restock(item => 'bolt'::text, note => NULL::text, qty => 1::integer)";
    expect(server.ran.at(-1)).toBe(call);
    const shown = m.shown()?.shown;
    expect(shown?.tabs[0]?.set).toMatchObject({
      columns: ["note", "qty"],
      rows: [["restocked bolt", "6"]],
    });
    const lines = shown?.tabs.at(-1)?.lines ?? [];
    expect(lines.some((l) => l.level === "notice" && /restocking bolt/u.test(l.text))).toBe(true);
    // Each call is sent as it is, outside a transaction block.
    expect(runs(m)).toEqual(["SELECT public.add_tax(amount => 100::numeric)", call]);
  });

  it("keeps the guards", async () => {
    let answer = "yes";
    const { m, server } = await start({ pick: () => answer });
    const open = (connection: string, name: string, args: Record<string, unknown> = {}) =>
      m.host.command("endue.database.routine", { connection, name, ...args });
    const archive = { arguments: { before: "2026-01-01" } };
    const call = "SELECT public.archive_orders(before => '2026-01-01'::date)";

    // Read-only: a volatile function and a procedure refused, rolled back too; an immutable one runs.
    await open("locked", "archive_orders", archive);
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      "locked is read-only: public.archive_orders is VOLATILE, so it may change data; it does not run there, not even rolled back.",
    );
    await acts(m).routineView?.(m.shown()?.id, { rollback: true });
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      "locked is read-only",
    );
    await open("locked", "restock", { arguments: { item: "x" } });
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      "locked is read-only: public.restock is a procedure",
    );
    expect(server.ran).toEqual([]);
    await open("locked", "add_tax", { arguments: { amount: 1 } });
    await m.host.command("endue.database.routine-run");
    expect(server.ran).toEqual(["SELECT public.add_tax(amount => 1::numeric)"]);

    // Production: asked, naming it; no runs nothing.
    await open("prod", "archive_orders", archive);
    answer = "no";
    const before = server.ran.length;
    await acts(m).routineRun?.(form(m)?.id);
    expect(server.ran).toHaveLength(before);
    answer = "yes";
    await m.host.command("endue.database.routine-run");
    expect(m.picks.at(-1)?.title).toBe("Run this statement on prod?");
    expect(reasons(m)).toEqual([
      "prod is tagged production.",
      "public.archive_orders is VOLATILE: it may change data.",
      call,
    ]);
    expect(server.ran.at(-1)).toBe(call);
    // Rolled back: sent between BEGIN and ROLLBACK, and not asked.
    const asked = m.picks.length;
    await open("prod", "archive_orders", { ...archive, rollback: true });
    await expect(m.host.command("endue.database.routine-run")).resolves.toMatchObject({
      rolledBack: true,
      summary: expect.stringMatching(/rolled back \(dry run\)$/u),
    });
    expect(m.picks).toHaveLength(asked);
    expect(server.ran.slice(-3)).toEqual(["BEGIN", call, "ROLLBACK"]);
    // A procedure's CALL is asked by the executor, naming production.
    await open("prod", "restock", { arguments: { item: "nut" } });
    await m.host.command("endue.database.routine-run");
    expect(m.picks.at(-1)?.title).toBe("Run this statement on prod?");
    expect(reasons(m)).toContain("prod is tagged production.");

    // An agent's request: run only after the person's yes.
    answer = "no";
    const ran = server.ran.length;
    await expect(open("warehouse", "archive_orders", { ...archive, run: true })).rejects.toThrow(
      "Not run.",
    );
    expect(server.ran).toHaveLength(ran);
    answer = "yes";
    await expect(
      open("warehouse", "archive_orders", { ...archive, run: true }),
    ).resolves.toMatchObject({
      status: "done",
      rows: [["3"]],
      notices: expect.arrayContaining([expect.stringMatching(/3 orders archived/u)]),
    });
    expect(reasons(m)[0]).toBe("An agent asks to run public.archive_orders.");
    await open("warehouse", "restock", { arguments: { item: "pin" }, run: true });
    expect(reasons(m)).toContain("An agent asks to change data.");
    // An agent's read runs without a question.
    const quiet = m.picks.length;
    await open("warehouse", "add_tax", { arguments: { amount: 10, rate: 0.5 }, run: true });
    expect(m.picks).toHaveLength(quiet);
    expect(server.ran.at(-1)).toBe(
      "SELECT public.add_tax(amount => 10::numeric, rate => 0.5::numeric)",
    );

    // A procedure that commits: no rollback offered, sent alone without BEGIN.
    await open("warehouse", "nightly_close", { rollback: true });
    expect(form(m)?.routine.rollback).toBe(false);
    await acts(m).routineView?.(form(m)?.id, { rollback: true });
    expect(form(m)?.routine.rollback).toBe(false);
    await m.host.command("endue.database.routine-run");
    expect(server.ran.slice(-2)).toEqual([
      expect.stringMatching(/./u),
      "CALL public.nightly_close()",
    ]);
    expect(runs(m).at(-1)).toBe("CALL public.nightly_close()");
    expect(runs(m).at(-2)).not.toBe("BEGIN");
  });

  it("remembers the arguments per routine for the session, and nothing after a restart", async () => {
    const { m } = await start();
    await acts(m).routine?.(ADD_TAX);
    const id = m.shown()?.id as string;
    await acts(m).routineView?.(id, { entries: [v("50"), v("0.1")] });
    await acts(m).routine?.(row("archive_orders(before date)", "9007"));
    await m.host.command("endue.database.close-console").catch(() => {});
    await acts(m).routine?.(ADD_TAX);
    expect(m.shown()?.routine.entries).toEqual([v("50"), v("0.1")]);
    await expect(m.host.command("endue.database.routine-run")).resolves.toMatchObject({
      statement: "SELECT public.add_tax(amount => 50::numeric, rate => 0.1::numeric)",
    });
    // Another connection's form of the same routine has its own.
    await acts(m).routine?.(
      row("add_tax(amount numeric, rate numeric)", "9001", "function", "c-prod-wh"),
    );
    expect(m.shown()?.routine.entries).toEqual([]);

    await m.settle();
    expect(JSON.stringify(m.host.state ?? {})).not.toContain("routine");
    const after = await start({ store: m.store, state: m.host.state });
    expect(after.m.view.consoles.some((c) => c.model?.kind === "routine")).toBe(false);
    await acts(after.m).routine?.(ADD_TAX);
    expect(after.m.shown()?.routine.entries).toEqual([]);
  });
});
