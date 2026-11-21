// @vitest-environment jsdom
// Which sessions of the activity view are the desk's own (#564): the session that read is "this
// view", one of the plugin's sessions on this desk (db.list, on the connection's server) is "this
// desk", and another desk's `endue Desk` session has no mark. "Hide the view's reads" hides the
// session that read and any other running one of the view's statements, in Sessions and in Locks.
// The footer's count follows each read while it still shows the panel's sentence, and the time of
// a read is on the explorer's 24-hour clock.
import { afterEach, describe, expect, it } from "vitest";
import { feature } from "../ui/features/activity/index.js";
import { DEFAULT_VIEW, readOf, saidOf } from "../ui/features/activity/model.js";
import { sessionsSql } from "../ui/features/activity/sql.js";
import { ACTIVITY_CONNECTION, activityRows, activityServer } from "./activity-fixture";
import { mount } from "./harness";

const panel = feature.panels?.activity;
if (!panel) throw new Error("the activity feature draws an activity panel");

/** Another desk's view reading the sessions this moment, holding its locks on the catalog. */
const READER = [
  ...["4252", "", "app", "warehouse", "endue Desk", "10.0.0.9", "50700", "client backend"],
  ...["active", "", "", "0", "0", "0", "", sessionsSql()],
];
const READER_LOCKS = [
  ["4252", "relation", "AccessShareLock", "t", "warehouse", "pg_locks", "", "", "", "", "", ""],
  ["4252", "virtualxid", "ExclusiveLock", "t", "", "", "", "", "7/1", "", "", ""],
];
const OWN_LOCK = ["4250", "relation", "AccessShareLock", "t", "warehouse", "pg_locks"];

function read(mine: number[] = [], at = Date.now()) {
  const rows = activityRows();
  const locks = [...rows.locks, [...OWN_LOCK, "", "", "", "", "", ""], ...READER_LOCKS];
  return readOf(rows.head, [...rows.sessions, READER], locks, false, at, new Set(mine));
}
function state(patch: Record<string, unknown> = {}) {
  return {
    read: read(),
    error: "",
    reading: false,
    ...structuredClone(DEFAULT_VIEW),
    selected: null,
    whole: false,
    period: 5,
    paused: false,
    conn: { name: "warehouse", readOnly: false, tag: "none" },
    ...patch,
  };
}
const drawn: Array<{ destroy?(): void }> = [];
function draw(patch: Record<string, unknown> = {}) {
  const made = panel?.render(document, state(patch), () => undefined, { id: "b-1" } as never);
  if (!made || "nodeType" in made) throw new Error("the panel changes in place");
  document.body.append(made.el);
  drawn.push(made);
  return made;
}
const pids = (el: HTMLElement, part: string) =>
  [...el.querySelectorAll<HTMLElement>(`[data-part="${part}"] tbody tr`)].map((r) => r.dataset.pid);
const mark = (el: HTMLElement, pid: string) =>
  el.querySelector(`[data-part="sessions"] tr[data-pid="${pid}"] .desk-badge`)?.textContent;
const ALL = { idle: false, own: false, system: true, database: "" };

afterEach(() => {
  for (const handle of drawn.splice(0)) handle.destroy?.();
  document.body.innerHTML = "";
});

describe("the activity view's own sessions", () => {
  it("marks only this desk's sessions", () => {
    expect(read().sessions.find((s) => s.pid === 4250)?.own).toBe("view");
    expect(read().sessions.find((s) => s.pid === 4251)?.own).toBe("");
    expect(read([4251]).sessions.find((s) => s.pid === 4251)?.own).toBe("desk");
    const el = draw({ read: read([4251]), filters: ALL }).el;
    expect(mark(el, "4250")).toBe("this view");
    expect(mark(el, "4251")).toBe("this desk");
    // Another desk's endue session: its Application says so, and no mark.
    expect(mark(draw({ filters: ALL }).el, "4251")).toBeUndefined();
  });

  it("asks db.list which sessions are this desk's, on the connection's server only", async () => {
    const listed = (pid: number, host: string) => ({
      sessionId: `d-${pid}`,
      host,
      port: 5432,
      database: "warehouse",
      user: "app",
      pid,
      running: false,
      more: false,
      transaction: "idle",
    });
    const m = await mount({
      store: { connections: [ACTIVITY_CONNECTION] },
      script: activityServer().script,
      handlers: {
        "db.list": () => ({
          sessions: [listed(4251, "db.example"), listed(4300, "other.example")],
        }),
      },
    });
    await m.host.command("endue.database.activity", { connection: "warehouse" });
    const sessions = m.shown()?.activity.read.sessions as { pid: number; own: string }[];
    expect(sessions.find((s) => s.pid === 4251)?.own).toBe("desk");
    expect(sessions.find((s) => s.pid === 4300)?.own).toBe("");
    expect(m.host.calls.filter((c) => c.method === "db.list").length).toBeGreaterThanOrEqual(1);
  });

  it("hides the view's reads with their locks", () => {
    const hidden = draw().el;
    expect(pids(hidden, "sessions")).not.toContain("4252");
    expect(pids(hidden, "sessions")).not.toContain("4250");
    expect(pids(hidden, "locks")).not.toContain("4252");
    expect(pids(hidden, "locks")).not.toContain("4250");
    expect(hidden.querySelector('[data-ctl="own"]')?.parentElement?.textContent).toContain(
      "Hide the view's reads",
    );
    const shown = draw({ filters: { ...DEFAULT_VIEW.filters, own: false } }).el;
    expect(pids(shown, "sessions")).toContain("4252");
    expect(pids(shown, "locks")).toEqual(expect.arrayContaining(["4250", "4252"]));
    // Agents get the default view: without the view's reads.
    expect(
      read()
        .sessions.filter((s) => s.reads)
        .map((s) => s.pid),
    ).toEqual([4252]);
  });

  it("puts each read's count in the footer while the footer shows the panel's sentence", () => {
    document.body.innerHTML = '<p id="hints"></p><p id="status"></p>';
    const status = document.getElementById("status") as HTMLElement;
    const first = read();
    const handle = draw({ read: first });
    // What the open command said after the first read.
    status.textContent = saidOf("warehouse", first);
    expect(status.textContent).toBe("9 sessions on warehouse, 2 waiting; 1 hides its statement.");
    const rows = activityRows();
    const second = readOf(rows.head, rows.sessions, rows.locks, false, Date.now(), new Set());
    handle.update?.(state({ read: second }));
    expect(status.textContent).toBe(saidOf("warehouse", second));
    expect(status.textContent).toBe("8 sessions on warehouse, 2 waiting; 1 hides its statement.");
    // Something else said since is kept.
    status.textContent = "Cancelled the statement of session 4242.";
    handle.update?.(state({ read: first }));
    expect(status.textContent).toBe("Cancelled the statement of session 4242.");
  });

  it("says when it was read on the explorer's 24-hour clock", () => {
    const at = new Date(2026, 10, 22, 0, 31, 7).getTime();
    const el = draw({ read: read([], at) }).el;
    const line = el.querySelector(".activity-status")?.textContent ?? "";
    expect(line).toMatch(/^read (\d{4}-\d{2}-\d{2} )?00:31:07 · PostgreSQL 17\.6 · /u);
    expect(line).not.toMatch(/AM|PM/u);
  });
});
