// @vitest-environment jsdom
// The agent audit panel's DOM (ui/features/audit/panel.js, PG-91): the entries newest first with who,
// what, the rows, the person's answer and how each ended; what agents may reach (closed, EXPLAIN
// ANALYZE, the sensitive columns) and the actions each control calls; an update drawn in place.
import { describe, expect, it } from "vitest";
import { feature } from "../ui/features/audit/index.js";

const panel = feature.panels?.agentAudit;
if (!panel) throw new Error("the audit feature draws an agentAudit panel");
const buffer = { id: "b-1", connection: "c-shop", name: "agent audit: shop" };

const entry = (patch: Record<string, unknown>) => ({
  at: "2026-11-22T09:00:00.000Z",
  caller: "agent:reader",
  command: "endue.database.query",
  statement: "select id from people",
  rows: 3,
  asked: false,
  allowed: null,
  outcome: "ran",
  ...patch,
});
const state = (patch: Record<string, unknown> = {}) => ({
  connection: "c-shop",
  name: "shop",
  tag: "staging",
  entries: [
    entry({
      statement: "insert into people (name) values ('Dee')",
      rows: 1,
      asked: true,
      allowed: true,
    }),
    entry({
      caller: "desk",
      statement: "delete from people",
      rows: null,
      asked: true,
      allowed: false,
      outcome: "declined",
    }),
    entry({
      command: "endue.database.schema",
      outcome: "refused",
      rows: null,
      error: "shop is closed to agents.",
    }),
  ],
  access: { closed: false, analyze: true, sensitive: ["people.email"] },
  note: "",
  ...patch,
});

function draw(first = state()) {
  const acts: unknown[][] = [];
  const out = panel?.render(document, first, (...args) => void acts.push(args), buffer);
  const handle = out && "el" in out ? out : { el: out as HTMLElement };
  document.body.replaceChildren(handle.el);
  return { handle, acts, q: (s: string) => handle.el.querySelector(s) as HTMLElement };
}

describe("the audit panel", () => {
  it("draws the entries newest first", () => {
    const { handle } = draw();
    const rows = [...handle.el.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["reader", "query", "insert into people (name) values ('Dee')", "1", "Allowed once", "Ran"],
      ["You (palette)", "query", "delete from people", "", "Declined", "Not run"],
      [
        "reader",
        "schema",
        "select id from peopleshop is closed to agents.",
        "",
        "Not asked",
        "Refused",
      ],
    ]);
    expect(handle.el.querySelector(".desk-header-desc")?.textContent).toBe(
      "shop · staging · 3 entries, kept apart from your history",
    );
  });

  it("shows what agents may reach, and each control acts", () => {
    const { q, acts } = draw();
    const closed = q('[data-ctl="closed"]') as HTMLInputElement;
    expect(closed.checked).toBe(false);
    expect((q('[data-ctl="analyze"]') as HTMLInputElement).checked).toBe(true);
    expect(q(".audit-chips").textContent).toContain("people.email");
    closed.checked = true;
    closed.dispatchEvent(new Event("change"));
    const field = q('[data-ctl="sensitive"]') as HTMLInputElement;
    field.value = "public.people.phone";
    q('[data-ctl="add"]').click();
    q('[data-ctl="remove"]').click();
    q('[data-ctl="export"]').click();
    q('[data-ctl="clear"]').click();
    expect(acts).toEqual([
      ["auditAccess", "c-shop", { closed: true }],
      ["auditAccess", "c-shop", { add: "public.people.phone" }],
      ["auditAccess", "c-shop", { remove: "people.email" }],
      ["auditExport", "c-shop"],
      ["auditClear", "c-shop"],
    ]);
  });

  it("says when nothing ran yet, and draws an update in place", () => {
    const { handle, q } = draw(state({ entries: [] }));
    expect(handle.el.textContent).toContain("No agent has run anything on this connection yet.");
    const el = handle.el;
    if (!("update" in handle) || !handle.update) throw new Error("the panel updates in place");
    handle.update(
      state({
        access: { closed: true, analyze: false, sensitive: [] },
        note: "shop is closed to agents.",
      }),
    );
    expect(handle.el).toBe(el);
    expect((q('[data-ctl="closed"]') as HTMLInputElement).checked).toBe(true);
    expect(q('[role="status"]').textContent).toBe("shop is closed to agents.");
    expect(el.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});
