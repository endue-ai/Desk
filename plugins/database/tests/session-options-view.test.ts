// @vitest-environment jsdom
// A PostgreSQL connection's session options on the page (PG-12): the form folds them under
// "Session options", open when the connection sets one, and hands them back on Save; the header says
// the role and the search path of a PostgreSQL console's connection; a connections file carries the
// options but never the startup script.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { normalize } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { entryOf } from "../ui/features/connections-file/file.js";
import { applyImport, planImport } from "../ui/features/connections-file/plan.js";
import { createBars } from "../ui/view-bars.js";
import { createForms } from "../ui/view-form.js";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SHOP = normalize({
  id: "c-shop",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  database: "shop",
  user: "app",
  searchPath: "app, public",
  role: "reporting",
  startup: "set work_mem = '64MB'",
} as Partial<Connection>);
const PLAIN = normalize({
  ...SHOP,
  id: "c-plain",
  name: "Plain",
  searchPath: "",
  role: "",
  startup: "",
});

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

describe("the session options on the page", () => {
  it("the form shows them open when set, and hands them back on Save", () => {
    const acted: unknown[][] = [];
    const forms = createForms(document, (...args) => void acted.push(args));
    forms.form({ mode: "edit", fields: SHOP, error: "", note: "" });
    const options = byId<HTMLDetailsElement>("f-options");
    expect(options.hidden).toBe(false);
    expect(options.open).toBe(true);
    expect(byId<HTMLInputElement>("f-searchPath").value).toBe("app, public");
    expect(byId<HTMLTextAreaElement>("f-startup").value).toBe("set work_mem = '64MB'");
    byId<HTMLInputElement>("f-timeZone").value = "UTC";
    byId<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(acted.at(-1)?.[0]).toBe("formSave");
    expect(acted.at(-1)?.[1]).toMatchObject({
      searchPath: "app, public",
      role: "reporting",
      timeZone: "UTC",
      startup: "set work_mem = '64MB'",
    });
    forms.form(null);
    forms.form({ mode: "edit", fields: PLAIN, error: "", note: "" });
    expect(options.open).toBe(false);
    const engine = byId<HTMLSelectElement>("f-engine");
    engine.value = "sqlite";
    engine.dispatchEvent(new Event("change"));
    expect(options.hidden).toBe(true);
  });

  it("the header says the role and the search path of a PostgreSQL console's connection", () => {
    const bars = createBars(document);
    const console = { kind: "console", name: "Shop", connection: SHOP.id } as never;
    bars.header(console, SHOP);
    expect(byId("session-options").hidden).toBe(false);
    expect(byId("session-options").textContent).toBe("as reporting · app, public");
    bars.header(console, PLAIN);
    expect(byId("session-options").hidden).toBe(true);
  });

  it("a connections file carries the options, never the startup script", () => {
    const entry = entryOf(SHOP) as Record<string, unknown>;
    expect(entry.searchPath).toBe("app, public");
    expect(entry.role).toBe("reporting");
    expect("startup" in entry).toBe(false);
    expect("searchPath" in (entryOf(PLAIN) as Record<string, unknown>)).toBe(false);
  });

  it("an import that changes a connection names the options and keeps the startup script here", () => {
    const fromFile = normalize({ ...entryOf(SHOP), searchPath: "audit" } as Partial<Connection>);
    const rows = planImport([SHOP], [{ conn: fromFile, notes: [] }]);
    expect(rows[0]?.changes).toEqual(["search path"]);
    expect(applyImport([SHOP], rows, [0])[0]?.conn.startup).toBe("set work_mem = '64MB'");
    // Read-only now, the file's connection would refuse a write: the script that writes goes.
    const writes = normalize({ ...SHOP, startup: "insert into log values (1)" });
    const readOnly = normalize({ ...entryOf(writes), readOnly: true } as Partial<Connection>);
    const kept = applyImport([writes], planImport([writes], [{ conn: readOnly, notes: [] }]), [0]);
    expect(kept[0]?.conn.readOnly).toBe(true);
    expect(kept[0]?.conn.startup).toBeUndefined();
  });
});
