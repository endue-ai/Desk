// @vitest-environment jsdom
// The maintenance form's DOM (ui/features/maintenance/panel.js, result.js): the operations, the
// options of the server's version, the statement, what it locks and the size; its controls and
// keys; its progress read every period while a run goes on; the result before and after.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceState } from "../ui/features/maintenance/controller.js";
import { feature } from "../ui/features/maintenance/index.js";
import type { Read } from "../ui/features/maintenance/model.js";
import { DEFAULTS } from "../ui/features/maintenance/options.js";
import { POLL_MS } from "../ui/features/maintenance/panel.js";

const panel = feature.panels?.maintenance;
if (!panel) throw new Error("the maintenance feature draws a maintenance panel");
const buffer = {
  id: "b-1",
  connection: "c-warehouse",
  name: "maintenance: warehouse · public.orders",
};
const MB = 1024 * 1024;
const index = (name: string, method = "btree", primary = false) => ({
  ...{ name, clustered: false, primary, valid: true, method, partial: false, bytes: MB },
});
const read = (version = 170006): Read => ({
  version,
  server: `${Math.floor(version / 10000)}.${version % 100}`,
  database: "warehouse",
  recovery: false,
  relkind: "r",
  table: "orders",
  tables: [],
  tablespaces: ["pg_default"],
  indexes: [
    index("orders_customer_idx"),
    index("orders_note_trgm", "gin"),
    index("orders_pkey", "btree", true),
  ],
  stats: {
    ...{ live: 120000, dead: 30000, total: 16 * MB, table: 12 * MB, indexes: 4 * MB },
    ...{ lastVacuum: null, lastAutovacuum: "2026-11-20 03:12:44", lastAnalyze: null },
    ...{ lastAutoanalyze: null, tables: 1, index: null },
  },
});
function state(
  patch: Partial<MaintenanceState> = {},
  options: Partial<MaintenanceState["options"]> = {},
): MaintenanceState {
  return {
    conn: { name: "warehouse", readOnly: false, tag: "none" },
    target: { kind: "table", schema: "public", table: "orders", index: "" },
    read: read(),
    reading: false,
    error: "",
    operation: "vacuum",
    options: { ...DEFAULTS, using: "orders_pkey", ...options },
    run: null,
    timeout: 0,
    ...patch,
  };
}
const run = (
  patch: Partial<NonNullable<MaintenanceState["run"]>> = {},
): NonNullable<MaintenanceState["run"]> => ({
  ...{
    status: "running",
    sql: "VACUUM (FULL, VERBOSE) public.orders",
    started: Date.now() - 4000,
    reads: 0,
  },
  ...{
    progress: null,
    output: [],
    error: "",
    ms: 0,
    before: read().stats,
    after: null,
    cancelling: false,
    note: "",
  },
  ...patch,
});

const drawn: Array<{ destroy?(): void }> = [];
function draw(s: MaintenanceState = state()) {
  const act = vi.fn();
  const made = panel?.render(document, s, act, buffer);
  if (!made || "nodeType" in made) throw new Error("the panel changes in place");
  document.body.append(made.el);
  drawn.push(made);
  return { act, handle: made, el: made.el };
}
const part = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLElement>(`[data-part="${name}"]`);
const key = (target: Element, k: string, mod = false) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, metaKey: mod, bubbles: true, cancelable: true }),
  );

beforeEach(() => {
  document.body.innerHTML = '<p id="hints"></p>';
});
afterEach(() => {
  for (const handle of drawn.splice(0)) handle.destroy?.();
  vi.useRealTimers();
});

