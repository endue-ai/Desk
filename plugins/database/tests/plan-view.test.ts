// @vitest-environment jsdom
// The plan tab and the plans feature on jsdom (PG-70): the statement's totals over the plan, the
// tree with estimate against actual and the marks in words, the flame and the table of the same
// plan, the bar's actions, the options dialog and two plans side by side.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Console } from "../ui/consoles.js";
import { comparePlans } from "../ui/explain/compare.js";
import { optionsFor } from "../ui/explain/options.js";
import { planOf, sqlitePlan } from "../ui/explain/plan.js";
import { SAFETY } from "../ui/features/plans/options-dialog.js";
import { createView } from "../ui/view.js";
import { SAVED } from "./harness";
import { captured, setOf } from "./plans/captured";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const conn = SAVED[1] ?? null;
const pg17 = captured().find((s) => s.num >= 170000 && s.num < 180000)?.plans ?? {};
const read = (plan: unknown) => planOf(setOf(plan)) as NonNullable<ReturnType<typeof planOf>>;
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = (selector: string) => all(selector).map((e) => e.textContent ?? "");

function buffer(fields: Partial<Console>): Console {
  return {
    id: "b-1",
    kind: "console",
    connection: "c-prod",
    name: "db: Shop",
    text: "",
    table: null,
    execution: { at: 1 } as never,
    shown: null,
    running: false,
    tab: 0,
    maxRows: 500,
    edit: null,
    page: null,
    ...fields,
  } as Console;
}

/** A console whose result shows a plan tab drawn as `view`. */
function planTab(plan: ReturnType<typeof read>, view?: "tree" | "flame" | "table") {
  const tab = {
    label: "Plan (analyzed)",
    kind: "plan" as const,
    plan,
    statement: 0,
    ...(view ? { view } : {}),
  };
  return buffer({
    shown: {
      tabs: [tab, { label: "Messages", kind: "messages", statement: -1, lines: [] }],
      open: 0,
      summary: "Done",
    },
  });
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

describe("the plan tab", () => {
  it("draws the summary, the tree with estimate against actual and the marks", () => {
    const act = vi.fn();
    const view = createView(document, act);
    view.console(planTab(read(pg17.join)), conn);
    const summary = text(".plan-summary dt");
    expect(summary).toEqual(["Planning", "Execution", "Buffers", "Planning buffers", "Settings"]);
    expect(text(".plan-summary dd")[2]).toMatch(/^hit 21,272/u);
    expect(text("[role=treeitem] .plan-label")).toEqual([
      "Sort",
      "Nested Loop",
      "Seq Scan on public.customers c",
      "Index Scan on public.orders o using orders_customer",
    ]);
    const facts = text("[role=treeitem] .plan-facts");
    expect(facts[2]).toMatch(/^cost [\d.]+ · est\. 10 → 666 rows · [\d.]+ ms · hit \d+/u);
    expect(facts[3]).toMatch(/est\. 1 × 666 loops → 1,998 rows · [\d.]+ ms/u);
    expect(facts[0]).toMatch(/own [\d.]+ ms of [\d.]+ ms/u);
    expect(text("[role=treeitem]:nth-child(1) .plan-mark")).toEqual([
      "990× more rows than estimated",
      expect.stringMatching(/^the sort spilled to disk/u),
    ]);
    expect(all(".plan-mark.mark-high").length).toBeGreaterThan(0);
    expect(document.querySelector(".plan-tools [aria-selected=true]")?.textContent).toBe("Tree");

    const button = (name: string) =>
      all(".plan-tools button").find((b) => b.textContent === name) as HTMLButtonElement;
    button("Flame").click();
    button("Copy text").click();
    button("Copy JSON").click();
    button("Compare…").click();
    button("Options…").click();
    expect(act.mock.calls).toEqual([
      ["planView", "flame"],
      ["copyPlan", "text"],
      ["copyPlan", "json"],
      ["comparePlans"],
      ["explainOptions"],
    ]);
    view.console(planTab(sqlitePlan([["2", "0", "0", "SCAN t"]])), SAVED[0] ?? null);
    expect(all(".plan-tools button").map((b) => b.textContent)).not.toContain("Options…");
    expect(document.querySelector(".plan-summary")).toBeNull();
  });

  it("draws the flame and the table views of the same plan", () => {
    const view = createView(document, vi.fn());
    const plan = read(pg17.join);
    view.console(planTab(plan, "flame"), conn);
    const blocks = all(".flame-block");
    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.style.width).toBe("100%");
    expect(blocks[0]?.getAttribute("aria-label")).toMatch(
      /^Sort: [\d.]+ ms own of [\d.]+ ms, \d+% of the whole$/u,
    );
    expect(all(".flame-row")).toHaveLength(3);
    expect(document.querySelector(".flame")?.getAttribute("aria-label")).toBe(
      "Where the plan's time goes",
    );
    view.console(planTab(read(pg17.estimate), "flame"), conn);
    expect(document.querySelector(".flame")?.getAttribute("aria-label")).toBe(
      "Where the plan's estimated cost goes",
    );

    view.console(planTab(plan, "table"), conn);
    const rows = () => text(".plan-table tbody th");
    expect(text(".plan-table thead th")).toEqual([
      "Node",
      "Est. rows",
      "Rows",
      "Misestimate",
      "Loops",
      "Own",
      "Total",
      "Share",
      "Marks",
      "Buffers",
    ]);
    const heaviest = [...plan.children, plan].flatMap((n) => [n, ...n.children]);
    expect(rows()[0]).toBe([...new Set(heaviest)].sort((a, b) => b.share - a.share)[0]?.label);
    (
      all(".plan-table thead button").find(
        (b) => b.textContent === "Misestimate",
      ) as HTMLButtonElement
    ).click();
    expect(rows()[0]).toBe("Sort");
    expect(text(".plan-table tbody tr:first-child td")[2]).toBe("×990 more");
  });
});

