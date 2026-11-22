// @vitest-environment jsdom
// The activity panel's DOM (ui/features/activity/panel.js): the sessions, who waits for whom, the
// locks and what is hidden; its keys; and its refresh every period while it is on screen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feature } from "../ui/features/activity/index.js";
import { DEFAULT_VIEW, readOf } from "../ui/features/activity/model.js";
import { activityRows } from "./activity-fixture";

const panel = feature.panels?.activity;
if (!panel) throw new Error("the activity feature draws an activity panel");
const buffer = { id: "b-1", connection: "c-warehouse", name: "activity: warehouse" };

function state(patch: Record<string, unknown> = {}) {
  const rows = activityRows();
  return {
    read: readOf(rows.head, rows.sessions, rows.locks, false, 1_700_000_000_000),
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
/** The panel drawn in a box of its own, as #panel-box holds it. */
function draw(patch: Record<string, unknown> = {}) {
  const act = vi.fn();
  const made = panel?.render(document, state(patch), act, buffer);
  if (!made || "nodeType" in made) throw new Error("the panel changes in place");
  const box = document.createElement("div");
  box.append(made.el);
  document.body.append(box);
  drawn.push(made);
  return { act, handle: made, el: made.el };
}
const rows = (el: HTMLElement, part: string) => [
  ...el.querySelectorAll<HTMLElement>(`[data-part="${part}"] tbody tr`),
];
const key = (target: Element, k: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '<p id="hints"></p>';
});
afterEach(() => {
  for (const handle of drawn.splice(0)) handle.destroy?.();
  vi.useRealTimers();
});

describe("the activity panel", () => {
  it("draws the sessions, the blocking tree, the locks and what is hidden", () => {
    const { el } = draw();
    const sessions = rows(el, "sessions");
    expect(sessions.map((r) => r.dataset.pid)).toEqual(["4300", "4242", "4243", "4244", "4260"]);
    expect(sessions[1]?.textContent).toContain("SELECT pg_sleep(600)");
    expect(sessions[2]?.textContent).toContain("Lock: transactionid");
    expect(el.querySelector('[data-part="sessions"] h2')?.textContent).toBe("Sessions (5 of 8)");
    expect(el.querySelector('th[aria-sort="descending"]')?.textContent).toContain("Transaction");
    const tree = el.querySelector('[data-part="tree"]');
    expect(tree?.querySelector("h2")?.textContent).toBe("Waiting (2)");
    const nodes = [...(tree?.querySelectorAll("[role=treeitem]") ?? [])];
    expect(nodes.map((n) => (n as HTMLElement).dataset.pid)).toEqual(["4242", "4243", "4244"]);
    expect(nodes[1]?.querySelector(".activity-node")?.textContent).toContain(
      "waits 30 s for ShareLock on transaction 731, held as ExclusiveLock",
    );
    expect(rows(el, "locks")[0]?.textContent).toContain("waiting");
    expect(el.querySelector('[data-part="notice"]')?.textContent).toContain("pg_read_all_stats");
    expect(el.querySelector(".activity-status")?.textContent).toContain(
      "PostgreSQL 17.6 · 8 sessions, 2 waiting",
    );
    // Shown with every filter off, the view's session is marked; the other endue Desk session is
    // not this desk's (db.list does not name it), so it has no mark (activity-own.test.ts).
    const all = draw({ filters: { idle: false, own: false, system: true, database: "" } }).el;
    const marks = (pid: string) =>
      all.querySelector(`[data-part="sessions"] tr[data-pid="${pid}"] .desk-badge`)?.textContent;
    expect(marks("4250")).toBe("this view");
    expect(marks("4251")).toBeUndefined();
    // A selected session shows its statement, and Cancel and End; a read-only connection turns them off.
    const picked = draw({ selected: 4242 }).el;
    expect(picked.querySelector(".activity-query")?.textContent).toBe("SELECT pg_sleep(600)");
    const locked = draw({ selected: 4242, conn: { name: "w", readOnly: true, tag: "none" } }).el;
    const buttons = [...locked.querySelectorAll<HTMLButtonElement>(".activity-details button")];
    expect(buttons.filter((b) => b.dataset.ctl !== "whole").every((b) => b.disabled)).toBe(true);
    expect(locked.querySelector(".activity-details")?.textContent).toContain("w is read-only");
    // A read that failed says so, with a way to try again.
    const failed = draw({ read: null, error: "could not connect to server" }).el;
    expect(failed.querySelector(".desk-error")?.textContent).toContain(
      "could not connect to server",
    );
    expect(failed.querySelector('.desk-error [data-ctl="refresh"]')).not.toBeNull();
  });

  it("keys inside the panel select a session, show its whole statement, refresh, pause, cancel and end", () => {
    const { act, el, handle } = draw({ selected: 4242 });
    const row = el.querySelector<HTMLElement>('[data-part="sessions"] tr[data-pid="4242"]');
    if (!row) throw new Error("no row for 4242");
    expect(row.getAttribute("aria-selected")).toBe("true");
    row.focus();
    key(row, "ArrowDown");
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", { selected: 4243 });
    key(row, "ArrowUp");
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", { selected: 4300 });
    key(row, "Enter");
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", { whole: true });
    key(row, "g");
    expect(act).toHaveBeenLastCalledWith("activityRefresh", "b-1");
    key(row, "p");
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", { paused: true });
    key(row, "c");
    expect(act).toHaveBeenLastCalledWith("activityStop", "b-1", "cancel", 4242);
    key(row, "e");
    expect(act).toHaveBeenLastCalledWith("activityStop", "b-1", "end", 4242);
    expect(document.getElementById("hints")?.textContent).toContain("c cancel");
    // A field keeps its own keys; a click on a column sorts by it.
    const calls = act.mock.calls.length;
    const select = el.querySelector<HTMLSelectElement>('[data-ctl="database"]');
    if (select) key(select, "g");
    expect(act.mock.calls.length).toBe(calls);
    el.querySelector<HTMLButtonElement>('[data-sort="pid"]')?.click();
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", {
      sort: { key: "pid", desc: false },
    });
    el.querySelector<HTMLInputElement>('[data-ctl="idle"]')?.click();
    expect(act).toHaveBeenLastCalledWith("activityView", "b-1", { filters: { idle: false } });
    handle.destroy?.();
  });

  it("refreshes every period while on screen and unpaused, keeps focus on the selected row, and stops when destroyed", () => {
    vi.useFakeTimers();
    const { act, handle, el } = draw({ selected: 4243 });
    vi.advanceTimersByTime(4999);
    expect(act).not.toHaveBeenCalledWith("activityRefresh", "b-1");
    vi.advanceTimersByTime(1);
    expect(act).toHaveBeenCalledWith("activityRefresh", "b-1");
    // The next read lands while the row has the focus: the focus stays on that session.
    el.querySelector<HTMLElement>('tr[data-pid="4243"]')?.focus();
    const rows2 = activityRows();
    handle.update?.(
      state({ selected: 4243, read: readOf(rows2.head, rows2.sessions, rows2.locks, false, 2) }),
    );
    expect((document.activeElement as HTMLElement | null)?.dataset.pid).toBe("4243");
    act.mockClear();
    // Hidden behind another buffer, it waits; paused, it never reads.
    el.parentElement?.setAttribute("hidden", "");
    vi.advanceTimersByTime(5000);
    expect(act).not.toHaveBeenCalled();
    el.parentElement?.removeAttribute("hidden");
    handle.update?.(
      state({ paused: true, read: readOf(rows2.head, rows2.sessions, rows2.locks, false, 3) }),
    );
    vi.advanceTimersByTime(60_000);
    expect(act).not.toHaveBeenCalled();
    expect(el.querySelector(".activity-status")?.textContent).toContain("Paused");
    handle.update?.(
      state({ period: 2, read: readOf(rows2.head, rows2.sessions, rows2.locks, false, 4) }),
    );
    handle.destroy?.();
    vi.advanceTimersByTime(60_000);
    expect(act).not.toHaveBeenCalled();
  });
});
