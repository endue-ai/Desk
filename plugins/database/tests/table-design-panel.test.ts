// @vitest-environment jsdom
// The table form's DOM (ui/features/table-design/panel.js and its views): the header and the tabs
// with their counts, a column's fields, the script drawn again as a field is typed in (the focus
// kept) and the form drawn again when its shape changes (the focus restored), the marks set apart,
// the problems with Run held, CONCURRENTLY offered for a new index on an existing table, no Run on
// a read-only connection, the run's result with its failed step, and Mod+Enter.
import { describe, expect, it } from "vitest";
import type { DesignState } from "../ui/features/table-design/controller.js";
import { feature } from "../ui/features/table-design/index.js";
import type { Design } from "../ui/features/table-design/model.js";
import { designOf } from "../ui/features/table-design/read.js";
import { t } from "../ui/strings/index.js";
import { shopFacts, TABLES } from "./table-design-fixture";

const panel = feature.panels?.tableDesign;
if (!panel) throw new Error("the table design feature draws a tableDesign panel");
const buffer = { id: "b-1", connection: "c-dev", name: "table: Dev · public.people" };
const facts = shopFacts();

function people(): Design {
  const rows = TABLES["public.people"];
  if (!rows) throw new Error("people");
  return designOf(
    "public",
    "people",
    {
      table: [rows.table],
      columns: rows.columns,
      constraints: rows.constraints,
      indexes: rows.indexes,
    },
    facts,
  ).design;
}
function state(patch: Partial<DesignState> = {}): DesignState {
  const original = people();
  return {
    conn: { name: "Dev", readOnly: false, tag: "none" },
    mode: "change",
    target: { schema: "public", name: "people" },
    read: { facts, original, partitioned: "", partition: false },
    design: original,
    reading: false,
    error: "",
    tab: "columns",
    selected: {},
    refs: { schemas: ["public", "sales"], tables: { public: ["orders", "people"] }, columns: {} },
    run: null,
    ...patch,
  };
}
function draw(first: DesignState) {
  const acts: Array<[string, ...unknown[]]> = [];
  const made = panel?.render(
    document,
    first,
    (name, ...args) => void acts.push([name, ...args]),
    buffer,
  );
  const handle = made && "el" in made ? made : { el: made as HTMLElement, update: undefined };
  document.body.replaceChildren(handle.el);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    handle.el.querySelector<T>(selector);
  const keyed = <T extends HTMLElement = HTMLInputElement>(key: string) =>
    [...handle.el.querySelectorAll<T>("[data-key]")].find((n) => n.dataset.key === key) as T;
  const script = () => $('[data-part="script"]')?.textContent ?? "";
  /** The design the form sent last. */
  const sent = (): Design => {
    const last = acts.findLast(
      (a) => a[0] === "tableDesignEdit" && (a[2] as { design?: Design }).design,
    );
    if (!last) throw new Error("the form sent no design");
    return (last[2] as { design: Design }).design;
  };
  return { acts, handle, $, keyed, script, sent };
}
const type = (input: HTMLInputElement, value: string, done = false) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (done) input.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);

