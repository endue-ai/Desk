// The server's activity through the plugin's commands and actions on the SDK's test host, against
// the scripted PostgreSQL of activity-fixture.ts: the panel per connection, a refresh that keeps
// what the person chose, and cancel and end asked first, refused on a read-only connection and
// said plainly when the server refuses.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { ACTIVITY_CONNECTION, activityServer } from "./activity-fixture";
import { type Mounted, mount, SAVED } from "./harness";

const NOTES = SAVED[0] as Connection;
const conn = (fields: Partial<Connection>): Connection => ({ ...ACTIVITY_CONNECTION, ...fields });
const PROD = conn({ id: "c-prod-wh", name: "prod", tag: "production" });
const LOCKED = conn({ id: "c-ro-wh", name: "locked", readOnly: true });

async function start(
  options: {
    refuse?: boolean;
    pick?: (args: { title: string }) => string;
    extra?: Connection[];
  } = {},
) {
  const server = activityServer(() => ({}), { refuse: options.refuse });
  const m = await mount({
    store: { connections: [ACTIVITY_CONNECTION, NOTES, PROD, LOCKED, ...(options.extra ?? [])] },
    script: server.script,
    pick: options.pick ?? (() => "yes"),
  });
  return { m, server };
}
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const psqlRuns = (m: Mounted) => m.sessions().length;

describe("the activity panel", () => {
  it("opens a PostgreSQL connection's activity panel and answers its sessions and waits for agents", async () => {
    const { m } = await start();
    const answer = (await m.host.command("endue.database.activity", {
      connection: "warehouse",
    })) as { server: string; hidden: number; sessions: { pid: number }[]; waits: unknown[] };
    expect(answer.server).toBe("17.6");
    expect(answer.hidden).toBe(1);
    expect(answer.sessions.map((s) => s.pid)).toEqual([4300, 4242, 4243, 4244, 4260]);
    expect(answer.waits).toEqual([
      { pid: 4243, waitsFor: [4242], lock: "ShareLock on transaction 731", waitSeconds: 30 },
      {
        pid: 4244,
        waitsFor: [4243],
        lock: "ExclusiveLock on orders (page 0, tuple 1)",
        waitSeconds: 12,
      },
    ]);
    const shown = m.shown();
    expect(shown).toMatchObject({ kind: "activity", name: "activity: warehouse" });
    expect(shown?.activity.read.sessions).toHaveLength(8);
    expect(shown?.activity).toMatchObject({
      reading: false,
      error: "",
      period: 5,
      paused: false,
      conn: { name: "warehouse", readOnly: false, tag: "none" },
    });
    expect(m.view.said.at(-1)).toBe("8 sessions on warehouse, 2 waiting; 1 hides its statement.");
  });

  it("refuses a connection that is not PostgreSQL", async () => {
    const { m } = await start();
    await expect(
      m.host.command("endue.database.activity", { connection: "Notes" }),
    ).rejects.toThrow("Notes is SQLite: sessions and locks are read from PostgreSQL connections.");
  });

  it("refreshes by hand and keeps the person's filters and sort", async () => {
    const { m } = await start();
    await m.host.command("endue.database.activity", { connection: "warehouse" });
    const id = m.shown()?.id as string;
    await acts(m).activityView?.(id, {
      filters: { idle: false },
      sort: { key: "pid", desc: false },
      selected: 4243,
    });
    expect(m.shown()?.activity.filters).toEqual({
      idle: false,
      own: true,
      system: false,
      database: "",
    });
    const before = psqlRuns(m);
    await m.host.command("endue.database.activity-refresh");
    await m.settle();
    expect(psqlRuns(m)).toBe(before + 1);
    expect(m.shown()?.activity).toMatchObject({
      filters: { idle: false, own: true },
      sort: { key: "pid", desc: false },
      selected: 4243,
    });
    // A period the panel does not offer is refused; one it offers is taken.
    await acts(m).activityView?.(id, { period: 7 });
    expect(m.view.said.at(-1)).toMatch(/every 2, 5, 10, 30 or 60 seconds/u);
    await acts(m).activityView?.(id, { period: 30, paused: true });
    expect(m.shown()?.activity).toMatchObject({ period: 30, paused: true });
  });

  it("asks which session from the palette when none is named", async () => {
    const asked: string[] = [];
    const { m, server } = await start({
      pick: ({ title }) => {
        asked.push(title);
        return asked.length === 1 ? "4243" : "yes";
      },
    });
    await m.host.command("endue.database.cancel-session", { connection: "warehouse" });
    expect(asked[0]).toBe("Database: cancel the statement of which session?");
    expect(m.picks[0]?.items.map((i) => i.id)).toEqual(["4242", "4243", "4244", "4260"]);
    expect(asked[1]).toBe("Cancel the statement of session 4243 on warehouse?");
    expect(server.signals).toEqual(["SELECT pg_catalog.pg_cancel_backend(4243)"]);
  });
});