describe("the maintenance form", () => {
  it("draws the operations, the options of the version, the statement, what it locks and the size", () => {
    const { el } = draw();
    const tabs = [...el.querySelectorAll<HTMLElement>("[data-op]")];
    expect(tabs.map((t) => t.textContent)).toEqual(["VACUUM", "ANALYZE", "REINDEX", "CLUSTER"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    const keys = [...el.querySelectorAll<HTMLElement>("[data-part=options] [data-key]")].map(
      (x) => x.dataset.key,
    );
    expect(keys).toEqual([
      ...["full", "freeze", "verbose", "analyze", "skipLocked", "indexCleanup"],
      ...["truncate", "parallel", "processToast", "bufferUsageLimit"],
    ]);
    expect(part(el, "statement")?.textContent).toBe("VACUUM (VERBOSE) public.orders");
    const locks = part(el, "locks");
    expect(locks?.dataset.tone).toBe("info");
    expect(locks?.textContent).toContain("What it locks");
    expect(locks?.textContent).toContain("SHARE UPDATE EXCLUSIVE");
    expect(part(el, "facts")?.textContent).toContain(
      "16 MB in all (table 12 MB, indexes 4 MB) · 120,000 rows, 30,000 dead · last vacuum never (auto 2026-11-20 03:12:44)",
    );
    expect(part(el, "target")?.textContent).toContain(
      "public.orders on warehouse · PostgreSQL 17.6",
    );
    const go = el.querySelector<HTMLButtonElement>('[data-ctl="run"]');
    expect(go?.textContent).toBe("Run VACUUM");
    expect(go?.disabled).toBe(false);
    // FULL blocks reads and writes: the callout warns, and what FULL rules out says why.
    const full = draw(state({}, { full: true })).el;
    expect(part(full, "locks")?.dataset.tone).toBe("warning");
    expect(part(full, "locks")?.textContent).toContain("What it blocks");
    const parallel = full.querySelector<HTMLInputElement>('[data-key="parallel"]');
    expect(parallel?.disabled).toBe(true);
    expect(parallel?.closest("label")?.textContent).toContain(
      "Not with FULL, which writes the table anew.",
    );
    // PostgreSQL 13 has neither PROCESS_TOAST nor BUFFER_USAGE_LIMIT.
    const old = draw(state({ read: read(130000) })).el;
    expect(old.querySelector('[data-key="processToast"]')).toBeNull();
    expect(old.querySelector('[data-key="bufferUsageLimit"]')).toBeNull();
    // CLUSTER picks among the indexes that keep an order.
    const cluster = draw(state({ operation: "cluster" })).el;
    const using = cluster.querySelector<HTMLSelectElement>('[data-key="using"]');
    expect([...(using?.options ?? [])].map((o) => o.value)).toEqual([
      "",
      "orders_customer_idx",
      "orders_pkey",
    ]);
    expect(using?.value).toBe("orders_pkey");
    // A read-only connection: Run is off and says why.
    const locked = draw(state({ conn: { name: "locked", readOnly: true, tag: "none" } })).el;
    expect(locked.querySelector<HTMLButtonElement>('[data-ctl="run"]')?.disabled).toBe(true);
    expect(part(locked, "refused")?.textContent).toBe(
      "locked is read-only: VACUUM, ANALYZE, REINDEX and CLUSTER do not run on it.",
    );
    // A failed read, with Try again.
    const failed = draw(state({ read: null, error: "canceling statement due to lock timeout" })).el;
    expect(part(failed, "notice")?.getAttribute("role")).toBe("alert");
    expect(part(failed, "notice")?.querySelector('[data-ctl="refresh"]')?.textContent).toBe(
      "Try again",
    );
  });

  it("changes options, runs with the button and Mod+Enter, cancels with Escape", () => {
    const { el, act, handle } = draw();
    el.querySelector<HTMLInputElement>('[data-key="full"]')?.click();
    expect(act).toHaveBeenLastCalledWith("maintenanceView", "b-1", { options: { full: true } });
    const cleanup = el.querySelector<HTMLSelectElement>('[data-key="indexCleanup"]');
    if (cleanup) cleanup.value = "off";
    cleanup?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(act).toHaveBeenLastCalledWith("maintenanceView", "b-1", {
      options: { indexCleanup: "off" },
    });
    el.querySelector<HTMLElement>('[data-op="analyze"]')?.click();
    expect(act).toHaveBeenLastCalledWith("maintenanceView", "b-1", { operation: "analyze" });
    el.querySelector<HTMLElement>('[data-ctl="run"]')?.click();
    expect(act).toHaveBeenLastCalledWith("maintenanceRun", "b-1");
    // The focused control keeps the focus across a redraw.
    const box = el.querySelector<HTMLInputElement>('[data-key="freeze"]');
    box?.focus();
    expect(document.getElementById("hints")?.textContent).toBe(
      "Mod+Enter run · Escape cancel · g read again",
    );
    handle.update?.(state({}, { freeze: true }));
    expect((document.activeElement as HTMLElement | null)?.dataset.key).toBe("freeze");
    act.mockClear();
    key(document.activeElement as Element, "Enter", true);
    expect(act).toHaveBeenLastCalledWith("maintenanceRun", "b-1");
    key(el, "g");
    expect(act).toHaveBeenLastCalledWith("maintenanceRefresh", "b-1");
    act.mockClear();
    key(document.activeElement as Element, "g");
    expect(act).not.toHaveBeenCalled();
    // While it runs: no Run, a Cancel, Escape cancels, options are off.
    handle.update?.(state({ run: run() }));
    expect(el.querySelector<HTMLButtonElement>('[data-ctl="run"]')?.disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>('[data-key="full"]')?.disabled).toBe(true);
    key(el, "Escape");
    expect(act).toHaveBeenLastCalledWith("maintenanceCancel", "b-1");
    el.querySelector<HTMLElement>('[data-ctl="cancel"]')?.click();
    expect(act).toHaveBeenLastCalledWith("maintenanceCancel", "b-1");
    act.mockClear();
    key(el, "Enter", true);
    expect(act).not.toHaveBeenCalled();
    handle.update?.(state({ run: run({ cancelling: true }) }));
    expect(el.querySelector<HTMLButtonElement>('[data-ctl="cancel"]')?.textContent).toBe(
      "Cancelling…",
    );
  });

  it("reads progress every period while running and shows the result before and after", () => {
    vi.useFakeTimers();
    const { el, act, handle } = draw(state({ run: run() }));
    expect(part(el, "progress")?.textContent).toMatch(/^Running for 4\.\d s · starting\.$/u);
    vi.advanceTimersByTime(POLL_MS);
    expect(act.mock.calls.filter((c) => c[0] === "maintenanceProgress")).toHaveLength(1);
    // After each read, the next one a period later.
    const progress = {
      ...{ pid: 4321, wait: "", blockedBy: [], ms: 4000, command: "VACUUM FULL" },
      ...{ phase: "seq scanning heap", done: 1250, total: 5000, relation: "public.orders" },
    };
    handle.update?.(state({ run: run({ reads: 1, progress }) }));
    expect(part(el, "progress")?.textContent).toBe(
      "Running for 4.0 s · VACUUM FULL · seq scanning heap · 1,250 of 5,000 blocks (25%) · public.orders.",
    );
    const bar = el.querySelector<HTMLProgressElement>("progress");
    expect([bar?.value, bar?.max]).toEqual([1250, 5000]);
    vi.advanceTimersByTime(POLL_MS);
    expect(act.mock.calls.filter((c) => c[0] === "maintenanceProgress")).toHaveLength(2);
    const waiting = {
      ...progress,
      wait: "Lock: relation",
      blockedBy: [4242],
      command: "",
      phase: "",
      total: null,
    };
    handle.update?.(state({ run: run({ reads: 2, progress: waiting }) }));
    expect(part(el, "wait")?.textContent).toBe(
      "Waiting for a lock (Lock: relation) held by session 4242.",
    );
    // Done: the output and the statistics before and after, the changed rows marked.
    const after = {
      ...read().stats,
      dead: 0,
      table: 9 * MB,
      total: 13 * MB,
      lastVacuum: "2026-11-21 10:15:00",
    };
    const output = [
      'INFO:  vacuuming "warehouse.public.orders"',
      "tuples: 30000 removed, 120000 remain",
    ];
    handle.update?.(state({ run: run({ status: "done", ms: 1200, output, after }) }));
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(act.mock.calls.filter((c) => c[0] === "maintenanceProgress")).toHaveLength(2);
    expect(part(el, "ended")?.textContent).toBe("Done in 1.2 s.");
    expect(part(el, "output")?.querySelector("summary")?.textContent).toBe(
      "The server's output (2 lines)",
    );
    expect(part(el, "output")?.querySelector("pre")?.textContent).toBe(output.join("\n"));
    const rows = [...el.querySelectorAll<HTMLElement>("[data-part=stats] tbody tr")];
    const cells = (label: string) =>
      [...(rows.find((r) => r.querySelector("th")?.textContent === label)?.children ?? [])].map(
        (c) => c.textContent,
      );
    expect(cells("Dead rows")).toEqual(["Dead rows", "30,000", "0"]);
    expect(cells("Size in all")).toEqual(["Size in all", "16 MB", "13 MB"]);
    expect(cells("Last vacuum")).toEqual(["Last vacuum", "never", "2026-11-21 10:15:00"]);
    expect(
      rows.filter((r) => r.dataset.changed).map((r) => r.querySelector("th")?.textContent),
    ).toEqual(["Dead rows", "Size in all", "Table", "Last vacuum"]);
    // A failure says the server's words as an alert.
    handle.update?.(
      state({
        run: run({ status: "failed", ms: 300, error: "permission denied for table orders", after }),
      }),
    );
    expect(part(el, "ended")?.getAttribute("role")).toBe("alert");
    expect(part(el, "ended")?.textContent).toBe(
      "Failed after 300 ms. permission denied for table orders",
    );
    handle.destroy?.();
  });
});