describe("the table form's panel", () => {
  it("draws the table, its tabs and a column, and holds Run while nothing changes", () => {
    const { $, handle, script } = draw(state());
    expect($(".td-title")?.textContent).toBe("Table public.people on Dev · PostgreSQL 17");
    expect([...handle.el.querySelectorAll(".desk-tab")].map((t) => t.textContent)).toEqual([
      "Columns (3)",
      "Keys (1)",
      "Foreign keys (0)",
      "Indexes (1)",
      "Table",
    ]);
    expect([...handle.el.querySelectorAll(".td-item-title")].map((t) => t.textContent)).toEqual([
      "id",
      "name",
      "joined",
    ]);
    expect($(".td-note")?.textContent).toBe(t("tableDesign.order"));
    expect(script()).toBe(t("tableDesign.nothing"));
    expect(button(handle.el, t("tableDesign.run"))?.disabled).toBe(true);
    expect(button(handle.el, t("tableDesign.openConsole"))?.disabled).toBe(true);
    expect($(".td-actions")?.textContent).toContain(
      "Nothing changes yet: the form is as the table is.",
    );
  });

  it("writes the script as a name is typed, keeping the field, and draws again on a change of shape", async () => {
    const first = state();
    const { acts, handle, $, keyed, script, sent } = draw(first);
    keyed<HTMLButtonElement>("cols:c2").click();
    const selected = (acts.at(-1)?.[2] as { selected?: Record<string, string> } | undefined)
      ?.selected;
    const name = keyed("col:c2:name");
    name.focus();
    type(name, "full name");
    expect(script()).toBe(
      'BEGIN;\n\nALTER TABLE "public"."people" RENAME COLUMN "name" TO "full name";\n\nCOMMIT;\n',
    );
    expect(document.activeElement).toBe(name);
    expect(sent().columns[1]?.name).toBe("full name");
    // The controller's echo of the same design draws the script alone.
    handle.update?.({ ...first, design: sent(), selected } as never);
    expect(keyed("col:c2:name")).toBe(name);

    // Left, the line draws the form again: its list says the rename, the focus stays.
    name.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(keyed("cols:c2").textContent).toBe("full nametext · NOT NULLrenamed");
    expect(document.activeElement).toBe(keyed("col:c2:name"));
    // Typed and clicked away at once: the click edits the design with what was typed.
    type(keyed("col:c2:comment"), "Who they are");
    // A dropped column: the form draws again, the row struck, its mark set apart.
    keyed<HTMLButtonElement>("col:c2:drop").focus();
    keyed<HTMLButtonElement>("col:c2:drop").click();
    expect(sent().columns[1]).toMatchObject({
      name: "full name",
      comment: "Who they are",
      dropped: true,
    });
    expect($(".td-struck .td-item-title")?.textContent).toBe("full name");
    expect([...handle.el.querySelectorAll(".td-mark")].map((m) => m.textContent)).toEqual([
      "-- Drops column name and its data for good.",
    ]);
    expect(document.activeElement?.textContent).toBe(t("tableDesign.keepColumn"));
    // Its index goes with it only when the person removes it too.
    expect($('[data-part="problems"]')?.textContent).toBe(
      "Index people_name holds full name, which is dropped: remove it too, or keep the column.",
    );
    expect(button(handle.el, t("tableDesign.run"))?.disabled).toBe(true);
    keyed<HTMLButtonElement>("tab:indexes").click();
    keyed<HTMLButtonElement>("idx:k16411:remove").click();
    expect(script()).toBe(
      'BEGIN;\n\nDROP INDEX "public"."people_name";\n\n-- Drops column name and its data for good.\nALTER TABLE "public"."people" DROP COLUMN "name";\n\nCOMMIT;\n',
    );
    expect(button(handle.el, t("tableDesign.run"))?.disabled).toBe(false);
    button(handle.el, t("tableDesign.run"))?.click();
    button(handle.el, t("tableDesign.dryRun"))?.click();
    button(handle.el, t("tableDesign.openConsole"))?.click();
    expect(acts.filter((a) => a[0] !== "tableDesignEdit")).toEqual([
      ["tableDesignRun", "b-1"],
      ["tableDesignDryRun", "b-1"],
      ["tableDesignConsole", "b-1"],
    ]);
  });

  it("says what it will not write and holds Run; Mod+Enter runs only a script that can run", () => {
    const { acts, handle, $, keyed } = draw(state({ selected: { columns: "c3" } }));
    const kind = keyed("col:c3:type");
    kind.focus();
    type(kind, "boolean", true);
    expect($('[data-part="problems"]')?.textContent).toBe(
      "PostgreSQL has no automatic cast from timestamp with time zone to boolean for column joined, so the change needs USING, which the form does not write: open the script in a console and add USING with an expression, or keep the type.",
    );
    expect(document.activeElement).toBe(keyed("col:c3:type"));
    expect(button(handle.el, t("tableDesign.run"))?.disabled).toBe(true);
    expect(button(handle.el, t("tableDesign.openConsole"))?.disabled).toBe(false);
    const enter = () =>
      handle.el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    enter();
    expect(acts.some((a) => a[0] === "tableDesignRun")).toBe(false);
    type(keyed("col:c3:type"), "text", true);
    enter();
    expect(acts.at(-1)).toEqual(["tableDesignRun", "b-1"]);
  });

  it("offers CONCURRENTLY for a new index on an existing table, after the transaction", () => {
    const { handle, keyed, script } = draw(state({ tab: "indexes" }));
    keyed<HTMLButtonElement>("idx:add").click();
    const id =
      [...handle.el.querySelectorAll<HTMLElement>(".td-item")].at(-1)?.dataset.key?.slice(4) ?? "";
    type(keyed(`idx:${id}:name`), "people_joined", true);
    keyed<HTMLButtonElement>(`idx:${id}:keys:add`).click();
    const pick = keyed<HTMLSelectElement>(`idx:${id}:keys:0:pick`);
    pick.value = "c3";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    const concurrently = keyed(`idx:${id}:concurrently`);
    concurrently.checked = true;
    concurrently.dispatchEvent(new Event("change", { bubbles: true }));
    expect(script()).toBe(
      '-- CONCURRENTLY: runs after the transaction, on its own, while writes go on; if it fails, an invalid index is left to drop.\nCREATE INDEX CONCURRENTLY "people_joined" ON "public"."people" USING "btree" ("joined");\n',
    );
    expect(handle.el.querySelector(".td-script-head .td-hint")?.textContent).toBe(
      "Runs in one transaction; the CONCURRENTLY indexes run after it commits, each on its own.",
    );
    expect(button(handle.el, t("tableDesign.dryRun"))?.disabled).toBe(true);
    // The kept index has no CONCURRENTLY: it exists.
    keyed<HTMLButtonElement>("idx:k16411").click();
    expect(keyed("idx:k16411:concurrently")).toBeUndefined();
  });

  it("shows a read-only connection's script with no Run, and a run's result with its failed step", () => {
    const original = people();
    const dropped: Design = {
      ...original,
      columns: original.columns.map((c) => (c.id === "c3" ? { ...c, dropped: true } : c)),
    };
    const locked = draw(
      state({ conn: { name: "Locked", readOnly: true, tag: "none" }, design: dropped }),
    );
    expect(button(locked.handle.el, t("tableDesign.run"))).toBeUndefined();
    expect(button(locked.handle.el, t("tableDesign.dryRun"))).toBeUndefined();
    expect(locked.$('[data-part="read-only"]')?.textContent).toBe(
      t("tableDesign.readOnly", { name: "Locked" }),
    );
    expect(locked.script()).toContain('DROP COLUMN "joined";');

    const failed = draw(
      state({
        conn: { name: "Shop", readOnly: false, tag: "production" },
        design: dropped,
        run: { status: "failed", dry: false, message: "Step 1 failed: no.", step: 0 },
      }),
    );
    expect(failed.$(".tag-production")?.textContent).toBe("production");
    expect(failed.$(".td-failed")?.textContent).toBe(
      '-- Drops column joined and its data for good.\nALTER TABLE "public"."people" DROP COLUMN "joined";',
    );
    expect(failed.$('[data-part="result"]')?.className).toContain("desk-error");
    expect(failed.$('[data-part="result"]')?.textContent).toBe("Step 1 failed: no.");
  });

  it("partitions a new table and moves its columns", () => {
    const blankState = state({
      mode: "create",
      target: { schema: "public", name: "" },
      read: { facts, original: null, partitioned: "", partition: false },
      design: {
        schema: "public",
        name: "events",
        comment: "",
        owner: "",
        columns: [
          {
            id: "n1",
            name: "id",
            type: "bigint",
            length: "",
            array: false,
            nullable: true,
            default: "",
            identity: "",
            generated: "",
            comment: "",
          },
          {
            id: "n2",
            name: "day",
            type: "date",
            length: "",
            array: false,
            nullable: true,
            default: "",
            identity: "",
            generated: "",
            comment: "",
          },
        ],
        primaryKey: null,
        uniques: [],
        checks: [],
        foreignKeys: [],
        indexes: [],
        others: [],
        partition: { by: "", keys: [] },
        seq: 2,
      },
      tab: "columns",
      selected: { columns: "n2" },
    });
    const { keyed, script, handle, sent } = draw(blankState);
    expect(handle.el.querySelector(".td-title")?.textContent).toBe(
      "New table in public on Dev · PostgreSQL 17",
    );
    keyed<HTMLButtonElement>("col:n2:up").click();
    expect(sent().columns.map((c) => c.name)).toEqual(["day", "id"]);
    keyed<HTMLButtonElement>("tab:table").click();
    const by = keyed<HTMLSelectElement>("table:partition");
    by.value = "range";
    by.dispatchEvent(new Event("change", { bubbles: true }));
    if (!keyed("table:partkeys:0:pick")) keyed<HTMLButtonElement>("table:partkeys:add").click();
    const pick = keyed<HTMLSelectElement>("table:partkeys:0:pick");
    pick.value = "n2";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(script()).toContain(') PARTITION BY RANGE ("day");');
    expect(script()).toContain("-- Rows go into its partitions");
  });
});