describe("cancel and end", () => {
  it("cancels a statement only after a yes that shows it, naming production first", async () => {
    const { m, server } = await start();
    await m.host.command("endue.database.activity", { connection: "prod" });
    const done = await m.host.command("endue.database.cancel-session", {
      connection: "prod",
      pid: 4242,
    });
    expect(done).toEqual({ pid: 4242, done: "cancelled" });
    const asked = m.picks.at(-1);
    expect(asked?.title).toBe("Cancel the statement of session 4242 on prod?");
    expect(asked?.items[0]).toMatchObject({ id: "yes", detail: "prod is tagged production." });
    expect(asked?.items.slice(1, -1).map((i) => i.label)).toEqual([
      "Statement: SELECT pg_sleep(600)",
      "alice on warehouse · billing · active for 1 min",
      "The statement stops with an error; the session stays.",
    ]);
    expect(server.signals).toEqual(["SELECT pg_catalog.pg_cancel_backend(4242)"]);
    expect(m.view.said.at(-1)).toBe("Cancelled the statement of session 4242.");
    // The panel read again: the session is still there, its transaction failed.
    const after = m.shown()?.activity.read.sessions.find((s: { pid: number }) => s.pid === 4242);
    expect(after?.state).toBe("idle in transaction (aborted)");
  });

  it("ends a session only after a yes; a no runs nothing", async () => {
    let answer = "no";
    const { m, server } = await start({ pick: () => answer });
    await expect(
      m.host.command("endue.database.end-session", { connection: "warehouse", pid: 4242 }),
    ).rejects.toThrow("Not ended.");
    expect(server.signals).toEqual([]);
    expect(m.picks.at(-1)?.title).toBe("End session 4242 on warehouse?");
    expect(m.picks.at(-1)?.items[0]).toMatchObject({ detail: "Statement: SELECT pg_sleep(600)" });
    answer = "yes";
    await m.host.command("endue.database.activity", { connection: "warehouse" });
    const id = m.shown()?.id as string;
    await acts(m).activityStop?.(id, "end", 4242);
    expect(server.signals).toEqual(["SELECT pg_catalog.pg_terminate_backend(4242, 5000)"]);
    expect(m.view.said.at(-1)).toBe("Ended session 4242.");
    const pids = m.shown()?.activity.read.sessions.map((s: { pid: number }) => s.pid);
    expect(pids).not.toContain(4242);
  });

  it("a read-only connection shows the panel and refuses both", async () => {
    const { m, server } = await start();
    await m.host.command("endue.database.activity", { connection: "locked" });
    expect(m.shown()?.activity.conn).toEqual({ name: "locked", readOnly: true, tag: "none" });
    const picks = m.picks.length;
    for (const id of ["endue.database.cancel-session", "endue.database.end-session"])
      await expect(m.host.command(id, { connection: "locked", pid: 4242 })).rejects.toThrow(
        "locked is read-only: its sessions are not cancelled or ended from here.",
      );
    await acts(m).activityStop?.(m.shown()?.id, "cancel", 4242);
    expect(m.view.said.at(-1)).toBe(
      "locked is read-only: its sessions are not cancelled or ended from here.",
    );
    expect(m.picks).toHaveLength(picks);
    expect(server.signals).toEqual([]);
  });

  it("says the server's refusal plainly when the role may not signal", async () => {
    const { m } = await start({ refuse: true });
    await expect(
      m.host.command("endue.database.cancel-session", { connection: "warehouse", pid: 4242 }),
    ).rejects.toThrow("Not cancelled: permission denied to cancel query");
    expect(m.view.said.at(-1)).toBe("Not cancelled: permission denied to cancel query");
  });

  it("refuses to cancel a session that runs no statement, and a session that is not there", async () => {
    const { m, server } = await start();
    await expect(
      m.host.command("endue.database.cancel-session", { connection: "warehouse", pid: 4300 }),
    ).rejects.toThrow(
      "Session 4300 runs no statement now (idle in transaction): there is nothing to cancel; ending it rolls its transaction back.",
    );
    await expect(
      m.host.command("endue.database.end-session", { connection: "warehouse", pid: 9999 }),
    ).rejects.toThrow("No session 9999 on warehouse: it may have ended.");
    expect(server.signals).toEqual([]);
  });
});