describe("the plans feature's views", () => {
  it("draws the options dialog with what ANALYZE does to a write", async () => {
    const view = createView(document, vi.fn());
    const model = {
      connection: "Shop",
      version: 170012,
      options: optionsFor(170012).map(({ name, hint, needs, not }) => ({ name, hint, needs, not })),
      on: ["BUFFERS", "WAL"],
    };
    const asked = view.dialog?.("explain-options", model);
    const form = document.querySelector("main > form.plan-options") as HTMLFormElement;
    expect(form.getAttribute("aria-labelledby")).toBe("plan-options-title");
    expect(form.querySelector("h2")?.textContent).toBe("Explain with options");
    expect(form.querySelector(".hint")?.textContent).toBe(
      "Shop · PostgreSQL 17 · remembered for this connection",
    );
    expect(document.getElementById("plan-options-safety")?.textContent).toBe(SAFETY);
    expect(SAFETY).toMatch(/rolled back.*read-only, production and agent guards/u);
    const box = (name: string) => form.querySelector(`input[name=${name}]`) as HTMLInputElement;
    expect([...form.querySelectorAll("input")].map((i) => i.name)).toEqual(
      model.options.map((o) => o.name),
    );
    expect(box("ANALYZE").getAttribute("aria-describedby")).toBe("plan-options-safety");
    expect([
      box("BUFFERS").checked,
      box("WAL").checked,
      box("WAL").disabled,
      box("GENERIC_PLAN").disabled,
    ]).toEqual([true, true, true, false]);
    box("ANALYZE").click();
    expect([box("WAL").disabled, box("GENERIC_PLAN").disabled, box("SERIALIZE").disabled]).toEqual([
      false,
      true,
      false,
    ]);
    box("VERBOSE").click();
    form.requestSubmit();
    expect(await asked).toEqual(["ANALYZE", "BUFFERS", "VERBOSE", "WAL"]);
    expect(document.querySelector("form.plan-options")).toBeNull();

    const again = view.dialog?.("explain-options", model);
    document
      .querySelector("form.plan-options")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await again).toBeUndefined();
    const third = view.dialog?.("explain-options", model);
    (
      all("form.plan-options button").find((b) => b.textContent === "Cancel") as HTMLButtonElement
    ).click();
    expect(await third).toBeUndefined();
    await expect(view.dialog?.("no-such", {})).rejects.toThrow(
      /No feature draws a no-such dialog/u,
    );
  });

  it("draws two plans side by side with each node's change", () => {
    const view = createView(document, vi.fn());
    const before = read(pg17.join);
    const after = read(pg17.loops);
    const side = (sql: string) => ({
      label: "Plan (analyzed)",
      console: "db: Shop",
      sql,
      at: "10:00:00",
      time: 5,
      cost: 900,
      planning: 0.2,
      execution: 5.1,
    });
    const state = {
      before: side("select 1"),
      after: side("select 2"),
      comparison: comparePlans(before, after),
    };
    view.console(
      buffer({ id: "b-2", kind: "plans", name: "plans: Shop · compare", plans: state }),
      conn,
    );
    const box = document.getElementById("panel-box") as HTMLElement;
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("aria-label")).toBe("Two plans compared");
    expect(text(".plans-side h3")).toEqual([
      "Before: Plan (analyzed), 10:00:00",
      "After: Plan (analyzed), 10:00:00",
    ]);
    expect(text(".plans-sql")).toEqual(["select 1", "select 2"]);
    expect(text(".plans-table thead th")).toEqual(["Before", "After", "What changed"]);
    const rows = all(".plans-table tbody tr");
    expect(rows).toHaveLength(state.comparison.rows.length);
    expect(rows[0]?.classList.contains("plans-changed")).toBe(true);
    expect(rows[0]?.querySelector(".plans-change")?.textContent).toMatch(/^Sort → Aggregate/u);
    expect(text(".plans-count")).toEqual([
      `${state.comparison.changed} of ${rows.length} nodes changed`,
    ]);
    expect(document.querySelector('link[href$="features/plans/plans.css"]')).not.toBeNull();
  });
});
