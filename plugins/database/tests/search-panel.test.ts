// @vitest-environment jsdom
// The value search's panel (ui/features/search/panel.js, results.js) on jsdom, over a run of the
// search on the scripted server: the form with the panel's options, the estimate, the progress while
// it runs, the results grouped by table and column with their counts, scans and keys, the tables
// left out and why, what was typed kept across an update, and the actions its controls call.
import { describe, expect, it } from "vitest";
import type { SearchState } from "../ui/features/search/controller.js";
import { defaults, type Run } from "../ui/features/search/model.js";
import { searchPanel } from "../ui/features/search/panel.js";
import { estimateOf } from "../ui/features/search/plan.js";
import { createRunner } from "../ui/features/search/runner.js";
import { scriptedExecutor } from "./scripted";
import { LEDGER, ledgerColumns, SEARCH_CONNECTION, searchServer } from "./search-fixture";

const candidates = Object.entries(LEDGER).flatMap(([schema, tables]) =>
  tables.map((t) => ({
    schema,
    name: t.name,
    kind: "table",
    rows: t.estimate ? Number(t.estimate) : null,
    partitioned: false,
  })),
);

async function searched() {
  const { execute } = scriptedExecutor((sql, env) =>
    searchServer()(sql, { ...env, PGDATABASE: "ledger" }),
  );
  const runner = createRunner({ execute, columns: async (_c, s, t) => ledgerColumns(s, t) });
  const options = {
    ...defaults(),
    value: "4242",
    match: "contains" as const,
    schemas: ["public", "sales"],
  };
  const told: Run[] = [];
  const run = await runner.run(SEARCH_CONNECTION, estimateOf(candidates, options), options, {
    signal: new AbortController().signal,
    progress: (r) => told.push(r),
  });
  return { run, told, options };
}

function draw(state: SearchState) {
  const acts: unknown[][] = [];
  const handle = searchPanel(document, state, (...args) => acts.push(args), { id: "b-1" });
  document.body.replaceChildren(handle.el);
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
  return { handle, acts, text };
}

const base = (fields: Partial<SearchState> = {}): SearchState => ({
  conn: { name: "ledger", engine: "postgresql", readOnly: false, tag: "none" },
  schemas: ["public", "sales"],
  options: { ...defaults(), schemas: ["public"], value: "4242" },
  estimate: "Reads 6 tables, about 80 thousand rows, one at a time, read-only, at most 10 s each.",
  run: null,
  error: "",
  ...fields,
});

describe("the search panel", () => {
  it("draws the form, the progress and the grouped results, and calls the actions", async () => {
    const { run, told, options } = await searched();
    const { handle, acts, text } = draw(base());
    const value = document.querySelector<HTMLInputElement>('input[name="value"]');
    expect(value?.value).toBe("4242");
    expect(text(".desk-header-title")).toBe("Search for a value");
    const schemas = [...document.querySelectorAll<HTMLInputElement>('input[name="schemas"]')];
    expect(schemas.map((s) => [s.value, s.checked])).toEqual([
      ["public", true],
      ["sales", false],
    ]);
    expect(document.querySelectorAll('input[name="families"]:checked')).toHaveLength(5);
    expect(text('[data-part="estimate"]')).toMatch(/^Reads 6 tables/u);
    expect(document.querySelector<HTMLButtonElement>('[data-ctl="cancel"]')?.disabled).toBe(true);

    // A change of what is read asks for a new estimate; Search sends every field.
    schemas[1]?.click();
    expect(acts.at(-1)?.slice(0, 2)).toEqual(["searchChange", "b-1"]);
    expect(((acts.at(-1) ?? [])[2] as { schemas: string[] }).schemas).toEqual(["public", "sales"]);
    (document.querySelector('select[name="match"]') as HTMLSelectElement).value = "regex";
    document.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(acts.at(-1)?.slice(0, 2)).toEqual(["searchStart", "b-1"]);
    expect(acts.at(-1)?.[2]).toMatchObject({
      value: "4242",
      match: "regex",
      rowLimit: 100,
      timeoutSeconds: 10,
      sizeLimit: 1_000_000,
      big: false,
    });

    // While it runs: the progress, Cancel, and the tables found so far.
    const midway = told.find((r) => r.tables.length === 2 && r.phase === "running") as Run;
    handle.update?.(base({ options, run: midway }));
    expect(text('[data-part="progress"]')).toMatch(
      /^ Searching public\.\w+ · \d of 8 tables · 3 rows found so far$/u,
    );
    expect(document.querySelector<HTMLButtonElement>('[data-ctl="cancel"]')?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-ctl="cancel"]')?.click();
    expect(acts.at(-1)).toEqual(["searchCancel", "b-1"]);
    expect(document.querySelectorAll(".search-table")).toHaveLength(2);

    // Done: the summary, a section per table, each column's count, its hits, the tables left out.
    handle.update?.(base({ options, run }));
    expect(text('[data-part="progress"]')).toBe("");
    expect(text('[data-part="summary"]')).toMatch(
      /^Found 5 rows in 4 tables \(5 columns\); 4 tables searched, 3 left out, in /u,
    );
    const tables = [...document.querySelectorAll(".search-table")].map((s) => [
      s.getAttribute("data-table"),
      [...s.querySelectorAll(".desk-badge")].map((b) => b.textContent),
      [...s.querySelectorAll(".search-column")].map((c) => c.textContent),
    ]);
    expect(tables).toEqual([
      ["public.customers", ["read in full"], ["emailcharacter varying(120)1 row", "notetext1 row"]],
      ["public.events", ["read in full", "no primary key: rows by ctid"], ["payloadjsonb1 row"]],
      ["public.orders", ["by an index"], ["idinteger1 row"]],
      ["sales.invoices", ["by an index"], ["numberinteger1 row"]],
    ]);
    expect([...document.querySelectorAll(".search-hit")].map((h) => h.textContent)).toEqual([
      "id 34242@example.com",
      "id 1called about order 4242",
      '(0,1){"order": 4242, "kind": "refund"}',
      "id 42424242",
      "id 14242",
    ]);
    expect([...document.querySelectorAll(".search-skipped li")].map((l) => l.textContent)).toEqual([
      "public.audit_log over the size limit: about 5 million rows",
      "public.secrets no permission to read it",
      "sales.big_log past its timeout",
    ]);
    expect(text(".search-notes")).toBe(
      "1 table has no column of the chosen kinds that can hold the value.",
    );
    document.querySelectorAll<HTMLButtonElement>(".search-hit")[2]?.click();
    expect(acts.at(-1)).toEqual(["searchOpen", "b-1", 1, 0, 0]);
    document.querySelectorAll<HTMLButtonElement>(".search-column")[1]?.click();
    expect(acts.at(-1)).toEqual(["searchOpen", "b-1", 0, 1, undefined]);
  });

  it("keeps what is being typed across an update, and says a failure", () => {
    const { handle } = draw(base());
    const value = document.querySelector<HTMLInputElement>(
      'input[name="value"]',
    ) as HTMLInputElement;
    value.focus();
    value.value = "42";
    handle.update?.(
      base({
        options: { ...defaults(), schemas: ["public"], value: "other" },
        error: "Type the value to find first.",
      }),
    );
    expect(value.value).toBe("42");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Type the value to find first.",
    );
    value.blur();
    handle.update?.(base({ options: { ...defaults(), schemas: ["sales"], value: "next" } }));
    expect(value.value).toBe("next");
    expect(
      [...document.querySelectorAll<HTMLInputElement>('input[name="schemas"]')].map(
        (s) => s.checked,
      ),
    ).toEqual([false, true]);
  });
});
