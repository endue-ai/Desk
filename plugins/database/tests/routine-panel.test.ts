// @vitest-environment jsdom
// The routine form's DOM (ui/features/routines/panel.js, fields.js): a row per argument with its
// name, mode, type and default, the typed cell editors drawn in the row, NULL and DEFAULT as
// choices, VARIADIC as a list, the call drawn again as values change, the rollback choice, a
// refusal, and the keys.
import { describe, expect, it } from "vitest";
import type { Entry } from "../ui/features/routines/call.js";
import type { RoutineState } from "../ui/features/routines/controller.js";
import { feature } from "../ui/features/routines/index.js";
import { routineOf } from "../ui/features/routines/read.js";
import { ROUTINES } from "./routine-fixture";

const panel = feature.panels?.routine;
if (!panel) throw new Error("the routines feature draws a routine panel");
const buffer = { id: "b-1", connection: "c-warehouse", name: "routine: warehouse · x" };
const routine = (name: string) => {
  const f = ROUTINES.find((r) => r.name === name);
  if (!f) throw new Error(name);
  return routineOf(
    [
      ...[f.oid, "public", f.name, f.prokind, f.volatility, f.set ? "t" : "f", f.identity],
      ...[f.result, f.language, ...f.returns, f.controls ? "t" : "f", "170006", "UTC"],
    ],
    f.args,
  );
};
const state = (name: string, patch: Partial<RoutineState> = {}): RoutineState => {
  const r = routine(name);
  return {
    conn: { name: "warehouse", readOnly: false, tag: "none" },
    oid: r.oid,
    routine: r,
    reading: false,
    error: "",
    entries: [],
    rollback: false,
    running: false,
    last: null,
    reads: 1,
    ...patch,
  };
};
function draw(first: RoutineState) {
  const acts: Array<[string, ...unknown[]]> = [];
  const made = panel?.render(
    document,
    first,
    (name, ...args) => acts.push([name, ...args]),
    buffer,
  );
  const handle = made && "el" in made ? made : { el: made as HTMLElement };
  document.body.replaceChildren(handle.el);
  const $ = (selector: string) => handle.el.querySelector<HTMLElement>(selector);
  return { acts, handle, $, statement: () => $('[data-part="statement"]')?.textContent };
}
const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("the routine form", () => {
  it("draws a field per argument with its type's editor, NULL and DEFAULT as choices, VARIADIC as a list, the statement as values change, and runs on Mod+Enter", () => {
    const { acts, $, statement, handle } = draw(state("recent_orders"));
    expect($(".routine-title")?.textContent).toBe(
      "Function public.recent_orders(since date, status order_status) on warehouse",
    );
    expect($('[data-part="facts"]')?.textContent).toBe(
      "Returns TABLE(id integer, total numeric) · sql · STABLE: it only reads, so it runs as a read.",
    );
    const rows = [...handle.el.querySelectorAll<HTMLElement>(".routine-arg")];
    expect(rows.map((r) => r.querySelector(".routine-arg-head")?.textContent)).toEqual([
      "sinceINdate",
      "statusINorder_statusDEFAULT 'paid'::order_status",
      "idTABLEinteger",
      "totalTABLEnumeric",
    ]);
    // since: a date with its picker, no DEFAULT; status: an enum's labels, on its DEFAULT.
    const since = rows[0] as HTMLElement;
    expect([...since.querySelectorAll("[data-choice]")].map((b) => b.textContent)).toEqual([
      "Value",
      "NULL",
    ]);
    const status = rows[1] as HTMLElement;
    expect(status.querySelector('[data-choice="default"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(status.querySelector<HTMLElement>(".routine-arg-editor")?.hidden).toBe(true);
    expect(rows[2]?.textContent).toContain("Comes back as a column of the result.");
    // Nothing typed yet: the date's check stops the call, and Run is off.
    expect($('[data-part="problem"]')?.textContent).toMatch(/^since: A date is YYYY-MM-DD/u);
    expect($('[data-ctl="run"]')?.hasAttribute("disabled")).toBe(true);
    type(since.querySelector("input") as HTMLInputElement, "2026-02-30");
    expect(since.querySelector(".routine-arg-error")?.textContent).toBe(
      "February 2026 has 28 days.",
    );
    type(since.querySelector("input") as HTMLInputElement, "2026-11-01");
    expect(since.querySelector<HTMLElement>(".routine-arg-error")?.hidden).toBe(true);
    expect(statement()).toBe("SELECT * FROM public.recent_orders(since => '2026-11-01'::date)");
    expect(acts.at(-1)).toEqual([
      "routineView",
      "b-1",
      {
        entries: [
          { choice: "value", value: "2026-11-01" },
          { choice: "default", value: "" },
        ],
      },
    ]);
    // A label of the enum, by a click.
    (status.querySelector('[data-choice="value"]') as HTMLElement).click();
    (status.querySelector('[role="option"]:nth-child(3)') as HTMLElement).click();
    expect(statement()).toBe(
      "SELECT * FROM public.recent_orders(since => '2026-11-01'::date, status => 'shipped'::order_status)",
    );
    // Alt+N in a row makes it NULL.
    key(status.querySelector('[role="listbox"]') as HTMLElement, {
      altKey: true,
      code: "KeyN",
      key: "n",
    });
    expect(statement()).toBe(
      "SELECT * FROM public.recent_orders(since => '2026-11-01'::date, status => NULL::order_status)",
    );
    expect($('[data-ctl="run"]')?.hasAttribute("disabled")).toBe(false);
    key(since, { metaKey: true, key: "Enter" });
    const ran = acts.at(-1) as [string, string, Entry[]];
    expect(ran.slice(0, 2)).toEqual(["routineRun", "b-1"]);
    expect(ran[2]?.slice(0, 2)).toEqual([
      { choice: "value", value: "2026-11-01" },
      { choice: "null", value: "shipped" },
    ]);
  });

  it("draws VARIADIC as a list of its elements, a boolean as a toggle, and the rollback choice of a write", () => {
    const { $, statement, acts, handle } = draw(state("total_of"));
    const list = $(".cell-editor-elements") as HTMLElement;
    expect(list).not.toBeNull();
    ($('[data-do="add"]') as HTMLElement).click();
    ($('[data-do="add"]') as HTMLElement).click();
    const inputs = [...list.querySelectorAll<HTMLInputElement>("input")];
    type(inputs[0] as HTMLInputElement, "4");
    type(inputs[1] as HTMLInputElement, "x");
    expect($(".routine-arg-error")?.textContent).toMatch(
      /^The array's element 2: x is not a whole number/u,
    );
    type(inputs[1] as HTMLInputElement, "5");
    expect(statement()).toBe("SELECT public.total_of(VARIADIC amounts => '{4,5}'::integer[])");
    expect($('[data-part="rollback"]')?.hidden).toBe(true);

    // A volatile function offers to roll back, said plainly; the choice goes to the controller.
    const write = draw(state("archive_orders"));
    expect(write.$('[data-part="facts"]')?.textContent).toContain("VOLATILE: it may change data");
    expect(write.$('[data-part="rollback"]')?.hidden).toBe(false);
    expect(write.$('[data-part="rollback"]')?.textContent).toContain(
      "what it writes in this database is undone at the end",
    );
    const check = write.$('[data-ctl="rollback"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(write.acts.at(-1)).toEqual(["routineView", "b-1", { rollback: true }]);
    write.handle.update?.(state("archive_orders", { rollback: true }));
    expect(write.$('[data-ctl="run"]')?.textContent).toBe("Run and roll back");

    // A boolean: true and false, NULL as the row's own choice.
    const flags = routine("archive_orders");
    const bool = ["1", "keep", "i", "boolean", "b", "bool", "bool", "B", "", "", "{}", "true"];
    const withFlag = {
      ...flags,
      args: routineOf([flags.oid, "public", "flagged", "f", "v"], [bool]).args,
    };
    const flagged = draw(state("archive_orders", { routine: withFlag }));
    (flagged.$('[data-choice="value"]') as HTMLElement).click();
    expect(
      [...(flagged.handle.el.querySelectorAll(".routine-arg-editor .desk-tab") ?? [])].map(
        (b) => b.textContent,
      ),
    ).toEqual(["true", "false"]);
    (flagged.$('.routine-arg-editor [data-value="f"]') as HTMLElement).click();
    expect(flagged.statement()).toBe("SELECT public.archive_orders(keep => FALSE)");
    expect(acts.length).toBeGreaterThan(0);
    expect(handle.el.isConnected).toBe(false);
  });

  it("says a refusal, a procedure that runs outside a transaction block, a failed read and the last run, and g reads again", () => {
    const locked = draw(
      state("archive_orders", { conn: { name: "locked", readOnly: true, tag: "none" } }),
    );
    expect(locked.$('[data-part="refused"]')?.textContent).toBe(
      "locked is read-only: public.archive_orders is VOLATILE, so it may change data; it does not run there, not even rolled back.",
    );
    expect(locked.$('[data-ctl="run"]')?.hasAttribute("disabled")).toBe(true);

    const commits = draw(state("nightly_close"));
    expect(commits.$('[data-part="control"]')?.hidden).toBe(false);
    expect(commits.$('[data-part="control"]')?.textContent).toContain(
      "Outside a transaction block",
    );
    expect(commits.$('[data-part="rollback"]')?.hidden).toBe(true);
    expect(commits.statement()).toBe("CALL public.nightly_close()");
    expect(commits.$(".routine-args")?.textContent).toContain("It takes no arguments.");

    const proc = draw(state("restock"));
    expect(proc.$('[data-arg="2"]')?.textContent).toContain(
      "Passed as NULL; its value comes back as a column of the result.",
    );
    type(proc.$('[data-arg="1"] input') as HTMLInputElement, "bolt");
    expect(proc.statement()).toBe("CALL public.restock(item => 'bolt'::text, note => NULL::text)");
    proc.handle.update?.(
      state("restock", {
        last: {
          status: "done",
          summary: "Done: 1 of 1 statement ran in 4 ms",
          console: "warehouse",
          sql: "CALL public.restock()",
          rolledBack: false,
        },
      }),
    );
    // The fields stay as typed across a new state of the same read.
    expect((proc.$('[data-arg="1"] input') as HTMLInputElement).value).toBe("bolt");
    expect(proc.$('[data-part="last"]')?.textContent).toBe(
      "Last run, in the console warehouse: Done: 1 of 1 statement ran in 4 ms.",
    );
    key(proc.$('[data-part="statement"]') as HTMLElement, { key: "g" });
    expect(proc.acts.at(-1)).toEqual(["routineRefresh", "b-1"]);
    const before = proc.acts.length;
    key(proc.$('[data-arg="1"] input') as HTMLElement, { key: "g" });
    expect(proc.acts.slice(before).some(([name]) => name === "routineRefresh")).toBe(false);

    const failed = draw(
      state("restock", {
        routine: null,
        error: "This routine is gone: it was dropped or made again.",
      }),
    );
    expect(failed.$('[data-part="error"]')?.hidden).toBe(false);
    expect(failed.$('[data-part="error"]')?.textContent).toContain("This routine is gone");
    expect(failed.$('[data-part="statement"]')?.hidden).toBe(true);
    (failed.$('[data-part="error"] [data-ctl="refresh"]') as HTMLElement).click();
    expect(failed.acts.at(-1)).toEqual(["routineRefresh", "b-1"]);
  });
});
