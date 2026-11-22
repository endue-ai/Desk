// @vitest-environment jsdom
// The export and import dialogs of connections on jsdom (#452, PG-15): export answers the ticked
// ids (All, None, nothing ticked holds the button); import shows each row's kind and what it does,
// the name a taken one is added under follows the ticks, and nothing ticked holds the button.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { exportDialog } from "../ui/features/connections-file/export-form.js";
import { importDialog } from "../ui/features/connections-file/import-form.js";
import { planImport } from "../ui/features/connections-file/plan.js";
import type { ImportModel } from "../ui/features/connections-file/transfer.js";
import { SAVED } from "./harness";

const SHOP = SAVED[1] as Connection;
const NOTES = SAVED[0] as Connection;

function shown<T>(
  render: (doc: Document, model: T, done: (answer?: unknown) => void) => HTMLElement,
  model: T,
) {
  const answers: unknown[] = [];
  const form = render(document, model, (answer) => answers.push(answer));
  document.body.replaceChildren(form);
  const q = <E extends Element>(s: string) => form.querySelector(s) as E;
  const submit = q<HTMLButtonElement>("button[type=submit]");
  const boxes = () => [...form.querySelectorAll<HTMLInputElement>(".connections-row input")];
  const click = (s: string) => q<HTMLElement>(s).click();
  const tick = (i: number, on: boolean) => {
    const box = boxes()[i] as HTMLInputElement;
    box.checked = on;
    box.dispatchEvent(new Event("change"));
  };
  const send = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
  return { form, answers, submit, boxes, click, tick, send, q };
}

describe("the connections dialogs", () => {
  it("export answers the ticked ids", () => {
    const d = shown(exportDialog, {
      connections: [
        { id: "c-prod", name: "Shop", detail: "PostgreSQL · production" },
        { id: "c-lite", name: "Notes", detail: "SQLite" },
      ],
      ticked: ["c-prod"],
    });
    expect(d.form.textContent).toContain("No password, passphrase or keychain entry goes into it.");
    expect(d.q("[data-part=count]").textContent).toBe("1 of 2 to export");
    d.click("[data-ctl=none]");
    expect(d.submit.disabled).toBe(true);
    d.send();
    expect(d.answers).toEqual([]);
    d.click("[data-ctl=all]");
    expect(d.q("[data-part=count]").textContent).toBe("2 of 2 to export");
    d.tick(1, false);
    d.send();
    expect(d.answers).toEqual([{ ids: ["c-prod"] }]);
    d.click(".buttons button[type=button]");
    expect(d.answers).toEqual([{ ids: ["c-prod"] }, undefined]);
  });

  it("import shows each row and the name a taken one gets", () => {
    const local = [SHOP, NOTES];
    const rows = planImport(local, [
      { conn: { ...SHOP, port: 5433 }, notes: [] },
      { conn: NOTES, notes: [] },
      { conn: { ...NOTES, id: "c-x", name: "Notes" }, notes: ["Left out: password."] },
    ]);
    const model: ImportModel = {
      file: "in.json",
      kind: "connections",
      version: 1,
      exported: "2026-11-22T09:00:00.000Z",
      local,
      rows,
    };
    const d = shown(importDialog, model);
    expect(d.q("h2").textContent).toBe("Import connections from in.json");
    expect(d.form.textContent).toContain("version 1, exported 2026-11-22");
    const rowsOf = [...d.form.querySelectorAll<HTMLElement>(".connections-row")];
    expect(rowsOf.map((r) => r.dataset.kind)).toEqual(["change", "same", "taken"]);
    expect(rowsOf[0]?.textContent).toContain("Changes port.");
    expect(rowsOf[2]?.textContent).toContain("A connection here is named Notes.");
    expect(rowsOf[2]?.textContent).toContain("Left out: password.");
    expect(d.boxes().map((b) => [b.checked, b.disabled])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(rowsOf[2]?.querySelector("[data-part=as]")?.textContent).toBe("");
    d.tick(2, true);
    expect(rowsOf[2]?.querySelector("[data-part=as]")?.textContent).toBe(" Imported as Notes (2).");
    d.click("[data-ctl=none]");
    expect(d.submit.disabled).toBe(true);
    expect(d.boxes()[1]?.checked).toBe(false);
    d.click("[data-ctl=all]");
    d.send();
    expect(d.answers).toEqual([{ ticked: [0, 2] }]);
  });
});
